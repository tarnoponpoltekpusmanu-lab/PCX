/**
 * ============================================================
 *  FLOWORKOS™ Usage Tracking & Cost Monitor
 *  FLOWORKOS™ native usage tracking engine
 * ============================================================
 *  Logic: Track token usage and estimate costs per provider/model.
 *  Provides real-time usage stats, session totals, and daily/monthly
 *  cost estimates.
 * ============================================================
 */

(function () {
  'use strict';

  // ── Pricing Table (USD per 1M tokens, as of 2026) ──────────
  const PRICING = {
    // Google
    'gemini-2.5-pro':       { input: 1.25,  output: 10.00,  cached: 0.315 },
    'gemini-2.5-flash':     { input: 0.15,  output: 0.60,   cached: 0.0375 },
    'gemini-2.0-flash':     { input: 0.10,  output: 0.40,   cached: 0.025 },
    'gemini-1.5-pro':       { input: 1.25,  output: 5.00,   cached: 0.315 },
    'gemini-1.5-flash':     { input: 0.075, output: 0.30,   cached: 0.02 },
    // OpenAI
    'gpt-4o':               { input: 2.50,  output: 10.00,  cached: 1.25 },
    'gpt-4o-mini':          { input: 0.15,  output: 0.60,   cached: 0.075 },
    'o3':                   { input: 10.00, output: 40.00,  cached: 2.50 },
    'o3-mini':              { input: 1.10,  output: 4.40,   cached: 0.55 },
    'o1':                   { input: 15.00, output: 60.00,  cached: 7.50 },
    // Anthropic
    'claude-sonnet-4-20250514':   { input: 3.00,  output: 15.00,  cached: 0.30 },
    'claude-3-5-sonnet':    { input: 3.00,  output: 15.00,  cached: 0.30 },
    'claude-3-opus':        { input: 15.00, output: 75.00,  cached: 7.50 },
    'claude-3-haiku':       { input: 0.25,  output: 1.25,   cached: 0.03 },
    // xAI
    'grok-3':               { input: 3.00,  output: 15.00,  cached: 0.75 },
    'grok-3-mini':          { input: 0.30,  output: 0.50,   cached: 0.075 },
    // DeepSeek
    'deepseek-chat':        { input: 0.27,  output: 1.10,   cached: 0.07 },
    'deepseek-reasoner':    { input: 0.55,  output: 2.19,   cached: 0.14 },
    // Groq (free/cheap)
    'llama-3.3-70b-versatile': { input: 0.59, output: 0.79, cached: 0.15 },
    'mixtral-8x7b-32768':   { input: 0.24,  output: 0.24,   cached: 0.06 },
    // Mistral
    'mistral-large-latest': { input: 2.00,  output: 6.00,   cached: 0.50 },
    // Cohere
    'command-r-plus':       { input: 2.50,  output: 10.00,  cached: 0.625 },
  };

  // ── Session State ──────────────────────────────────────────
  const _sessions = new Map(); // sessionId → usage data
  const _dailyUsage = { date: _today(), totalCost: 0, totalTokens: 0, calls: 0 };

  function _today() {
    return new Date().toISOString().split('T')[0];
  }

  function _getSession(sessionId) {
    sessionId = sessionId || 'default';
    if (!_sessions.has(sessionId)) {
      _sessions.set(sessionId, {
        id: sessionId,
        startedAt: Date.now(),
        calls: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        totalCost: 0,
        callCount: 0,
      });
    }
    return _sessions.get(sessionId);
  }

  // ── Token Estimation ───────────────────────────────────────

  /**
   * Estimate token count from text (simple approximation)
   * More accurate than chars/4: considers whitespace and punctuation
   */
  function estimateTokens(text) {
    if (!text) return 0;
    if (typeof text !== 'string') text = JSON.stringify(text);

    // Better estimation based on GPT tokenizer patterns:
    // ~1 token per 4 chars for English, ~1 per 3 chars for code
    const hasCode = /[{}\[\]();=<>]/.test(text);
    const ratio = hasCode ? 3.2 : 4.0;
    return Math.ceil(text.length / ratio);
  }

  // ── Cost Calculation ───────────────────────────────────────

  /**
   * Calculate cost for a given model and token usage
   */
  function calculateCost(model, inputTokens, outputTokens, cachedTokens) {
    const pricing = _findPricing(model);
    if (!pricing) return null;

    cachedTokens = cachedTokens || 0;
    const effectiveInput = Math.max(0, inputTokens - cachedTokens);

    const inputCost = (effectiveInput / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const cachedCost = (cachedTokens / 1_000_000) * (pricing.cached || pricing.input * 0.25);

    return {
      inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,   // 6 decimal places
      outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
      cachedCost: Math.round(cachedCost * 1_000_000) / 1_000_000,
      totalCost: Math.round((inputCost + outputCost + cachedCost) * 1_000_000) / 1_000_000,
      currency: 'USD',
    };
  }

  function _findPricing(model) {
    if (!model) return null;
    // Exact match
    if (PRICING[model]) return PRICING[model];
    // Partial match
    const modelLower = model.toLowerCase();
    for (const [key, pricing] of Object.entries(PRICING)) {
      if (modelLower.includes(key.toLowerCase())) return pricing;
    }
    return null;
  }

  // ── Recording ──────────────────────────────────────────────

  /**
   * Record a completed LLM call
   *
   * @param {Object} params
   * @param {string} params.provider - Provider name
   * @param {string} params.model - Model name
   * @param {number} [params.inputTokens] - Input token count
   * @param {number} [params.outputTokens] - Output token count
   * @param {number} [params.cachedTokens] - Cached tokens
   * @param {string} [params.sessionId] - Session ID
   * @param {number} [params.latencyMs] - Request latency
   */
  function recordUsage(params) {
    const session = _getSession(params.sessionId);
    const cost = calculateCost(params.model, params.inputTokens || 0, params.outputTokens || 0, params.cachedTokens || 0);

    const call = {
      timestamp: Date.now(),
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens || 0,
      outputTokens: params.outputTokens || 0,
      cachedTokens: params.cachedTokens || 0,
      cost: cost ? cost.totalCost : 0,
      latencyMs: params.latencyMs || 0,
    };

    session.calls.push(call);
    session.totalInputTokens += call.inputTokens;
    session.totalOutputTokens += call.outputTokens;
    session.totalCachedTokens += call.cachedTokens;
    session.totalCost += call.cost;
    session.callCount++;

    // Daily tracking
    const today = _today();
    if (_dailyUsage.date !== today) {
      _dailyUsage.date = today;
      _dailyUsage.totalCost = 0;
      _dailyUsage.totalTokens = 0;
      _dailyUsage.calls = 0;
    }
    _dailyUsage.totalCost += call.cost;
    _dailyUsage.totalTokens += call.inputTokens + call.outputTokens;
    _dailyUsage.calls++;
  }

  // ── Status & Reporting ─────────────────────────────────────

  /**
   * Get usage summary for a session
   */
  function getSessionUsage(sessionId) {
    const session = _getSession(sessionId);
    return {
      sessionId: session.id,
      startedAt: new Date(session.startedAt).toISOString(),
      duration: _formatDuration(Date.now() - session.startedAt),
      callCount: session.callCount,
      totalInputTokens: session.totalInputTokens,
      totalOutputTokens: session.totalOutputTokens,
      totalTokens: session.totalInputTokens + session.totalOutputTokens,
      totalCost: '$' + session.totalCost.toFixed(4),
      avgTokensPerCall: session.callCount > 0
        ? Math.round((session.totalInputTokens + session.totalOutputTokens) / session.callCount)
        : 0,
      avgLatency: session.calls.length > 0
        ? Math.round(session.calls.reduce((a, c) => a + c.latencyMs, 0) / session.calls.length) + 'ms'
        : 'N/A',
    };
  }

  /**
   * Get daily usage summary
   */
  function getDailyUsage() {
    return {
      date: _dailyUsage.date,
      totalCost: '$' + _dailyUsage.totalCost.toFixed(4),
      totalTokens: _dailyUsage.totalTokens,
      calls: _dailyUsage.calls,
    };
  }

  /**
   * Get compact status line (for UI footer)
   */
  function getStatusLine(sessionId) {
    const session = _getSession(sessionId);
    const tokens = session.totalInputTokens + session.totalOutputTokens;
    const cost = session.totalCost.toFixed(4);
    const lastCall = session.calls.length > 0 ? session.calls[session.calls.length - 1] : null;
    const model = lastCall ? `${lastCall.provider}/${lastCall.model}` : 'N/A';
    return `${model} • ${_formatTokens(tokens)} tokens • $${cost} • ${session.callCount} calls`;
  }

  // ── Helpers ────────────────────────────────────────────────

  function _formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  function _formatDuration(ms) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + 's';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ' + (sec % 60) + 's';
    const hr = Math.floor(min / 60);
    return hr + 'h ' + (min % 60) + 'm';
  }

  function resetSession(sessionId) {
    _sessions.delete(sessionId || 'default');
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_UsageTracking = {
    recordUsage,
    calculateCost,
    estimateTokens,
    getSessionUsage,
    getDailyUsage,
    getStatusLine,
    resetSession,
    PRICING,
  };

  console.log('[FLOWORKOS] ✅ Usage Tracking loaded');
})();
