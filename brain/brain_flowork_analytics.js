// =========================================================================
// FLOWORK OS — Brain Analytics Module
// Tracks tool usage patterns, failures, and timing for AI self-improvement.
// =========================================================================

(function() {
    'use strict';

    const STORAGE_KEY = 'flowork_analytics';

    let state = {
        toolStats: {},      // { toolName: { calls, successes, failures, totalMs, lastUsed } }
        sessionStart: Date.now(),
        sessionToolCalls: 0,
    };

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) state = { ...state, ...JSON.parse(saved) };
    } catch(e) {}

    function _save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
    }

    // ─── Core: Record a tool call ───────────────────────────────────────
    function record(toolName, success, durationMs = 0) {
        if (!state.toolStats[toolName]) {
            state.toolStats[toolName] = { calls: 0, successes: 0, failures: 0, totalMs: 0, lastUsed: null, errors: [] };
        }
        const stat = state.toolStats[toolName];
        stat.calls++;
        stat.totalMs += durationMs;
        stat.lastUsed = new Date().toISOString();
        if (success) {
            stat.successes++;
        } else {
            stat.failures++;
        }
        state.sessionToolCalls++;
        _save();
    }

    function recordError(toolName, errorMsg) {
        if (!state.toolStats[toolName]) {
            state.toolStats[toolName] = { calls: 0, successes: 0, failures: 0, totalMs: 0, lastUsed: null, errors: [] };
        }
        state.toolStats[toolName].errors.push({
            msg: (errorMsg || '').substring(0, 200),
            ts: new Date().toISOString(),
        });
        // Keep last 10 errors per tool
        if (state.toolStats[toolName].errors.length > 10) {
            state.toolStats[toolName].errors = state.toolStats[toolName].errors.slice(-10);
        }
        _save();
    }

    // ─── Tool Handlers ──────────────────────────────────────────────────

    function telemetryReport(input) {
        const tools = Object.entries(state.toolStats);
        if (tools.length === 0) return { result: 'No tool usage data yet.' };

        // Sort by calls descending
        tools.sort((a, b) => b[1].calls - a[1].calls);

        let report = `📊 TOOL USAGE ANALYTICS\n`;
        report += `Session started: ${new Date(state.sessionStart).toLocaleString()}\n`;
        report += `Total unique tools used: ${tools.length}\n`;
        report += `Total tool calls this session: ${state.sessionToolCalls}\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        // Most used
        report += `🔥 TOP 10 MOST USED:\n`;
        for (const [name, stat] of tools.slice(0, 10)) {
            const avgMs = stat.calls > 0 ? Math.round(stat.totalMs / stat.calls) : 0;
            const successRate = stat.calls > 0 ? Math.round((stat.successes / stat.calls) * 100) : 0;
            report += `  ${name}: ${stat.calls} calls | ${successRate}% success | avg ${avgMs}ms\n`;
        }

        // Most failures
        const failTools = tools.filter(([_, s]) => s.failures > 0).sort((a, b) => b[1].failures - a[1].failures);
        if (failTools.length > 0) {
            report += `\n⚠️ TOOLS WITH FAILURES:\n`;
            for (const [name, stat] of failTools.slice(0, 5)) {
                report += `  ${name}: ${stat.failures} failures / ${stat.calls} calls\n`;
                if (stat.errors.length > 0) {
                    report += `    Last error: ${stat.errors[stat.errors.length - 1].msg}\n`;
                }
            }
        }

        // Slowest tools
        const slowTools = tools.filter(([_, s]) => s.calls > 0)
            .map(([name, s]) => [name, Math.round(s.totalMs / s.calls)])
            .sort((a, b) => b[1] - a[1]);
        if (slowTools.length > 0) {
            report += `\n🐌 SLOWEST TOOLS (avg ms):\n`;
            for (const [name, avgMs] of slowTools.slice(0, 5)) {
                report += `  ${name}: ${avgMs}ms avg\n`;
            }
        }

        return { result: report };
    }

    function toolUsageReport(input) {
        const toolName = input.tool || input.name;
        if (toolName && state.toolStats[toolName]) {
            const s = state.toolStats[toolName];
            return {
                result: JSON.stringify({
                    tool: toolName,
                    calls: s.calls,
                    successes: s.successes,
                    failures: s.failures,
                    successRate: `${Math.round((s.successes / s.calls) * 100)}%`,
                    avgDurationMs: Math.round(s.totalMs / s.calls),
                    lastUsed: s.lastUsed,
                    recentErrors: s.errors.slice(-3),
                }, null, 2)
            };
        }

        // Return summary of all tools
        const summary = Object.entries(state.toolStats).map(([name, s]) => ({
            tool: name,
            calls: s.calls,
            successRate: `${Math.round((s.successes / Math.max(s.calls, 1)) * 100)}%`,
        }));
        summary.sort((a, b) => b.calls - a.calls);

        return { result: JSON.stringify(summary.slice(0, 30), null, 2) };
    }

    // ─── Summary for Memory Bridge ──────────────────────────────────────
    function getToolUseSummary() {
        const tools = Object.entries(state.toolStats);
        if (tools.length === 0) return '';
        tools.sort((a, b) => b[1].calls - a[1].calls);
        return tools.slice(0, 15).map(([name, s]) => `${name}(${s.calls})`).join(', ');
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.toolAnalytics = {
        record,
        recordError,
        telemetryReport,
        toolUsageReport,
        getToolUseSummary,
        getState: () => ({ ...state }),
    };

    // Wire to memory bridge expectation
    window.toolUseSummary = getToolUseSummary;

    console.log(`[Brain] ✅ Analytics module loaded (${Object.keys(state.toolStats).length} tools tracked)`);

})();
