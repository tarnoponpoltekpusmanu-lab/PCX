// =========================================================================
// FLOWORK OS — Brain Adapter v2
// The main interface between brain engine and Flowork UI
// Now uses brainToolBridge for REAL tool execution (Phase 7)
// Includes vision support (Phase 8) and self-healing (Phase 9)
// =========================================================================

(function() {
    'use strict';

    // ═══ BRAIN STATE ═══
    const brainState = {
        isRunning: false,
        currentAbortController: null,
        tickCount: 0,
        totalToolCalls: 0,
        totalTokens: { input: 0, output: 0 },
        sessionId: `session_${Date.now()}`,
        autoMode: true,
        // Phase 9: Smart Circuit Breaker (replaces old errorTracker)
    };

    // ═══ SMART CIRCUIT BREAKER — Prevent infinite retry loops ═══════════
    const _circuitBreaker = {
        data: {},
        MAX_IDENTICAL: 2,     // Same error signature → stop trying
        MAX_TOTAL: 3,         // Total fails on same tool → quarantine
        QUARANTINE_MS: 60000, // 60-second quarantine

        _hash(params) {
            try {
                const { action, ...rest } = params || {};
                return JSON.stringify(rest).substring(0, 500);
            } catch { return ''; }
        },

        _signature(error) {
            return (error || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').substring(0, 100);
        },

        isQuarantined(toolName) {
            const entry = this.data[toolName];
            if (!entry || !entry.quarantinedUntil) return false;
            if (Date.now() > entry.quarantinedUntil) {
                entry.quarantinedUntil = 0;
                entry.errors = [];
                return false;
            }
            return true;
        },

        isDuplicateAttempt(toolName, params) {
            const entry = this.data[toolName];
            if (!entry) return false;
            const hash = this._hash(params);
            return entry.errors.some(e => e.params === hash);
        },

        recordError(toolName, errorMsg, params) {
            if (!this.data[toolName]) {
                this.data[toolName] = { errors: [], quarantinedUntil: 0 };
            }
            const entry = this.data[toolName];
            const sig = this._signature(errorMsg);
            const hash = this._hash(params);
            entry.errors.push({ signature: sig, params: hash, time: Date.now() });

            const identicalCount = entry.errors.filter(e => e.signature === sig).length;
            const totalCount = entry.errors.length;

            if (totalCount >= this.MAX_TOTAL) {
                entry.quarantinedUntil = Date.now() + this.QUARANTINE_MS;
                return {
                    action: 'quarantine',
                    message: `🚫 Tool "${toolName}" quarantined for 60s after ${totalCount} failures. ` +
                             `Last error: ${errorMsg?.substring(0, 200)}. ` +
                             `Use a COMPLETELY different approach or different tools.`
                };
            }

            if (identicalCount >= this.MAX_IDENTICAL) {
                return {
                    action: 'stop_identical',
                    message: `🛑 STOP: "${toolName}" failed ${identicalCount}x with same error: "${errorMsg?.substring(0, 150)}". ` +
                             `Do NOT retry the same approach. Change strategy entirely.`
                };
            }

            return { action: 'retry_allowed', message: null };
        },

        recordSuccess(toolName) {
            if (this.data[toolName]) {
                this.data[toolName].errors = [];
                this.data[toolName].quarantinedUntil = 0;
            }
        }
    };

    // ═══ CONTEXT BUDGET GOVERNOR — Enhanced with FLOWORKOS™ Compaction ════
    const _contextGovernor = {
        MAX_TOKENS: 900000,   // ~900k token budget
        WARN_PCT: 0.80,       // 80% → auto-compact
        HARD_PCT: 1.00,       // 100% → emergency compact
        KILL_PCT: 1.20,       // 120% → force stop

        estimateTokens() {
            const history = window.chatHistory || [];
            // Use FLOWORKOS token estimator if available (more accurate)
            if (window.FLOWORKOS_UsageTracking) {
                let totalTokens = 0;
                for (const m of history) {
                    totalTokens += window.FLOWORKOS_UsageTracking.estimateTokens(m.content);
                }
                return totalTokens;
            }
            // Fallback to char/4
            let chars = 0;
            for (const m of history) {
                chars += typeof m.content === 'string' ? m.content.length : 0;
            }
            return Math.ceil(chars / 4);
        },

        getUsagePct() {
            return this.estimateTokens() / this.MAX_TOKENS;
        },

        async check() {
            const pct = this.getUsagePct();
            const pctStr = `${Math.round(pct * 100)}%`;

            if (window.updateContextMeter) {
                window.updateContextMeter(pct);
            }

            if (pct >= this.KILL_PCT) {
                console.warn(`[ContextGovernor] 🔴 KILL: ${pctStr} — force stopping`);
                return 'kill';
            }
            if (pct >= this.HARD_PCT) {
                console.warn(`[ContextGovernor] 🟠 EMERGENCY COMPACT: ${pctStr}`);
                await this._emergencyCompact();
                return 'compacted';
            }
            if (pct >= this.WARN_PCT) {
                console.warn(`[ContextGovernor] 🟡 AUTO-COMPACT: ${pctStr}`);
                await this._autoCompact();
                return 'compacted';
            }
            return 'ok';
        },

        async _autoCompact() {
            // ═══ FLOWORKOS™ Smart Compaction ═══
            if (window.FLOWORKOS_Compaction) {
                const result = window.FLOWORKOS_Compaction.compactMessages(
                    window.chatHistory,
                    { maxContextChars: this.MAX_TOKENS * 4 } // tokens→chars
                );
                if (result.compacted) {
                    window.chatHistory = result.messages;
                    console.log(`[ContextGovernor] ✅ FLOWORKOS compact: ${result.stats.reductionPercent} reduced`);
                    if (window.appendToolMessage) {
                        window.appendToolMessage('context', 'success',
                            `🧠 Smart compact: ${result.stats.reductionPercent} reduced (${result.stats.originalMessages}→${result.stats.finalMessages} msgs)`);
                    }
                    return;
                }
            }
            // Fallback
            if (window.smartCompact) {
                await window.smartCompact();
            } else {
                await this._emergencyCompact();
            }
        },

        async _emergencyCompact() {
            const history = window.chatHistory || [];
            if (history.length < 6) return;

            const systemMsgs = history.filter(m => m.role === 'system').slice(0, 1);
            const recentMsgs = history.slice(-5);
            const removed = history.length - systemMsgs.length - recentMsgs.length;

            window.chatHistory = [
                ...systemMsgs,
                { role: 'system', content: `[EMERGENCY-COMPACT] ${removed} messages removed — context was overflowing. Focus on current task.` },
                ...recentMsgs
            ];

            console.log(`[ContextGovernor] 🚨 Emergency compact: removed ${removed} messages`);
            if (window.appendToolMessage) {
                window.appendToolMessage('context', 'warning',
                    `🚨 Emergency compact: ${removed} msgs removed. Context was overflowing.`);
            }
        }
    };

    // ═══ MAIN API: window.floworkBrain ═══
    window.floworkBrain = {

        async submitMessage(prompt, options = {}) {
            if (brainState.isRunning) {
                console.warn('[Brain] Already processing, ignoring submit');
                return;
            }

            const provider = options.provider || window.getEl?.('select-provider')?.value || 'gemini';
            const apiKey = options.apiKey || window.getEl?.('input-api-key')?.value || '';
            const outputType = options.outputType || window.getEl?.('select-output-type')?.value || 'app';
            const appId = options.appId || window.currentAppId || '';
            const lang = options.lang || window.currentLang || 'en';

            if (!apiKey) {
                if (window.appendChatMessage) window.appendChatMessage('system', '⚠️ API key required');
                return;
            }

            window.chatHistory = window.chatHistory || [];
            if (prompt) {
                window.chatHistory.push({ role: 'user', content: prompt });
                if (window.appendChatMessage) window.appendChatMessage('user', prompt);
            }

            brainState.isRunning = true;
            window.isGenerating = true;
            brainState.currentAbortController = new AbortController();
            if (window.showLoader) window.showLoader();

            try {
                await _runAgentLoop(provider, apiKey, outputType, appId, lang);
            } catch (err) {
                console.error('[Brain] Agent loop error:', err);
                if (window.appendToolMessage) window.appendToolMessage('Brain Error', 'error', err.message);
            } finally {
                brainState.isRunning = false;
                window.isGenerating = false;
                brainState.currentAbortController = null;
                if (window.removeLoader) window.removeLoader();
            }
        },

        abort() {
            if (brainState.currentAbortController) {
                brainState.currentAbortController.abort();
                brainState.isRunning = false;
                window.isGenerating = false;
                window.forceAbortAgent = true;
                if (window.removeLoader) window.removeLoader();
                console.log('[Brain] Aborted by user');
            }
        },

        async executeTool(toolName, toolInput) {
            // Use the bridge (which routes to proper APIs) instead of raw brainExecuteTool
            if (window.brainToolBridge) {
                return await window.brainToolBridge(toolName, toolInput);
            }
            return await window.brainExecuteTool(toolName, toolInput);
        },

        getStatus() {
            return {
                isRunning: brainState.isRunning,
                tickCount: brainState.tickCount,
                totalToolCalls: brainState.totalToolCalls,
                totalTokens: { ...brainState.totalTokens },
                sessionId: brainState.sessionId,
                registeredTools: Object.keys(window.brainToolRegistry || {}).length,
            };
        },

        getTools() { return Object.keys(window.brainToolRegistry || {}); },

        async compact() {
            if (window.smartCompact) return await window.smartCompact();
            return { error: 'Compaction not available' };
        },

        getUsage() {
            return {
                tokens: brainState.totalTokens,
                ticks: brainState.tickCount,
                toolCalls: brainState.totalToolCalls,
                costTracker: window.costTracker?.getReport?.() || null,
            };
        },
    };

    // ═════════════════════════════════════════════════════════════════════
    // AGENT LOOP — Autonomous execution with REAL tool dispatch
    // ═════════════════════════════════════════════════════════════════════
    const MAX_TICKS = 100;

    async function _runAgentLoop(provider, apiKey, outputType, appId, lang) {
        for (let tick = 0; tick < MAX_TICKS; tick++) {
            brainState.tickCount++;

            if (brainState.currentAbortController?.signal.aborted || window.forceAbortAgent) {
                window.forceAbortAgent = false;
                console.log('[Brain] Aborted at tick', tick);
                break;
            }

            // ═══ CONTEXT GOVERNOR — Auto-compact check BEFORE calling LLM ═══
            const contextStatus = await _contextGovernor.check();
            if (contextStatus === 'kill') {
                window.chatHistory.push({
                    role: 'system',
                    content: '[CONTEXT-OVERFLOW] Context exceeded 120% budget. Agent loop forcibly stopped. Start a new session or compact manually.'
                });
                if (window.appendChatMessage) {
                    window.appendChatMessage('system', '🚨 Context overflow — agent stopped. Use /compact or start fresh.');
                }
                break;
            }

            // 1. Build system prompt
            const systemPrompt = await _buildSystemPrompt(outputType, lang);

            // 2. Create streaming bubble
            let streamBubble = null;
            if (window.createStreamingBubble) {
                streamBubble = window.createStreamingBubble();
            }

            const onChunk = (chunk, fullText) => {
                if (streamBubble) streamBubble.update(fullText);
            };

            // 3. Call LLM via multi-provider adapter
            //    ═══ FLOWORKOS™ Model Failover wraps the call ═══
            let rawResponse = '';
            const _llmStartTime = Date.now();
            try {
                const _doLLMCall = async (p, ak) => {
                    if (window.brainLLMAdapter) {
                        const response = await window.brainLLMAdapter.query(
                            p, ak, systemPrompt,
                            window.chatHistory, null, onChunk,
                            brainState.currentAbortController?.signal
                        );
                        return response?.rawText || '';
                    }
                    // Fallback to direct calls
                    if (p.includes('gemini')) return await window.callGemini(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if (p.includes('grok') && window.callGrok) return await window.callGrok(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if (p.startsWith('groq-') && window.callGroq) return await window.callGroq(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if (p.startsWith('deepseek-') && window.callDeepSeek) return await window.callDeepSeek(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if ((p.startsWith('mistral-') || p.startsWith('magistral-')) && window.callMistral) return await window.callMistral(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if (p.startsWith('together-') && window.callTogether) return await window.callTogether(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if (p.startsWith('fireworks-') && window.callFireworks) return await window.callFireworks(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if (p.startsWith('cohere-') && window.callCohere) return await window.callCohere(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if (p.startsWith('ollama-') && window.callOllama) return await window.callOllama(ak, p, systemPrompt, window.chatHistory, onChunk);
                    if (p.includes('claude')) return await window.callClaude(ak, p, systemPrompt, window.chatHistory, onChunk);
                    return await window.callOpenAI(ak, p, systemPrompt, window.chatHistory, onChunk);
                };

                // ═══ FLOWORKOS™ Model Failover — auto-switch on failure ═══
                if (window.FLOWORKOS_ModelFailover) {
                    const failoverResult = await window.FLOWORKOS_ModelFailover.runWithModelFailover({
                        provider: provider,
                        model: provider,
                        run: async (p, m) => _doLLMCall(p, apiKey),
                        onSwitch: (newProvider, newModel, attempt) => {
                            console.log(`[Brain] 🔄 Failover: switching to ${newProvider} (attempt ${attempt + 1})`);
                            if (window.appendToolMessage) {
                                window.appendToolMessage('failover', 'warning',
                                    `🔄 Provider "${provider}" failed → switching to "${newProvider}"`);
                            }
                        },
                        onError: (info) => {
                            console.warn(`[Brain] ❌ Provider ${info.provider} failed: ${info.reason}`);
                        },
                    });
                    rawResponse = failoverResult.result;
                    if (failoverResult.usedFallback) {
                        provider = failoverResult.provider; // Update provider for cost tracking
                    }
                } else {
                    rawResponse = await _doLLMCall(provider, apiKey);
                }
            } catch (err) {
                if (streamBubble) streamBubble.finish();
                if (err.name === 'AbortError') break;
                // Show failover error details to user
                if (err.name === 'FloworkModelFailoverError' && err.attempts) {
                    const summary = err.attempts.map(a => `${a.provider}: ${a.reason}`).join(', ');
                    window.chatHistory.push({ role: 'system', content: `[MODEL-FAILOVER] All providers failed: ${summary}` });
                    if (window.appendChatMessage) window.appendChatMessage('system', `🚨 All AI providers failed: ${summary}`);
                }
                throw err;
            }
            if (streamBubble) streamBubble.finish();

            // ═══ FLOWORKOS™ Usage Tracking ═══
            if (window.FLOWORKOS_UsageTracking) {
                const latencyMs = Date.now() - _llmStartTime;
                const inputTokens = window.FLOWORKOS_UsageTracking.estimateTokens(systemPrompt) +
                    (window.chatHistory || []).reduce((s, m) => s + window.FLOWORKOS_UsageTracking.estimateTokens(m.content), 0);
                const outputTokens = window.FLOWORKOS_UsageTracking.estimateTokens(rawResponse);
                window.FLOWORKOS_UsageTracking.recordUsage({
                    provider, model: provider, inputTokens, outputTokens, latencyMs,
                    sessionId: brainState.sessionId,
                });
            }

            if (!rawResponse) break;

            // Cost tracking
            if (window.costTracker) {
                const inputChars = systemPrompt.length + window.chatHistory.reduce((a, m) => a + (m.content || '').length, 0);
                window.costTracker.recordCall(provider, inputChars, rawResponse.length, 0);
            }

            // 4. Parse response — extract JSON actions
            let actionData;
            try {
                let cleanText = rawResponse;

                // Handle thinking blocks
                if (window.thinkingMode?.enabled && cleanText.includes('<thinking>')) {
                    const thinkResult = window.thinkingMode.parseResponse(cleanText);
                    cleanText = thinkResult.response;
                    window.thinkingMode.renderThinkingInUI(thinkResult.thinking);
                }

                // Extract JSON
                if (cleanText.includes('```json')) {
                    cleanText = cleanText.split('```json').pop().split('```')[0].trim();
                } else if (cleanText.includes('```')) {
                    cleanText = cleanText.split('```')[1]?.split('```')[0]?.trim() || cleanText;
                }

                actionData = JSON.parse(cleanText);
            } catch(e) {
                // Not JSON — treat as plain text chat
                window.chatHistory.push({ role: 'agent', content: rawResponse });
                if (window.appendChatMessage) window.appendChatMessage('agent', rawResponse);

                // Check control keywords in plain text
                const upper = rawResponse.toUpperCase();
                if (upper.includes('[TASK_COMPLETE]')) break;
                if (upper.includes('[WAITING_APPROVAL]')) break;
                if (upper.includes('[AUTO_CONTINUE]')) continue;
                break; // No JSON, no control → stop
            }

            // 5. Process actions using the TOOL BRIDGE (real execution!)
            window.chatHistory.push({ role: 'agent', content: JSON.stringify(actionData) });

            const actions = Array.isArray(actionData) ? actionData : [actionData];
            let shouldContinue = false;
            let shouldStop = false;

            // BEHAVIOR FIX: Detect if batch contains observation tools
            // If so, FORCE AUTO_CONTINUE — AI MUST analyze results before concluding
            const observationTools = ['capture_browser', 'read_dom', 'get_console_logs'];
            const hasObservation = actions.some(a => observationTools.includes(a.action));

            for (const act of actions) {
                const toolName = act.action;
                if (!toolName) continue;

                // ═══ CIRCUIT BREAKER — Pre-execution checks ═══
                if (_circuitBreaker.isQuarantined(toolName)) {
                    const qMsg = `🚫 Tool "${toolName}" is quarantined (too many failures). Use alternative tools.`;
                    window.chatHistory.push({ role: 'system', content: qMsg });
                    if (window.appendToolMessage) window.appendToolMessage(toolName, 'error', qMsg);
                    shouldContinue = true;
                    continue;
                }

                if (_circuitBreaker.isDuplicateAttempt(toolName, act)) {
                    const dMsg = `[CIRCUIT-BREAKER] Blocked: You already tried "${toolName}" with these exact parameters and it failed. Use a different approach.`;
                    window.chatHistory.push({ role: 'system', content: dMsg });
                    if (window.appendToolMessage) window.appendToolMessage(toolName, 'error', '🔁 Duplicate attempt blocked');
                    shouldContinue = true;
                    continue;
                }

                brainState.totalToolCalls++;

                // ═══ FLOWORKOS™ Loop Detector — check BEFORE execution ═══
                if (window.FLOWORKOS_LoopDetector) {
                    const loopCheck = window.FLOWORKOS_LoopDetector.detectToolCallLoop(
                        toolName, act, brainState.sessionId
                    );
                    if (loopCheck.stuck) {
                        if (loopCheck.level === 'critical') {
                            window.chatHistory.push({ role: 'system', content: loopCheck.message });
                            if (window.appendToolMessage) window.appendToolMessage(toolName, 'error', loopCheck.message);
                            console.error(`[LoopDetector] ${loopCheck.message}`);
                            shouldStop = true;
                            break;
                        } else {
                            // Warning — inject into context so AI changes approach
                            window.chatHistory.push({ role: 'system', content: loopCheck.message });
                            console.warn(`[LoopDetector] ${loopCheck.message}`);
                        }
                    }
                    window.FLOWORKOS_LoopDetector.recordToolCall(toolName, act, brainState.sessionId);
                }

                // ═══ FLOWORKOS™ Tool Policy — check permission ═══
                if (window.FLOWORKOS_ToolPolicy) {
                    const policyCheck = window.FLOWORKOS_ToolPolicy.evaluatePolicy(toolName, act);
                    if (!policyCheck.allowed) {
                        const policyMsg = `[TOOL-POLICY] ${policyCheck.reason}`;
                        window.chatHistory.push({ role: 'system', content: policyMsg });
                        if (window.appendToolMessage) window.appendToolMessage(toolName, 'error', policyCheck.reason);
                        console.warn(`[ToolPolicy] Blocked: ${toolName} — ${policyCheck.reason}`);
                        shouldContinue = true;
                        continue;
                    }
                    if (policyCheck.warnings && policyCheck.warnings.length > 0) {
                        console.warn(`[ToolPolicy] Warnings for ${toolName}:`, policyCheck.warnings);
                    }
                }

                // Show tool in UI
                if (window.appendToolMessage && toolName !== 'chat') {
                    window.appendToolMessage(toolName, 'running', '⏳ Executing...');
                }

                // Execute via bridge (REAL handlers!)
                const result = await window.brainToolBridge(toolName, act);

                // ═══ FLOWORKOS™ Loop Detector — record outcome ═══
                if (window.FLOWORKOS_LoopDetector) {
                    window.FLOWORKOS_LoopDetector.recordToolCallOutcome(
                        toolName, act, result, result?.error, brainState.sessionId
                    );
                }

                // Check for control keywords from chat/ask_user
                if (result?._controlKeywords) {
                    const kw = result._controlKeywords;
                    // BEHAVIOR FIX: If observation tools in batch, NEVER stop
                    // Force AI to analyze screenshot/DOM/logs in next tick
                    if (hasObservation) {
                        shouldContinue = true;
                        if (kw.taskComplete || kw.waitingApproval) {
                            window.chatHistory.push({
                                role: 'system',
                                content: '[OVERRIDE] You used observation tools (capture_browser/read_dom/get_console_logs) — you MUST analyze the results FIRST before declaring completion. Describe what you see in the screenshot/DOM/logs, then decide if task is truly complete.'
                            });
                        }
                    } else {
                        if (kw.taskComplete) { shouldStop = true; break; }
                        if (kw.waitingApproval) { shouldStop = true; break; }
                        if (kw.autoContinue) shouldContinue = true;
                    }
                }

                // Update tool UI with result
                if (window.appendToolMessage && toolName !== 'chat' && toolName !== 'ask_user') {
                    const status = result?.error ? 'error' : 'success';
                    const summary = (result?.error || result?.result || JSON.stringify(result)).substring(0, 150);
                    window.appendToolMessage(toolName, status, summary);
                }

                // Inject result into history for next LLM turn
                const resultStr = result?.error
                    ? `Tool ${toolName} FAILED: ${result.error}`
                    : `Tool ${toolName} result: ${typeof result?.result === 'string' ? result.result : JSON.stringify(result)}`;
                window.chatHistory.push({ role: 'system', content: resultStr });

                // ═══ CIRCUIT BREAKER — Post-execution tracking ═══
                if (result?.error) {
                    const verdict = _circuitBreaker.recordError(toolName, result.error, act);
                    if (verdict.action !== 'retry_allowed') {
                        window.chatHistory.push({ role: 'system', content: `[CIRCUIT-BREAKER] ${verdict.message}` });
                    } else {
                        // Standard self-heal hint on first failures
                        window.chatHistory.push({
                            role: 'system',
                            content: `[SELF-HEAL] Tool "${toolName}" failed: ${result.error.substring(0, 200)}. ` +
                                     `Debug: 1) capture_browser 2) get_console_logs 3) read_dom. Try a different approach.`
                        });
                    }

                    // Auto-evolve on quarantine
                    if (verdict.action === 'quarantine' && window.brainEvolution?.selfImprove) {
                        window.brainEvolution.selfImprove({
                            context: `Tool "${toolName}" quarantined after repeated failures. Error: ${result.error}. AI should avoid this pattern.`
                        });
                        console.log(`[Brain] 🧬 Auto-evolved rule from ${toolName} quarantine`);
                    }
                } else {
                    // Clear circuit breaker on success
                    _circuitBreaker.recordSuccess(toolName);
                }

                // Phase 10: Auto-verify UI changes via vision
                const _uiWriteTools = ['write_files', 'patch_file', 'smart_patch'];
                const _uiExtensions = ['.html', '.css', '.jsx', '.tsx', '.vue', '.svelte'];
                if (_uiWriteTools.includes(toolName) && !result?.error) {
                    const filePath = act.path || act.file_path || '';
                    const isUIFile = _uiExtensions.some(ext => filePath.endsWith(ext));
                    if (isUIFile) {
                        window.chatHistory.push({
                            role: 'system',
                            content: '[AUTO-VERIFY] UI file modified. Use capture_browser + vision_analyze to visually verify the change looks correct before proceeding.'
                        });
                    }
                }

                // If tool was executed (not chat), mark continue
                if (toolName !== 'chat' && toolName !== 'ask_user') {
                    shouldContinue = true;
                }
            }

            // 6. Loop control
            if (shouldStop) break;
            if (shouldContinue) continue;
            break; // No tools, no continue → stop
        }

        // Safety limit
        if (brainState.tickCount >= MAX_TICKS) {
            window.chatHistory.push({
                role: 'system',
                content: '[SAFETY] Maximum tick limit reached. Stopping autonomous loop.'
            });
            if (window.appendChatMessage) {
                window.appendChatMessage('system', '⚠️ Safety: Max tick limit reached.');
            }
        }
    }

    // ─── System Prompt Builder ───────────────────────────────────────────
    async function _buildSystemPrompt(outputType, lang) {
        if (window.fetchSystemPrompt) {
            return await window.fetchSystemPrompt(lang, outputType);
        }
        if (window.cachedSystemPrompt) return window.cachedSystemPrompt;
        return window.SYSTEM_PROMPT || 'You are Flowork AI Engine.';
    }

    // ─── Phase 9: Error Tracker (REPLACED by _circuitBreaker above) ─────
    // Legacy _trackError removed — Smart Circuit Breaker handles all error
    // tracking with signature dedup, quarantine, and duplicate detection.

    // ═════════════════════════════════════════════════════════════════════
    // BACKWARD COMPATIBILITY
    // ═════════════════════════════════════════════════════════════════════
    const _originalAgentTick = window.agentTick;
    window.agentTick = async function(provider, apiKey, outputType, appId, lang, depth) {
        return await window.floworkBrain.submitMessage(null, {
            provider, apiKey, outputType, appId, lang
        });
    };

    const _originalAbort = window.abortGeneration;
    window.abortGeneration = function() {
        window.floworkBrain.abort();
        if (_originalAbort) _originalAbort();
    };

    console.log('[Brain] ✅ Brain Adapter v2 loaded — window.floworkBrain ready');
    console.log('[Brain] ✅ agentTick() → floworkBrain.submitMessage() bridged');
    console.log('[Brain] ✅ Tool execution via brainToolBridge (REAL handlers)');

})();
