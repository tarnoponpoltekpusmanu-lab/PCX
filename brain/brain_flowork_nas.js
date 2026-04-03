// =========================================================================
// FLOWORK OS — Brain Neural Architecture Search (NAS) Module
// Auto-benchmark prompt strategies, optimize token efficiency,
// and self-patch the system for maximum performance.
// =========================================================================

(function() {
    'use strict';

    const STORAGE_KEY = 'flowork_nas_state';

    const state = {
        experiments: [],        // { id, name, strategyA, strategyB, metrics, winner, status }
        benchmarkHistory: [],   // { timestamp, strategy, score, tokenCount, latency }
        activeOptimizations: [],// Currently applied optimizations
        tokenBudget: null,     // Max tokens per conversation
        autoOptimize: true,    // Auto-apply winning strategies
    };

    // Load persisted state
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        Object.assign(state, saved);
    } catch(e) {}

    function _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch(e) {}
    }

    // ═══ A/B PROMPT EXPERIMENT ═══════════════════════════════════════════

    /**
     * Create an A/B test between two prompt strategies
     * Tool: nas_experiment
     */
    function createExperiment(input) {
        const name = input.name || `Experiment ${state.experiments.length + 1}`;
        const strategyA = input.strategy_a || input.a;
        const strategyB = input.strategy_b || input.b;

        if (!strategyA || !strategyB) {
            return { error: 'Need strategy_a and strategy_b. Example: { strategy_a: "Think step by step", strategy_b: "Be concise and direct" }' };
        }

        const experiment = {
            id: `exp_${Date.now()}`,
            name,
            strategyA: { prompt: strategyA, runs: [], avgScore: 0, avgTokens: 0, avgLatency: 0 },
            strategyB: { prompt: strategyB, runs: [], avgScore: 0, avgTokens: 0, avgLatency: 0 },
            status: 'active',
            winner: null,
            createdAt: new Date().toISOString(),
            minRuns: input.min_runs || 3,
        };

        state.experiments.push(experiment);
        _save();

        return {
            result: `🧬 EXPERIMENT CREATED: "${name}"\n` +
                    `ID: ${experiment.id}\n` +
                    `Strategy A: "${strategyA.substring(0, 80)}"\n` +
                    `Strategy B: "${strategyB.substring(0, 80)}"\n` +
                    `Min runs each: ${experiment.minRuns}\n\n` +
                    `Use nas_benchmark to run tests, or nas_auto_test for automatic testing.`
        };
    }

    /**
     * Run a benchmark test for an experiment
     * Tool: nas_benchmark
     */
    async function runBenchmark(input) {
        const expId = input.experiment_id || input.id;
        const testPrompt = input.test_prompt || input.prompt || 'Explain how a CPU works in 3 sentences.';

        const experiment = state.experiments.find(e => e.id === expId);
        if (!experiment) return { error: `Experiment "${expId}" not found.` };
        if (experiment.status !== 'active') return { result: `Experiment already completed. Winner: ${experiment.winner}` };

        const apiKey = window.getConfig?.('apiKey');
        const provider = window.getConfig?.('provider') || 'gemini-2.5-flash-preview-05-20';
        if (!apiKey) return { error: 'No API key configured.' };

        const results = {};

        // Test Strategy A
        for (const [label, strategy] of [['A', experiment.strategyA], ['B', experiment.strategyB]]) {
            const systemPrompt = `${strategy.prompt}\n\nAnswer the following:`;
            const startTime = Date.now();

            try {
                const response = await window.brainLLMAdapter.query(
                    provider, apiKey, systemPrompt,
                    [{ role: 'user', content: testPrompt }],
                    null, () => {}, null
                );

                const latency = Date.now() - startTime;
                const rawText = response.rawText || '';
                const tokenEstimate = Math.ceil(rawText.length / 4);

                // Score: lower tokens + lower latency = higher score
                // Quality bonus: length indicates thoroughness (up to a point)
                const lengthScore = Math.min(rawText.length / 500, 1.0);  // 0-1
                const efficiencyScore = Math.max(0, 1 - (tokenEstimate / 1000));  // fewer tokens = better
                const speedScore = Math.max(0, 1 - (latency / 10000));  // faster = better
                const score = (lengthScore * 0.4 + efficiencyScore * 0.3 + speedScore * 0.3) * 100;

                const run = {
                    timestamp: new Date().toISOString(),
                    testPrompt: testPrompt.substring(0, 100),
                    tokens: tokenEstimate,
                    latency,
                    responseLength: rawText.length,
                    score: Math.round(score * 10) / 10,
                };

                strategy.runs.push(run);
                strategy.avgScore = strategy.runs.reduce((s, r) => s + r.score, 0) / strategy.runs.length;
                strategy.avgTokens = strategy.runs.reduce((s, r) => s + r.tokens, 0) / strategy.runs.length;
                strategy.avgLatency = strategy.runs.reduce((s, r) => s + r.latency, 0) / strategy.runs.length;

                results[label] = run;
            } catch(err) {
                results[label] = { error: err.message };
            }
        }

        // Check if experiment can be concluded
        if (experiment.strategyA.runs.length >= experiment.minRuns &&
            experiment.strategyB.runs.length >= experiment.minRuns) {

            if (experiment.strategyA.avgScore > experiment.strategyB.avgScore) {
                experiment.winner = 'A';
            } else {
                experiment.winner = 'B';
            }
            experiment.status = 'completed';

            // Auto-apply winning strategy
            if (state.autoOptimize && window.brainEvolution) {
                const winningStrategy = experiment.winner === 'A' ? experiment.strategyA : experiment.strategyB;
                window.brainEvolution.evolvePrompt({
                    rule: `[NAS-OPTIMIZED] ${winningStrategy.prompt}`,
                    reason: `Auto-applied by NAS. Score: ${winningStrategy.avgScore.toFixed(1)} vs ${(experiment.winner === 'A' ? experiment.strategyB : experiment.strategyA).avgScore.toFixed(1)}`,
                });
                console.log(`[NAS] 🏆 Auto-applied winning strategy: ${experiment.winner}`);
            }
        }

        _save();

        return {
            result: `🧬 BENCHMARK RESULT: "${experiment.name}"\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Test: "${testPrompt.substring(0, 60)}"\n\n` +
                    `📊 Strategy A: Score ${results.A?.score || 'ERR'} | ${results.A?.tokens || '?'} tokens | ${results.A?.latency || '?'}ms\n` +
                    `📊 Strategy B: Score ${results.B?.score || 'ERR'} | ${results.B?.tokens || '?'} tokens | ${results.B?.latency || '?'}ms\n\n` +
                    `Running avg A: ${experiment.strategyA.avgScore.toFixed(1)} (${experiment.strategyA.runs.length} runs)\n` +
                    `Running avg B: ${experiment.strategyB.avgScore.toFixed(1)} (${experiment.strategyB.runs.length} runs)\n` +
                    (experiment.status === 'completed'
                        ? `\n🏆 WINNER: Strategy ${experiment.winner}! Auto-applied: ${state.autoOptimize ? 'YES' : 'NO'}`
                        : `\n⏳ Need ${experiment.minRuns - Math.min(experiment.strategyA.runs.length, experiment.strategyB.runs.length)} more runs per strategy.`)
        };
    }

    // ═══ TOKEN EFFICIENCY OPTIMIZER ═════════════════════════════════════

    /**
     * Analyze current token usage patterns and suggest optimizations
     * Tool: nas_optimize
     */
    function optimize(input) {
        const analytics = window.toolAnalytics;
        const costTracker = window.costTracker;

        let report = `🧠 NAS OPTIMIZATION REPORT\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        // Analyze conversation patterns
        const chatMessages = window.chatHistory || [];
        const userMsgs = chatMessages.filter(m => m.role === 'user');
        const agentMsgs = chatMessages.filter(m => m.role === 'assistant');

        const avgUserLen = userMsgs.reduce((sum, m) => sum + (m.content?.length || 0), 0) / (userMsgs.length || 1);
        const avgAgentLen = agentMsgs.reduce((sum, m) => sum + (m.content?.length || 0), 0) / (agentMsgs.length || 1);
        const ratio = avgAgentLen / (avgUserLen || 1);

        report += `📝 CONVERSATION ANALYSIS:\n`;
        report += `  Avg user message: ${Math.round(avgUserLen)} chars\n`;
        report += `  Avg agent response: ${Math.round(avgAgentLen)} chars\n`;
        report += `  Response/Input ratio: ${ratio.toFixed(1)}x\n\n`;

        // Token efficiency suggestions
        const suggestions = [];

        if (ratio > 5) {
            suggestions.push({
                priority: 'HIGH',
                suggestion: 'Agent responses are 5x+ longer than user inputs. Add "Be concise" to system prompt.',
                action: 'evolve_prompt',
                data: { rule: 'Keep responses concise. Aim for 2-3x the user message length maximum.' }
            });
        }

        if (avgAgentLen > 2000) {
            suggestions.push({
                priority: 'MEDIUM',
                suggestion: 'Average response >2000 chars. Consider chunking long responses.',
                action: 'evolve_prompt',
                data: { rule: 'For complex tasks, give a brief summary first, then details only if asked.' }
            });
        }

        // Cost analysis
        if (costTracker) {
            const costs = costTracker.costReport({});
            report += `💰 COST ANALYSIS:\n  ${(costs.result || '').substring(0, 200)}\n\n`;
        }

        // Tool efficiency
        if (analytics) {
            const toolReport = analytics.telemetryReport({});
            report += `🔧 TOOL EFFICIENCY:\n  ${(toolReport.result || '').substring(0, 200)}\n\n`;
        }

        report += `💡 OPTIMIZATION SUGGESTIONS (${suggestions.length}):\n`;
        if (suggestions.length === 0) {
            report += `  ✅ No critical optimizations needed!\n`;
        } else {
            for (const s of suggestions) {
                report += `  [${s.priority}] ${s.suggestion}\n`;
            }
        }

        // Auto-apply if configured
        if (input.auto_apply && suggestions.length > 0) {
            for (const s of suggestions) {
                if (s.action === 'evolve_prompt' && window.brainEvolution) {
                    window.brainEvolution.evolvePrompt(s.data);
                }
            }
            report += `\n✅ Auto-applied ${suggestions.length} optimizations to system prompt.`;
        }

        return { result: report };
    }

    /**
     * Set token budget per conversation
     * Tool: nas_set_budget
     */
    function setBudget(input) {
        const budget = input.budget || input.tokens || input.max_tokens;
        if (!budget) {
            return {
                result: `Current token budget: ${state.tokenBudget ? state.tokenBudget + ' tokens' : 'UNLIMITED'}\n` +
                        `Set with: nas_set_budget({ budget: 50000 })`
            };
        }

        state.tokenBudget = parseInt(budget);
        _save();
        return { result: `✅ Token budget set to ${state.tokenBudget} tokens per conversation.` };
    }

    /**
     * List all experiments and their results
     * Tool: nas_experiments
     */
    function listExperiments(input) {
        if (state.experiments.length === 0) {
            return { result: 'No experiments. Use nas_experiment to create one.' };
        }

        let report = `🧬 NAS EXPERIMENTS (${state.experiments.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const exp of state.experiments) {
            const icon = exp.status === 'completed' ? '🏆' : '🔬';
            report += `\n${icon} ${exp.name} (${exp.id})\n`;
            report += `   Status: ${exp.status}`;
            if (exp.winner) report += ` | Winner: Strategy ${exp.winner}`;
            report += `\n`;
            report += `   A: "${exp.strategyA.prompt.substring(0, 50)}" — avg ${exp.strategyA.avgScore.toFixed(1)}\n`;
            report += `   B: "${exp.strategyB.prompt.substring(0, 50)}" — avg ${exp.strategyB.avgScore.toFixed(1)}\n`;
        }
        return { result: report };
    }

    /**
     * Self-patch: analyze own code and suggest improvements
     * Tool: nas_self_patch
     */
    async function selfPatch(input) {
        const target = input.target || input.module || 'system_prompt';

        if (target === 'system_prompt') {
            // Analyze evolved rules and prune ineffective ones
            const evolved = window.brainEvolution?.getHistory?.();
            const injection = window.brainEvolution?.getPromptInjection?.();

            return {
                result: `🔧 SELF-PATCH ANALYSIS: System Prompt\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `Current evolved rules: ${injection ? injection.split('\n').length - 2 : 0}\n` +
                        `Evolution history: ${evolved?.result?.split('\n').length || 0} entries\n\n` +
                        `Recommendations:\n` +
                        `1. Run nas_experiment to A/B test prompt rules\n` +
                        `2. Use nas_optimize to find token waste\n` +
                        `3. Use evolve_undo to remove underperforming rules\n\n` +
                        `Auto-optimize: ${state.autoOptimize ? 'ENABLED' : 'DISABLED'}`
            };
        }

        return { result: `Self-patch target "${target}" not supported yet. Use "system_prompt".` };
    }

    // ═══ PERFORMANCE PROFILING ═══════════════════════════════════════════

    const _profileData = {
        toolTimings: {},      // toolName → [latencyMs]
        toolSuccess: {},      // toolName → { success: n, fail: n }
        modelTimings: {},     // model → [latencyMs]
        sessionStart: Date.now(),
    };

    /**
     * Record a tool execution (called from dispatcher hook)
     */
    function recordToolProfile(toolName, latencyMs, success) {
        if (!_profileData.toolTimings[toolName]) _profileData.toolTimings[toolName] = [];
        _profileData.toolTimings[toolName].push(latencyMs);
        if (_profileData.toolTimings[toolName].length > 100) _profileData.toolTimings[toolName].shift();

        if (!_profileData.toolSuccess[toolName]) _profileData.toolSuccess[toolName] = { success: 0, fail: 0 };
        if (success) _profileData.toolSuccess[toolName].success++;
        else _profileData.toolSuccess[toolName].fail++;
    }

    /**
     * Performance report
     * Tool: profile_report
     */
    function profileReport(input) {
        const sessionDuration = ((Date.now() - _profileData.sessionStart) / 1000 / 60).toFixed(1);

        let report = `📊 PERFORMANCE PROFILE\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n`;
        report += `Session: ${sessionDuration} min\\n\\n`;

        // Tool timings sorted by avg latency (slowest first)
        const entries = Object.entries(_profileData.toolTimings)
            .map(([name, timings]) => {
                const avg = timings.reduce((s, t) => s + t, 0) / timings.length;
                const max = Math.max(...timings);
                const min = Math.min(...timings);
                const calls = timings.length;
                const successRate = _profileData.toolSuccess[name]
                    ? (_profileData.toolSuccess[name].success / (_profileData.toolSuccess[name].success + _profileData.toolSuccess[name].fail) * 100)
                    : 100;
                return { name, avg, max, min, calls, successRate };
            })
            .sort((a, b) => b.avg - a.avg);

        if (entries.length === 0) {
            report += `No profiling data yet. Tools will be profiled as they execute.\\n`;
        } else {
            report += `🔧 TOOL PERFORMANCE (slowest first):\\n`;
            for (const e of entries.slice(0, 20)) {
                const bar = '█'.repeat(Math.min(20, Math.round(e.avg / 200)));
                report += `  ${e.name}: avg ${e.avg.toFixed(0)}ms | max ${e.max}ms | ${e.calls} calls | ${e.successRate.toFixed(0)}% success ${bar}\\n`;
            }

            // Summary stats
            const totalCalls = entries.reduce((s, e) => s + e.calls, 0);
            const avgLatency = entries.reduce((s, e) => s + e.avg * e.calls, 0) / (totalCalls || 1);
            report += `\\nTOTAL: ${totalCalls} tool calls | avg ${avgLatency.toFixed(0)}ms\\n`;
        }

        // Memory estimate
        const chatLen = (window.chatHistory || []).length;
        const chatSize = JSON.stringify(window.chatHistory || []).length;
        report += `\\n💾 MEMORY:\\n`;
        report += `  Chat messages: ${chatLen}\\n`;
        report += `  Chat size: ~${(chatSize / 1024).toFixed(0)}KB\\n`;

        return { result: report };
    }

    /**
     * Tool effectiveness scoring
     * Tool: tool_effectiveness
     */
    function toolEffectiveness(input) {
        const entries = Object.entries(_profileData.toolSuccess)
            .map(([name, stats]) => {
                const total = stats.success + stats.fail;
                const rate = total > 0 ? (stats.success / total * 100) : 0;
                const avgTime = _profileData.toolTimings[name]
                    ? _profileData.toolTimings[name].reduce((s, t) => s + t, 0) / _profileData.toolTimings[name].length
                    : 0;
                // Effectiveness = success rate * speed factor
                const speedFactor = Math.max(0, 1 - avgTime / 10000);
                const effectiveness = rate * speedFactor;
                return { name, successRate: rate, avgTime, total, effectiveness };
            })
            .sort((a, b) => b.effectiveness - a.effectiveness);

        let report = `🎯 TOOL EFFECTIVENESS RANKING\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n`;

        if (entries.length === 0) {
            report += `No data. Tools will be scored as they execute.\\n`;
        } else {
            for (const e of entries) {
                const stars = '⭐'.repeat(Math.min(5, Math.round(e.effectiveness / 20)));
                report += `  ${stars} ${e.name}: ${e.successRate.toFixed(0)}% success | ${e.avgTime.toFixed(0)}ms avg | ${e.total} uses\\n`;
            }
        }

        return { result: report };
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkNAS = {
        createExperiment,
        runBenchmark,
        optimize,
        setBudget,
        listExperiments,
        selfPatch,
        recordToolProfile,
        profileReport,
        toolEffectiveness,
    };

    console.log(`[Brain] ✅ NAS module loaded — ${state.experiments.length} experiments, auto-optimize: ${state.autoOptimize}`);

})();
