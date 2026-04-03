// =========================================================================
// FLOWORK OS — Brain Swarm Intelligence Module
// True parallel multi-agent execution using Web Workers.
// Each worker runs an independent agent with its own LLM loop.
// =========================================================================

(function() {
    'use strict';

    const MAX_WORKERS = 6;  // Max parallel threads
    const WORKER_TIMEOUT = 120000;  // 2 min per worker

    const swarmPool = {};  // swarmId → { workers[], tasks[], status, results }
    let swarmCounter = 0;

    // ─── Worker Code (stringified, runs in isolated thread) ─────────
    const WORKER_CODE = `
    // === SWARM WORKER THREAD ===
    let taskData = null;

    self.onmessage = async function(e) {
        const msg = e.data;

        if (msg.type === 'init') {
            taskData = msg;
            self.postMessage({ type: 'status', status: 'initialized', workerId: msg.workerId });
        }

        if (msg.type === 'execute') {
            try {
                self.postMessage({ type: 'status', status: 'running', workerId: taskData.workerId });

                // Use custom headers if provided (e.g., OpenAI Bearer token)
                const fetchHeaders = msg.customHeaders || { 'Content-Type': 'application/json' };

                const response = await fetch(msg.apiUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify(msg.payload),
                    signal: AbortSignal.timeout(90000),
                });

                if (!response.ok) {
                    throw new Error('API error: ' + response.status);
                }

                const data = await response.json();

                // Extract text — support Gemini AND OpenAI response formats
                let resultText = '';
                let tokenCount = 0;
                if (data.candidates && data.candidates[0]) {
                    // Gemini format
                    const parts = data.candidates[0].content?.parts || [];
                    resultText = parts.map(p => p.text || '').join('');
                    tokenCount = data.usageMetadata?.totalTokenCount || 0;
                } else if (data.choices && data.choices[0]) {
                    // OpenAI format
                    resultText = data.choices[0].message?.content || '';
                    tokenCount = data.usage?.total_tokens || 0;
                }

                self.postMessage({
                    type: 'result',
                    workerId: taskData.workerId,
                    taskIndex: msg.taskIndex,
                    result: resultText,
                    tokens: tokenCount,
                    success: true,
                });
            } catch(err) {
                self.postMessage({
                    type: 'result',
                    workerId: taskData.workerId,
                    taskIndex: msg.taskIndex,
                    result: 'Worker error: ' + err.message,
                    success: false,
                });
            }
        }

        if (msg.type === 'terminate') {
            self.close();
        }
    };
    `;

    // ─── Create Worker from string ──────────────────────────────────
    function _createWorker(workerId) {
        const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);

        worker._blobUrl = url;
        worker._id = workerId;
        worker._busy = false;
        worker._result = null;

        return worker;
    }

    function _cleanup(worker) {
        try {
            worker.terminate();
            URL.revokeObjectURL(worker._blobUrl);
        } catch(e) {}
    }

    // ─── Helper: Get raw API key and model from config ────────────
    function _getRawConfig() {
        // Direct DOM read (most reliable)
        let apiKey = window.getEl?.('input-api-key')?.value || '';
        let model = window.getEl?.('select-provider')?.value || '';

        // Fallback: read from localStorage
        if (!apiKey || !model) {
            try {
                const saved = JSON.parse(localStorage.getItem('flowork_builder_config') || '{}');
                if (!apiKey) apiKey = saved.apiKey || '';
                if (!model) model = saved.provider || 'gemini-2.5-flash-preview-05-20';
            } catch(e) {}
        }

        return { apiKey, model };
    }

    // ─── Build API payload (multi-provider) ─────────────────────────
    function _buildPayload(task, systemPrompt) {
        const { apiKey, model } = _getRawConfig();

        // OpenAI-compatible providers (GPT, Claude via proxy, etc.)
        if (model.startsWith('gpt') || model.includes('openai') || model.includes('o1') || model.includes('o3') || model.includes('o4')) {
            const baseUrl = 'https://api.openai.com/v1/chat/completions';
            return {
                apiUrl: baseUrl,
                payload: {
                    model: model,
                    messages: [
                        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                        { role: 'user', content: task }
                    ],
                    max_tokens: 2000,
                    temperature: 0.7,
                },
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
            };
        }

        // Default: Gemini format
        return {
            apiUrl: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            payload: {
                contents: [{
                    parts: [{ text: task }]
                }],
                systemInstruction: systemPrompt ? {
                    parts: [{ text: systemPrompt }]
                } : undefined,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2000,
                },
            },
        };
    }

    // ═══ SWARM LAUNCH ═══════════════════════════════════════════════

    /**
     * Launch a swarm — distribute tasks across parallel workers
     * Tool: swarm_launch
     */
    async function launch(input) {
        const tasks = input.tasks || [];
        const systemPrompt = input.system_prompt || input.prompt || 'Complete the assigned task efficiently. Be concise.';
        const name = input.name || `Swarm ${++swarmCounter}`;

        if (tasks.length === 0) {
            return { error: 'Missing tasks array. Example: { tasks: ["task1", "task2", "task3"] }' };
        }

        const { apiKey } = _getRawConfig();
        if (!apiKey) return { error: 'No API key configured. Swarm needs API access.' };

        const workerCount = Math.min(tasks.length, MAX_WORKERS);
        const swarmId = `swarm_${Date.now()}`;

        const swarm = {
            id: swarmId,
            name,
            workers: [],
            tasks: tasks.map((t, i) => ({
                index: i,
                task: typeof t === 'string' ? t : t.task || JSON.stringify(t),
                status: 'queued',
                result: null,
                assignedWorker: null,
            })),
            status: 'running',
            startedAt: Date.now(),
            completedAt: null,
            results: [],
            totalTokens: 0,
        };

        swarmPool[swarmId] = swarm;

        console.log(`[Swarm] 🐝 Launching "${name}" — ${tasks.length} tasks, ${workerCount} workers`);

        // Create worker pool
        for (let i = 0; i < workerCount; i++) {
            const workerId = `${swarmId}_w${i}`;
            const worker = _createWorker(workerId);

            worker.onmessage = (e) => {
                const msg = e.data;

                if (msg.type === 'result') {
                    // Store result
                    const task = swarm.tasks[msg.taskIndex];
                    if (task) {
                        task.status = msg.success ? 'done' : 'error';
                        task.result = msg.result;
                        swarm.totalTokens += msg.tokens || 0;
                    }

                    worker._busy = false;

                    // Find next queued task for this worker
                    const nextTask = swarm.tasks.find(t => t.status === 'queued');
                    if (nextTask) {
                        _assignTask(worker, nextTask, swarm, systemPrompt);
                    } else {
                        // Check if all done
                        const allDone = swarm.tasks.every(t => t.status === 'done' || t.status === 'error');
                        if (allDone) {
                            _completeSwarm(swarmId);
                        }
                    }
                }
            };

            worker.onerror = (err) => {
                console.error(`[Swarm] Worker ${workerId} error:`, err.message);
                worker._busy = false;
            };

            // Initialize worker
            worker.postMessage({ type: 'init', workerId });
            swarm.workers.push(worker);
        }

        // Distribute initial tasks to workers
        for (let i = 0; i < workerCount && i < swarm.tasks.length; i++) {
            _assignTask(swarm.workers[i], swarm.tasks[i], swarm, systemPrompt);
        }

        // Set timeout
        setTimeout(() => {
            if (swarm.status === 'running') {
                _completeSwarm(swarmId, true);
            }
        }, WORKER_TIMEOUT);

        return {
            result: `🐝 SWARM LAUNCHED: "${name}"\n` +
                    `ID: ${swarmId}\n` +
                    `Tasks: ${tasks.length} | Workers: ${workerCount} (parallel)\n` +
                    `Timeout: ${WORKER_TIMEOUT / 1000}s\n\n` +
                    `Use swarm_status with id "${swarmId}" to check progress.\n` +
                    `Use swarm_collect to gather all results.`
        };
    }

    function _assignTask(worker, task, swarm, systemPrompt) {
        task.status = 'running';
        task.assignedWorker = worker._id;
        worker._busy = true;

        const { apiUrl, payload, headers: customHeaders } = _buildPayload(task.task, systemPrompt);

        worker.postMessage({
            type: 'execute',
            taskIndex: task.index,
            apiUrl,
            payload,
            customHeaders: customHeaders || null,
        });
    }

    function _completeSwarm(swarmId, timedOut = false) {
        const swarm = swarmPool[swarmId];
        if (!swarm) return;

        swarm.status = timedOut ? 'timeout' : 'completed';
        swarm.completedAt = Date.now();

        // Cleanup workers
        for (const worker of swarm.workers) {
            _cleanup(worker);
        }
        swarm.workers = [];

        const duration = ((swarm.completedAt - swarm.startedAt) / 1000).toFixed(1);
        const successCount = swarm.tasks.filter(t => t.status === 'done').length;

        console.log(`[Swarm] ${timedOut ? '⏰' : '✅'} "${swarm.name}" completed: ${successCount}/${swarm.tasks.length} in ${duration}s`);

        // Track cost
        if (window.costTracker && swarm.totalTokens > 0) {
            const { model } = _getRawConfig();
            window.costTracker.recordCall(model, 0, swarm.totalTokens * 4, 0);
        }
    }

    // ═══ SWARM STATUS & COLLECT ═════════════════════════════════════

    /**
     * Check swarm progress
     * Tool: swarm_status
     */
    function status(input) {
        const swarmId = input.id || input.swarm_id;
        if (!swarmId) {
            // List all swarms
            const swarms = Object.values(swarmPool);
            if (swarms.length === 0) return { result: 'No swarms. Use swarm_launch to create one.' };

            let report = `🐝 SWARMS (${swarms.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const s of swarms) {
                const done = s.tasks.filter(t => t.status === 'done').length;
                const icon = s.status === 'completed' ? '✅' : s.status === 'timeout' ? '⏰' : '🔄';
                report += `${icon} ${s.name} (${s.id})\n`;
                report += `   ${done}/${s.tasks.length} tasks | ${s.totalTokens} tokens\n`;
            }
            return { result: report };
        }

        const swarm = swarmPool[swarmId];
        if (!swarm) return { error: `Swarm "${swarmId}" not found.` };

        const done = swarm.tasks.filter(t => t.status === 'done').length;
        const errors = swarm.tasks.filter(t => t.status === 'error').length;
        const running = swarm.tasks.filter(t => t.status === 'running').length;
        const queued = swarm.tasks.filter(t => t.status === 'queued').length;

        const elapsed = ((Date.now() - swarm.startedAt) / 1000).toFixed(1);

        let report = `🐝 SWARM: "${swarm.name}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `Status: ${swarm.status.toUpperCase()}\n`;
        report += `Progress: ${done}/${swarm.tasks.length} done | ${errors} errors | ${running} running | ${queued} queued\n`;
        report += `Time: ${elapsed}s | Tokens: ${swarm.totalTokens}\n`;
        report += `Workers: ${swarm.workers.length} active\n\n`;

        // Show task status
        for (const task of swarm.tasks) {
            const icon = task.status === 'done' ? '✅' : task.status === 'error' ? '❌' : task.status === 'running' ? '🔄' : '⏳';
            report += `${icon} Task ${task.index + 1}: "${task.task.substring(0, 60)}"\n`;
        }

        return { result: report };
    }

    /**
     * Collect all results from a completed swarm
     * Tool: swarm_collect
     */
    function collect(input) {
        const swarmId = input.id || input.swarm_id;
        if (!swarmId) return { error: 'Missing swarm id.' };

        const swarm = swarmPool[swarmId];
        if (!swarm) return { error: `Swarm "${swarmId}" not found.` };

        const duration = swarm.completedAt
            ? ((swarm.completedAt - swarm.startedAt) / 1000).toFixed(1)
            : ((Date.now() - swarm.startedAt) / 1000).toFixed(1);

        let report = `🐝 SWARM RESULTS: "${swarm.name}"\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `Total time: ${duration}s | Tokens: ${swarm.totalTokens}\n`;
        report += `Status: ${swarm.status}\n\n`;

        for (const task of swarm.tasks) {
            const icon = task.status === 'done' ? '✅' : '❌';
            report += `${icon} TASK ${task.index + 1}: "${task.task.substring(0, 80)}"\n`;
            report += `─────────────────────────────────────────────\n`;
            report += `${task.result || '(no result)'}\n\n`;
        }

        return { result: report };
    }

    /**
     * Cancel a running swarm
     * Tool: swarm_cancel
     */
    function cancel(input) {
        const swarmId = input.id || input.swarm_id;
        if (!swarmId) return { error: 'Missing swarm id.' };

        const swarm = swarmPool[swarmId];
        if (!swarm) return { error: `Swarm "${swarmId}" not found.` };

        // Kill all workers
        for (const worker of swarm.workers) {
            _cleanup(worker);
        }
        swarm.workers = [];
        swarm.status = 'cancelled';
        swarm.completedAt = Date.now();

        return { result: `🛑 Swarm "${swarm.name}" cancelled. ${swarm.tasks.filter(t => t.status === 'done').length} tasks completed before cancellation.` };
    }

    /**
     * Quick parallel execute — convenience function
     * Tool: swarm_parallel
     */
    async function parallelExecute(input) {
        const tasks = input.tasks || input.prompts || [];
        if (tasks.length === 0) return { error: 'Missing tasks array.' };

        // Launch swarm and wait for completion
        const launchResult = await launch({
            tasks,
            name: input.name || 'Quick Parallel',
            system_prompt: input.system_prompt,
        });

        // Extract swarm ID
        const match = launchResult.result?.match(/swarm_\d+/);
        if (!match) return launchResult;

        const swarmId = match[0];

        // Poll for completion
        return new Promise((resolve) => {
            let polls = 0;
            const maxPolls = 60;  // 60 * 2s = 120s max

            const interval = setInterval(() => {
                polls++;
                const swarm = swarmPool[swarmId];

                if (!swarm || swarm.status !== 'running' || polls >= maxPolls) {
                    clearInterval(interval);

                    if (swarm) {
                        resolve(collect({ id: swarmId }));
                    } else {
                        resolve({ error: 'Swarm not found.' });
                    }
                }
            }, 2000);
        });
    }

    /**
     * Map-Reduce pattern — split task, parallel execute, merge results
     * Tool: swarm_map_reduce
     */
    async function mapReduce(input) {
        const data = input.data || input.items || [];
        const mapPrompt = input.map_prompt || input.map || 'Analyze this item:';
        const reducePrompt = input.reduce_prompt || input.reduce || 'Combine and summarize these results:';

        if (data.length === 0) return { error: 'Missing data array for map-reduce.' };

        // MAP phase: distribute items across workers
        const mapTasks = data.map((item, i) =>
            `${mapPrompt}\n\nItem ${i + 1}:\n${typeof item === 'string' ? item : JSON.stringify(item)}`
        );

        const mapResult = await launch({
            tasks: mapTasks,
            name: `MapReduce-Map (${data.length} items)`,
            system_prompt: 'You are processing one item in a map-reduce pipeline. Analyze the given item and provide a structured result.',
        });

        const match = mapResult.result?.match(/swarm_\d+/);
        if (!match) return mapResult;

        const swarmId = match[0];

        // Wait for map phase
        await new Promise(resolve => {
            const checkInterval = setInterval(() => {
                const swarm = swarmPool[swarmId];
                if (!swarm || swarm.status !== 'running') {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 1000);
        });

        // REDUCE phase: combine results
        const swarm = swarmPool[swarmId];
        if (!swarm) return { error: 'Map phase failed.' };

        const mapResults = swarm.tasks
            .filter(t => t.status === 'done')
            .map((t, i) => `[Result ${i + 1}]: ${t.result}`)
            .join('\n\n');

        // Use single LLM call for reduce
        const { apiKey, model } = _getRawConfig();

        if (!apiKey) return { error: 'No API key for reduce phase.' };

        try {
            const response = await window.brainLLMAdapter.query(
                model, apiKey,
                'You are performing the REDUCE step of a map-reduce operation. Combine all results into a coherent summary.',
                [{ role: 'user', content: `${reducePrompt}\n\n=== MAP RESULTS ===\n${mapResults}` }],
                null, () => {}, null
            );

            return {
                result: `🐝 MAP-REDUCE COMPLETE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `Map: ${swarm.tasks.length} items processed in parallel\n` +
                        `Reduce: Combined into final result\n` +
                        `Total tokens: ${swarm.totalTokens}\n\n` +
                        `=== RESULT ===\n${response.rawText}`
            };
        } catch(e) {
            return { error: `Reduce phase failed: ${e.message}` };
        }
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkSwarm = {
        launch,
        status,
        collect,
        cancel,
        parallelExecute,
        mapReduce,
    };

    console.log(`[Brain] ✅ Swarm Intelligence loaded — max ${MAX_WORKERS} parallel workers`);

})();
