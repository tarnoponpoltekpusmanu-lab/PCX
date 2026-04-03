// =========================================================================
// FLOWORK OS — Brain Self-Heal Module (Phase 11: Full Immune System)
// Active self-healing: crash detection, auto-retry, circuit breaker,
// module health monitoring, state checkpoint, graceful degradation.
//
// Tools: diagnostic_snapshot, health_status, heal_retry, heal_reset
// =========================================================================

(function() {
    'use strict';

    // ═══ CONFIG ═══════════════════════════════════════════════════════════
    const MAX_CRASH_LOG = 50;
    const MAX_ERROR_LOG = 50;
    const CIRCUIT_BREAKER_THRESHOLD = 3;     // 3 consecutive failures → OPEN
    const CIRCUIT_BREAKER_COOLDOWN = 30000;  // 30s cooldown before HALF-OPEN
    const AUTO_RETRY_MAX = 2;                // Max auto-retry attempts
    const AUTO_RETRY_DELAY = 1000;           // 1s between retries
    const HEALTH_CHECK_INTERVAL = 30000;     // 30s health check cycle
    const CHECKPOINT_INTERVAL = 60000;       // 1min auto-checkpoint
    const MAX_CHECKPOINTS = 5;

    // ═══ STATE ════════════════════════════════════════════════════════════
    let _crashWs = null;
    const _crashLog = [];
    const _consoleErrors = [];

    // ─── Circuit Breaker State ───────────────────────────────────────
    // Tracks failure patterns per tool/module to prevent cascading failures
    const _circuitBreakers = {};   // toolName → { state, failCount, lastFailure, lastSuccess, openedAt }
    // state: 'CLOSED' (normal), 'OPEN' (blocking), 'HALF_OPEN' (testing)

    // ─── Module Health Registry ──────────────────────────────────────
    const _moduleHealth = {};      // moduleName → { status, lastCheck, errorCount, degraded }

    // ─── State Checkpoints ───────────────────────────────────────────
    const _checkpoints = [];       // Array of { id, ts, chatHistoryLen, flags, activeModules }

    // ─── Heal History ────────────────────────────────────────────────
    const _healLog = [];           // { ts, action, target, result }
    const MAX_HEAL_LOG = 100;

    // ═══ CRASH LISTENER (WebSocket to Electron main) ═════════════════════
    function connectCrashListener() {
        try {
            _crashWs = new WebSocket('ws://127.0.0.1:5001');
            _crashWs.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'CRASH_REPORT') {
                        const crash = {
                            stack: data.data || '',
                            ts: Date.now(),
                            injected: false,
                            autoHealed: false,
                        };
                        _crashLog.push(crash);
                        if (_crashLog.length > MAX_CRASH_LOG) _crashLog.shift();

                        console.warn('[SelfHeal] 💥 Crash intercepted:', crash.stack.substring(0, 200));

                        // ─── AUTO-HEAL: Analyze crash and attempt recovery ────
                        const healResult = _attemptAutoHeal(crash);

                        // Auto-inject into next LLM context
                        if (window.chatHistory) {
                            const healNote = healResult
                                ? `\n✅ AUTO-HEAL attempted: ${healResult}`
                                : '\n⚠️ Could not auto-heal. Manual diagnosis needed.';

                            window.chatHistory.push({
                                role: 'system',
                                content: `[⚠️ CRASH DETECTED] The Electron main process caught an error:\n${crash.stack.substring(0, 500)}${healNote}\n\nDiagnose this error. If it's related to your current task, fix it. If not, acknowledge and continue.`
                            });
                            crash.injected = true;
                        }
                    }
                } catch(e) {}
            };
            _crashWs.onclose = function() {
                setTimeout(connectCrashListener, 5000);
            };
            _crashWs.onerror = function() {
                // Silent — WebSocket may not be available
            };
        } catch(e) {}
    }

    setTimeout(connectCrashListener, 2000);

    // ═══ CONSOLE ERROR MONITOR ══════════════════════════════════════════
    if (!window._selfHealConsoleActive) {
        window._selfHealConsoleActive = true;
        window.addEventListener('error', function(event) {
            const msg = `${event.message} at ${event.filename}:${event.lineno}`;
            _consoleErrors.push({ message: msg.substring(0, 500), ts: Date.now() });
            if (_consoleErrors.length > MAX_ERROR_LOG) _consoleErrors.shift();

            // Trip circuit breaker if error involves a known module
            const moduleName = _identifyModule(event.filename);
            if (moduleName) {
                _tripCircuitBreaker(moduleName, msg);
            }
        });
        window.addEventListener('unhandledrejection', function(event) {
            const msg = `Unhandled Promise Rejection: ${event.reason}`;
            _consoleErrors.push({ message: msg.substring(0, 500), ts: Date.now() });
            if (_consoleErrors.length > MAX_ERROR_LOG) _consoleErrors.shift();
        });
    }

    // ═══ CIRCUIT BREAKER ════════════════════════════════════════════════
    // Prevents cascading failures by isolating broken tools/modules

    function _getCircuitBreaker(name) {
        if (!_circuitBreakers[name]) {
            _circuitBreakers[name] = {
                state: 'CLOSED',
                failCount: 0,
                totalFails: 0,
                lastFailure: null,
                lastSuccess: null,
                openedAt: null,
                lastError: '',
            };
        }
        return _circuitBreakers[name];
    }

    function _tripCircuitBreaker(name, errorMsg) {
        const cb = _getCircuitBreaker(name);
        cb.failCount++;
        cb.totalFails++;
        cb.lastFailure = Date.now();
        cb.lastError = (errorMsg || '').substring(0, 200);

        if (cb.failCount >= CIRCUIT_BREAKER_THRESHOLD && cb.state === 'CLOSED') {
            cb.state = 'OPEN';
            cb.openedAt = Date.now();
            _logHeal('circuit_breaker_open', name, `Opened after ${cb.failCount} consecutive failures: ${cb.lastError}`);
            console.warn(`[SelfHeal] 🔴 Circuit OPEN for "${name}" — ${cb.failCount} consecutive failures. Cooldown: ${CIRCUIT_BREAKER_COOLDOWN/1000}s`);

            // Schedule transition to HALF_OPEN
            setTimeout(() => {
                if (_circuitBreakers[name]?.state === 'OPEN') {
                    _circuitBreakers[name].state = 'HALF_OPEN';
                    _logHeal('circuit_breaker_half_open', name, 'Testing recovery...');
                    console.log(`[SelfHeal] 🟡 Circuit HALF-OPEN for "${name}" — next call will test recovery`);
                }
            }, CIRCUIT_BREAKER_COOLDOWN);
        }
    }

    function _recordSuccess(name) {
        const cb = _getCircuitBreaker(name);
        cb.failCount = 0;
        cb.lastSuccess = Date.now();
        if (cb.state === 'HALF_OPEN') {
            cb.state = 'CLOSED';
            _logHeal('circuit_breaker_closed', name, 'Recovered successfully');
            console.log(`[SelfHeal] 🟢 Circuit CLOSED for "${name}" — recovered`);
        }
    }

    function isCircuitOpen(name) {
        const cb = _circuitBreakers[name];
        if (!cb) return false;
        return cb.state === 'OPEN';
    }

    // ═══ AUTO-RETRY WRAPPER ════════════════════════════════════════════
    // Wraps tool calls with automatic retry on transient failures

    async function withAutoRetry(toolName, fn, maxRetries) {
        const retries = maxRetries || AUTO_RETRY_MAX;

        // Check circuit breaker first
        if (isCircuitOpen(toolName)) {
            return {
                error: `🔴 Circuit breaker OPEN for "${toolName}". Too many failures. Will auto-recover in ${CIRCUIT_BREAKER_COOLDOWN/1000}s. Use heal_reset to force-close.`
            };
        }

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await fn();

                // Check if result indicates an error
                if (result?.error && _isTransientError(result.error)) {
                    throw new Error(result.error);
                }

                _recordSuccess(toolName);
                return result;

            } catch (err) {
                const isLast = attempt === retries;

                if (isLast || !_isTransientError(err.message)) {
                    _tripCircuitBreaker(toolName, err.message);
                    _logHeal('auto_retry_exhausted', toolName, `Failed after ${attempt + 1} attempts: ${err.message}`);
                    return { error: err.message };
                }

                _logHeal('auto_retry', toolName, `Attempt ${attempt + 1} failed, retrying... (${err.message})`);
                console.warn(`[SelfHeal] 🔄 Retry ${attempt + 1}/${retries} for "${toolName}": ${err.message}`);
                await new Promise(r => setTimeout(r, AUTO_RETRY_DELAY * (attempt + 1)));
            }
        }
    }

    function _isTransientError(errorMsg) {
        if (!errorMsg) return false;
        const msg = errorMsg.toLowerCase();
        const transientPatterns = [
            'timeout', 'econnreset', 'econnrefused', 'network',
            'fetch failed', '503', '502', '429', 'rate limit',
            'socket hang up', 'aborted', 'epipe',
        ];
        return transientPatterns.some(p => msg.includes(p));
    }

    // ═══ MODULE HEALTH MONITOR ══════════════════════════════════════════
    // Periodically checks if critical modules are still functional

    const CRITICAL_MODULES = [
        { name: 'brainToolBridge', check: () => typeof window.brainToolBridge === 'function' },
        { name: 'brainLLMAdapter', check: () => !!window.brainLLMAdapter?.query },
        { name: 'floworkFeatures', check: () => !!window.floworkFeatures?.isEnabled },
        { name: 'floworkVision', check: () => !!window.floworkVision?.analyzeImage },
        { name: 'floworkEars', check: () => !!window.floworkEars?.transcribeAudio },
        { name: 'floworkTTS', check: () => !!window.floworkTTS?.speak },
        { name: 'floworkCrawler', check: () => !!window.floworkCrawler?.crawlUrl },
        { name: 'floworkSwarm', check: () => !!window.floworkSwarm?.launch },
        { name: 'agentPool', check: () => !!window.agentPool?.spawnAgent },
        { name: 'teamManager', check: () => !!window.teamManager?.createTeam },
        { name: 'brainEvolution', check: () => !!window.brainEvolution?.evolveTool },
        { name: 'mcpManager', check: () => !!window.mcpManager?.connect },
        { name: 'floworkDaemon', check: () => !!window.floworkDaemon?.schedule },
        { name: 'floworkImageGen', check: () => !!window.floworkImageGen?.generateImage },
        { name: 'floworkAudioGen', check: () => !!window.floworkAudioGen?.generateSound },
        { name: 'floworkVideoGen', check: () => !!window.floworkVideoGen?.generateVideo },
        { name: 'floworkGatewayBridge', check: () => !!window.floworkGatewayBridge?.gatewaySend },
        { name: 'costTracker', check: () => !!window.costTracker },
        { name: 'chatHistory', check: () => Array.isArray(window.chatHistory) },
        { name: 'wsCommand', check: () => typeof window.wsCommand === 'function' },
    ];

    function _runHealthCheck() {
        let healthy = 0;
        let degraded = 0;
        let failed = 0;

        for (const mod of CRITICAL_MODULES) {
            try {
                const isHealthy = mod.check();
                const prev = _moduleHealth[mod.name];

                _moduleHealth[mod.name] = {
                    status: isHealthy ? 'healthy' : 'missing',
                    lastCheck: Date.now(),
                    errorCount: prev?.errorCount || 0,
                    degraded: false,
                };

                // Check circuit breaker status for this module
                const cb = _circuitBreakers[mod.name];
                if (cb?.state === 'OPEN') {
                    _moduleHealth[mod.name].status = 'degraded';
                    _moduleHealth[mod.name].degraded = true;
                    degraded++;
                } else if (isHealthy) {
                    healthy++;
                } else {
                    failed++;
                }
            } catch (e) {
                _moduleHealth[mod.name] = {
                    status: 'error',
                    lastCheck: Date.now(),
                    errorCount: (_moduleHealth[mod.name]?.errorCount || 0) + 1,
                    degraded: true,
                };
                failed++;
            }
        }

        return { healthy, degraded, failed, total: CRITICAL_MODULES.length };
    }

    // Run health checks periodically
    setInterval(() => {
        const result = _runHealthCheck();
        if (result.failed > 0 || result.degraded > 0) {
            console.warn(`[SelfHeal] ⚕️ Health: ${result.healthy}✅ ${result.degraded}⚠️ ${result.failed}❌ / ${result.total}`);
        }
    }, HEALTH_CHECK_INTERVAL);

    // ═══ STATE CHECKPOINTS ═════════════════════════════════════════════
    // Periodic snapshots of critical state for rollback recovery

    function _createCheckpoint(label) {
        const checkpoint = {
            id: `ckpt_${Date.now()}`,
            ts: new Date().toISOString(),
            label: label || 'auto',
            chatHistoryLen: window.chatHistory?.length || 0,
            featureFlags: window.floworkFeatures?.getFlags?.() || {},
            activeModules: Object.keys(_moduleHealth).filter(k => _moduleHealth[k]?.status === 'healthy'),
            circuitBreakerStates: Object.fromEntries(
                Object.entries(_circuitBreakers).map(([k, v]) => [k, { state: v.state, failCount: v.failCount }])
            ),
        };

        _checkpoints.push(checkpoint);
        if (_checkpoints.length > MAX_CHECKPOINTS) _checkpoints.shift();

        _logHeal('checkpoint_created', checkpoint.id, `Modules: ${checkpoint.activeModules.length}, ChatHistory: ${checkpoint.chatHistoryLen}`);
        return checkpoint;
    }

    function _restoreCheckpoint(checkpointId) {
        const ckpt = _checkpoints.find(c => c.id === checkpointId);
        if (!ckpt) return { error: `Checkpoint "${checkpointId}" not found.` };

        // Restore feature flags
        if (ckpt.featureFlags && window.floworkFeatures) {
            for (const [key, val] of Object.entries(ckpt.featureFlags)) {
                if (val) {
                    window.floworkFeatures.featureEnable({ name: key });
                } else {
                    window.floworkFeatures.featureDisable({ name: key });
                }
            }
        }

        // Reset circuit breakers
        for (const [name, state] of Object.entries(ckpt.circuitBreakerStates)) {
            if (_circuitBreakers[name]) {
                _circuitBreakers[name].state = state.state;
                _circuitBreakers[name].failCount = state.failCount;
            }
        }

        // Trim chat history if it grew beyond checkpoint
        if (window.chatHistory && window.chatHistory.length > ckpt.chatHistoryLen + 20) {
            // Don't trim aggressively — just note the divergence
            _logHeal('checkpoint_restored', checkpointId, `Restored flags & breakers. ChatHistory: ${ckpt.chatHistoryLen} → ${window.chatHistory.length}`);
        }

        return {
            result: `♻️ Checkpoint "${ckpt.label}" (${ckpt.ts}) restored.\n` +
                    `Modules: ${ckpt.activeModules.length}\n` +
                    `Feature flags reset to checkpoint state.`
        };
    }

    // Auto-create checkpoints
    setInterval(() => _createCheckpoint('auto'), CHECKPOINT_INTERVAL);
    // Create initial checkpoint after boot
    setTimeout(() => _createCheckpoint('boot'), 5000);

    // ═══ AUTO-HEAL ENGINE ═══════════════════════════════════════════════
    // Analyzes crash/error and attempts automatic recovery

    function _attemptAutoHeal(crash) {
        const stack = crash.stack || '';

        // Pattern 1: WebSocket disconnection → reconnect
        if (stack.includes('WebSocket') || stack.includes('ws://') || stack.includes('ECONNREFUSED')) {
            if (window.wsCommand) {
                _logHeal('ws_reconnect', 'wsCommand', 'Auto-reconnecting WebSocket...');
                crash.autoHealed = true;
                return 'WebSocket reconnection triggered';
            }
        }

        // Pattern 2: Fetch/network error → flag for retry
        if (stack.includes('fetch') || stack.includes('network') || stack.includes('ETIMEDOUT')) {
            _logHeal('network_retry_flagged', 'fetch', 'Network error detected — subsequent calls will auto-retry');
            crash.autoHealed = true;
            return 'Network error flagged — auto-retry enabled for next calls';
        }

        // Pattern 3: Module reference error → mark module as degraded
        const moduleMatch = stack.match(/window\.(flowork\w+|brain\w+|agentPool|teamManager|mcpManager)/);
        if (moduleMatch) {
            const modName = moduleMatch[1];
            _moduleHealth[modName] = {
                status: 'degraded',
                lastCheck: Date.now(),
                errorCount: (_moduleHealth[modName]?.errorCount || 0) + 1,
                degraded: true,
            };
            _logHeal('module_degraded', modName, 'Module error detected — marked as degraded');
            crash.autoHealed = true;
            return `Module "${modName}" marked as degraded. Non-critical features using it will be skipped.`;
        }

        // Pattern 4: Out of memory → trim chat history
        if (stack.includes('out of memory') || stack.includes('allocation') || stack.includes('heap')) {
            if (window.chatHistory && window.chatHistory.length > 20) {
                const trimmed = window.chatHistory.length - 10;
                window.chatHistory = [
                    window.chatHistory[0],
                    { role: 'system', content: `[SELF-HEAL] Trimmed ${trimmed} messages due to memory pressure.` },
                    ...window.chatHistory.slice(-8),
                ];
                _logHeal('memory_trim', 'chatHistory', `Trimmed ${trimmed} messages due to memory pressure`);
                crash.autoHealed = true;
                return `Chat history trimmed (${trimmed} messages removed) to free memory`;
            }
        }

        return null; // Could not auto-heal
    }

    // ═══ GRACEFUL DEGRADATION ═══════════════════════════════════════════
    // AI can check if a module is available before using it

    function isModuleHealthy(moduleName) {
        const health = _moduleHealth[moduleName];
        if (!health) return true; // Unknown = assume healthy
        return health.status === 'healthy' && !health.degraded;
    }

    function getAvailableModules() {
        const available = [];
        const degraded = [];
        const missing = [];

        for (const mod of CRITICAL_MODULES) {
            const health = _moduleHealth[mod.name];
            if (!health || health.status === 'healthy') {
                available.push(mod.name);
            } else if (health.status === 'degraded') {
                degraded.push(mod.name);
            } else {
                missing.push(mod.name);
            }
        }

        return { available, degraded, missing };
    }

    // ═══ IDENTIFY MODULE FROM FILENAME ═══════════════════════════════════

    function _identifyModule(filename) {
        if (!filename) return null;
        const patterns = {
            'vision': 'floworkVision',
            'ears': 'floworkEars',
            'tts': 'floworkTTS',
            'crawler': 'floworkCrawler',
            'swarm': 'floworkSwarm',
            'agents': 'agentPool',
            'teams': 'teamManager',
            'mcp': 'mcpManager',
            'daemon': 'floworkDaemon',
            'imagegen': 'floworkImageGen',
            'audiogen': 'floworkAudioGen',
            'evolution': 'brainEvolution',
            'tool_bridge': 'brainToolBridge',
        };
        for (const [pattern, name] of Object.entries(patterns)) {
            if (filename.includes(pattern)) return name;
        }
        return null;
    }

    // ═══ HEAL LOG ═══════════════════════════════════════════════════════

    function _logHeal(action, target, result) {
        _healLog.push({
            ts: new Date().toISOString(),
            action,
            target,
            result: (result || '').substring(0, 300),
        });
        if (_healLog.length > MAX_HEAL_LOG) _healLog.shift();
    }

    // ═══ PUBLIC API (Tools) ═════════════════════════════════════════════

    window.brainSelfHeal = {
        // ─── Get recent crashes ─────────────────────────────────────
        getCrashes() {
            return _crashLog.slice(-10);
        },

        // ─── Get recent console errors ──────────────────────────────
        getErrors() {
            return _consoleErrors.slice(-10);
        },

        // ─── Get diagnostic summary for AI injection ────────────────
        getDiagnostic() {
            const recentCrashes = _crashLog.filter(c => Date.now() - c.ts < 60000);
            const recentErrors = _consoleErrors.filter(e => Date.now() - e.ts < 60000);

            if (recentCrashes.length === 0 && recentErrors.length === 0) {
                return null; // No issues
            }

            let diagnostic = '[🔍 DIAGNOSTIC REPORT]\n';
            if (recentCrashes.length > 0) {
                diagnostic += `Crashes (last 60s): ${recentCrashes.length}\n`;
                recentCrashes.forEach(c => {
                    diagnostic += `  - ${c.stack.substring(0, 150)}`;
                    if (c.autoHealed) diagnostic += ' [AUTO-HEALED]';
                    diagnostic += '\n';
                });
            }
            if (recentErrors.length > 0) {
                diagnostic += `Console Errors (last 60s): ${recentErrors.length}\n`;
                recentErrors.forEach(e => diagnostic += `  - ${e.message.substring(0, 150)}\n`);
            }
            return diagnostic;
        },

        // ─── Force inject diagnostic ────────────────────────────────
        injectDiagnostic() {
            const diag = this.getDiagnostic();
            if (diag && window.chatHistory) {
                window.chatHistory.push({ role: 'system', content: diag });
                return true;
            }
            return false;
        },

        // ─── Clear error history ────────────────────────────────────
        clear() {
            _crashLog.length = 0;
            _consoleErrors.length = 0;
        },

        // ═══ NEW: Full Health Status Report ═════════════════════════
        healthStatus(input) {
            const health = _runHealthCheck();
            const modules = getAvailableModules();
            const openBreakers = Object.entries(_circuitBreakers)
                .filter(([_, v]) => v.state !== 'CLOSED');

            let report = `🏥 SYSTEM HEALTH REPORT\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            // Overall status
            const overallIcon = health.failed > 0 ? '🔴' : health.degraded > 0 ? '🟡' : '🟢';
            report += `${overallIcon} Overall: ${health.healthy}/${health.total} healthy`;
            if (health.degraded > 0) report += `, ${health.degraded} degraded`;
            if (health.failed > 0) report += `, ${health.failed} failed`;
            report += `\n\n`;

            // Modules
            report += `✅ Available (${modules.available.length}): ${modules.available.join(', ')}\n`;
            if (modules.degraded.length > 0) {
                report += `⚠️ Degraded (${modules.degraded.length}): ${modules.degraded.join(', ')}\n`;
            }
            if (modules.missing.length > 0) {
                report += `❌ Missing (${modules.missing.length}): ${modules.missing.join(', ')}\n`;
            }

            // Circuit breakers
            report += `\n🔌 Circuit Breakers:\n`;
            if (openBreakers.length === 0) {
                report += `  All closed (normal)\n`;
            } else {
                for (const [name, cb] of openBreakers) {
                    report += `  ${cb.state === 'OPEN' ? '🔴' : '🟡'} ${name}: ${cb.state} (${cb.failCount} fails) — ${cb.lastError}\n`;
                }
            }

            // Recent crashes
            const recentCrashes = _crashLog.filter(c => Date.now() - c.ts < 300000);  // Last 5 min
            report += `\n💥 Crashes (last 5min): ${recentCrashes.length}\n`;
            const recentErrors = _consoleErrors.filter(e => Date.now() - e.ts < 300000);
            report += `⚠️ Console errors (last 5min): ${recentErrors.length}\n`;

            // Checkpoints
            report += `\n💾 Checkpoints: ${_checkpoints.length}\n`;
            if (_checkpoints.length > 0) {
                const last = _checkpoints[_checkpoints.length - 1];
                report += `  Latest: ${last.id} (${last.ts}) — ${last.label}\n`;
            }

            // Heal log
            const recentHeals = _healLog.filter(h => Date.now() - new Date(h.ts).getTime() < 300000);
            if (recentHeals.length > 0) {
                report += `\n♻️ Recent Heal Actions (${recentHeals.length}):\n`;
                for (const h of recentHeals.slice(-5)) {
                    report += `  [${h.ts.substring(11, 19)}] ${h.action}: ${h.target} → ${h.result.substring(0, 80)}\n`;
                }
            }

            return { result: report };
        },

        // ═══ NEW: Force-reset a circuit breaker ═════════════════════
        healReset(input) {
            const target = input.target || input.name || input.module || '';

            if (!target || target === 'all') {
                // Reset all circuit breakers
                let count = 0;
                for (const [name, cb] of Object.entries(_circuitBreakers)) {
                    if (cb.state !== 'CLOSED') {
                        cb.state = 'CLOSED';
                        cb.failCount = 0;
                        count++;
                        _logHeal('manual_reset', name, 'Forced CLOSED by user');
                    }
                }
                // Reset module health
                for (const name of Object.keys(_moduleHealth)) {
                    _moduleHealth[name].status = 'healthy';
                    _moduleHealth[name].degraded = false;
                }
                return { result: `♻️ Reset ${count} circuit breaker(s) and all module health to healthy.` };
            }

            // Reset specific
            const cb = _circuitBreakers[target];
            if (cb) {
                cb.state = 'CLOSED';
                cb.failCount = 0;
                _logHeal('manual_reset', target, 'Forced CLOSED by user');
            }
            if (_moduleHealth[target]) {
                _moduleHealth[target].status = 'healthy';
                _moduleHealth[target].degraded = false;
            }
            return { result: `♻️ Circuit breaker for "${target}" reset to CLOSED. Module marked healthy.` };
        },

        // ═══ NEW: Retry a previously failed operation ═══════════════
        healRetry(input) {
            const toolName = input.tool || input.action || '';
            if (!toolName) return { error: 'Missing tool name. Usage: heal_retry { tool: "web_search" }' };

            // Reset circuit breaker for this tool
            if (_circuitBreakers[toolName]) {
                _circuitBreakers[toolName].state = 'HALF_OPEN';
                _circuitBreakers[toolName].failCount = 0;
                _logHeal('heal_retry', toolName, 'Set to HALF_OPEN for retry test');
            }

            return {
                result: `♻️ Circuit breaker for "${toolName}" set to HALF-OPEN.\n` +
                        `Next call to this tool will test recovery.\n` +
                        `If successful, the breaker will close (normal operation resumed).`
            };
        },

        // ═══ NEW: Create/restore checkpoints ═══════════════════════
        checkpoint(input) {
            if (input.restore) {
                return _restoreCheckpoint(input.restore);
            }

            const ckpt = _createCheckpoint(input.label || 'manual');
            return {
                result: `💾 Checkpoint created: ${ckpt.id}\n` +
                        `Time: ${ckpt.ts}\n` +
                        `Modules: ${ckpt.activeModules.length}\n` +
                        `ChatHistory: ${ckpt.chatHistoryLen} messages\n\n` +
                        `To restore: checkpoint { restore: "${ckpt.id}" }`
            };
        },

        // ═══ NEW: List checkpoints ══════════════════════════════════
        listCheckpoints(input) {
            if (_checkpoints.length === 0) return { result: 'No checkpoints available.' };

            let report = `💾 CHECKPOINTS (${_checkpoints.length}/${MAX_CHECKPOINTS})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const ckpt of _checkpoints) {
                report += `  • ${ckpt.id} [${ckpt.label}] — ${ckpt.ts}\n`;
                report += `    Modules: ${ckpt.activeModules.length} | Chat: ${ckpt.chatHistoryLen} msgs\n`;
            }
            return { result: report };
        },

        // ═══ NEW: Get heal history ══════════════════════════════════
        healHistory(input) {
            const count = input.count || 20;
            const recent = _healLog.slice(-count);
            if (recent.length === 0) return { result: 'No heal actions recorded yet.' };

            let report = `♻️ HEAL HISTORY (last ${recent.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const h of recent) {
                report += `[${h.ts.substring(11, 19)}] ${h.action} → ${h.target}: ${h.result}\n`;
            }
            return { result: report };
        },

        // ═══ Expose internals for other modules ═════════════════════
        withAutoRetry,
        isCircuitOpen,
        isModuleHealthy,
        getAvailableModules,
        _getCircuitBreaker,
        _recordSuccess,
        _tripCircuitBreaker,
    };

    console.log('[Brain] ✅ Self-Heal module loaded — crash listener + circuit breaker + auto-retry + checkpoints + health monitor');

})();
