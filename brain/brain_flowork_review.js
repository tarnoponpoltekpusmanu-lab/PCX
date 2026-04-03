// =========================================================================
// FLOWORK OS — Brain Self-Review Module
// AI can analyze its own session performance and generate improvement insights.
// =========================================================================

(function() {
    'use strict';

    // ─── Self Review: Analyze session performance ───────────────────────
    function selfReview(input) {
        const chatHistory = window.chatHistory || [];
        const analytics = window.toolAnalytics?.getState?.() || {};
        const costData = window.costTracker?.getState?.() || {};

        let report = `🔍 SELF-REVIEW REPORT\n`;
        report += `Generated: ${new Date().toISOString()}\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        // 1. Chat analysis
        const userMsgs = chatHistory.filter(m => m.role === 'user');
        const agentMsgs = chatHistory.filter(m => m.role === 'agent' || m.role === 'assistant');
        const toolMsgs = chatHistory.filter(m => m.role === 'tool');

        report += `📝 CONVERSATION:\n`;
        report += `  User messages: ${userMsgs.length}\n`;
        report += `  Agent messages: ${agentMsgs.length}\n`;
        report += `  Tool results: ${toolMsgs.length}\n`;
        report += `  Total exchanges: ${chatHistory.length}\n\n`;

        // 2. Tool analysis
        const toolStats = analytics.toolStats || {};
        const toolEntries = Object.entries(toolStats);
        const totalCalls = toolEntries.reduce((sum, [_, s]) => sum + s.calls, 0);
        const totalFailures = toolEntries.reduce((sum, [_, s]) => sum + s.failures, 0);
        const failRate = totalCalls > 0 ? ((totalFailures / totalCalls) * 100).toFixed(1) : 0;

        report += `🔧 TOOL PERFORMANCE:\n`;
        report += `  Total tool calls: ${totalCalls}\n`;
        report += `  Total failures: ${totalFailures} (${failRate}% failure rate)\n`;
        report += `  Unique tools used: ${toolEntries.length}\n`;

        // Identify problematic tools
        const problemTools = toolEntries.filter(([_, s]) => s.failures > 1).sort((a, b) => b[1].failures - a[1].failures);
        if (problemTools.length > 0) {
            report += `\n  ⚠️ PROBLEMATIC TOOLS:\n`;
            for (const [name, s] of problemTools.slice(0, 5)) {
                report += `    ${name}: ${s.failures} failures (${Math.round((s.failures / s.calls) * 100)}% fail rate)\n`;
            }
        }

        // 3. Cost analysis
        const sessionCost = costData.currentSession?.totals?.cost || 0;
        report += `\n💰 COST:\n`;
        report += `  Session cost: $${sessionCost.toFixed(6)}\n`;
        report += `  Lifetime cost: $${(costData.lifetime?.totalCost || 0).toFixed(6)}\n`;

        // 4. Improvement suggestions
        report += `\n💡 IMPROVEMENT SUGGESTIONS:\n`;
        if (totalFailures > 5) {
            report += `  • High failure rate detected. Consider checking tool inputs before execution.\n`;
        }
        if (totalCalls > 50) {
            report += `  • Many tool calls. Consider batching operations or using smarter strategies.\n`;
        }
        if (sessionCost > 0.05) {
            report += `  • Significant cost. Consider using flash models for simple tasks.\n`;
        }
        if (chatHistory.length > 100) {
            report += `  • Long conversation. Consider using smart_compact to reduce context size.\n`;
        }
        if (totalFailures === 0 && totalCalls > 10) {
            report += `  • 🌟 Excellent! Zero failures across ${totalCalls} tool calls.\n`;
        }

        return { result: report };
    }

    // ─── Brief: 1-paragraph session summary ─────────────────────────────
    function brief(input) {
        const chatHistory = window.chatHistory || [];
        const toolStats = window.toolAnalytics?.getState?.()?.toolStats || {};

        const userMsgs = chatHistory.filter(m => m.role === 'user');
        const toolCalls = Object.values(toolStats).reduce((sum, s) => sum + s.calls, 0);
        const failures = Object.values(toolStats).reduce((sum, s) => sum + s.failures, 0);

        // Get unique tools used
        const usedTools = Object.keys(toolStats).slice(0, 10).join(', ');

        // Find last user message for context
        const lastUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;
        const lastUserText = lastUserMsg
            ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)).substring(0, 100)
            : 'No user messages';

        const summary = `Session with ${userMsgs.length} user requests and ${toolCalls} tool calls ` +
            `(${failures} failures). Tools used: ${usedTools || 'none yet'}. ` +
            `Last request: "${lastUserText}"`;

        return { result: summary };
    }

    // ─── Synthetic Output: Transform results into structured data ────────
    function syntheticOutput(input) {
        const format = input.format || 'json';
        const data = input.data || input.content || '';

        try {
            if (format === 'json') {
                // Try to parse as JSON first
                if (typeof data === 'string') {
                    try {
                        const parsed = JSON.parse(data);
                        return { result: JSON.stringify(parsed, null, 2) };
                    } catch(e) {
                        // Convert text to structured JSON
                        const lines = data.split('\n').filter(l => l.trim());
                        return {
                            result: JSON.stringify({
                                type: 'text_to_json',
                                lines: lines,
                                totalLines: lines.length,
                                charCount: data.length,
                            }, null, 2)
                        };
                    }
                }
                return { result: JSON.stringify(data, null, 2) };
            }

            if (format === 'csv') {
                if (Array.isArray(data)) {
                    const headers = Object.keys(data[0] || {}).join(',');
                    const rows = data.map(row => Object.values(row).join(','));
                    return { result: [headers, ...rows].join('\n') };
                }
                return { result: String(data) };
            }

            if (format === 'table') {
                if (Array.isArray(data)) {
                    const headers = Object.keys(data[0] || {});
                    let table = '| ' + headers.join(' | ') + ' |\n';
                    table += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
                    for (const row of data) {
                        table += '| ' + headers.map(h => String(row[h] || '')).join(' | ') + ' |\n';
                    }
                    return { result: table };
                }
                return { result: String(data) };
            }

            return { result: String(data) };
        } catch(e) {
            return { error: `Synthetic output failed: ${e.message}` };
        }
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkReview = {
        selfReview,
        brief,
        syntheticOutput,
    };

    console.log('[Brain] ✅ Self-Review module loaded');

})();
