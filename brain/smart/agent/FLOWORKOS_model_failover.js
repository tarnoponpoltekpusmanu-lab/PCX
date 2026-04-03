/**
 * ============================================================
 *  FLOWORKOS™ Model Failover Engine
 *  FLOWORKOS™ native model failover engine
 * ============================================================
 *  Logic: When an LLM provider fails (429 rate limit, 500 server error,
 *  502 bad gateway, timeout), automatically switch to the next provider
 *  in the fallback chain. Supports cooldown tracking per provider
 *  and exponential backoff retry.
 * ============================================================
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────
  const COOLDOWN_MS = 60_000;            // 60s cooldown after failure
  const MAX_RETRIES_PER_PROVIDER = 2;    // Max retries before marking cooldown
  const PROBE_INTERVAL_MS = 30_000;      // Min time between probes
  const BACKOFF_BASE_MS = 1000;          // 1s base for exponential backoff
  const BACKOFF_MAX_MS = 16_000;         // 16s max backoff

  // ── Provider Cooldown State ────────────────────────────────
  const _providerCooldowns = new Map();  // provider → { until: timestamp, failCount: number, reason: string }
  const _providerRetries = new Map();    // provider → retry count this session
  const _lastProbeAttempt = new Map();   // provider → last probe timestamp

  // ── Known Model Context Windows ────────────────────────────
  const MODEL_CONTEXT_WINDOWS = {
    // Google
    'gemini-2.5-pro':       1_048_576,
    'gemini-2.5-flash':     1_048_576,
    'gemini-2.0-flash':     1_048_576,
    'gemini-1.5-pro':       2_097_152,
    'gemini-1.5-flash':     1_048_576,
    // OpenAI
    'gpt-4o':               128_000,
    'gpt-4o-mini':          128_000,
    'gpt-4-turbo':          128_000,
    'o3':                   200_000,
    'o3-mini':              200_000,
    'o1':                   200_000,
    // Anthropic
    'claude-sonnet-4-20250514':   200_000,
    'claude-3-5-sonnet':    200_000,
    'claude-3-opus':        200_000,
    'claude-3-haiku':       200_000,
    // xAI
    'grok-3':               131_072,
    'grok-3-mini':          131_072,
    // DeepSeek
    'deepseek-chat':        64_000,
    'deepseek-reasoner':    64_000,
    // Groq
    'llama-3.3-70b-versatile': 128_000,
    'mixtral-8x7b-32768':   32_768,
    // Mistral
    'mistral-large-latest': 128_000,
    // Cohere
    'command-r-plus':       128_000,
  };

  // ── Error Classification ───────────────────────────────────

  /**
   * Classify an error into a failover reason
   * @param {Error|Object|string} error
   * @returns {{ isFailover: boolean, reason: string, retryAfterMs: number|null }}
   */
  function classifyError(error) {
    const msg = (error?.message || error?.error?.message || String(error)).toLowerCase();
    const status = error?.status || error?.statusCode || error?.error?.code || 0;

    // Rate limited
    if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded') || msg.includes('resource_exhausted')) {
      const retryAfter = _parseRetryAfter(error);
      return { isFailover: true, reason: 'rate_limit', retryAfterMs: retryAfter || COOLDOWN_MS };
    }

    // Server error
    if (status === 500 || status === 502 || status === 503 || msg.includes('internal server error') || msg.includes('bad gateway') || msg.includes('service unavailable')) {
      return { isFailover: true, reason: 'server_error', retryAfterMs: COOLDOWN_MS / 2 };
    }

    // Overloaded
    if (msg.includes('overloaded') || msg.includes('capacity') || msg.includes('busy')) {
      return { isFailover: true, reason: 'overloaded', retryAfterMs: COOLDOWN_MS };
    }

    // Timeout
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnaborted') || msg.includes('socket hang up')) {
      return { isFailover: true, reason: 'timeout', retryAfterMs: COOLDOWN_MS / 4 };
    }

    // Auth / billing — don't retry these
    if (status === 401 || status === 403 || msg.includes('invalid api key') || msg.includes('unauthorized')) {
      return { isFailover: true, reason: 'auth', retryAfterMs: null }; // permanent, skip provider
    }
    if (status === 402 || msg.includes('billing') || msg.includes('payment') || msg.includes('insufficient')) {
      return { isFailover: true, reason: 'billing', retryAfterMs: null }; // permanent
    }

    // Model not found
    if (status === 404 || msg.includes('model not found') || msg.includes('does not exist') || msg.includes('is not found')) {
      return { isFailover: true, reason: 'model_not_found', retryAfterMs: null };
    }

    // Context overflow — rethrow, don't failover
    if (msg.includes('context length') || msg.includes('maximum context') || msg.includes('too long') || msg.includes('token limit')) {
      return { isFailover: false, reason: 'context_overflow', retryAfterMs: null };
    }

    // Network error
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('fetch failed')) {
      return { isFailover: true, reason: 'network', retryAfterMs: COOLDOWN_MS / 2 };
    }

    // Unknown error — try failover anyway
    return { isFailover: true, reason: 'unknown', retryAfterMs: COOLDOWN_MS / 4 };
  }

  /**
   * Parse Retry-After header from error response
   */
  function _parseRetryAfter(error) {
    const headers = error?.headers || error?.response?.headers;
    if (!headers) return null;
    const retryAfter = headers['retry-after'] || headers['Retry-After'];
    if (!retryAfter) return null;
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    return null;
  }

  // ── Cooldown Management ────────────────────────────────────

  function isProviderInCooldown(provider) {
    const cd = _providerCooldowns.get(provider);
    if (!cd) return false;
    if (Date.now() > cd.until) {
      _providerCooldowns.delete(provider);
      return false;
    }
    return true;
  }

  function markProviderCooldown(provider, reason, durationMs) {
    const retries = (_providerRetries.get(provider) || 0) + 1;
    _providerRetries.set(provider, retries);

    // Permanent failures get longer cooldowns
    const isPermanent = reason === 'auth' || reason === 'billing' || reason === 'model_not_found';
    const cooldownDuration = isPermanent ? durationMs * 10 : durationMs * Math.min(retries, 4);

    _providerCooldowns.set(provider, {
      until: Date.now() + cooldownDuration,
      failCount: retries,
      reason: reason,
    });

    console.warn(`[FLOWORKOS Failover] Provider "${provider}" in cooldown for ${Math.round(cooldownDuration / 1000)}s (reason: ${reason}, failures: ${retries})`);
  }

  function clearProviderCooldown(provider) {
    _providerCooldowns.delete(provider);
    _providerRetries.delete(provider);
  }

  function getProviderCooldownInfo(provider) {
    const cd = _providerCooldowns.get(provider);
    if (!cd || Date.now() > cd.until) return null;
    return {
      provider,
      reason: cd.reason,
      failCount: cd.failCount,
      remainingMs: cd.until - Date.now(),
      remainingSec: Math.ceil((cd.until - Date.now()) / 1000),
    };
  }

  // ── Fallback Chain Builder ─────────────────────────────────

  /**
   * Build a fallback chain from config
   * @param {Object} config - { provider, model, fallbacks: [{ provider, model }] }
   * @returns {Array<{ provider: string, model: string }>}
   */
  function buildFallbackChain(config) {
    const seen = new Set();
    const chain = [];

    function addCandidate(provider, model) {
      if (!provider || !model) return;
      const key = `${provider}/${model}`;
      if (seen.has(key)) return;
      seen.add(key);
      chain.push({ provider, model });
    }

    // Primary
    addCandidate(config.provider, config.model);

    // Explicit fallbacks from config
    if (Array.isArray(config.fallbacks)) {
      for (const fb of config.fallbacks) {
        if (typeof fb === 'string') {
          const [p, m] = fb.split('/');
          if (p && m) addCandidate(p, m);
        } else if (fb && fb.provider && fb.model) {
          addCandidate(fb.provider, fb.model);
        }
      }
    }

    // Auto-detect from Flowork's available providers
    const state = window._floworkState || {};
    const availableProviders = state.availableProviders || [];
    for (const ap of availableProviders) {
      if (ap.provider && ap.model && ap.apiKey) {
        addCandidate(ap.provider, ap.model);
      }
    }

    return chain;
  }

  // ── Main Failover Runner ───────────────────────────────────

  /**
   * Run an LLM call with automatic failover to backup providers
   *
   * @param {Object} params
   * @param {string} params.provider - Primary provider name
   * @param {string} params.model - Primary model name
   * @param {Array} [params.fallbacks] - Optional fallback chain
   * @param {Function} params.run - async (provider, model) => result
   * @param {Function} [params.onError] - Optional error callback
   * @param {Function} [params.onSwitch] - Called when switching providers
   * @returns {Promise<{ result: any, provider: string, model: string, attempts: Array }>}
   */
  async function runWithModelFailover(params) {
    const chain = buildFallbackChain({
      provider: params.provider,
      model: params.model,
      fallbacks: params.fallbacks,
    });

    const attempts = [];
    let lastError = null;
    const hasFallbacks = chain.length > 1;

    for (let i = 0; i < chain.length; i++) {
      const candidate = chain[i];
      const isPrimary = (i === 0);

      // Check cooldown
      if (isProviderInCooldown(candidate.provider)) {
        const cdInfo = getProviderCooldownInfo(candidate.provider);
        const shouldProbe = _shouldProbeProvider(candidate.provider, isPrimary, hasFallbacks);

        if (!shouldProbe) {
          attempts.push({
            provider: candidate.provider,
            model: candidate.model,
            error: `Provider in cooldown (${cdInfo.reason}), ${cdInfo.remainingSec}s remaining`,
            reason: cdInfo.reason,
            skipped: true,
          });
          console.log(`[FLOWORKOS Failover] Skipping ${candidate.provider}/${candidate.model} (cooldown: ${cdInfo.reason})`);
          continue;
        }
        console.log(`[FLOWORKOS Failover] Probing ${candidate.provider} despite cooldown...`);
      }

      // Attempt the call
      try {
        console.log(`[FLOWORKOS Failover] Trying ${candidate.provider}/${candidate.model}${isPrimary ? ' (primary)' : ` (fallback #${i})`}...`);

        if (!isPrimary && params.onSwitch) {
          params.onSwitch(candidate.provider, candidate.model, i);
        }

        const result = await params.run(candidate.provider, candidate.model);

        // Success — clear any cooldown
        clearProviderCooldown(candidate.provider);

        if (i > 0) {
          console.log(`[FLOWORKOS Failover] ✅ Succeeded with fallback: ${candidate.provider}/${candidate.model} (after ${i} failed attempts)`);
        }

        return {
          result,
          provider: candidate.provider,
          model: candidate.model,
          attempts,
          usedFallback: i > 0,
          attemptIndex: i,
        };

      } catch (error) {
        lastError = error;

        // Classify the error
        const classification = classifyError(error);

        attempts.push({
          provider: candidate.provider,
          model: candidate.model,
          error: error?.message || String(error),
          reason: classification.reason,
          skipped: false,
        });

        if (params.onError) {
          try {
            params.onError({
              provider: candidate.provider,
              model: candidate.model,
              error,
              attempt: i + 1,
              total: chain.length,
              reason: classification.reason,
            });
          } catch (_) { /* ignore callback errors */ }
        }

        // Context overflow — rethrow immediately, don't try other models
        if (!classification.isFailover) {
          throw error;
        }

        // Mark cooldown if retriable
        if (classification.retryAfterMs) {
          markProviderCooldown(candidate.provider, classification.reason, classification.retryAfterMs);
        }

        console.warn(`[FLOWORKOS Failover] ❌ ${candidate.provider}/${candidate.model} failed: ${classification.reason} — ${error?.message || error}`);

        // If no more fallbacks, throw detailed error
        if (i === chain.length - 1) {
          const summaryMsg = attempts.map(a =>
            `${a.provider}/${a.model}: ${a.reason}${a.skipped ? ' (skipped)' : ''}`
          ).join(' → ');

          const finalError = new Error(
            `All ${chain.length} model(s) failed: ${summaryMsg}`
          );
          finalError.name = 'FloworkModelFailoverError';
          finalError.attempts = attempts;
          finalError.lastError = lastError;
          throw finalError;
        }

        // Brief delay before trying next (exponential backoff)
        const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, i), BACKOFF_MAX_MS);
        await _sleep(delay);
      }
    }

    // Should never reach here, but safety
    throw lastError || new Error('No providers available');
  }

  // ── Probe Logic ────────────────────────────────────────────

  function _shouldProbeProvider(provider, isPrimary, hasFallbacks) {
    if (!isPrimary && !hasFallbacks) return true; // Single provider, must try
    if (!isPrimary) return false;                  // Don't probe non-primary during cooldown

    // Primary: check probe throttle
    const lastProbe = _lastProbeAttempt.get(provider) || 0;
    const elapsed = Date.now() - lastProbe;
    if (elapsed < PROBE_INTERVAL_MS) return false;

    _lastProbeAttempt.set(provider, Date.now());
    return true;
  }

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Context Window Helper ──────────────────────────────────

  /**
   * Get the context window size for a model
   * @param {string} model - Model name
   * @param {number} [defaultTokens=128000] - Default if unknown
   * @returns {{ tokens: number, source: string, shouldWarn: boolean }}
   */
  function getContextWindowInfo(model, defaultTokens) {
    defaultTokens = defaultTokens || 128_000;

    // Try exact match first
    if (MODEL_CONTEXT_WINDOWS[model]) {
      return {
        tokens: MODEL_CONTEXT_WINDOWS[model],
        source: 'known_model',
        shouldWarn: MODEL_CONTEXT_WINDOWS[model] < 32_000,
        shouldBlock: MODEL_CONTEXT_WINDOWS[model] < 16_000,
      };
    }

    // Try partial match
    const modelLower = (model || '').toLowerCase();
    for (const [key, tokens] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      if (modelLower.includes(key.toLowerCase())) {
        return {
          tokens,
          source: 'partial_match',
          shouldWarn: tokens < 32_000,
          shouldBlock: tokens < 16_000,
        };
      }
    }

    return {
      tokens: defaultTokens,
      source: 'default',
      shouldWarn: defaultTokens < 32_000,
      shouldBlock: defaultTokens < 16_000,
    };
  }

  // ── Status & Diagnostics ───────────────────────────────────

  function getFailoverStatus() {
    const status = {};
    for (const [provider, cd] of _providerCooldowns) {
      if (Date.now() > cd.until) continue;
      status[provider] = {
        reason: cd.reason,
        failCount: cd.failCount,
        remainingSec: Math.ceil((cd.until - Date.now()) / 1000),
        cooldownUntil: new Date(cd.until).toISOString(),
      };
    }
    return status;
  }

  function resetAllCooldowns() {
    _providerCooldowns.clear();
    _providerRetries.clear();
    _lastProbeAttempt.clear();
    console.log('[FLOWORKOS Failover] All cooldowns cleared');
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_ModelFailover = {
    runWithModelFailover,
    classifyError,
    buildFallbackChain,
    isProviderInCooldown,
    markProviderCooldown,
    clearProviderCooldown,
    getProviderCooldownInfo,
    getContextWindowInfo,
    getFailoverStatus,
    resetAllCooldowns,
    MODEL_CONTEXT_WINDOWS,
    // Constants exposed for config
    COOLDOWN_MS,
    MAX_RETRIES_PER_PROVIDER,
    BACKOFF_BASE_MS,
    BACKOFF_MAX_MS,
  };

  console.log('[FLOWORKOS] ✅ Model Failover Engine loaded');
})();
