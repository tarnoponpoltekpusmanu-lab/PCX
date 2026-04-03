// =========================================================================
// FLOWORK OS — Brain Cost Tracker Module
// Tracks API usage, token counts, and estimated cost per LLM provider.
// Persists between sessions via localStorage.
// =========================================================================

(function() {
    'use strict';

    // ─── Pricing table (USD per 1M tokens) ──────────────────────────────
    const PRICING = {
        'gemini': { input: 1.25, output: 5.00, image: 0.0025 },
        'gemini-flash': { input: 0.075, output: 0.30, image: 0.002 },
        'openai': { input: 2.50, output: 10.00, image: 0.003 },
        'claude': { input: 3.00, output: 15.00, image: 0.0048 },
    };

    const STORAGE_KEY = 'flowork_cost_tracker';

    // ─── Load state ─────────────────────────────────────────────────────
    let state = {
        sessions: [],           // Per-session summaries
        currentSession: null,   // Active session tracking
        lifetime: { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCalls: 0 },
    };

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) state = JSON.parse(saved);
    } catch(e) {}

    function _save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
    }

    // ─── Start new session ──────────────────────────────────────────────
    function _ensureSession() {
        if (!state.currentSession) {
            state.currentSession = {
                id: `session_${Date.now()}`,
                startedAt: new Date().toISOString(),
                calls: [],
                totals: { cost: 0, inputTokens: 0, outputTokens: 0, images: 0, callCount: 0 },
                byProvider: {},
            };
        }
        return state.currentSession;
    }

    // ─── Core: Record an API call ───────────────────────────────────────
    function recordCall(provider, inputChars, outputChars, imageCount = 0) {
        const session = _ensureSession();
        const normalizedProvider = _normalizeProvider(provider);
        const pricing = PRICING[normalizedProvider] || PRICING['gemini'];

        // Rough char-to-token: 1 token ≈ 4 chars
        const inputTokens = Math.ceil(inputChars / 4);
        const outputTokens = Math.ceil(outputChars / 4);

        const inputCost = (inputTokens / 1_000_000) * pricing.input;
        const outputCost = (outputTokens / 1_000_000) * pricing.output;
        const imageCost = imageCount * pricing.image;
        const totalCost = inputCost + outputCost + imageCost;

        const record = {
            provider: normalizedProvider,
            inputTokens, outputTokens, imageCount,
            cost: totalCost,
            ts: Date.now(),
        };
        session.calls.push(record);

        // Update session totals
        session.totals.cost += totalCost;
        session.totals.inputTokens += inputTokens;
        session.totals.outputTokens += outputTokens;
        session.totals.images += imageCount;
        session.totals.callCount++;

        // Update per-provider
        if (!session.byProvider[normalizedProvider]) {
            session.byProvider[normalizedProvider] = { cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
        }
        session.byProvider[normalizedProvider].cost += totalCost;
        session.byProvider[normalizedProvider].calls++;
        session.byProvider[normalizedProvider].inputTokens += inputTokens;
        session.byProvider[normalizedProvider].outputTokens += outputTokens;

        // Update lifetime
        state.lifetime.totalCost += totalCost;
        state.lifetime.totalInputTokens += inputTokens;
        state.lifetime.totalOutputTokens += outputTokens;
        state.lifetime.totalCalls++;

        // Keep last 200 calls per session
        if (session.calls.length > 200) session.calls = session.calls.slice(-200);

        _save();
        return record;
    }

    function _normalizeProvider(provider) {
        const p = (provider || '').toLowerCase();
        if (p.includes('flash') || p.includes('lite')) return 'gemini-flash';
        if (p.includes('gemini')) return 'gemini';
        if (p.includes('gpt') || p.includes('openai') || p.includes('chatgpt')) return 'openai';
        if (p.includes('claude') || p.includes('anthropic')) return 'claude';
        return 'gemini';
    }

    // ─── Tool Handlers ──────────────────────────────────────────────────

    function costReport(input) {
        const session = state.currentSession;
        if (!session) return { result: 'No active session. No costs tracked yet.' };

        let report = `💰 COST REPORT — Session: ${session.id}\n`;
        report += `Started: ${session.startedAt}\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `Total Cost: $${session.totals.cost.toFixed(6)}\n`;
        report += `API Calls: ${session.totals.callCount}\n`;
        report += `Input Tokens: ${session.totals.inputTokens.toLocaleString()}\n`;
        report += `Output Tokens: ${session.totals.outputTokens.toLocaleString()}\n`;
        report += `Images: ${session.totals.images}\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        for (const [provider, data] of Object.entries(session.byProvider)) {
            report += `\n📊 ${provider.toUpperCase()}:\n`;
            report += `  Cost: $${data.cost.toFixed(6)} | Calls: ${data.calls}\n`;
            report += `  In: ${data.inputTokens.toLocaleString()} | Out: ${data.outputTokens.toLocaleString()}\n`;
        }

        report += `\n═══ LIFETIME ═══\n`;
        report += `Total Spent: $${state.lifetime.totalCost.toFixed(6)}\n`;
        report += `Total Calls: ${state.lifetime.totalCalls}\n`;
        report += `Total Tokens: ${(state.lifetime.totalInputTokens + state.lifetime.totalOutputTokens).toLocaleString()}\n`;

        return { result: report };
    }

    function costStatus(input) {
        const session = state.currentSession;
        return {
            result: JSON.stringify({
                sessionActive: !!session,
                sessionCost: session ? `$${session.totals.cost.toFixed(6)}` : '$0',
                sessionCalls: session ? session.totals.callCount : 0,
                lifetimeCost: `$${state.lifetime.totalCost.toFixed(6)}`,
                lifetimeCalls: state.lifetime.totalCalls,
            }, null, 2)
        };
    }

    function getTokenUsage(input) {
        const session = state.currentSession;
        if (!session) return { result: 'No active session.' };

        return {
            result: JSON.stringify({
                inputTokens: session.totals.inputTokens,
                outputTokens: session.totals.outputTokens,
                totalTokens: session.totals.inputTokens + session.totals.outputTokens,
                images: session.totals.images,
                callCount: session.totals.callCount,
                recentCalls: session.calls.slice(-10).map(c => ({
                    provider: c.provider,
                    in: c.inputTokens,
                    out: c.outputTokens,
                    cost: `$${c.cost.toFixed(6)}`,
                })),
            }, null, 2)
        };
    }

    function endSession() {
        if (state.currentSession) {
            state.currentSession.endedAt = new Date().toISOString();
            state.sessions.push({
                id: state.currentSession.id,
                startedAt: state.currentSession.startedAt,
                endedAt: state.currentSession.endedAt,
                totals: state.currentSession.totals,
            });
            // Keep last 50 sessions
            if (state.sessions.length > 50) state.sessions = state.sessions.slice(-50);
            state.currentSession = null;
            _save();
        }
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.costTracker = {
        recordCall,
        costReport,
        costStatus,
        getTokenUsage,
        endSession,
        getState: () => ({ ...state }),
    };

    console.log(`[Brain] ✅ Cost Tracker loaded (Lifetime: $${state.lifetime.totalCost.toFixed(4)}, ${state.lifetime.totalCalls} calls)`);

})();
