// =========================================================================
// FLOWORK OS — Brain Memory Bridge
// Connects brain_flowork_adapter's agent loop to existing memory systems:
//   - sessionPersistence (auto-save/restore)
//   - autoMemory (extract facts from conversation)
//   - sessionMemory (inject past memories at start)
//   - autoDream (consolidate memories overnight)
//   - smartCompact (reduce context window)
//   - toolUseSummary (track tool performance)
// =========================================================================

(function() {
    'use strict';

    // Wait for brain adapter to be ready
    if (!window.floworkBrain) {
        console.warn('[BrainMemory] floworkBrain not ready — skipping');
        return;
    }

    const _originalSubmit = window.floworkBrain.submitMessage.bind(window.floworkBrain);

    // ═══ ENHANCED submitMessage — wraps brain adapter with memory hooks ═══
    window.floworkBrain.submitMessage = async function(prompt, options = {}) {

        // ── PRE-HOOKS ──────────────────────────────────────────────

        // 1. Inject session memory at first message
        if (window.sessionMemory && !window.sessionMemory.injected) {
            await window.sessionMemory.injectAtStart();
        }

        // 2. Initialize session persistence
        if (window.sessionPersistence && !window.sessionPersistence.currentSessionId) {
            window.sessionPersistence.init();
        }

        // 3. Mark session as dirty
        if (window.sessionPersistence) {
            window.sessionPersistence.markDirty();
        }

        // 4. Clear prompt suggestion
        if (window.promptSuggestion) {
            window.promptSuggestion.clear();
        }

        // ── EXECUTE ────────────────────────────────────────────────
        await _originalSubmit(prompt, options);

        // ── POST-HOOKS (all silent, non-blocking) ────────────────────

        // Check Go backend health before triggering any memory hooks
        let goBackendOnline = false;
        try {
            const ping = await fetch('http://127.0.0.1:5000/api/health', { method: 'GET', signal: AbortSignal.timeout(1000) });
            goBackendOnline = ping.ok;
        } catch(e) { /* offline */ }

        if (goBackendOnline) {
            // 5. Auto-extract memories from conversation
            if (window.autoMemory && window.autoMemory.shouldExtract?.()) {
                window.autoMemory.extractFromConversation().catch(() => {});
            }

            // 6. Auto-save session
            if (window.sessionPersistence && window.sessionPersistence.isDirty) {
                window.sessionPersistence.save().catch(() => {});
            }

            // 7. Generate prompt suggestion for next turn
            if (window.promptSuggestion && window.promptSuggestion.enabled) {
                window.promptSuggestion.generate().catch(() => {});
            }

            // 8. Auto-dream only if backend up AND conditions met
            if (window.autoDream && window.autoDream.shouldRun?.()) {
                window.autoDream.run().catch(e => {
                    // Mark as consollidated to prevent retry loop
                    if (window.autoDream) {
                        window.autoDream.lastConsolidatedAt = Date.now();
                        try { localStorage.setItem('flowork_last_dream', String(Date.now())); } catch(x) {}
                    }
                });
            }

            // 8.5 NAS Auto-optimize every 20 tool calls
            if (window.floworkNAS && window.toolAnalytics) {
                const nasStats = window.toolAnalytics.getState?.();
                if (nasStats?.sessionToolCalls && nasStats.sessionToolCalls % 20 === 0) {
                    try {
                        window.floworkNAS.optimize({ auto_apply: true });
                        console.log('[BrainMemory] 🧬 NAS auto-optimize triggered');
                    } catch(e) {}
                }
            }

            // 9. Magic docs
            if (window.magicDocs && window.magicDocs.trackedArticles?.size > 0) {
                window.magicDocs.updateAll().catch(() => {});
            }
        } else {
            console.log('[BrainMemory] Go backend offline — skipping memory hooks');
        }
    };

    // ═══ Wire brain_native tool handlers to existing memory systems ═══
    const _originalExecuteTool = window.floworkBrain.executeTool.bind(window.floworkBrain);

    window.floworkBrain.executeTool = async function(toolName, toolInput) {
        const startTime = Date.now();

        // Route memory tools to existing implementations
        switch (toolName) {
            // ─── Session Persistence ────────────────────────────
            case 'session_save':
                if (window.sessionPersistence) {
                    return await window.sessionPersistence.save(toolInput?.label);
                }
                break;

            case 'session_restore':
            case 'session_resume':
                if (window.sessionPersistence) {
                    return await window.sessionPersistence.restore(toolInput?.session_id);
                }
                break;

            case 'session_list':
            case 'list_sessions':
                if (window.sessionPersistence) {
                    const sessions = await window.sessionPersistence.listSessions();
                    return { result: sessions };
                }
                break;

            // ─── Memory ─────────────────────────────────────────
            case 'remember':
            case 'save_memory':
                if (window.autoMemory) {
                    const fact = toolInput?.fact || toolInput?.content || '';
                    const level = toolInput?.level || 'project';
                    try {
                        await fetch('http://127.0.0.1:5000/api/knowledge', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: `[AUTO:${level}] ${fact.substring(0, 80)}`,
                                content: fact,
                                category: level
                            })
                        });
                        return { result: `Remembered: "${fact.substring(0, 100)}" (level: ${level})` };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
                break;

            case 'memory_search':
                try {
                    const res = await fetch('http://127.0.0.1:5000/api/knowledge/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: toolInput?.query || '',
                            limit: toolInput?.limit || 10
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        return { result: data.results || data.data || [] };
                    }
                } catch (e) {
                    return { error: e.message };
                }
                break;

            // ─── Compaction ─────────────────────────────────────
            case 'compact':
            case 'smart_compact':
                return _smartCompact();

            // ─── Dream (consolidation) ──────────────────────────
            case 'dream':
                if (window.autoDream) {
                    await window.autoDream.run();
                    return { result: 'Dream consolidation complete' };
                }
                break;

            // ─── Magic Docs ─────────────────────────────────────
            case 'magic_docs_update':
                if (window.magicDocs) {
                    await window.magicDocs.updateAll();
                    return { result: `Updated ${window.magicDocs.trackedArticles.size} tracked articles` };
                }
                break;

            // ─── Auto-Memory Config ─────────────────────────────
            case 'set_auto_memory':
                if (window.autoMemory) {
                    window.autoMemory.enabled = toolInput?.enabled !== false;
                    return { result: `Auto-memory ${window.autoMemory.enabled ? 'enabled' : 'disabled'}` };
                }
                break;

            // ─── Session Memory Inject ──────────────────────────
            case 'session_memory_inject':
                if (toolInput?.content) {
                    window.chatHistory.unshift({
                        role: 'system',
                        content: `[Memory Injection] ${toolInput.content}`
                    });
                    return { result: 'Memory injected into session context' };
                }
                break;

            // ─── Summary ────────────────────────────────────────
            case 'agent_summary':
                if (window.agentSummary) {
                    return { result: window.agentSummary.generate(window.chatHistory || []) };
                }
                break;

            case 'away_summary':
                if (window.agentSummary) {
                    const summary = window.agentSummary.generate(window.chatHistory || []);
                    summary.type = 'away_summary';
                    summary.timestamp = new Date().toISOString();
                    return { result: summary };
                }
                break;
        }

        // Default: delegate to original executor
        const result = await _originalExecuteTool(toolName, toolInput);

        // Record tool usage stats
        if (window.toolUseSummary) {
            const duration = Date.now() - startTime;
            const success = !result?.error;
            window.toolUseSummary.record(toolName, success, duration);
        }

        return result;
    };

    // ═══ SMART COMPACT — Reduce context window ═══════════════════════
    async function _smartCompact() {
        const history = window.chatHistory || [];
        if (history.length < 10) {
            return { result: 'Not enough history to compact (need 10+ messages)' };
        }

        // Strategy: Keep first 2 system msgs + last 8 msgs, summarize middle
        const systemMsgs = history.filter(m => m.role === 'system').slice(0, 2);
        const recentMsgs = history.slice(-8);
        const middleMsgs = history.slice(2, -8);

        if (middleMsgs.length < 4) {
            return { result: 'Not enough middle context to compact' };
        }

        // Create summary of middle messages
        const middleText = middleMsgs.map(m => {
            const content = typeof m.content === 'string' ? m.content : '';
            return `[${m.role}]: ${content.substring(0, 200)}`;
        }).join('\n');

        const summary = `[COMPACTED] ${middleMsgs.length} messages summarized:\n` +
            `Topics covered: ${_extractTopics(middleMsgs).join(', ')}\n` +
            `Tools used: ${_extractTools(middleMsgs).join(', ')}\n` +
            `Key decisions: ${_extractDecisions(middleMsgs).join('; ')}\n`;

        // Replace history
        window.chatHistory = [
            ...systemMsgs,
            { role: 'system', content: summary },
            ...recentMsgs
        ];

        const removed = middleMsgs.length;
        const remaining = window.chatHistory.length;

        console.log(`[SmartCompact] Removed ${removed} msgs, ${remaining} remaining`);
        if (window.appendToolMessage) {
            window.appendToolMessage('compact', 'success',
                `📦 Compacted: ${removed} messages → summary. ${remaining} messages remain.`);
        }

        // Mark session dirty so it auto-saves
        if (window.sessionPersistence) {
            window.sessionPersistence.markDirty();
        }

        return {
            result: `Compacted ${removed} messages into summary. ${remaining} messages remain.`,
            removed,
            remaining
        };
    }

    // Helper: extract topics from messages
    function _extractTopics(msgs) {
        const topics = new Set();
        for (const m of msgs) {
            const content = (typeof m.content === 'string' ? m.content : '').toLowerCase();
            if (content.includes('file')) topics.add('file operations');
            if (content.includes('browser') || content.includes('tab')) topics.add('browser automation');
            if (content.includes('error') || content.includes('fix')) topics.add('debugging');
            if (content.includes('build') || content.includes('compile')) topics.add('building');
            if (content.includes('test')) topics.add('testing');
            if (content.includes('deploy')) topics.add('deployment');
            if (content.includes('database') || content.includes('sql')) topics.add('database');
            if (content.includes('api')) topics.add('API work');
        }
        return [...topics].slice(0, 5);
    }

    // Helper: extract tool names from messages
    function _extractTools(msgs) {
        const tools = new Set();
        for (const m of msgs) {
            const content = typeof m.content === 'string' ? m.content : '';
            const matches = content.match(/"action"\s*:\s*"(\w+)"/g) || [];
            for (const match of matches) {
                const tool = match.replace(/"action"\s*:\s*"/, '').replace('"', '');
                tools.add(tool);
            }
        }
        return [...tools].slice(0, 8);
    }

    // Helper: extract key decisions from messages
    function _extractDecisions(msgs) {
        const decisions = [];
        for (const m of msgs) {
            if (m.role !== 'user') continue;
            const content = typeof m.content === 'string' ? m.content : '';
            if (content.length > 30 && content.length < 200) {
                decisions.push(content.substring(0, 100));
            }
        }
        return decisions.slice(0, 3);
    }

    // ═══ COMPACT OVERRIDE — Wire window.smartCompact ═══
    window.smartCompact = _smartCompact;

    console.log('[Brain] ✅ Memory Bridge loaded');
    console.log('  → sessionPersistence:', !!window.sessionPersistence);
    console.log('  → autoMemory:', !!window.autoMemory);
    console.log('  → sessionMemory:', !!window.sessionMemory);
    console.log('  → autoDream:', !!window.autoDream);
    console.log('  → promptSuggestion:', !!window.promptSuggestion);

})();
