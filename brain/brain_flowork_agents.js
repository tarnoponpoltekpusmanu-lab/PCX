// =========================================================================
// FLOWORK OS — Brain Multi-Agent Module (Phase 11: Full Clone System)
// Spawn sub-agents with depth tracking, orphan recovery, inter-agent
// messaging, health integration, and smart/subagents bridge.
//
// Tools: spawn_agent, check_agent, list_agents, kill_agent,
//        agent_broadcast, agent_collect
// =========================================================================

(function() {
    'use strict';

    // ═══ CONFIG ═══════════════════════════════════════════════════════════
    const MAX_AGENTS = 10;
    const AGENT_MAX_TICKS = 30;
    const MAX_DEPTH = 3;                    // Max nesting depth (parent → child → grandchild)
    const ORPHAN_CHECK_INTERVAL = 30000;    // 30s orphan scan
    const AGENT_TIMEOUT = 300000;           // 5min max per agent before timeout
    const MAX_AGENT_HISTORY = 50;           // Keep last 50 completed agents in history

    // ═══ STATE ════════════════════════════════════════════════════════════
    let agentCounter = 0;
    const agents = {};           // id → agent object (active)
    const agentHistory = [];     // Completed agents (for auditing)
    const messageBoard = {};     // agentId → [messages from other agents]

    // ═══ SPAWN AGENT ═════════════════════════════════════════════════════
    async function spawnAgent(input) {
        const task = input.task || input.prompt || '';
        if (!task) return { error: 'Missing task description for agent.' };

        // ─── Depth tracking ──────────────────────────────────────
        const parentId = input.parent_id || input.parentId || null;
        const parentDepth = parentId && agents[parentId] ? (agents[parentId].depth || 0) : 0;
        const agentDepth = parentId ? parentDepth + 1 : 0;

        if (agentDepth >= MAX_DEPTH) {
            return {
                error: `🔴 Max agent depth (${MAX_DEPTH}) exceeded. ` +
                       `Cannot spawn child of "${parentId}" (depth ${parentDepth}). ` +
                       `Flatten your task instead of nesting agents deeper.`
            };
        }

        // ─── Capacity check + auto-cleanup ───────────────────────
        if (Object.keys(agents).length >= MAX_AGENTS) {
            _cleanupCompleted();
            if (Object.keys(agents).length >= MAX_AGENTS) {
                return { error: `Max ${MAX_AGENTS} concurrent agents. Use kill_agent or wait for completion.` };
            }
        }

        agentCounter++;
        const agentId = `agent_${agentCounter}_${Date.now()}`;
        const model = input.model || input.provider || null;

        const agent = {
            id: agentId,
            task: task,
            status: 'running',
            result: null,
            chatHistory: [],
            config: {
                model: model,
                maxTicks: input.max_ticks || AGENT_MAX_TICKS,
                tools: input.tools || null,
            },
            // ─── NEW: Depth tracking ─────────────────────────────
            depth: agentDepth,
            parentId: parentId,
            childIds: [],
            // ─── NEW: Timing ──────────────────────────────────────
            startedAt: new Date().toISOString(),
            endedAt: null,
            timeoutAt: new Date(Date.now() + AGENT_TIMEOUT).toISOString(),
            // ─── Stats ────────────────────────────────────────────
            ticks: 0,
            errors: [],
            toolCalls: 0,
            // ─── NEW: Health integration ──────────────────────────
            _abortFlag: false,
        };

        agents[agentId] = agent;

        // Register as child of parent
        if (parentId && agents[parentId]) {
            agents[parentId].childIds.push(agentId);
        }

        // Bridge to smart subagents if available
        if (window.FLOWORKOS_SubAgents?.spawnSubagent) {
            try {
                window.FLOWORKOS_SubAgents.spawnSubagent({
                    id: agentId,
                    task,
                    parentId,
                    depth: agentDepth,
                    model,
                });
                agent._smartBridged = true;
            } catch(e) {}
        }

        console.log(`[MultiAgent] 🤖 Spawned ${agentId} (depth:${agentDepth}${parentId ? `, parent:${parentId}` : ''}): "${task.substring(0, 80)}"`);

        // Execute agent asynchronously
        _runAgent(agentId).catch(err => {
            agent.status = 'error';
            agent.result = `Agent crashed: ${err.message}`;
            agent.endedAt = new Date().toISOString();
            agent.errors.push(err.message);
            console.error(`[MultiAgent] ❌ Agent ${agentId} crashed:`, err);

            // Report to self-heal
            if (window.brainSelfHeal?._tripCircuitBreaker) {
                window.brainSelfHeal._tripCircuitBreaker(`agent:${agentId}`, err.message);
            }
        });

        return {
            result: `🤖 Agent spawned: ${agentId}\n` +
                    `Task: "${task.substring(0, 120)}"\n` +
                    `Depth: ${agentDepth}/${MAX_DEPTH}\n` +
                    `Max ticks: ${agent.config.maxTicks}\n` +
                    `Timeout: ${AGENT_TIMEOUT / 1000}s\n` +
                    (parentId ? `Parent: ${parentId}\n` : '') +
                    `Use check_agent with id: "${agentId}" to monitor progress.`
        };
    }

    // ═══ RUN AGENT LOOP ══════════════════════════════════════════════════
    async function _runAgent(agentId) {
        const agent = agents[agentId];
        if (!agent) return;

        const provider = agent.config.model || window.getConfig?.('provider') || 'gemini-2.5-flash-preview-05-20';
        const apiKey = window.getConfig?.('apiKey') || '';

        if (!apiKey) {
            agent.status = 'error';
            agent.result = 'No API key configured. Cannot run sub-agent.';
            agent.endedAt = new Date().toISOString();
            return;
        }

        // Build system prompt for sub-agent
        const depthInfo = agent.depth > 0
            ? `You are a depth-${agent.depth} sub-agent (parent: ${agent.parentId}). `
            : 'You are a top-level sub-agent. ';

        const systemPrompt = `You are a sub-agent in the Flowork AI system. ${depthInfo}Your task is specific and focused.
You have access to all tools. Complete the task autonomously.
When done, output [TASK_COMPLETE] with your final result.
Do NOT ask questions. Work independently.
You have ${agent.config.maxTicks} ticks maximum.
${agent.depth >= MAX_DEPTH - 1 ? '⚠️ You are at max depth — do NOT spawn sub-agents.' : ''}

TASK: ${agent.task}`;

        agent.chatHistory.push({ role: 'user', content: agent.task });

        // Agent loop
        for (let tick = 0; tick < agent.config.maxTicks; tick++) {
            // ─── Abort & timeout checks ──────────────────────────
            if (agent._abortFlag) {
                agent.status = 'killed';
                agent.result = 'Agent was killed by parent/user.';
                agent.endedAt = new Date().toISOString();
                return;
            }

            if (Date.now() > new Date(agent.timeoutAt).getTime()) {
                agent.status = 'timeout';
                agent.result = `Agent timed out after ${AGENT_TIMEOUT / 1000}s.`;
                agent.endedAt = new Date().toISOString();
                _logAgentEvent(agentId, 'timeout', `Timed out at tick ${tick}`);
                return;
            }

            agent.ticks = tick + 1;

            try {
                // ─── Check message board for inter-agent messages ─
                const messages = messageBoard[agentId];
                if (messages && messages.length > 0) {
                    const msgContent = messages.map(m => `[From ${m.from}]: ${m.content}`).join('\n');
                    agent.chatHistory.push({
                        role: 'system',
                        content: `[📨 INTER-AGENT MESSAGES]\n${msgContent}`
                    });
                    messageBoard[agentId] = []; // Clear
                }

                // Call LLM with auto-retry via self-heal
                let response;
                if (window.brainSelfHeal?.withAutoRetry) {
                    response = await window.brainSelfHeal.withAutoRetry(
                        `agent:${agentId}:llm`,
                        () => window.brainLLMAdapter.query(
                            provider, apiKey, systemPrompt,
                            agent.chatHistory, null,
                            () => {}, null
                        )
                    );
                    if (response?.error) {
                        agent.errors.push(response.error);
                        agent.chatHistory.push({ role: 'system', content: `LLM error: ${response.error}. Retrying...` });
                        continue;
                    }
                } else {
                    response = await window.brainLLMAdapter.query(
                        provider, apiKey, systemPrompt,
                        agent.chatHistory, null,
                        () => {}, null
                    );
                }

                const rawText = response.rawText || '';
                agent.chatHistory.push({ role: 'assistant', content: rawText });

                // Check for task complete
                if (rawText.toUpperCase().includes('[TASK_COMPLETE]')) {
                    agent.status = 'done';
                    agent.result = rawText;
                    agent.endedAt = new Date().toISOString();

                    // Announce completion to parent
                    if (agent.parentId && agents[agent.parentId]) {
                        _sendMessage(agentId, agent.parentId, `✅ Sub-task complete: ${rawText.substring(0, 300)}`);
                    }

                    // Emit event
                    if (window.floworkDaemon?.emit) {
                        window.floworkDaemon.emit('agent:complete', { agentId, task: agent.task, result: rawText.substring(0, 500) });
                    }

                    _archiveAgent(agentId);
                    console.log(`[MultiAgent] ✅ Agent ${agentId} completed in ${tick + 1} ticks`);
                    return;
                }

                // Parse and execute tool calls
                const actions = _parseActions(rawText);
                for (const action of actions) {
                    // ─── Block spawn_agent if at max depth ──────────
                    if (action.action === 'spawn_agent' && agent.depth >= MAX_DEPTH - 1) {
                        agent.chatHistory.push({
                            role: 'tool',
                            content: `[spawn_agent] ❌ Cannot spawn: max depth (${MAX_DEPTH}) reached. Perform this sub-task directly.`
                        });
                        continue;
                    }

                    // Inject parentId for nested spawns
                    if (action.action === 'spawn_agent') {
                        action.parent_id = agentId;
                    }

                    try {
                        const _savedTabId = window.activeAppBrowserTabId;
                        const _savedAppId = window.currentAppId;

                        const toolResult = await window.brainToolBridge(action.action, action);
                        const resultStr = toolResult?.result || toolResult?.error || JSON.stringify(toolResult);

                        window.activeAppBrowserTabId = _savedTabId;
                        window.currentAppId = _savedAppId;

                        agent.chatHistory.push({
                            role: 'tool',
                            content: `[${action.action}] ${resultStr.substring(0, 2000)}`,
                        });
                        agent.toolCalls++;

                    } catch(toolErr) {
                        agent.chatHistory.push({
                            role: 'tool',
                            content: `[${action.action}] ERROR: ${toolErr.message}`,
                        });
                        agent.errors.push(toolErr.message);
                    }
                }

                // Compact if history gets too long
                if (agent.chatHistory.length > 40) {
                    agent.chatHistory = [
                        agent.chatHistory[0],
                        { role: 'tool', content: `[COMPACTED] Previous ${agent.chatHistory.length - 4} messages compressed.` },
                        ...agent.chatHistory.slice(-3),
                    ];
                }

            } catch(err) {
                agent.errors.push(err.message);
                if (agent.errors.length > 5) {
                    agent.status = 'error';
                    agent.result = `Too many errors. Last: ${err.message}`;
                    agent.endedAt = new Date().toISOString();

                    // Report to self-heal
                    if (window.brainSelfHeal?._tripCircuitBreaker) {
                        window.brainSelfHeal._tripCircuitBreaker(`agent:${agentId}`, err.message);
                    }

                    _archiveAgent(agentId);
                    return;
                }
            }
        }

        // Max ticks reached
        agent.status = 'done';
        agent.result = `Agent completed ${agent.config.maxTicks} ticks. Last response: ${agent.chatHistory[agent.chatHistory.length - 1]?.content?.substring(0, 500) || 'none'}`;
        agent.endedAt = new Date().toISOString();
        _archiveAgent(agentId);
    }

    // ═══ ACTION PARSER ═══════════════════════════════════════════════════
    function _parseActions(text) {
        const actions = [];
        const jsonMatch = text.match(/```json\s*([\s\S]*?)```/g);
        if (jsonMatch) {
            for (const block of jsonMatch) {
                try {
                    const jsonStr = block.replace(/```json\s*/, '').replace(/```$/, '').trim();
                    const parsed = JSON.parse(jsonStr);
                    if (Array.isArray(parsed)) {
                        actions.push(...parsed.filter(a => a.action));
                    } else if (parsed.action) {
                        actions.push(parsed);
                    }
                } catch(e) {}
            }
        }
        return actions;
    }

    // ═══ INTER-AGENT MESSAGING ═══════════════════════════════════════════

    function _sendMessage(fromId, toId, content) {
        if (!messageBoard[toId]) messageBoard[toId] = [];
        messageBoard[toId].push({
            from: fromId,
            content: (content || '').substring(0, 1000),
            ts: new Date().toISOString(),
        });
    }

    function broadcast(input) {
        const fromId = input.from || input.agent_id || 'user';
        const content = input.message || input.content || '';
        if (!content) return { error: 'Missing message content.' };

        const targetScope = input.scope || 'all'; // 'all', 'siblings', 'children'
        let targets = [];

        if (targetScope === 'children' && agents[fromId]) {
            targets = agents[fromId].childIds.filter(id => agents[id]);
        } else if (targetScope === 'siblings' && agents[fromId]?.parentId) {
            const parentId = agents[fromId].parentId;
            targets = (agents[parentId]?.childIds || []).filter(id => id !== fromId && agents[id]);
        } else {
            targets = Object.keys(agents).filter(id => id !== fromId);
        }

        for (const targetId of targets) {
            _sendMessage(fromId, targetId, content);
        }

        return {
            result: `📢 Broadcast sent to ${targets.length} agent(s): "${content.substring(0, 100)}"`
        };
    }

    // ═══ COLLECT RESULTS ═════════════════════════════════════════════════
    // Gather results from all child agents of a parent

    function collect(input) {
        const parentId = input.parent_id || input.parentId || input.from;

        let targets;
        if (parentId && agents[parentId]) {
            targets = agents[parentId].childIds;
        } else {
            targets = Object.keys(agents);
        }

        let report = `📋 AGENT RESULTS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        let allDone = true;

        for (const id of targets) {
            const a = agents[id] || agentHistory.find(h => h.id === id);
            if (!a) continue;

            const icon = a.status === 'done' ? '✅' : a.status === 'error' ? '❌' : a.status === 'timeout' ? '⏰' : '🔄';
            report += `\n${icon} ${a.id} (depth:${a.depth}, ${a.ticks} ticks)\n`;
            report += `   Task: "${a.task.substring(0, 100)}"\n`;
            report += `   Status: ${a.status}\n`;
            if (a.result) report += `   Result: ${a.result.substring(0, 300)}\n`;
            if (a.status === 'running') allDone = false;
        }

        report += `\n${allDone ? '✅ All agents complete.' : '🔄 Some agents still running.'}`;
        return { result: report };
    }

    // ═══ KILL AGENT ══════════════════════════════════════════════════════

    function killAgent(input) {
        const id = input.id || input.agent_id;
        if (!id) {
            // Kill all
            for (const agent of Object.values(agents)) {
                agent._abortFlag = true;
                agent.status = 'killed';
                agent.endedAt = new Date().toISOString();
            }
            const count = Object.keys(agents).length;
            return { result: `🗑️ Killed ${count} agent(s). They will stop at next tick.` };
        }

        if (!agents[id]) return { error: `Agent "${id}" not found.` };

        // Kill agent and all its children recursively
        const killed = _killRecursive(id);
        return { result: `🗑️ Killed ${killed} agent(s): ${id} + ${killed - 1} children.` };
    }

    function _killRecursive(agentId) {
        const agent = agents[agentId];
        if (!agent) return 0;

        let count = 1;
        agent._abortFlag = true;
        agent.status = 'killed';
        agent.endedAt = new Date().toISOString();

        // Kill all children
        for (const childId of (agent.childIds || [])) {
            count += _killRecursive(childId);
        }

        _archiveAgent(agentId);
        return count;
    }

    // ═══ CHECK AGENT ═════════════════════════════════════════════════════

    function checkAgent(input) {
        const id = input.id || input.agent_id;
        if (!id) return { error: 'Missing agent id.' };

        const agent = agents[id] || agentHistory.find(h => h.id === id);
        if (!agent) return { error: `Agent "${id}" not found.` };

        return {
            result: JSON.stringify({
                id: agent.id,
                task: agent.task.substring(0, 200),
                status: agent.status,
                depth: agent.depth,
                parentId: agent.parentId,
                childIds: agent.childIds,
                ticks: agent.ticks,
                maxTicks: agent.config.maxTicks,
                toolCalls: agent.toolCalls,
                startedAt: agent.startedAt,
                endedAt: agent.endedAt,
                errors: agent.errors.length,
                result: agent.result ? agent.result.substring(0, 1000) : null,
                historyLength: agent.chatHistory?.length || 0,
                _smartBridged: agent._smartBridged || false,
            }, null, 2)
        };
    }

    // ═══ LIST AGENTS ═════════════════════════════════════════════════════

    function listAgents(input) {
        const agentList = Object.values(agents);
        const showHistory = input?.show_history || false;

        if (agentList.length === 0 && !showHistory) {
            return { result: 'No agents running. Use spawn_agent to create one.' };
        }

        let report = `🤖 AGENTS (${agentList.length} active)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        // Build tree view
        const rootAgents = agentList.filter(a => !a.parentId || !agents[a.parentId]);
        for (const a of rootAgents) {
            _renderAgentTree(a, report, '', agents);
        }

        // Flat fallback if tree fails
        if (rootAgents.length === 0) {
            for (const a of agentList) {
                const icon = a.status === 'done' ? '✅' : a.status === 'error' ? '❌' : a.status === 'timeout' ? '⏰' : a.status === 'killed' ? '🔴' : '🔄';
                const bridged = a._smartBridged ? ' [SMART]' : '';
                report += `${icon} ${a.id} (d:${a.depth}) | ${a.status} | ${a.ticks}/${a.config.maxTicks} ticks${bridged}\n`;
                report += `   Task: "${a.task.substring(0, 80)}"\n`;
            }
        }

        // Show recent history if requested
        if (showHistory && agentHistory.length > 0) {
            report += `\n📜 RECENT HISTORY (${agentHistory.length}):\n`;
            for (const a of agentHistory.slice(-5)) {
                report += `  ${a.status === 'done' ? '✅' : '❌'} ${a.id}: "${a.task.substring(0, 60)}" (${a.ticks} ticks)\n`;
            }
        }

        return { result: report };
    }

    function _renderAgentTree(agent, report, prefix) {
        const icon = agent.status === 'done' ? '✅' : agent.status === 'error' ? '❌' : agent.status === 'timeout' ? '⏰' : agent.status === 'killed' ? '🔴' : '🔄';
        report += `${prefix}${icon} ${agent.id} (d:${agent.depth}) | ${agent.status} | ${agent.ticks}/${agent.config.maxTicks}\n`;
        report += `${prefix}   Task: "${agent.task.substring(0, 80)}"\n`;

        for (const childId of (agent.childIds || [])) {
            if (agents[childId]) {
                _renderAgentTree(agents[childId], report, prefix + '  │ ');
            }
        }
    }

    // ═══ ORPHAN RECOVERY ═════════════════════════════════════════════════

    function _orphanScan() {
        const now = Date.now();
        let orphansFound = 0;

        for (const [id, agent] of Object.entries(agents)) {
            // Check 1: Agent has parent that no longer exists
            if (agent.parentId && !agents[agent.parentId]) {
                // Parent died — promote to orphan top-level
                console.warn(`[MultiAgent] 🧹 Orphan detected: ${id} (parent ${agent.parentId} gone)`);
                agent.parentId = null;
                agent.depth = 0;
                orphansFound++;

                // Inject notice into agent's context
                agent.chatHistory.push({
                    role: 'system',
                    content: '[WARNING] Your parent agent has terminated. You are now operating independently. Complete your task and report [TASK_COMPLETE].'
                });
            }

            // Check 2: Agent exceeded timeout
            if (agent.status === 'running' && now > new Date(agent.timeoutAt).getTime()) {
                console.warn(`[MultiAgent] ⏰ Timeout: ${id} exceeded ${AGENT_TIMEOUT / 1000}s`);
                agent._abortFlag = true;
                orphansFound++;
            }

            // Check 3: Agent is stuck (no ticks for 60s)
            if (agent.status === 'running' && agent.ticks > 0) {
                // This is a heuristic — if status is running but we can't tell last activity
                // We skip for now since the abort flag handles true stuck agents
            }
        }

        if (orphansFound > 0) {
            _logAgentEvent('system', 'orphan_scan', `Found ${orphansFound} orphans/timeouts`);
        }
    }

    // Run orphan scan periodically
    setInterval(_orphanScan, ORPHAN_CHECK_INTERVAL);

    // ═══ UTILITIES ═══════════════════════════════════════════════════════

    function _cleanupCompleted() {
        for (const [id, agent] of Object.entries(agents)) {
            if (agent.status === 'done' || agent.status === 'error' || agent.status === 'killed' || agent.status === 'timeout') {
                _archiveAgent(id);
            }
        }
    }

    function _archiveAgent(agentId) {
        const agent = agents[agentId];
        if (!agent) return;

        agentHistory.push({
            id: agent.id,
            task: agent.task,
            status: agent.status,
            depth: agent.depth,
            parentId: agent.parentId,
            childIds: agent.childIds,
            ticks: agent.ticks,
            toolCalls: agent.toolCalls,
            result: agent.result,
            startedAt: agent.startedAt,
            endedAt: agent.endedAt,
            errors: agent.errors,
        });

        if (agentHistory.length > MAX_AGENT_HISTORY) agentHistory.shift();
        delete agents[agentId];
    }

    function _logAgentEvent(agentId, event, detail) {
        if (window.floworkDaemon?.emit) {
            window.floworkDaemon.emit(`agent:${event}`, { agentId, detail });
        }
    }

    // ═══ EXPOSE ══════════════════════════════════════════════════════════
    window.agentPool = {
        spawnAgent,
        checkAgent,
        listAgents,
        killAgent,
        broadcast,
        collect,
        // Internal access for teams
        _agents: agents,
        _history: agentHistory,
    };

    console.log('[Brain] ✅ Multi-Agent module loaded (depth tracking + orphan recovery + messaging + health integration)');

})();
