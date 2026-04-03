// =========================================================================
// FLOWORK OS — Brain Native Dispatcher
// Master router for all brain_native tools.
// This wires window.floworkBrain.executeTool so _executeBrainNative
// in the registry can dispatch to the correct module.
//
// MUST be loaded AFTER all brain modules and BEFORE evolution.js
// =========================================================================

(function() {
    'use strict';

    // ─── Ensure floworkBrain exists ─────────────────────────────────────
    if (!window.floworkBrain) window.floworkBrain = {};

    /**
     * Master dispatcher for brain_native tools.
     * Called by brain_flowork_tool_registry.js → _executeBrainNative()
     * when a tool has handler: 'brain_native'.
     */
    window.floworkBrain.executeTool = async function(toolName, input) {

        // ═══ FEATURE FLAG GATE — check if module is enabled ═══════════
        const _featureMap = {
            'spawn_agent': 'multiAgent', 'check_agent': 'multiAgent', 'list_agents': 'multiAgent',
            'create_team': 'multiAgent', 'list_teams': 'multiAgent', 'delete_team': 'multiAgent',
            'team_share_memory': 'multiAgent', 'team_sync': 'multiAgent',
            'mcp_connect': 'mcp', 'mcp_call_tool': 'mcp', 'mcp_disconnect': 'mcp',
            'mcp_list_tools': 'mcp', 'mcp_list_servers': 'mcp', 'mcp_server_start': 'mcp', 'mcp_server_stop': 'mcp',
            'find_definition': 'lsp', 'find_references': 'lsp', 'document_symbols': 'lsp', 'hover_info': 'lsp',
            'plugin_list': 'plugins', 'plugin_load': 'plugins', 'plugin_unload': 'plugins',
            'plugin_install': 'plugins', 'plugin_uninstall': 'plugins', 'plugin_enable': 'plugins', 'plugin_disable': 'plugins',
            'voice_start': 'voice', 'voice_stop': 'voice',
            'vision_analyze': 'vision', 'vision_find_element': 'vision', 'vision_ocr': 'vision',
            'vision_diff': 'vision', 'vision_set_model': 'vision', 'vision_status': 'vision',
            'vision_auto_start': 'vision', 'vision_auto_stop': 'vision', 'vision_click_at': 'vision',
            'tts_speak': 'tts', 'tts_stop': 'tts', 'tts_list_voices': 'tts', 'tts_set_provider': 'tts', 'tts_status': 'tts',
            'transcribe_audio': 'ears', 'watch_folder': 'ears', 'unwatch_folder': 'ears',
            'start_webhook': 'ears', 'stop_webhook': 'ears', 'ear_status': 'ears',
            'crawl_url': 'crawler', 'crawl_site': 'crawler', 'extract_page': 'crawler', 'crawl_status': 'crawler',
            'generate_image': 'imagegen', 'edit_image': 'imagegen', 'imagegen_status': 'imagegen',
            'generate_sound': 'audiogen', 'generate_music': 'audiogen', 'audiogen_status': 'audiogen',
            'generate_voice_clone': 'audiogen', 'mix_audio': 'audiogen', 'audio_library': 'audiogen',
            'generate_video': 'videogen', 'video_status': 'videogen', 'record_screen': 'videogen',
            'stop_recording': 'videogen', 'create_animation': 'videogen',
            'start_realtime_mic': 'ears', 'stop_realtime_mic': 'ears',
            'start_wake_word': 'ears', 'stop_wake_word': 'ears',
            'start_continuous_listen': 'ears', 'stop_continuous_listen': 'ears',
            'tts_speak_streaming': 'tts', 'tts_speak_chunked': 'tts',
            'tts_stop_streaming': 'tts', 'tts_hook_streaming': 'tts',
            'daemon_schedule': 'daemon', 'daemon_list': 'daemon', 'daemon_cancel': 'daemon',
            'daemon_pause': 'daemon', 'daemon_resume': 'daemon',
            // ── Smart Module Bridges (Phase 2) ──
            'gateway_send': 'gateway', 'gateway_reply': 'gateway', 'gateway_list_channels': 'gateway',
            'gateway_status': 'gateway', 'gateway_register_channel': 'gateway', 'gateway_connect_whatsapp': 'gateway',
            'gateway_connect_telegram': 'gateway',
            'subagent_spawn': 'subagentsPro', 'subagent_kill': 'subagentsPro', 'subagent_kill_all': 'subagentsPro',
            'subagent_steer': 'subagentsPro', 'subagent_list': 'subagentsPro', 'subagent_status': 'subagentsPro',
            'session_create': 'sessions', 'session_save_smart': 'sessions', 'session_load_smart': 'sessions',
            'session_list_smart': 'sessions', 'session_delete': 'sessions', 'session_export': 'sessions',
            'session_import': 'sessions', 'session_repair': 'sessions',
            'skill_install': 'skills', 'skill_uninstall': 'skills', 'skill_activate': 'skills',
            'skill_deactivate': 'skills', 'skill_list': 'skills', 'skill_search': 'skills',
            'skill_install_marketplace': 'skills',
            'context_check': 'contextGuard', 'context_status': 'contextGuard', 'context_trend': 'contextGuard',
            'mcp_connect_sse': 'mcpSmart', 'mcp_connect_ws': 'mcpSmart', 'mcp_register_virtual': 'mcpSmart',
            'mcp_smart_call': 'mcpSmart', 'mcp_smart_list_servers': 'mcpSmart', 'mcp_smart_list_tools': 'mcpSmart',
            'mcp_smart_disconnect': 'mcpSmart', 'mcp_read_resource': 'mcpSmart',
            'redact_text': 'redaction', 'check_sensitive': 'redaction', 'redact_object': 'redaction',
        };
        const _requiredFeature = _featureMap[toolName];
        if (_requiredFeature && window.floworkFeatures && !window.floworkFeatures.isEnabled(_requiredFeature)) {
            return { result: `🔒 [DISABLED] Feature "${_requiredFeature}" is currently disabled. Use feature_enable({ name: "${_requiredFeature}" }) to activate it first.` };
        }

        // ═══ KERNEL FILE PROTECTION — AI cannot modify security files ═══
        const _KERNEL_FILES = [
            '.env',  // 🔒 Mode config — AI CANNOT change DEV/PUBLISH
            'brain_flowork_config.js', 'brain_flowork_evolution.js',
            'brain_flowork_permissions.js', 'brain_flowork_features.js',
            'brain_flowork_native_dispatcher.js', 'brain_flowork_adapter.js',
            'brain_flowork_tool_bridge.js', 'brain_flowork_tool_registry.js',
        ];
        const _writeTools = ['write_files', 'patch_file', 'smart_patch', 'delete_file', 'rename_file', 'dev_patch_file'];
        if (_writeTools.includes(toolName)) {
            const filePath = input?.path || input?.file_path || input?.target || '';
            const fileName = filePath.split(/[/\\]/).pop();
            if (_KERNEL_FILES.includes(fileName)) {
                console.error(`[🔒 SECURITY] ❌ BLOCKED: AI tried to modify kernel file: ${fileName}`);
                return { result: `🔒 [KERNEL PROTECTION] Cannot modify "${fileName}" — this is a protected system file. Security-critical brain modules cannot be modified by AI to prevent self-tampering.` };
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // PLAN MODE (Phase 1)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'enter_plan_mode') return window.floworkPlanMode?.enter?.(input) || _stub('plan_mode');
        if (toolName === 'exit_plan_mode') return window.floworkPlanMode?.exit?.(input) || _stub('plan_mode');
        if (toolName === 'advance_plan') return window.floworkPlanMode?.advance?.(input) || _stub('plan_mode');
        if (toolName === 'cancel_plan') return window.floworkPlanMode?.cancel?.(input) || _stub('plan_mode');
        if (toolName === 'ultraplan_start') return window.floworkPlanMode?.ultraplan?.(input) || _stub('plan_mode');

        // ═══════════════════════════════════════════════════════════════
        // COST TRACKER (Phase 1)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'cost_report') return window.costTracker?.costReport?.(input) || _stub('cost_tracker');
        if (toolName === 'cost_status') return window.costTracker?.costStatus?.(input) || _stub('cost_tracker');
        if (toolName === 'get_token_usage') return window.costTracker?.getTokenUsage?.(input) || _stub('cost_tracker');

        // ═══════════════════════════════════════════════════════════════
        // ANALYTICS (Phase 1)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'telemetry_report') return window.toolAnalytics?.telemetryReport?.(input) || _stub('analytics');
        if (toolName === 'tool_usage_report') return window.toolAnalytics?.toolUsageReport?.(input) || _stub('analytics');

        // ═══════════════════════════════════════════════════════════════
        // PERMISSIONS (Phase 2)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'set_permission_mode') return window.floworkPermissions?.setPermissionMode?.(input) || _stub('permissions');
        if (toolName === 'get_permission_status') return window.floworkPermissions?.getPermissionStatus?.(input) || _stub('permissions');
        if (toolName === 'get_audit_trail') return window.floworkPermissions?.getAuditTrail?.(input) || _stub('permissions');

        // ═══════════════════════════════════════════════════════════════
        // FEATURE FLAGS (Phase 2)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'feature_enable') return window.floworkFeatures?.featureEnable?.(input) || _stub('features');
        if (toolName === 'feature_disable') return window.floworkFeatures?.featureDisable?.(input) || _stub('features');
        if (toolName === 'feature_list') return window.floworkFeatures?.featureList?.(input) || _stub('features');
        if (toolName === 'enable_thinking') return window.floworkFeatures?.enableThinking?.(input) || _stub('features');
        if (toolName === 'disable_thinking') return window.floworkFeatures?.disableThinking?.(input) || _stub('features');

        // ═══════════════════════════════════════════════════════════════
        // SELF-REVIEW (Phase 2)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'self_review') return window.floworkReview?.selfReview?.(input) || _stub('review');
        if (toolName === 'brief') return window.floworkReview?.brief?.(input) || _stub('review');
        if (toolName === 'synthetic_output') return window.floworkReview?.syntheticOutput?.(input) || _stub('review');

        // ═══════════════════════════════════════════════════════════════
        // MULTI-AGENT (Phase 3) — stubs until module loaded
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'spawn_agent') return window.agentPool?.spawnAgent?.(input) || _stub('agents');
        if (toolName === 'check_agent') return window.agentPool?.checkAgent?.(input) || _stub('agents');
        if (toolName === 'list_agents') return window.agentPool?.listAgents?.(input) || _stub('agents');
        if (toolName === 'create_team') return window.teamManager?.createTeam?.(input) || _stub('teams');
        if (toolName === 'list_teams') return window.teamManager?.listTeams?.(input) || _stub('teams');
        if (toolName === 'delete_team') return window.teamManager?.deleteTeam?.(input) || _stub('teams');
        if (toolName === 'team_share_memory') return window.teamManager?.shareMemory?.(input) || _stub('teams');
        if (toolName === 'team_sync') return window.teamManager?.syncTeam?.(input) || _stub('teams');

        // ═══════════════════════════════════════════════════════════════
        // MCP (Phase 4) — stubs until module loaded
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'mcp_connect') return window.mcpManager?.connect?.(input) || _stub('mcp');
        if (toolName === 'mcp_call_tool') return window.mcpManager?.callTool?.(input) || _stub('mcp');
        if (toolName === 'mcp_disconnect') return window.mcpManager?.disconnect?.(input) || _stub('mcp');
        if (toolName === 'mcp_list_tools') return window.mcpManager?.listTools?.(input) || _stub('mcp');
        if (toolName === 'mcp_list_servers') return window.mcpManager?.listServers?.(input) || _stub('mcp');
        if (toolName === 'mcp_server_start') return window.mcpManager?.serverStart?.(input) || _stub('mcp');
        if (toolName === 'mcp_server_stop') return window.mcpManager?.serverStop?.(input) || _stub('mcp');

        // ═══════════════════════════════════════════════════════════════
        // PLUGINS (Phase 6) — stubs until module loaded
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'plugin_list') return window.floworkPlugins?.list?.(input) || _stub('plugins');
        if (toolName === 'plugin_load') return window.floworkPlugins?.load?.(input) || _stub('plugins');
        if (toolName === 'plugin_unload') return window.floworkPlugins?.unload?.(input) || _stub('plugins');
        if (toolName === 'plugin_install') return window.floworkPlugins?.install?.(input) || _stub('plugins');
        if (toolName === 'plugin_uninstall') return window.floworkPlugins?.uninstall?.(input) || _stub('plugins');
        if (toolName === 'plugin_enable') return window.floworkPlugins?.enable?.(input) || _stub('plugins');
        if (toolName === 'plugin_disable') return window.floworkPlugins?.disable?.(input) || _stub('plugins');

        // ═══════════════════════════════════════════════════════════════
        // LSP (Phase 6) — stubs until module loaded
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'find_definition') return window.floworkLSP?.findDefinition?.(input) || _stub('lsp');
        if (toolName === 'find_references') return window.floworkLSP?.findReferences?.(input) || _stub('lsp');
        if (toolName === 'document_symbols') return window.floworkLSP?.documentSymbols?.(input) || _stub('lsp');
        if (toolName === 'hover_info') return window.floworkLSP?.hoverInfo?.(input) || _stub('lsp');

        // ═══════════════════════════════════════════════════════════════
        // VOICE (Phase 6)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'voice_start') return window.floworkVoice?.start?.(input) || _stub('voice');
        if (toolName === 'voice_stop') return window.floworkVoice?.stop?.(input) || _stub('voice');

        // ═══════════════════════════════════════════════════════════════
        // IDE BRIDGE (Phase 6)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'bridge_start') return window.floworkBridge?.start?.(input) || _stub('bridge');
        if (toolName === 'bridge_stop') return window.floworkBridge?.stop?.(input) || _stub('bridge');
        if (toolName === 'bridge_status') return window.floworkBridge?.status?.(input) || _stub('bridge');
        if (toolName === 'get_ide_context') return window.floworkBridge?.getContext?.(input) || _stub('bridge');

        // ═══════════════════════════════════════════════════════════════
        // VISION — Deep Visual Reasoning (Agent Wish #1)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'vision_analyze' || toolName === 'analyze_screenshot') return window.floworkVision?.analyzeImage?.(input) || _stub('vision');
        if (toolName === 'vision_find_element') return window.floworkVision?.findElement?.(input) || _stub('vision');
        if (toolName === 'vision_ocr') return window.floworkVision?.extractText?.(input) || _stub('vision');
        if (toolName === 'vision_diff') return window.floworkVision?.diffScreenshots?.(input) || _stub('vision');
        if (toolName === 'vision_set_model') return window.floworkVision?.setModel?.(input) || _stub('vision');
        if (toolName === 'vision_status') return window.floworkVision?.status?.(input) || _stub('vision');

        // ═══════════════════════════════════════════════════════════════
        // NAS — Neural Architecture Search (Agent Wish #2)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'nas_experiment') return window.floworkNAS?.createExperiment?.(input) || _stub('nas');
        if (toolName === 'nas_benchmark') return window.floworkNAS?.runBenchmark?.(input) || _stub('nas');
        if (toolName === 'nas_optimize') return window.floworkNAS?.optimize?.(input) || _stub('nas');
        if (toolName === 'nas_set_budget') return window.floworkNAS?.setBudget?.(input) || _stub('nas');
        if (toolName === 'nas_experiments') return window.floworkNAS?.listExperiments?.(input) || _stub('nas');
        if (toolName === 'nas_self_patch') return window.floworkNAS?.selfPatch?.(input) || _stub('nas');
        if (toolName === 'profile_report') return window.floworkNAS?.profileReport?.(input) || _stub('nas');
        if (toolName === 'tool_effectiveness') return window.floworkNAS?.toolEffectiveness?.(input) || _stub('nas');

        // ═══════════════════════════════════════════════════════════════
        // SWARM — True Swarm Intelligence (Agent Wish #3)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'swarm_launch') return window.floworkSwarm?.launch?.(input) || _stub('swarm');
        if (toolName === 'swarm_status') return window.floworkSwarm?.status?.(input) || _stub('swarm');
        if (toolName === 'swarm_collect') return window.floworkSwarm?.collect?.(input) || _stub('swarm');
        if (toolName === 'swarm_cancel') return window.floworkSwarm?.cancel?.(input) || _stub('swarm');
        if (toolName === 'swarm_parallel') return window.floworkSwarm?.parallelExecute?.(input) || _stub('swarm');
        if (toolName === 'swarm_map_reduce') return window.floworkSwarm?.mapReduce?.(input) || _stub('swarm');

        // ═══════════════════════════════════════════════════════════════
        // MEMORY & SESSION — wired to existing implementations
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'remember' || toolName === 'save_memory') {
            const fact = input?.fact || input?.content || '';
            const level = input?.level || 'project';
            if (!fact) return { error: 'Missing fact/content to remember.' };
            try {
                const res = await fetch('http://127.0.0.1:5000/api/knowledge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: `[AUTO:${level}] ${fact.substring(0, 80)}`,
                        content: fact,
                        category: level
                    }),
                    signal: AbortSignal.timeout(5000),
                });
                if (res.ok) return { result: `✅ Remembered: "${fact.substring(0, 100)}" (level: ${level})` };
                return { error: `Memory save failed: HTTP ${res.status}` };
            } catch(e) {
                return { error: `Memory save failed: ${e.message}. Is Go backend running?` };
            }
        }

        if (toolName === 'memory_search') {
            const query = input?.query || input?.search || '';
            if (!query) return { error: 'Missing query for memory search.' };
            try {
                // Go backend only has GET /api/knowledge (list all) — no search endpoint
                const res = await fetch('http://127.0.0.1:5000/api/knowledge', {
                    signal: AbortSignal.timeout(5000),
                });
                if (res.ok) {
                    const data = await res.json();
                    const allItems = data.items || [];

                    // Split query into individual words for fuzzy OR matching
                    // This solves language mismatch (e.g. user searches in Indonesian but memory stored in English)
                    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
                    const fullQuery = query.toLowerCase();

                    // Score each item by how many query words match
                    const scored = allItems.map(item => {
                        const text = `${item.title || ''} ${item.content || ''} ${item.category || ''}`.toLowerCase();
                        let score = 0;
                        // Full query match = highest score
                        if (text.includes(fullQuery)) score += 10;
                        // Individual word matches
                        for (const word of queryWords) {
                            if (text.includes(word)) score += 1;
                        }
                        return { item, score };
                    });

                    const matched = scored.filter(s => s.score > 0)
                        .sort((a, b) => b.score - a.score);

                    const limit = input?.limit || 10;
                    const results = matched.slice(0, limit);

                    if (results.length === 0) {
                        // No matches → return ALL memories so AI can still find what it needs
                        if (allItems.length === 0) return { result: 'Memory bank is empty. No memories saved yet.' };
                        return {
                            result: `No exact matches for "${query}". Showing ALL ${allItems.length} memories:\n` +
                                allItems.slice(0, 20).map((r, i) => `${i+1}. [${r.category || 'general'}] ${r.title || 'Untitled'}\n   ${(r.content || '').substring(0, 150)}`).join('\n')
                        };
                    }
                    return {
                        result: `🔍 Found ${results.length} memories (of ${allItems.length} total):\n` +
                            results.map((r, i) => `${i+1}. [${r.item.category || 'general'}] ${r.item.title || 'Untitled'} (relevance: ${r.score})\n   ${(r.item.content || '').substring(0, 200)}`).join('\n')
                    };
                }
                return { error: `Memory search failed: HTTP ${res.status}` };
            } catch(e) {
                return { error: `Memory search failed: ${e.message}. Is Go backend running on port 5000?` };
            }
        }

        if (toolName === 'compact' || toolName === 'smart_compact') {
            if (window.smartCompact) return await window.smartCompact();
            // Inline fallback if smartCompact not loaded
            const history = window.chatHistory || [];
            if (history.length < 10) return { result: 'Not enough history to compact (need 10+ messages).' };
            const systemMsgs = history.filter(m => m.role === 'system').slice(0, 2);
            const recentMsgs = history.slice(-8);
            const removed = history.length - systemMsgs.length - recentMsgs.length;
            window.chatHistory = [...systemMsgs, { role: 'system', content: `[COMPACTED] ${removed} messages summarized.` }, ...recentMsgs];
            return { result: `📦 Compacted: ${removed} messages removed. ${window.chatHistory.length} remain.` };
        }

        if (toolName === 'session_save') {
            if (window.sessionPersistence?.save) {
                try {
                    const result = await window.sessionPersistence.save(input?.label);
                    return result || { result: '✅ Session saved.' };
                } catch(e) { return { error: `Session save failed: ${e.message}` }; }
            }
            return { result: 'Session persistence module not loaded.' };
        }

        if (toolName === 'session_memory_inject') {
            const content = input?.content || input?.memory || '';
            if (!content) return { error: 'Missing content to inject.' };
            if (window.chatHistory) {
                window.chatHistory.unshift({ role: 'system', content: `[Memory Injection] ${content}` });
                return { result: `✅ Memory injected into session context: "${content.substring(0, 80)}"` };
            }
            return { error: 'chatHistory not available.' };
        }

        if (toolName === 'magic_docs_update') {
            if (window.magicDocs?.updateAll) {
                try {
                    await window.magicDocs.updateAll();
                    return { result: `✅ Updated ${window.magicDocs.trackedArticles?.size || 0} tracked articles.` };
                } catch(e) { return { error: `Magic docs update failed: ${e.message}` }; }
            }
            return { result: 'Magic docs module not loaded or no tracked articles.' };
        }

        if (toolName === 'dream') {
            if (window.autoDream?.run) {
                try {
                    await window.autoDream.run();
                    return { result: '🌙 Dream consolidation complete. Memories organized.' };
                } catch(e) { return { error: `Dream failed: ${e.message}` }; }
            }
            return { result: 'Dream module not loaded.' };
        }

        if (toolName === 'agent_summary') {
            if (window.agentSummary?.generate) {
                return { result: window.agentSummary.generate(window.chatHistory || []) };
            }
            // Inline fallback
            const hist = window.chatHistory || [];
            const userCount = hist.filter(m => m.role === 'user').length;
            const toolCount = hist.filter(m => m.role === 'tool').length;
            return { result: `Session: ${userCount} user messages, ${toolCount} tool calls, ${hist.length} total exchanges.` };
        }

        if (toolName === 'away_summary') {
            if (window.agentSummary?.generate) {
                const summary = window.agentSummary.generate(window.chatHistory || []);
                return { result: JSON.stringify({ ...summary, type: 'away_summary', timestamp: new Date().toISOString() }) };
            }
            return { result: 'Agent summary module not loaded.' };
        }

        if (toolName === 'set_auto_memory') {
            if (window.autoMemory) {
                window.autoMemory.enabled = input?.enabled !== false;
                return { result: `Auto-memory ${window.autoMemory.enabled ? '✅ enabled' : '❌ disabled'}.` };
            }
            return { result: 'Auto-memory module not loaded.' };
        }

        // ═══════════════════════════════════════════════════════════════
        // TTS — Text-to-Speech Output (Mouth)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'tts_speak') return window.floworkTTS?.speak?.(input) || _stub('tts');
        if (toolName === 'tts_stop') return window.floworkTTS?.stop?.(input) || _stub('tts');
        if (toolName === 'tts_list_voices') return window.floworkTTS?.listVoices?.(input) || _stub('tts');
        if (toolName === 'tts_set_provider') return window.floworkTTS?.setProvider?.(input) || _stub('tts');
        if (toolName === 'tts_status') return window.floworkTTS?.status?.(input) || _stub('tts');
        // v2: Streaming TTS
        if (toolName === 'tts_speak_streaming') return window.floworkTTS?.speakStreaming?.(input) || _stub('tts');
        if (toolName === 'tts_speak_chunked') return window.floworkTTS?.speakChunked?.(input) || _stub('tts');
        if (toolName === 'tts_stop_streaming') return window.floworkTTS?.stopStreaming?.(input) || _stub('tts');
        if (toolName === 'tts_hook_streaming') return window.floworkTTS?.hookStreamingTTS?.(input) || _stub('tts');

        // ═══════════════════════════════════════════════════════════════
        // EARS — Audio Transcription, File Watch, Webhook (Ears)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'transcribe_audio') return window.floworkEars?.transcribeAudio?.(input) || _stub('ears');
        if (toolName === 'watch_folder') return window.floworkEars?.watchFolder?.(input) || _stub('ears');
        if (toolName === 'unwatch_folder') return window.floworkEars?.unwatchFolder?.(input) || _stub('ears');
        if (toolName === 'start_webhook') return window.floworkEars?.startWebhook?.(input) || _stub('ears');
        if (toolName === 'stop_webhook') return window.floworkEars?.stopWebhook?.(input) || _stub('ears');
        if (toolName === 'ear_status') return window.floworkEars?.earStatus?.(input) || _stub('ears');
        // v2: Real-time mic
        if (toolName === 'start_realtime_mic') return window.floworkEars?.startRealtimeMic?.(input) || _stub('ears');
        if (toolName === 'stop_realtime_mic') return window.floworkEars?.stopRealtimeMic?.(input) || _stub('ears');
        // v2: Wake word detection
        if (toolName === 'start_wake_word') return window.floworkEars?.startWakeWord?.(input) || _stub('ears');
        if (toolName === 'stop_wake_word') return window.floworkEars?.stopWakeWord?.(input) || _stub('ears');
        // v2: Continuous listening
        if (toolName === 'start_continuous_listen') return window.floworkEars?.startContinuousListening?.(input) || _stub('ears');
        if (toolName === 'stop_continuous_listen') return window.floworkEars?.stopContinuousListening?.(input) || _stub('ears');

        // ═══════════════════════════════════════════════════════════════
        // CRAWLER — Smart Web Crawling (Legs)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'crawl_url') return window.floworkCrawler?.crawlUrl?.(input) || _stub('crawler');
        if (toolName === 'crawl_site') return window.floworkCrawler?.crawlSite?.(input) || _stub('crawler');
        if (toolName === 'extract_page') return window.floworkCrawler?.extractPage?.(input) || _stub('crawler');
        if (toolName === 'crawl_status') return window.floworkCrawler?.crawlStatus?.(input) || _stub('crawler');

        // ═══════════════════════════════════════════════════════════════
        // IMAGE GENERATION — Creative Visual Output (Creativity)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'generate_image') return window.floworkImageGen?.generateImage?.(input) || _stub('imagegen');
        if (toolName === 'edit_image') return window.floworkImageGen?.editImage?.(input) || _stub('imagegen');
        if (toolName === 'imagegen_status') return window.floworkImageGen?.imagegenStatus?.(input) || _stub('imagegen');

        // ═══════════════════════════════════════════════════════════════
        // AUDIO GENERATION — Sound & Music (Creativity)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'generate_sound') return window.floworkAudioGen?.generateSound?.(input) || _stub('audiogen');
        if (toolName === 'generate_music') return window.floworkAudioGen?.generateMusic?.(input) || _stub('audiogen');
        if (toolName === 'audiogen_status') return window.floworkAudioGen?.audiogenStatus?.(input) || _stub('audiogen');
        // v2: Voice cloning, mixing, SFX library
        if (toolName === 'generate_voice_clone') return window.floworkAudioGen?.generateVoiceClone?.(input) || _stub('audiogen');
        if (toolName === 'mix_audio') return window.floworkAudioGen?.mixAudio?.(input) || _stub('audiogen');
        if (toolName === 'audio_library') return window.floworkAudioGen?.audioLibrary?.(input) || _stub('audiogen');

        // ═══════════════════════════════════════════════════════════════
        // VIDEO GENERATION — AI Video, Screen Recording, Animation
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'generate_video') return window.floworkVideoGen?.generateVideo?.(input) || _stub('videogen');
        if (toolName === 'video_status') return window.floworkVideoGen?.videoStatus?.(input) || _stub('videogen');
        if (toolName === 'record_screen') return window.floworkVideoGen?.recordScreen?.(input) || _stub('videogen');
        if (toolName === 'stop_recording') return window.floworkVideoGen?.stopRecording?.(input) || _stub('videogen');
        if (toolName === 'create_animation') return window.floworkVideoGen?.createAnimation?.(input) || _stub('videogen');

        // ═══════════════════════════════════════════════════════════════
        // DAEMON — Background Tasks, Cron, Event Bus (Reflexes)
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'daemon_schedule') return window.floworkDaemon?.schedule?.(input) || _stub('daemon');
        if (toolName === 'daemon_list') return window.floworkDaemon?.list?.(input) || _stub('daemon');
        if (toolName === 'daemon_cancel') return window.floworkDaemon?.cancel?.(input) || _stub('daemon');
        if (toolName === 'daemon_pause') return window.floworkDaemon?.pause?.(input) || _stub('daemon');
        if (toolName === 'daemon_resume') return window.floworkDaemon?.resume?.(input) || _stub('daemon');

        // ═══════════════════════════════════════════════════════════════
        // VISION AUTO-LOOP — new auto-capture tools
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'vision_auto_start') return window.floworkVision?.autoStart?.(input) || _stub('vision');
        if (toolName === 'vision_auto_stop') return window.floworkVision?.autoStop?.(input) || _stub('vision');
        if (toolName === 'vision_click_at') return window.floworkVision?.clickAt?.(input) || _stub('vision');

        // ═══════════════════════════════════════════════════════════════
        // GATEWAY — Multi-Channel Messaging (Discord, Telegram, WhatsApp, Slack)
        // Smart module: window.FLOWORKOS_Gateway
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'gateway_send') {
            if (!window.FLOWORKOS_Gateway) return _stub('gateway');
            const channel = input.channel || 'web';
            const to = input.to || input.recipient || '';
            const text = input.text || input.message || '';
            if (!text) return { error: 'Missing text/message to send.' };
            return await window.FLOWORKOS_Gateway.sendOutbound(channel, to, text, input);
        }
        if (toolName === 'gateway_reply') {
            if (!window.FLOWORKOS_Gateway) return _stub('gateway');
            const sessionKey = input.session || input.session_key || '';
            const text = input.text || input.message || '';
            if (!sessionKey || !text) return { error: 'Missing session and/or text.' };
            return await window.FLOWORKOS_Gateway.replyToSession(sessionKey, text, input);
        }
        if (toolName === 'gateway_list_channels') return window.FLOWORKOS_Gateway?.listChannels?.() ? { result: JSON.stringify(window.FLOWORKOS_Gateway.listChannels(), null, 2) } : _stub('gateway');
        if (toolName === 'gateway_status') return window.FLOWORKOS_Gateway?.getGatewayStatus?.() ? { result: JSON.stringify(window.FLOWORKOS_Gateway.getGatewayStatus(), null, 2) } : _stub('gateway');
        if (toolName === 'gateway_register_channel') return window.FLOWORKOS_Gateway?.registerChannel?.(input) || _stub('gateway');
        if (toolName === 'gateway_connect_whatsapp') {
            if (!window.FLOWORKOS_Gateway) return _stub('gateway');
            const adapter = window.FLOWORKOS_Gateway.createWhatsAppAdapter(input);
            return window.FLOWORKOS_Gateway.registerChannel(adapter);
        }
        if (toolName === 'gateway_connect_telegram') {
            if (!window.FLOWORKOS_Gateway) return _stub('gateway');
            const adapter = window.FLOWORKOS_Gateway.createTelegramAdapter(input);
            return window.FLOWORKOS_Gateway.registerChannel(adapter);
        }

        // ═══════════════════════════════════════════════════════════════
        // SUBAGENTS PRO — Advanced Sub-Agent System
        // Smart module: window.FLOWORKOS_SubAgents
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'subagent_spawn') return window.FLOWORKOS_SubAgents?.spawnSubagent?.(input) || _stub('subagentsPro');
        if (toolName === 'subagent_kill') return window.FLOWORKOS_SubAgents?.killSubagent?.(input?.runId || input?.id) || _stub('subagentsPro');
        if (toolName === 'subagent_kill_all') return window.FLOWORKOS_SubAgents?.killAllSubagents?.(input?.controllerSessionId) || _stub('subagentsPro');
        if (toolName === 'subagent_steer') return window.FLOWORKOS_SubAgents?.steerSubagent?.(input?.runId || input?.id, input?.message) || _stub('subagentsPro');
        if (toolName === 'subagent_list') {
            const result = window.FLOWORKOS_SubAgents?.listSubagents?.(input?.controllerSessionId, input?.recentMinutes);
            return result ? { result: result.text || JSON.stringify(result) } : _stub('subagentsPro');
        }
        if (toolName === 'subagent_status') {
            const result = window.FLOWORKOS_SubAgents?.getRunStatus?.(input?.runId || input?.id);
            return result ? { result: JSON.stringify(result, null, 2) } : _stub('subagentsPro');
        }

        // ═══════════════════════════════════════════════════════════════
        // SESSIONS — Smart Session Persistence & Restore
        // Smart module: window.FLOWORKOS_Sessions
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'session_create') return window.FLOWORKOS_Sessions?.createSession?.(input) ? { result: `✅ Session created: ${window.FLOWORKOS_Sessions.getCurrentSession()?.id}` } : _stub('sessions');
        if (toolName === 'session_save_smart') {
            if (!window.FLOWORKOS_Sessions) return _stub('sessions');
            window.FLOWORKOS_Sessions.syncFromChatHistory();
            return await window.FLOWORKOS_Sessions.saveSession();
        }
        if (toolName === 'session_load_smart') {
            if (!window.FLOWORKOS_Sessions) return _stub('sessions');
            const sessionId = input?.id || input?.session_id;
            if (!sessionId) return { error: 'Missing session id.' };
            const session = await window.FLOWORKOS_Sessions.loadSession(sessionId);
            if (session?.error) return session;
            window.FLOWORKOS_Sessions.syncToChatHistory();
            return { result: `✅ Session loaded: ${session.id} (${session.messageCount} messages)` };
        }
        if (toolName === 'session_list_smart') {
            if (!window.FLOWORKOS_Sessions) return _stub('sessions');
            const sessions = await window.FLOWORKOS_Sessions.listSessions();
            return { result: sessions.length === 0 ? 'No saved sessions.' : JSON.stringify(sessions, null, 2) };
        }
        if (toolName === 'session_delete') {
            if (!window.FLOWORKOS_Sessions) return _stub('sessions');
            return await window.FLOWORKOS_Sessions.deleteSession(input?.id || input?.session_id);
        }
        if (toolName === 'session_export') {
            if (!window.FLOWORKOS_Sessions) return _stub('sessions');
            const json = window.FLOWORKOS_Sessions.exportSession();
            return json ? { result: `✅ Session exported (${json.length} chars)`, data: json } : { error: 'No active session to export.' };
        }
        if (toolName === 'session_import') {
            if (!window.FLOWORKOS_Sessions) return _stub('sessions');
            return window.FLOWORKOS_Sessions.importSession(input?.json || input?.data || '');
        }
        if (toolName === 'session_repair') {
            if (!window.FLOWORKOS_Sessions) return _stub('sessions');
            const session = window.FLOWORKOS_Sessions.getCurrentSession();
            if (!session) return { error: 'No active session.' };
            window.FLOWORKOS_Sessions.repairTranscript(session);
            return { result: `✅ Session repaired: ${session.messageCount} valid messages.` };
        }

        // ═══════════════════════════════════════════════════════════════
        // SKILLS — Skills Marketplace & Management
        // Smart module: window.FLOWORKOS_Skills
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'skill_install') return window.FLOWORKOS_Skills?.installSkill?.(input) || _stub('skills');
        if (toolName === 'skill_uninstall') return window.FLOWORKOS_Skills?.uninstallSkill?.(input?.id || input?.skill_id) || _stub('skills');
        if (toolName === 'skill_activate') return window.FLOWORKOS_Skills?.activateSkill?.(input?.id || input?.skill_id) || _stub('skills');
        if (toolName === 'skill_deactivate') return window.FLOWORKOS_Skills?.deactivateSkill?.(input?.id || input?.skill_id) || _stub('skills');
        if (toolName === 'skill_list') {
            const skills = window.FLOWORKOS_Skills?.listSkills?.();
            if (!skills) return _stub('skills');
            let report = `📦 SKILLS (${skills.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const s of skills) {
                report += `${s.active ? '✅' : '⬜'} ${s.name} v${s.version} (${s.id})\n   ${s.description}\n`;
            }
            return { result: report };
        }
        if (toolName === 'skill_search') {
            const results = window.FLOWORKOS_Skills?.searchMarketplace?.(input?.query || '');
            if (!results) return _stub('skills');
            let report = `🔍 MARKETPLACE (${results.length} results)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const r of results) {
                report += `${r.installed ? '📦' : '📥'} ${r.name} v${r.version} — ${r.description}\n   Tags: ${r.tags.join(', ')}\n`;
            }
            return { result: report };
        }
        if (toolName === 'skill_install_marketplace') return window.FLOWORKOS_Skills?.installFromMarketplace?.(input?.id || input?.skill_id) || _stub('skills');

        // ═══════════════════════════════════════════════════════════════
        // CONTEXT GUARD — Context Window Monitoring
        // Smart module: window.FLOWORKOS_ContextGuard
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'context_check') {
            if (!window.FLOWORKOS_ContextGuard) return _stub('contextGuard');
            const check = window.FLOWORKOS_ContextGuard.check(window.chatHistory, input?.model);
            let report = `📊 CONTEXT HEALTH\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            report += `Status: ${check.status === 'ok' ? '🟢' : check.status === 'warning' ? '🟡' : '🔴'} ${check.status.toUpperCase()}\n`;
            report += `Usage: ${check.usagePercent} (${check.totalTokens} / ${check.availableForInput} tokens)\n`;
            report += `Messages: ${check.messageCount}\n`;
            report += `Breakdown: system=${check.breakdown.system}, user=${check.breakdown.user}, assistant=${check.breakdown.assistant}, tool=${check.breakdown.tool}\n`;
            if (check.recommendations.length > 0) {
                report += `\nRecommendations:\n${check.recommendations.join('\n')}\n`;
            }
            if (check.shouldCompact) report += `\n⚠️ Auto-compaction recommended!`;
            return { result: report };
        }
        if (toolName === 'context_status') {
            if (!window.FLOWORKOS_ContextGuard) return _stub('contextGuard');
            return { result: window.FLOWORKOS_ContextGuard.getStatusLine(input?.model) };
        }
        if (toolName === 'context_trend') {
            if (!window.FLOWORKOS_ContextGuard) return _stub('contextGuard');
            return { result: JSON.stringify(window.FLOWORKOS_ContextGuard.getTrend(), null, 2) };
        }

        // ═══════════════════════════════════════════════════════════════
        // MCP SMART — Advanced MCP Protocol Client (SSE, WS, Virtual)
        // Smart module: window.FLOWORKOS_MCP
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'mcp_connect_sse') {
            if (!window.FLOWORKOS_MCP) return _stub('mcpSmart');
            try { return await window.FLOWORKOS_MCP.connectSSE(input); } catch(e) { return { error: `MCP SSE connect failed: ${e.message}` }; }
        }
        if (toolName === 'mcp_connect_ws') {
            if (!window.FLOWORKOS_MCP) return _stub('mcpSmart');
            try { return await window.FLOWORKOS_MCP.connectWS(input); } catch(e) { return { error: `MCP WS connect failed: ${e.message}` }; }
        }
        if (toolName === 'mcp_register_virtual') return window.FLOWORKOS_MCP?.registerVirtualServer?.(input) || _stub('mcpSmart');
        if (toolName === 'mcp_smart_call') {
            if (!window.FLOWORKOS_MCP) return _stub('mcpSmart');
            const toolNameMcp = input?.tool || input?.tool_name || '';
            if (!toolNameMcp) return { error: 'Missing tool name for MCP call.' };
            return await window.FLOWORKOS_MCP.callTool(toolNameMcp, input?.args || input?.arguments || {});
        }
        if (toolName === 'mcp_smart_list_servers') {
            const servers = window.FLOWORKOS_MCP?.listServers?.();
            return servers ? { result: JSON.stringify(servers, null, 2) } : _stub('mcpSmart');
        }
        if (toolName === 'mcp_smart_list_tools') {
            const tools = window.FLOWORKOS_MCP?.listAllTools?.();
            return tools ? { result: JSON.stringify(tools, null, 2) } : _stub('mcpSmart');
        }
        if (toolName === 'mcp_smart_disconnect') return window.FLOWORKOS_MCP?.disconnect?.(input?.id || input?.server_id) || _stub('mcpSmart');
        if (toolName === 'mcp_read_resource') {
            if (!window.FLOWORKOS_MCP) return _stub('mcpSmart');
            return await window.FLOWORKOS_MCP.readResource(input?.uri || '');
        }

        // ═══════════════════════════════════════════════════════════════
        // REDACTION — Payload Redaction Engine (Protect Secrets)
        // Smart module: window.FLOWORKOS_Redaction
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'redact_text') {
            if (!window.FLOWORKOS_Redaction) return _stub('redaction');
            const text = input?.text || input?.content || '';
            if (!text) return { error: 'Missing text to redact.' };
            const result = window.FLOWORKOS_Redaction.redact(text, { verbose: input?.verbose });
            return { result: `🔒 Redacted ${result.redactions.length} items:\n${result.text}` };
        }
        if (toolName === 'check_sensitive') {
            if (!window.FLOWORKOS_Redaction) return _stub('redaction');
            const text = input?.text || input?.content || '';
            const hasSensitive = window.FLOWORKOS_Redaction.containsSensitiveData(text);
            return { result: hasSensitive ? '⚠️ Text contains sensitive data (API keys, tokens, passwords, etc.)' : '✅ No sensitive data detected.' };
        }
        if (toolName === 'redact_object') {
            if (!window.FLOWORKOS_Redaction) return _stub('redaction');
            const obj = input?.object || input?.data || input;
            const result = window.FLOWORKOS_Redaction.redactObject(obj);
            return { result: JSON.stringify(result, null, 2) };
        }

        // ═══════════════════════════════════════════════════════════════
        // SMART STATUS — Unified status for all smart modules
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'smart_status') {
            if (!window.FLOWORKOS_Smart) return _stub('smart');
            const status = window.FLOWORKOS_Smart.getSmartStatus();
            return { result: JSON.stringify(status, null, 2) };
        }

        // ═══════════════════════════════════════════════════════════════
        // MISC
        // ═══════════════════════════════════════════════════════════════
        if (toolName === 'x402_pay') return _stub('x402');
        if (toolName === 'x402_balance') return _stub('x402');

        // ═══ FALLBACK ═══
        return { result: `[brain_native] Unknown tool: ${toolName}. No handler registered.` };
    };

    function _stub(module) {
        return { result: `[brain_native:${module}] Module not yet loaded. Enable it via feature_enable or wait for next phase deployment.` };
    }

    // ─── Hook: Plan Mode blocking into tool bridge ──────────────────────
    if (window.brainToolBridge) {
        const _originalBridge = window.brainToolBridge;
        window.brainToolBridge = async function(actionType, input) {
            // Check plan mode blocking
            if (window.floworkPlanMode?.isToolBlocked?.(actionType)) {
                return window.floworkPlanMode.getBlockedMessage(actionType);
            }

            // Check permission mode blocking
            if (window.floworkPermissions) {
                const perm = window.floworkPermissions.checkPermission(actionType, input);
                if (!perm.allowed) {
                    return { result: `🚫 [PERMISSIONS] Tool "${actionType}" blocked: ${perm.reason}` };
                }
            }

            // Track analytics
            const startTime = Date.now();
            try {
                const result = await _originalBridge(actionType, input);
                const duration = Date.now() - startTime;

                // Record analytics
                if (window.toolAnalytics) {
                    const success = !result?.error;
                    window.toolAnalytics.record(actionType, success, duration);
                    if (!success && result?.error) {
                        window.toolAnalytics.recordError(actionType, result.error);
                    }
                }

                // Record NAS profiling
                if (window.floworkNAS?.recordToolProfile) {
                    window.floworkNAS.recordToolProfile(actionType, duration, !result?.error);
                }

                return result;
            } catch(err) {
                const duration = Date.now() - startTime;
                if (window.toolAnalytics) {
                    window.toolAnalytics.record(actionType, false, duration);
                    window.toolAnalytics.recordError(actionType, err.message);
                }
                throw err;
            }
        };
    }

    console.log('[Brain] ✅ Native Dispatcher loaded — all brain_native tools routed');

})();
