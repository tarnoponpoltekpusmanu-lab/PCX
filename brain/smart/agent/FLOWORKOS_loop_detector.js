/**
 * ============================================================
 *  FLOWORKOS™ Tool Loop Detector
 *  FLOWORKOS™ native tool loop detection engine
 * ============================================================
 *  Logic: Track tool call history and detect when the AI agent
 *  is stuck in a repetitive loop. Supports:
 *  - Generic repeat detection (same tool+args N times)
 *  - Ping-pong detection (A→B→A→B oscillation)
 *  - No-progress detection (same result hash repeated)
 *  - Global circuit breaker (force stop after threshold)
 * ============================================================
 */

(function () {
  'use strict';

  // ── Configuration Defaults ─────────────────────────────────
  const DEFAULT_CONFIG = {
    enabled: true,                      // Active by default in Flowork
    historySize: 30,                    // Track last 30 tool calls
    warningThreshold: 5,                // Warn after 5 repeats
    criticalThreshold: 10,              // Block after 10 repeats (reduced from 20)
    globalCircuitBreakerThreshold: 15,  // Force stop after 15 (reduced from 30)
    detectors: {
      genericRepeat: true,
      knownPollNoProgress: true,
      pingPong: true,
    },
  };

  // ── Session State ──────────────────────────────────────────
  // Each session gets its own history
  const _sessionStates = new Map(); // sessionId → { toolCallHistory: [] }

  function _getState(sessionId) {
    sessionId = sessionId || 'default';
    if (!_sessionStates.has(sessionId)) {
      _sessionStates.set(sessionId, { toolCallHistory: [] });
    }
    return _sessionStates.get(sessionId);
  }

  // ── Hash Functions ─────────────────────────────────────────

  /**
   * Stable JSON stringify for deterministic hashing
   */
  function stableStringify(value) {
    if (value === null || value === undefined) return String(value);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }

  /**
   * Simple hash function (browser-compatible, no crypto needed)
   */
  function simpleHash(str) {
    let hash = 0;
    const s = typeof str === 'string' ? str : stableStringify(str);
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'h' + Math.abs(hash).toString(36);
  }

  /**
   * Hash a tool call (name + args)
   */
  function hashToolCall(toolName, params) {
    return toolName + ':' + simpleHash(params);
  }

  /**
   * Hash a tool call outcome (result or error)
   */
  function hashToolOutcome(toolName, params, result, error) {
    if (error !== undefined) {
      const msg = error instanceof Error ? error.message : String(error);
      return 'error:' + simpleHash(msg);
    }
    if (result === undefined) return undefined;

    // For known poll tools, extract meaningful state
    if (_isKnownPollTool(toolName, params)) {
      if (typeof result === 'object' && result !== null) {
        return simpleHash({
          status: result.status || result.details?.status,
          exitCode: result.exitCode || result.details?.exitCode,
          text: _extractText(result),
        });
      }
    }

    return simpleHash(result);
  }

  // ── Known Tool Patterns ────────────────────────────────────

  function _isKnownPollTool(toolName, params) {
    // Flowork-specific polling tools
    if (toolName === 'command_status') return true;
    if (toolName === 'check_status') return true;
    if (toolName === 'wait_for') return true;
    // Process poll pattern
    if (toolName === 'process' && typeof params === 'object') {
      return params?.action === 'poll' || params?.action === 'log';
    }
    return false;
  }

  function _extractText(result) {
    if (typeof result === 'string') return result.slice(0, 200);
    if (typeof result !== 'object' || !result) return '';
    if (Array.isArray(result.content)) {
      return result.content
        .filter(e => e && typeof e.text === 'string')
        .map(e => e.text)
        .join('\n')
        .slice(0, 200);
    }
    if (typeof result.text === 'string') return result.text.slice(0, 200);
    if (typeof result.output === 'string') return result.output.slice(0, 200);
    return '';
  }

  // ── Streak Detection ───────────────────────────────────────

  /**
   * Count consecutive identical no-progress results
   */
  function _getNoProgressStreak(history, toolName, argsHash) {
    let streak = 0;
    let latestResultHash = undefined;

    for (let i = history.length - 1; i >= 0; i--) {
      const record = history[i];
      if (record.toolName !== toolName || record.argsHash !== argsHash) continue;
      if (!record.resultHash) continue;

      if (!latestResultHash) {
        latestResultHash = record.resultHash;
        streak = 1;
        continue;
      }
      if (record.resultHash !== latestResultHash) break;
      streak++;
    }

    return { count: streak, latestResultHash };
  }

  /**
   * Detect ping-pong pattern (A→B→A→B)
   */
  function _getPingPongStreak(history, currentHash) {
    if (history.length < 3) return { count: 0, noProgressEvidence: false };

    const last = history[history.length - 1];
    if (!last) return { count: 0, noProgressEvidence: false };

    // Find the "other" call in the alternation
    let otherHash = null;
    let otherToolName = null;
    for (let i = history.length - 2; i >= 0; i--) {
      if (history[i].argsHash !== last.argsHash) {
        otherHash = history[i].argsHash;
        otherToolName = history[i].toolName;
        break;
      }
    }
    if (!otherHash) return { count: 0, noProgressEvidence: false };

    // Count alternating tail
    let alternatingCount = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const expected = alternatingCount % 2 === 0 ? last.argsHash : otherHash;
      if (history[i].argsHash !== expected) break;
      alternatingCount++;
    }

    if (alternatingCount < 3) return { count: 0, noProgressEvidence: false };

    // Check if current would continue the pattern
    if (currentHash !== otherHash) return { count: 0, noProgressEvidence: false };

    // Check no-progress evidence (same results each time)
    const tailStart = Math.max(0, history.length - alternatingCount);
    let noProgress = true;
    const resultA = new Set();
    const resultB = new Set();
    for (let i = tailStart; i < history.length; i++) {
      if (!history[i].resultHash) { noProgress = false; break; }
      if (history[i].argsHash === last.argsHash) resultA.add(history[i].resultHash);
      else resultB.add(history[i].resultHash);
    }
    if (resultA.size > 1 || resultB.size > 1) noProgress = false;

    return {
      count: alternatingCount + 1,
      pairedToolName: last.toolName,
      noProgressEvidence: noProgress,
    };
  }

  // ── Main Detection ─────────────────────────────────────────

  /**
   * Detect if the agent is stuck in a tool call loop
   *
   * @param {string} toolName - Name of the tool being called
   * @param {*} params - Tool parameters
   * @param {string} [sessionId] - Session identifier
   * @param {Object} [config] - Override detection config
   * @returns {{ stuck: boolean, level?: string, detector?: string, count?: number, message?: string }}
   */
  function detectToolCallLoop(toolName, params, sessionId, config) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (!cfg.enabled) return { stuck: false };

    const state = _getState(sessionId);
    const history = state.toolCallHistory || [];
    const currentHash = hashToolCall(toolName, params);
    const noProgress = _getNoProgressStreak(history, toolName, currentHash);
    const knownPoll = _isKnownPollTool(toolName, params);
    const pingPong = _getPingPongStreak(history, currentHash);

    // 1. Global circuit breaker
    if (noProgress.count >= cfg.globalCircuitBreakerThreshold) {
      return {
        stuck: true,
        level: 'critical',
        detector: 'global_circuit_breaker',
        count: noProgress.count,
        message: `🚨 CIRCUIT BREAKER: ${toolName} has repeated ${noProgress.count} times with no progress. Stopping to prevent infinite loop.`,
      };
    }

    // 2. Known poll tool no-progress (critical)
    if (knownPoll && cfg.detectors.knownPollNoProgress && noProgress.count >= cfg.criticalThreshold) {
      return {
        stuck: true,
        level: 'critical',
        detector: 'known_poll_no_progress',
        count: noProgress.count,
        message: `🚨 STUCK POLLING: ${toolName} called ${noProgress.count} times with same result. Process appears stuck. Stop polling and try a different approach.`,
      };
    }

    // 3. Known poll tool no-progress (warning)
    if (knownPoll && cfg.detectors.knownPollNoProgress && noProgress.count >= cfg.warningThreshold) {
      return {
        stuck: true,
        level: 'warning',
        detector: 'known_poll_no_progress',
        count: noProgress.count,
        message: `⚠️ POLL WARNING: ${toolName} called ${noProgress.count} times with same result. Consider increasing wait time or trying a different approach.`,
      };
    }

    // 4. Ping-pong critical (with no-progress evidence)
    if (cfg.detectors.pingPong && pingPong.count >= cfg.criticalThreshold && pingPong.noProgressEvidence) {
      return {
        stuck: true,
        level: 'critical',
        detector: 'ping_pong',
        count: pingPong.count,
        message: `🚨 PING-PONG LOOP: Alternating between tool calls ${pingPong.count} times with no progress. Stop and try a completely different approach.`,
        pairedToolName: pingPong.pairedToolName,
      };
    }

    // 5. Ping-pong warning
    if (cfg.detectors.pingPong && pingPong.count >= cfg.warningThreshold) {
      return {
        stuck: true,
        level: 'warning',
        detector: 'ping_pong',
        count: pingPong.count,
        message: `⚠️ OSCILLATION: Alternating tool calls detected (${pingPong.count} times). This looks like a ping-pong loop.`,
        pairedToolName: pingPong.pairedToolName,
      };
    }

    // 6. Generic repeat (non-poll tools)
    const recentCount = history.filter(h => h.toolName === toolName && h.argsHash === currentHash).length;
    if (!knownPoll && cfg.detectors.genericRepeat && recentCount >= cfg.warningThreshold) {
      return {
        stuck: true,
        level: recentCount >= cfg.criticalThreshold ? 'critical' : 'warning',
        detector: 'generic_repeat',
        count: recentCount,
        message: recentCount >= cfg.criticalThreshold
          ? `🚨 STUCK: ${toolName} called ${recentCount} times with identical arguments. Forcing stop.`
          : `⚠️ LOOP WARNING: ${toolName} called ${recentCount} times with identical arguments. Try a different approach.`,
      };
    }

    return { stuck: false };
  }

  // ── Recording ──────────────────────────────────────────────

  /**
   * Record a tool call in history (BEFORE execution)
   */
  function recordToolCall(toolName, params, sessionId, toolCallId) {
    const state = _getState(sessionId);
    if (!state.toolCallHistory) state.toolCallHistory = [];

    state.toolCallHistory.push({
      toolName,
      argsHash: hashToolCall(toolName, params),
      toolCallId,
      timestamp: Date.now(),
    });

    // Sliding window
    const maxSize = DEFAULT_CONFIG.historySize;
    while (state.toolCallHistory.length > maxSize) {
      state.toolCallHistory.shift();
    }
  }

  /**
   * Record tool call outcome (AFTER execution)
   */
  function recordToolCallOutcome(toolName, params, result, error, sessionId, toolCallId) {
    const state = _getState(sessionId);
    if (!state.toolCallHistory) return;

    const argsHash = hashToolCall(toolName, params);
    const resultHash = hashToolOutcome(toolName, params, result, error);
    if (!resultHash) return;

    // Find matching unresolved call and attach result
    for (let i = state.toolCallHistory.length - 1; i >= 0; i--) {
      const call = state.toolCallHistory[i];
      if (toolCallId && call.toolCallId !== toolCallId) continue;
      if (call.toolName !== toolName || call.argsHash !== argsHash) continue;
      if (call.resultHash !== undefined) continue;
      call.resultHash = resultHash;
      return;
    }

    // No matching call found, add with result
    state.toolCallHistory.push({
      toolName,
      argsHash,
      toolCallId,
      resultHash,
      timestamp: Date.now(),
    });
  }

  // ── Stats & Debug ──────────────────────────────────────────

  function getToolCallStats(sessionId) {
    const state = _getState(sessionId);
    const history = state.toolCallHistory || [];
    const patterns = new Map();

    for (const call of history) {
      const existing = patterns.get(call.argsHash);
      if (existing) existing.count++;
      else patterns.set(call.argsHash, { toolName: call.toolName, count: 1 });
    }

    let mostFrequent = null;
    for (const p of patterns.values()) {
      if (!mostFrequent || p.count > mostFrequent.count) mostFrequent = p;
    }

    return {
      totalCalls: history.length,
      uniquePatterns: patterns.size,
      mostFrequent,
    };
  }

  function resetSession(sessionId) {
    _sessionStates.delete(sessionId || 'default');
  }

  function resetAll() {
    _sessionStates.clear();
    console.log('[FLOWORKOS] Loop detector state cleared');
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_LoopDetector = {
    detectToolCallLoop,
    recordToolCall,
    recordToolCallOutcome,
    getToolCallStats,
    resetSession,
    resetAll,
    hashToolCall,
    // Config access
    DEFAULT_CONFIG,
  };

  console.log('[FLOWORKOS] ✅ Tool Loop Detector loaded');
})();
