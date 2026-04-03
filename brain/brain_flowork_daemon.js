// =========================================================================
// FLOWORK OS — Brain Daemon Module (Phase 11: Full Reflex System)
// Background tasks, cron expressions, persistent jobs, event bus,
// delivery system, hook triggers, and smart/automation bridge.
//
// Tools: daemon_schedule, daemon_list, daemon_cancel, daemon_pause,
//        daemon_resume, daemon_hooks, daemon_deliver
// =========================================================================

(function() {
    'use strict';

    const _tasks = {};       // taskId → task object
    let _taskCounter = 0;
    const _eventBus = {};    // eventName → [callback]
    const _eventLog = [];
    const MAX_EVENT_LOG = 200;
    const MAX_TASKS = 20;

    // ═══ PERSISTENCE KEYS ════════════════════════════════════════════════
    const STORAGE_KEY = 'flowork_daemon_jobs';
    const HOOKS_STORAGE_KEY = 'flowork_daemon_hooks';

    // ═══ HOOK REGISTRY ═══════════════════════════════════════════════════
    const _hooks = {};       // hookId → { id, event, action, filter, createdAt }
    let _hookCounter = 0;

    // ═══ CRON EXPRESSION PARSER ══════════════════════════════════════════
    // Supports standard 5-field cron: min hour dom month dow
    // Also supports simple intervals: 30s, 5m, 1h, 1d

    function _parseCronExpression(expr) {
        if (!expr) return null;

        // Simple interval format: 30s, 5m, 1h, 1d
        const simpleMatch = String(expr).match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
        if (simpleMatch) {
            const n = parseInt(simpleMatch[1]);
            const unit = simpleMatch[2].toLowerCase();
            const multipliers = {
                s: 1000, sec: 1000,
                m: 60000, min: 60000,
                h: 3600000, hr: 3600000, hour: 3600000,
                d: 86400000, day: 86400000,
            };
            return {
                type: 'interval',
                intervalMs: n * (multipliers[unit] || 1000),
                original: expr,
            };
        }

        // Standard cron expression: min hour dom month dow
        const parts = String(expr).trim().split(/\s+/);
        if (parts.length === 5) {
            try {
                return {
                    type: 'cron',
                    fields: {
                        minute: _parseCronField(parts[0], 0, 59),
                        hour: _parseCronField(parts[1], 0, 23),
                        dayOfMonth: _parseCronField(parts[2], 1, 31),
                        month: _parseCronField(parts[3], 1, 12),
                        dayOfWeek: _parseCronField(parts[4], 0, 6),
                    },
                    original: expr,
                };
            } catch(e) {
                return null;
            }
        }

        // Named presets
        const presets = {
            '@hourly': '0 * * * *',
            '@daily': '0 0 * * *',
            '@midnight': '0 0 * * *',
            '@weekly': '0 0 * * 0',
            '@monthly': '0 0 1 * *',
            '@yearly': '0 0 1 1 *',
        };
        if (presets[expr.toLowerCase()]) {
            return _parseCronExpression(presets[expr.toLowerCase()]);
        }

        return null;
    }

    function _parseCronField(field, min, max) {
        const values = new Set();

        for (const part of field.split(',')) {
            // Wildcard
            if (part === '*') {
                for (let i = min; i <= max; i++) values.add(i);
                continue;
            }

            // Step: */5 or 1-10/2
            const stepMatch = part.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
            if (stepMatch) {
                const start = stepMatch[2] ? parseInt(stepMatch[2]) : min;
                const end = stepMatch[3] ? parseInt(stepMatch[3]) : max;
                const step = parseInt(stepMatch[4]);
                for (let i = start; i <= end; i += step) values.add(i);
                continue;
            }

            // Range: 1-5
            const rangeMatch = part.match(/^(\d+)-(\d+)$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                for (let i = start; i <= end; i++) values.add(i);
                continue;
            }

            // Single value
            const num = parseInt(part);
            if (!isNaN(num)) values.add(num);
        }

        return [...values].sort((a, b) => a - b);
    }

    function _cronMatchesNow(cronParsed) {
        if (!cronParsed || cronParsed.type !== 'cron') return false;

        const now = new Date();
        const f = cronParsed.fields;

        return f.minute.includes(now.getMinutes()) &&
               f.hour.includes(now.getHours()) &&
               f.dayOfMonth.includes(now.getDate()) &&
               f.month.includes(now.getMonth() + 1) &&
               f.dayOfWeek.includes(now.getDay());
    }

    function _getNextCronRun(cronParsed) {
        if (!cronParsed || cronParsed.type !== 'cron') return null;

        const now = new Date();
        // Brute-force next 1440 minutes (24h) to find next match
        for (let i = 1; i <= 1440; i++) {
            const candidate = new Date(now.getTime() + i * 60000);
            candidate.setSeconds(0, 0);
            const f = cronParsed.fields;
            if (f.minute.includes(candidate.getMinutes()) &&
                f.hour.includes(candidate.getHours()) &&
                f.dayOfMonth.includes(candidate.getDate()) &&
                f.month.includes(candidate.getMonth() + 1) &&
                f.dayOfWeek.includes(candidate.getDay())) {
                return candidate.toISOString();
            }
        }
        return 'beyond 24h';
    }

    // ═══ SCHEDULE ════════════════════════════════════════════════════════
    async function schedule(input) {
        const name = input.name || input.task || '';
        if (!name) return { error: 'Missing task name/description.' };

        if (Object.keys(_tasks).length >= MAX_TASKS) {
            return { error: `Max ${MAX_TASKS} daemon tasks. Use daemon_cancel to remove old tasks.` };
        }

        // Parse schedule expression (supports both interval and cron)
        const scheduleExpr = input.interval || input.every || input.cron || '1h';
        const parsed = _parseCronExpression(scheduleExpr);
        if (!parsed) return { error: `Invalid schedule: "${scheduleExpr}". Use: 30s, 5m, 1h, 1d OR cron: "*/5 * * * *"` };

        const taskId = `daemon_${++_taskCounter}_${Date.now()}`;
        const mode = input.mode || 'agent';
        const code = input.code || null;

        const task = {
            id: taskId,
            name,
            schedule: scheduleExpr,
            scheduleType: parsed.type,
            intervalMs: parsed.type === 'interval' ? parsed.intervalMs : 60000, // Cron checks every minute
            cronParsed: parsed.type === 'cron' ? parsed : null,
            mode,
            code,
            status: 'active',
            lastRun: null,
            nextRun: parsed.type === 'interval'
                ? new Date(Date.now() + parsed.intervalMs).toISOString()
                : _getNextCronRun(parsed),
            runCount: 0,
            errors: [],
            results: [],
            timer: null,
            delivery: input.delivery || null, // { type: 'chat'|'file'|'webhook', target: '...' }
            createdAt: new Date().toISOString(),
            persistent: input.persistent !== false, // Default persistent
        };

        // Set timer based on type
        if (parsed.type === 'interval') {
            task.timer = setInterval(() => _executeTask(taskId), parsed.intervalMs);
        } else {
            // For cron: check every minute
            task.timer = setInterval(() => {
                if (_cronMatchesNow(task.cronParsed)) {
                    _executeTask(taskId);
                }
            }, 60000);
        }

        _tasks[taskId] = task;

        // Persist if enabled
        if (task.persistent) _persistJobs();

        // Bridge to smart cron if available
        if (window.FLOWORKOS_Cron?.schedule) {
            try {
                window.FLOWORKOS_Cron.schedule({
                    id: taskId,
                    name,
                    cron: scheduleExpr,
                    mode,
                });
                task._smartBridged = true;
            } catch(e) {}
        }

        // Run immediately if requested
        if (input.run_now) {
            await _executeTask(taskId);
        }

        console.log(`[Daemon] ⏰ Scheduled: ${name} (${scheduleExpr}) → ${taskId}`);

        return {
            result: `⏰ DAEMON TASK SCHEDULED\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `ID: ${taskId}\n` +
                    `Name: ${name}\n` +
                    `Schedule: ${scheduleExpr} (${parsed.type})\n` +
                    `Mode: ${mode}\n` +
                    `Persistent: ${task.persistent ? 'yes (survives restart)' : 'no'}\n` +
                    `Delivery: ${task.delivery ? JSON.stringify(task.delivery) : 'chat (default)'}\n` +
                    `Next run: ${task.nextRun}\n` +
                    (input.run_now ? `First run: NOW\n` : '') +
                    `\nUse daemon_cancel { id: "${taskId}" } to stop.`
        };
    }

    // ═══ TASK EXECUTION ══════════════════════════════════════════════════
    async function _executeTask(taskId) {
        const task = _tasks[taskId];
        if (!task || task.status !== 'active') return;

        task.lastRun = new Date().toISOString();
        task.runCount++;

        // Update next run time
        if (task.scheduleType === 'interval') {
            task.nextRun = new Date(Date.now() + task.intervalMs).toISOString();
        } else {
            task.nextRun = _getNextCronRun(task.cronParsed);
        }

        try {
            let result = '';

            if (task.mode === 'script' && task.code) {
                // Execute JS code directly
                const fn = new Function('window', 'console', task.code);
                const execResult = fn(window, console);
                result = String(execResult).substring(0, 500);
            } else {
                // Inject task into AI chat as system message
                if (window.chatHistory) {
                    window.chatHistory.push({
                        role: 'system',
                        content: `[🔄 DAEMON TASK: ${task.name}]\n` +
                                 `Scheduled task "${task.name}" triggered (run #${task.runCount}).\n` +
                                 `Schedule: ${task.schedule}\n` +
                                 `Execute this task autonomously. When done, continue with any pending work.`
                    });
                    result = 'Injected into AI context';
                }
            }

            task.results.push({ ts: task.lastRun, result });
            if (task.results.length > 20) task.results = task.results.slice(-20);

            // Deliver result if delivery configured
            if (task.delivery) {
                await _deliverResult(task, result);
            }

            // Emit event
            _emit('task:run', { taskId, name: task.name, runCount: task.runCount, result });

            // Persist updated state
            if (task.persistent) _persistJobs();

        } catch (err) {
            task.errors.push({ ts: task.lastRun, error: err.message });
            if (task.errors.length > 10) task.errors.shift();
            console.error(`[Daemon] ❌ Task ${taskId} error:`, err.message);

            // Report to self-heal if available
            if (window.brainSelfHeal?._tripCircuitBreaker) {
                window.brainSelfHeal._tripCircuitBreaker(`daemon:${taskId}`, err.message);
            }
        }
    }

    // ═══ DELIVERY SYSTEM ═════════════════════════════════════════════════
    async function _deliverResult(task, result) {
        const delivery = task.delivery;
        if (!delivery) return;

        try {
            switch (delivery.type) {
                case 'file': {
                    // Write result to a file
                    const fs = window.originalNodeRequire?.('fs');
                    const path = window.originalNodeRequire?.('path');
                    if (fs && delivery.target) {
                        const content = `[${task.lastRun}] Task: ${task.name}\n${result}\n---\n`;
                        fs.appendFileSync(delivery.target, content, 'utf-8');
                    }
                    break;
                }
                case 'webhook': {
                    // POST result to webhook
                    if (delivery.target) {
                        await fetch(delivery.target, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                taskId: task.id,
                                taskName: task.name,
                                runCount: task.runCount,
                                result,
                                ts: task.lastRun,
                            }),
                        });
                    }
                    break;
                }
                case 'gateway': {
                    // Send via gateway channel
                    if (window.FLOWORKOS_Gateway?.sendOutbound && delivery.target) {
                        window.FLOWORKOS_Gateway.sendOutbound({
                            channel: delivery.target,
                            content: `[Daemon] ${task.name}: ${result}`,
                        });
                    }
                    break;
                }
                // 'chat' is default — already injected above
            }
        } catch (e) {
            console.warn(`[Daemon] ⚠️ Delivery failed for ${task.id}:`, e.message);
        }
    }

    // ═══ LIST ════════════════════════════════════════════════════════════
    function list(input) {
        const taskList = Object.values(_tasks);
        if (taskList.length === 0) return { result: 'No daemon tasks. Use daemon_schedule to create one.' };

        let report = `⏰ DAEMON TASKS (${taskList.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const t of taskList) {
            const icon = t.status === 'active' ? '🟢' : t.status === 'paused' ? '⏸️' : '🔴';
            const bridged = t._smartBridged ? ' [SMART]' : '';
            report += `${icon} ${t.id}${bridged}\n`;
            report += `   Name: ${t.name}\n`;
            report += `   Schedule: ${t.schedule} (${t.scheduleType}) | Runs: ${t.runCount} | Errors: ${t.errors.length}\n`;
            report += `   Last: ${t.lastRun || 'never'} | Next: ${t.nextRun}\n`;
            if (t.delivery) report += `   Delivery: ${t.delivery.type} → ${t.delivery.target || 'default'}\n`;
        }
        return { result: report };
    }

    // ═══ CANCEL ══════════════════════════════════════════════════════════
    function cancel(input) {
        const id = input.id || input.task_id;
        if (!id) {
            // Cancel all
            for (const t of Object.values(_tasks)) {
                if (t.timer) clearInterval(t.timer);
            }
            const count = Object.keys(_tasks).length;
            Object.keys(_tasks).forEach(k => delete _tasks[k]);
            _persistJobs();
            return { result: `🗑️ All ${count} daemon tasks cancelled.` };
        }
        if (!_tasks[id]) return { error: `Task "${id}" not found.` };
        if (_tasks[id].timer) clearInterval(_tasks[id].timer);
        delete _tasks[id];
        _persistJobs();
        return { result: `🗑️ Task "${id}" cancelled.` };
    }

    // ═══ PAUSE / RESUME ══════════════════════════════════════════════════
    function pause(input) {
        const id = input.id || input.task_id;
        if (!id || !_tasks[id]) return { error: `Task "${id}" not found.` };
        _tasks[id].status = 'paused';
        _persistJobs();
        return { result: `⏸️ Task "${id}" paused.` };
    }

    function resume(input) {
        const id = input.id || input.task_id;
        if (!id || !_tasks[id]) return { error: `Task "${id}" not found.` };
        _tasks[id].status = 'active';
        _persistJobs();
        return { result: `▶️ Task "${id}" resumed.` };
    }

    // ═══ HOOKS ═══════════════════════════════════════════════════════════
    // Register event-driven triggers (file change, webhook, custom events)

    function registerHook(input) {
        const event = input.event || input.trigger || '';
        const action = input.action || input.task || '';
        if (!event || !action) return { error: 'Missing event and action. Usage: daemon_hook { event: "file:change", action: "do something" }' };

        _hookCounter++;
        const hookId = `hook_${_hookCounter}_${Date.now()}`;

        _hooks[hookId] = {
            id: hookId,
            event,
            action,
            filter: input.filter || null,
            mode: input.mode || 'agent',
            triggerCount: 0,
            createdAt: new Date().toISOString(),
        };

        // Register on event bus
        _on(event, (data) => {
            const hook = _hooks[hookId];
            if (!hook) return;

            // Apply filter if specified
            if (hook.filter && typeof data === 'object') {
                const matches = Object.entries(hook.filter).every(([k, v]) => data[k] === v);
                if (!matches) return;
            }

            hook.triggerCount++;
            console.log(`[Daemon] 🪝 Hook triggered: ${hookId} (${event})`);

            // Execute hook action
            if (hook.mode === 'script' && typeof hook.action === 'string' && hook.action.startsWith('{')) {
                try { new Function('data', hook.action)(data); } catch(e) {}
            } else if (window.chatHistory) {
                window.chatHistory.push({
                    role: 'system',
                    content: `[🪝 HOOK TRIGGERED: ${event}]\n` +
                             `Event data: ${JSON.stringify(data).substring(0, 300)}\n` +
                             `Action: ${hook.action}\n` +
                             `Execute this action now.`
                });
            }
        });

        // Persist hooks
        _persistHooks();

        return {
            result: `🪝 Hook registered: ${hookId}\n` +
                    `Trigger: "${event}"\n` +
                    `Action: "${action}"\n` +
                    `Filter: ${hook.filter ? JSON.stringify(hook.filter) : 'none'}`
        };
    }

    function listHooks(input) {
        const hookList = Object.values(_hooks);
        if (hookList.length === 0) return { result: 'No hooks registered. Use daemon_hook to create one.' };

        let report = `🪝 HOOKS (${hookList.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const h of hookList) {
            report += `• ${h.id}: on "${h.event}" → "${h.action.substring(0, 80)}"\n`;
            report += `  Triggers: ${h.triggerCount} | Created: ${h.createdAt}\n`;
        }
        return { result: report };
    }

    function removeHook(input) {
        const id = input.id || input.hook_id;
        if (!id || !_hooks[id]) return { error: `Hook "${id}" not found.` };
        delete _hooks[id];
        _persistHooks();
        return { result: `🗑️ Hook "${id}" removed.` };
    }

    // ═══ EVENT BUS ═══════════════════════════════════════════════════════
    function _on(event, callback) {
        if (!_eventBus[event]) _eventBus[event] = [];
        _eventBus[event].push(callback);
    }

    function _emit(event, data) {
        _eventLog.push({ event, data, ts: new Date().toISOString() });
        if (_eventLog.length > MAX_EVENT_LOG) _eventLog.shift();
        const handlers = _eventBus[event] || [];
        for (const h of handlers) {
            try { h(data); } catch(e) {}
        }
    }

    // ═══ PERSISTENCE ═════════════════════════════════════════════════════
    function _persistJobs() {
        try {
            const saveable = Object.values(_tasks)
                .filter(t => t.persistent)
                .map(t => ({
                    id: t.id,
                    name: t.name,
                    schedule: t.schedule,
                    scheduleType: t.scheduleType,
                    mode: t.mode,
                    code: t.code,
                    status: t.status,
                    runCount: t.runCount,
                    lastRun: t.lastRun,
                    delivery: t.delivery,
                    createdAt: t.createdAt,
                }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saveable));
        } catch(e) {}
    }

    function _restoreJobs() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return 0;
            const jobs = JSON.parse(saved);
            let restored = 0;
            for (const job of jobs) {
                if (job.status === 'active') {
                    // Re-schedule restored jobs
                    schedule({
                        name: job.name,
                        interval: job.schedule,
                        mode: job.mode,
                        code: job.code,
                        delivery: job.delivery,
                        persistent: true,
                    }).then(() => {}).catch(() => {});
                    restored++;
                }
            }
            if (restored > 0) {
                console.log(`[Daemon] ♻️ Restored ${restored} persistent jobs`);
            }
            return restored;
        } catch(e) {
            return 0;
        }
    }

    function _persistHooks() {
        try {
            const saveable = Object.values(_hooks).map(h => ({
                id: h.id,
                event: h.event,
                action: h.action,
                filter: h.filter,
                mode: h.mode,
                createdAt: h.createdAt,
            }));
            localStorage.setItem(HOOKS_STORAGE_KEY, JSON.stringify(saveable));
        } catch(e) {}
    }

    // Restore persistent jobs on boot
    setTimeout(() => _restoreJobs(), 3000);

    // ═══ EXPOSE ══════════════════════════════════════════════════════════
    window.floworkDaemon = {
        schedule,
        list,
        cancel,
        pause,
        resume,
        // Hooks
        registerHook,
        listHooks,
        removeHook,
        // Event Bus
        on: _on,
        emit: _emit,
        getEventLog: () => _eventLog.slice(-50),
        // Utilities
        parseCron: _parseCronExpression,
        getNextRun: _getNextCronRun,
    };

    console.log('[Brain] ✅ Daemon module loaded (cron + persistent + hooks + delivery + event bus)');
})();
