/**
 * ============================================================
 *  FLOWORKOS™ Context Guard
 *  FLOWORKOS™ native context window guard
 * ============================================================
 *  Logic: Real-time monitor for context window usage.
 *  - Track per-message token impact
 *  - Warn before context overflow
 *  - Auto-trim system messages
 *  - Track context budget over time
 * ============================================================
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────
  const DEFAULT_CONFIG = {
    maxTokens: 128000,      // Default context window (GPT-4 class)
    warnThreshold: 0.75,    // Warn at 75% usage
    criticalThreshold: 0.90, // Critical at 90%
    autoTrimAt: 0.85,       // Auto-trim at 85%
    reserveForOutput: 4096, // Reserve tokens for output
    trackHistory: true,     // Keep usage history
    historyMaxEntries: 100, // Max history entries
  };

  // ── Model Context Windows ──────────────────────────────────
  const MODEL_CONTEXT_WINDOWS = {
    // Google
    'gemini-2.5-pro': 1048576,
    'gemini-2.5-flash': 1048576,
    'gemini-2.0-flash': 1048576,
    'gemini-1.5-pro': 2097152,
    'gemini-1.5-flash': 1048576,
    // OpenAI
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'o3': 200000,
    'o3-mini': 200000,
    'o1': 200000,
    'gpt-4-turbo': 128000,
    // Anthropic
    'claude-sonnet-4-20250514': 200000,
    'claude-3-5-sonnet': 200000,
    'claude-3-opus': 200000,
    'claude-3-haiku': 200000,
    // xAI
    'grok-3': 131072,
    'grok-3-mini': 131072,
    // DeepSeek
    'deepseek-chat': 64000,
    'deepseek-reasoner': 64000,
    // Groq
    'llama-3.3-70b-versatile': 128000,
    'mixtral-8x7b-32768': 32768,
    // Mistral
    'mistral-large-latest': 128000,
    // Cohere
    'command-r-plus': 128000,
  };

  // ── State ──────────────────────────────────────────────────
  let _config = { ...DEFAULT_CONFIG };
  const _usageHistory = [];
  let _currentModel = null;

  // ── Core Functions ─────────────────────────────────────────

  /**
   * Get the context window size for a model
   */
  function getContextWindow(model) {
    if (!model) return _config.maxTokens;

    // Exact match
    if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];

    // Partial match
    const modelLower = model.toLowerCase();
    for (const [key, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      if (modelLower.includes(key.toLowerCase())) return window;
    }

    return _config.maxTokens;
  }

  /**
   * Estimate current context usage
   */
  function estimateUsage(messages, model) {
    messages = messages || window.chatHistory || [];
    const contextWindow = getContextWindow(model || _currentModel);
    const availableForInput = contextWindow - _config.reserveForOutput;

    let totalChars = 0;
    let systemChars = 0;
    let userChars = 0;
    let assistantChars = 0;
    let toolChars = 0;

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      const chars = content.length;
      totalChars += chars;

      switch (msg.role) {
        case 'system': systemChars += chars; break;
        case 'user': userChars += chars; break;
        case 'assistant': case 'agent': assistantChars += chars; break;
        case 'tool': case 'function': toolChars += chars; break;
      }
    }

    // Token estimate (more accurate than simple /4)
    const estimator = window.FLOWORKOS_UsageTracking;
    const totalTokens = estimator
      ? messages.reduce((sum, m) => sum + estimator.estimateTokens(m.content), 0)
      : Math.ceil(totalChars / 3.5);

    const usageRatio = totalTokens / availableForInput;

    return {
      totalTokens,
      contextWindow,
      availableForInput,
      usageRatio,
      usagePercent: (usageRatio * 100).toFixed(1) + '%',
      messageCount: messages.length,
      breakdown: {
        system: Math.ceil(systemChars / 3.5),
        user: Math.ceil(userChars / 3.5),
        assistant: Math.ceil(assistantChars / 3.5),
        tool: Math.ceil(toolChars / 3.5),
      },
      status: usageRatio >= _config.criticalThreshold ? 'critical'
            : usageRatio >= _config.warnThreshold ? 'warning'
            : 'ok',
    };
  }

  /**
   * Check context health and return recommendations
   */
  function check(messages, model) {
    const usage = estimateUsage(messages, model);
    const recommendations = [];

    if (usage.status === 'critical') {
      recommendations.push('🔴 CRITICAL: Context nearly full. Compact immediately or start new session.');
      if (usage.breakdown.tool > usage.totalTokens * 0.3) {
        recommendations.push('💡 Tool outputs use >30% of context. Consider truncating tool results.');
      }
    } else if (usage.status === 'warning') {
      recommendations.push('🟡 WARNING: Context growing large. Consider compacting soon.');
    }

    if (usage.breakdown.system > usage.totalTokens * 0.2) {
      recommendations.push('💡 System messages use >20% of context. Consider trimming system prompts.');
    }

    if (usage.messageCount > 50) {
      recommendations.push(`💡 ${usage.messageCount} messages in history. Old messages can be summarized.`);
    }

    // Track history
    if (_config.trackHistory) {
      _usageHistory.push({
        timestamp: Date.now(),
        tokens: usage.totalTokens,
        ratio: usage.usageRatio,
        messages: usage.messageCount,
      });

      // Trim history
      while (_usageHistory.length > _config.historyMaxEntries) {
        _usageHistory.shift();
      }
    }

    return {
      ...usage,
      recommendations,
      shouldCompact: usage.usageRatio >= _config.autoTrimAt,
      shouldWarn: usage.usageRatio >= _config.warnThreshold,
    };
  }

  /**
   * Get usage trend (increasing/decreasing/stable)
   */
  function getTrend() {
    if (_usageHistory.length < 3) return { trend: 'unknown', samples: _usageHistory.length };

    const recent = _usageHistory.slice(-5);
    const ratios = recent.map(h => h.ratio);
    const avgRecent = ratios.slice(-2).reduce((a, b) => a + b, 0) / 2;
    const avgEarlier = ratios.slice(0, -2).reduce((a, b) => a + b, 0) / (ratios.length - 2);

    const diff = avgRecent - avgEarlier;
    return {
      trend: diff > 0.05 ? 'increasing' : diff < -0.05 ? 'decreasing' : 'stable',
      recentRatio: avgRecent,
      delta: diff,
      samples: _usageHistory.length,
    };
  }

  /**
   * Get compact status line for UI
   */
  function getStatusLine(model) {
    const usage = estimateUsage(undefined, model);
    const icon = usage.status === 'critical' ? '🔴' : usage.status === 'warning' ? '🟡' : '🟢';
    return `${icon} Context: ${usage.usagePercent} (${_formatTokens(usage.totalTokens)}/${_formatTokens(usage.availableForInput)})`;
  }

  function setModel(model) {
    _currentModel = model;
  }

  function setConfig(config) {
    _config = { ...DEFAULT_CONFIG, ...config };
  }

  function _formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_ContextGuard = {
    estimateUsage,
    check,
    getTrend,
    getStatusLine,
    getContextWindow,
    setModel,
    setConfig,
    MODEL_CONTEXT_WINDOWS,
    DEFAULT_CONFIG,
  };

  console.log('[FLOWORKOS] ✅ Context Guard loaded');
})();
