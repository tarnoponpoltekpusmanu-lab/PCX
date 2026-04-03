/**
 * ============================================================
 *  FLOWORKOS™ Smart Compaction Engine
 *  FLOWORKOS™ native smart context compaction engine
 * ============================================================
 *  Logic: When conversation context grows too large, intelligently
 *  compress the history while preserving:
 *  - Critical identifiers (file names, URLs, variable names)
 *  - Recent tool results
 *  - Error messages and stack traces
 *  - User preferences and decisions
 *  Strips: base64 images, long log blocks, redundant tool outputs
 * ============================================================
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────
  const DEFAULT_CONFIG = {
    maxContextChars: 120_000,         // ~30k tokens (chars/4 estimate)
    compactionTriggerRatio: 0.85,     // Compact when 85% full
    preserveRecentMessages: 6,        // Always keep last 6 messages
    preserveSystemPrompt: true,       // Never compact system prompt
    maxRetries: 2,                    // Retry compaction if first attempt fails
    stripBase64: true,                // Remove base64 encoded images
    stripLongLogs: true,              // Truncate long log outputs
    longLogThreshold: 2000,           // Chars before truncating logs
    preserveIdentifiers: true,        // Keep file names, URLs, etc.
  };

  // ── Identifier Extraction ──────────────────────────────────

  /**
   * Extract important identifiers from text that must be preserved
   */
  function extractIdentifiers(text) {
    if (typeof text !== 'string') return [];
    const identifiers = new Set();

    // File paths
    const filePaths = text.match(/[A-Za-z]:\\[^\s"'`<>|]+|\/[\w.-]+(?:\/[\w.-]+)+/g);
    if (filePaths) filePaths.forEach(p => identifiers.add(p));

    // URLs
    const urls = text.match(/https?:\/\/[^\s"'`<>]+/g);
    if (urls) urls.forEach(u => identifiers.add(u));

    // Function/variable names (camelCase or snake_case patterns)
    const funcNames = text.match(/\b[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+\b/g);
    if (funcNames) funcNames.forEach(f => identifiers.add(f));

    // Package names
    const packages = text.match(/(?:npm|pnpm|yarn)\s+(?:install|add)\s+([^\s]+)/g);
    if (packages) packages.forEach(p => identifiers.add(p));

    // Error names
    const errors = text.match(/\b\w+Error\b/g);
    if (errors) errors.forEach(e => identifiers.add(e));

    return [...identifiers];
  }

  // ── Content Sanitization (Pre-compact) ─────────────────────

  /**
   * Strip base64 encoded data from message content
   */
  function stripBase64(text) {
    if (typeof text !== 'string') return text;
    // Data URIs
    text = text.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]{100,}/g, '[BASE64_IMAGE_REMOVED]');
    // Raw base64 blobs (100+ chars of base64 alphabet)
    text = text.replace(/(?<![A-Za-z0-9])[A-Za-z0-9+/]{100,}={0,2}(?![A-Za-z0-9])/g, '[BASE64_DATA_REMOVED]');
    return text;
  }

  /**
   * Truncate long log/output blocks
   */
  function truncateLongLogs(text, threshold) {
    if (typeof text !== 'string') return text;
    threshold = threshold || DEFAULT_CONFIG.longLogThreshold;

    // Truncate code blocks that are too long
    return text.replace(/```[\s\S]*?```/g, (block) => {
      if (block.length <= threshold) return block;
      const lines = block.split('\n');
      const langLine = lines[0]; // ```language
      const firstLines = lines.slice(1, 6).join('\n');
      const lastLines = lines.slice(-5).join('\n');
      const removedCount = lines.length - 11;
      return `${langLine}\n${firstLines}\n... [${removedCount} lines truncated] ...\n${lastLines}\n\`\`\``;
    });
  }

  /**
   * Sanitize a single message before compaction
   */
  function sanitizeMessage(message, config) {
    config = { ...DEFAULT_CONFIG, ...config };
    if (!message || !message.content) return message;

    let content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);

    if (config.stripBase64) {
      content = stripBase64(content);
    }
    if (config.stripLongLogs) {
      content = truncateLongLogs(content, config.longLogThreshold);
    }

    return { ...message, content };
  }

  // ── Compaction Strategies ──────────────────────────────────

  /**
   * Strategy 1: Summarize old messages (keep recent ones intact)
   */
  function compactBySummarization(messages, config) {
    config = { ...DEFAULT_CONFIG, ...config };
    const preserveCount = config.preserveRecentMessages;

    if (messages.length <= preserveCount + 1) return messages; // Nothing to compact

    // Split: system + old + recent
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    const recentMessages = nonSystemMessages.slice(-preserveCount);
    const oldMessages = nonSystemMessages.slice(0, -preserveCount);

    if (oldMessages.length === 0) return messages;

    // Build summary of old messages
    const summary = _buildConversationSummary(oldMessages, config);

    // Construct compacted array
    const compacted = [
      ...systemMessages,
      {
        role: 'user',
        content: `[CONVERSATION SUMMARY — ${oldMessages.length} messages compacted]\n${summary}`,
      },
      {
        role: 'assistant',
        content: 'Understood. I have the context from our previous conversation. Continuing from where we left off.',
      },
      ...recentMessages,
    ];

    return compacted;
  }

  /**
   * Strategy 2: Strip tool results (keep tool calls but remove verbose results)
   */
  function compactToolResults(messages, config) {
    config = { ...DEFAULT_CONFIG, ...config };
    const preserveCount = config.preserveRecentMessages;

    return messages.map((msg, idx) => {
      // Don't touch recent messages
      if (idx >= messages.length - preserveCount) return msg;
      if (msg.role !== 'tool' && msg.role !== 'function') return msg;

      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (content.length <= 500) return msg; // Short results are fine

      // Extract key info and truncate
      const identifiers = extractIdentifiers(content);
      const firstLine = content.split('\n')[0].slice(0, 200);
      const truncated = `[Tool result truncated: ${content.length} chars → 200 chars]\n${firstLine}${identifiers.length > 0 ? '\n[Key identifiers: ' + identifiers.slice(0, 10).join(', ') + ']' : ''}`;

      return { ...msg, content: truncated };
    });
  }

  /**
   * Strategy 3: Remove duplicate/redundant messages
   */
  function removeDuplicates(messages) {
    const seen = new Set();
    const result = [];

    for (const msg of messages) {
      if (msg.role === 'system') { result.push(msg); continue; }

      const key = msg.role + ':' + (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      const hash = _simpleHash(key);

      if (seen.has(hash)) continue;
      seen.add(hash);
      result.push(msg);
    }

    return result;
  }

  // ── Main Compaction Pipeline ───────────────────────────────

  /**
   * Run the full compaction pipeline on a message array
   *
   * @param {Array} messages - Array of { role, content } messages
   * @param {Object} [config] - Override config
   * @returns {{ messages: Array, compacted: boolean, stats: Object }}
   */
  function compactMessages(messages, config) {
    // Support shorthand: compactMessages(msgs, 128000)
    if (typeof config === 'number') {
      config = { maxContextChars: config };
    }
    config = { ...DEFAULT_CONFIG, ...config };

    if (!Array.isArray(messages) || messages.length === 0) {
      return { messages, compacted: false, stats: { reason: 'empty' } };
    }

    // Measure current size
    const currentSize = _measureSize(messages);
    const triggerSize = config.maxContextChars * config.compactionTriggerRatio;

    if (currentSize < triggerSize) {
      return {
        messages,
        compacted: false,
        stats: {
          reason: 'under_threshold',
          currentSize,
          triggerSize,
          ratio: (currentSize / config.maxContextChars * 100).toFixed(1) + '%',
        },
      };
    }

    console.log(`[FLOWORKOS Compaction] Context at ${(currentSize / config.maxContextChars * 100).toFixed(1)}% (${currentSize}/${config.maxContextChars} chars). Compacting...`);

    let result = [...messages];
    let attempts = 0;

    // Phase 1: Sanitize all messages (strip base64, truncate logs)
    result = result.map(m => sanitizeMessage(m, config));
    let afterSanitize = _measureSize(result);

    // Phase 2: Remove duplicate messages
    result = removeDuplicates(result);

    // Phase 3: Compact tool results
    if (_measureSize(result) > triggerSize) {
      result = compactToolResults(result, config);
    }

    // Phase 4: Summarize old messages (most aggressive)
    while (_measureSize(result) > triggerSize && attempts < config.maxRetries) {
      result = compactBySummarization(result, config);
      attempts++;
    }

    const finalSize = _measureSize(result);

    const stats = {
      reason: 'compacted',
      originalSize: currentSize,
      finalSize,
      reduction: currentSize - finalSize,
      reductionPercent: ((1 - finalSize / currentSize) * 100).toFixed(1) + '%',
      originalMessages: messages.length,
      finalMessages: result.length,
      attempts,
    };

    console.log(`[FLOWORKOS Compaction] ✅ Reduced ${stats.reductionPercent}: ${currentSize} → ${finalSize} chars (${messages.length} → ${result.length} messages)`);

    return { messages: result, compacted: true, stats };
  }

  /**
   * Check if compaction is needed (without running it)
   */
  function shouldCompact(messages, config) {
    config = { ...DEFAULT_CONFIG, ...config };
    const currentSize = _measureSize(messages);
    const triggerSize = config.maxContextChars * config.compactionTriggerRatio;
    return {
      needed: currentSize >= triggerSize,
      currentSize,
      triggerSize,
      maxSize: config.maxContextChars,
      ratio: (currentSize / config.maxContextChars * 100).toFixed(1) + '%',
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  function _measureSize(messages) {
    let size = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') size += msg.content.length;
      else size += JSON.stringify(msg.content || '').length;
    }
    return size;
  }

  function _buildConversationSummary(messages, config) {
    const parts = [];
    let userRequests = 0;
    let toolCalls = 0;
    const identifiers = new Set();

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      if (msg.role === 'user') {
        userRequests++;
        // Keep first 150 chars of user messages
        parts.push(`• User asked: "${content.slice(0, 150)}${content.length > 150 ? '...' : ''}"`);
      } else if (msg.role === 'assistant') {
        // Summarize assistant actions
        const actions = content.match(/(?:created|modified|deleted|installed|configured|fixed|updated|built|deployed)\s+[^\n.]+/gi);
        if (actions) {
          actions.slice(0, 3).forEach(a => parts.push(`• AI: ${a.slice(0, 100)}`));
        }
      } else if (msg.role === 'tool' || msg.role === 'function') {
        toolCalls++;
      }

      // Collect identifiers
      if (config.preserveIdentifiers) {
        extractIdentifiers(content).forEach(id => identifiers.add(id));
      }
    }

    parts.push(`\n[Stats: ${userRequests} user messages, ${toolCalls} tool calls]`);

    if (identifiers.size > 0) {
      const idList = [...identifiers].slice(0, 20).join(', ');
      parts.push(`[Key identifiers preserved: ${idList}]`);
    }

    return parts.join('\n');
  }

  function _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Compaction = {
    compactMessages,
    shouldCompact,
    sanitizeMessage,
    stripBase64,
    truncateLongLogs,
    extractIdentifiers,
    compactBySummarization,
    compactToolResults,
    removeDuplicates,
    DEFAULT_CONFIG,
  };

  console.log('[FLOWORKOS] ✅ Smart Compaction Engine loaded');
})();
