// =========================================================================
// FLOWORK OS — Brain Team Manager Module v2
// Full team coordination with roles, task decomposition, dependency
// graphs, agent templates, persistent teams, and execution strategies.
// =========================================================================

(function() {
    'use strict';

    // ── Constants ────────────────────────────────────────────
    const STORAGE_KEY = 'flowork_teams';
    const TEMPLATES_KEY = 'flowork_agent_templates';

    // ── Pre-defined Roles ───────────────────────────────────
    const ROLES = {
        pm: {
            name: 'Project Manager',
            icon: '📋',
            description: 'Decomposes tasks, assigns work, tracks progress',
            allowedTools: ['spawn_agent', 'list_agents', 'check_agent', 'team_sync', 'todo_write', 'todo_list'],
            systemHint: 'You are a project manager. Break tasks into subtasks, delegate to specialists, and track completion.',
        },
        developer: {
            name: 'Developer',
            icon: '💻',
            description: 'Writes code, fixes bugs, implements features',
            allowedTools: ['write_files', 'patch_file', 'read_file', 'run_command', 'search_files', 'git'],
            systemHint: 'You are a software developer. Write clean, tested code. Follow best practices.',
        },
        qa: {
            name: 'QA Tester',
            icon: '🧪',
            description: 'Tests functionality, finds bugs, validates output',
            allowedTools: ['run_command', 'read_file', 'capture_browser', 'read_dom', 'get_console_logs', 'vision_analyze'],
            systemHint: 'You are a QA tester. Test thoroughly: run tests, check UI, verify functionality, report bugs.',
        },
        researcher: {
            name: 'Researcher',
            icon: '🔍',
            description: 'Searches web, gathers info, summarizes findings',
            allowedTools: ['web_search', 'web_fetch', 'crawl_url', 'crawl_site', 'read_url'],
            systemHint: 'You are a researcher. Search thoroughly, verify sources, summarize findings concisely.',
        },
        designer: {
            name: 'Designer',
            icon: '🎨',
            description: 'Creates UI/UX designs, generates images, styles',
            allowedTools: ['generate_image', 'write_files', 'patch_file', 'capture_browser', 'vision_analyze'],
            systemHint: 'You are a UI/UX designer. Create beautiful, modern, accessible designs.',
        },
        writer: {
            name: 'Writer',
            icon: '✍️',
            description: 'Writes documentation, content, copy',
            allowedTools: ['write_files', 'read_file', 'web_search'],
            systemHint: 'You are a technical writer. Write clear, concise, well-structured documentation.',
        },
        analyst: {
            name: 'Analyst',
            icon: '📊',
            description: 'Analyzes data, generates reports, finds patterns',
            allowedTools: ['read_file', 'run_command', 'search_files', 'web_search'],
            systemHint: 'You are a data analyst. Analyze thoroughly, find patterns, present insights clearly.',
        },
        devops: {
            name: 'DevOps',
            icon: '⚙️',
            description: 'Deployment, CI/CD, infrastructure, monitoring',
            allowedTools: ['run_command', 'write_files', 'read_file', 'git'],
            systemHint: 'You are a DevOps engineer. Handle deployment, CI/CD, monitoring, and infrastructure.',
        },
    };

    // ── Execution Strategies ────────────────────────────────
    const STRATEGIES = {
        sequential: {
            name: 'Sequential',
            description: 'Execute tasks one by one in order',
        },
        parallel: {
            name: 'Parallel',
            description: 'Execute all tasks simultaneously',
        },
        pipeline: {
            name: 'Pipeline',
            description: 'Output of each task feeds into the next',
        },
        debate: {
            name: 'Debate/Vote',
            description: 'Multiple agents propose solutions, best one wins',
        },
        waterfall: {
            name: 'Waterfall',
            description: 'Strict dependency-based execution',
        },
    };

    // ── State ────────────────────────────────────────────────
    const teams = {};       // teamId → TeamObject
    let teamCounter = 0;
    let _templates = {};    // templateId → AgentTemplate

    // ── Load Persistent State ───────────────────────────────
    function _loadPersistent() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                Object.assign(teams, data);
                teamCounter = Object.keys(teams).length;
                console.log(`[Teams] 📂 Loaded ${teamCounter} persistent teams`);
            }
        } catch (e) { /* ignore */ }

        try {
            const savedT = localStorage.getItem(TEMPLATES_KEY);
            if (savedT) {
                _templates = JSON.parse(savedT);
                console.log(`[Teams] 📂 Loaded ${Object.keys(_templates).length} agent templates`);
            }
        } catch (e) { /* ignore */ }
    }

    function _savePersistent() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
        } catch (e) { /* ignore */ }
    }

    function _saveTemplates() {
        try {
            localStorage.setItem(TEMPLATES_KEY, JSON.stringify(_templates));
        } catch (e) { /* ignore */ }
    }

    // ── Task Decomposition ──────────────────────────────────
    /**
     * Decompose a large task into sub-tasks with dependencies.
     * Each sub-task: { id, task, role, dependsOn: [], status }
     */
    function decomposeTask(input) {
        const task = input.task || input.description || '';
        if (!task.trim()) return { error: 'Missing "task" to decompose.' };

        const subtasks = input.subtasks || input.tasks || [];
        if (subtasks.length === 0) {
            return {
                result: '📝 TASK DECOMPOSITION\n' +
                        '━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                        `Main task: "${task}"\n\n` +
                        'Provide subtasks array to decompose. Example:\n' +
                        '```json\n' +
                        '{\n' +
                        '  "task": "Build login page",\n' +
                        '  "subtasks": [\n' +
                        '    { "task": "Design UI mockup", "role": "designer" },\n' +
                        '    { "task": "Implement HTML/CSS", "role": "developer", "dependsOn": [0] },\n' +
                        '    { "task": "Add authentication logic", "role": "developer", "dependsOn": [1] },\n' +
                        '    { "task": "Write tests", "role": "qa", "dependsOn": [2] }\n' +
                        '  ]\n' +
                        '}\n' +
                        '```'
            };
        }

        // Validate dependencies
        const taskGraph = subtasks.map((st, idx) => ({
            id: idx,
            task: typeof st === 'string' ? st : st.task,
            role: st.role || 'developer',
            dependsOn: st.dependsOn || st.depends_on || [],
            status: 'pending',
        }));

        // Check for circular dependencies
        const visited = new Set();
        const recStack = new Set();
        function hasCycle(nodeId) {
            visited.add(nodeId);
            recStack.add(nodeId);
            for (const dep of taskGraph[nodeId]?.dependsOn || []) {
                if (!visited.has(dep) && hasCycle(dep)) return true;
                if (recStack.has(dep)) return true;
            }
            recStack.delete(nodeId);
            return false;
        }
        for (let i = 0; i < taskGraph.length; i++) {
            if (!visited.has(i) && hasCycle(i)) {
                return { error: `Circular dependency detected involving task ${i}. Fix dependsOn references.` };
            }
        }

        let report = `📝 TASK DECOMPOSITION: "${task}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const t of taskGraph) {
            const role = ROLES[t.role] || { icon: '🤖', name: t.role };
            const deps = t.dependsOn.length > 0 ? ` (waits for: ${t.dependsOn.join(', ')})` : '';
            report += `  ${t.id}. ${role.icon} [${role.name}] ${t.task}${deps}\n`;
        }

        return { result: report, _taskGraph: taskGraph };
    }

    // ── Create Team ─────────────────────────────────────────
    function createTeam(input) {
        const name = input.name || `Team ${++teamCounter}`;
        const teamId = `team_${teamCounter}_${Date.now()}`;
        const strategy = input.strategy || 'parallel';

        if (!STRATEGIES[strategy]) {
            return { error: `Unknown strategy: "${strategy}". Options: ${Object.keys(STRATEGIES).join(', ')}` };
        }

        const team = {
            id: teamId,
            name: name,
            strategy: strategy,
            agentIds: [],
            agents: [],        // { agentId, role, label, status, task, result }
            taskGraph: [],     // Dependency graph
            sharedMemory: [],
            sharedContext: '', // Shared context string for all agents
            createdAt: new Date().toISOString(),
            status: 'idle',    // idle, running, paused, done, failed
            completedTasks: 0,
            totalTasks: 0,
        };

        teams[teamId] = team;

        // Auto-decompose and spawn if tasks provided
        const tasks = input.tasks || [];
        const spawnedAgents = [];

        if (tasks.length > 0) {
            // Build task graph
            team.taskGraph = tasks.map((t, idx) => ({
                id: idx,
                task: typeof t === 'string' ? t : t.task,
                role: t.role || 'developer',
                dependsOn: t.dependsOn || t.depends_on || [],
                status: 'pending',
                agentId: null,
                result: null,
            }));
            team.totalTasks = team.taskGraph.length;

            // Spawn agents based on strategy
            if (strategy === 'parallel' || strategy === 'debate') {
                // Spawn all immediately
                for (const taskNode of team.taskGraph) {
                    const spawnResult = _spawnForTask(team, taskNode, input.model, input.max_ticks);
                    if (spawnResult) spawnedAgents.push(spawnResult);
                }
            } else if (strategy === 'sequential' || strategy === 'pipeline' || strategy === 'waterfall') {
                // Only spawn tasks with no dependencies
                for (const taskNode of team.taskGraph) {
                    if (taskNode.dependsOn.length === 0) {
                        const spawnResult = _spawnForTask(team, taskNode, input.model, input.max_ticks);
                        if (spawnResult) spawnedAgents.push(spawnResult);
                    }
                }
            }

            team.status = 'running';
        }

        _savePersistent();

        return {
            result: `👥 Team "${name}" created: ${teamId}\n` +
                    `Strategy: ${STRATEGIES[strategy].name}\n` +
                    `Tasks: ${team.totalTasks}\n` +
                    (spawnedAgents.length > 0 ? `Spawned ${spawnedAgents.length} agents: ${spawnedAgents.join(', ')}` : 'No agents yet.')
        };
    }

    // ── Spawn Agent for Task ────────────────────────────────
    function _spawnForTask(team, taskNode, model, maxTicks) {
        const role = ROLES[taskNode.role] || { name: taskNode.role, icon: '🤖', systemHint: '' };

        // Build task prompt with role context
        const taskPrompt = [
            role.systemHint,
            `\nTask: ${taskNode.task}`,
            team.sharedContext ? `\nShared context: ${team.sharedContext}` : '',
            team.sharedMemory.length > 0 ? `\nTeam memory:\n${team.sharedMemory.slice(-5).map(m => `[${m.from}] ${m.content}`).join('\n')}` : '',
        ].filter(Boolean).join('\n');

        // Use FLOWORKOS_SubAgents if available (preferred)
        if (window.FLOWORKOS_SubAgents) {
            const result = window.FLOWORKOS_SubAgents.spawnSubagent({
                task: taskPrompt,
                label: `${role.icon} ${role.name} — ${taskNode.task.substring(0, 40)}`,
                model: model,
                timeoutSec: (maxTicks || 30) * 10,
            });

            if (result.status === 'accepted') {
                taskNode.agentId = result.runId;
                taskNode.status = 'running';
                team.agentIds.push(result.runId);
                team.agents.push({
                    agentId: result.runId,
                    role: taskNode.role,
                    label: result.label,
                    status: 'running',
                    task: taskNode.task,
                    result: null,
                });
                return result.runId;
            }
        }
        // Fallback to agentPool
        else if (window.agentPool) {
            const result = window.agentPool.spawnAgent({
                task: taskPrompt,
                model: model,
                max_ticks: maxTicks,
            });
            const match = result?.result?.match(/agent_\d+_\d+/);
            if (match) {
                taskNode.agentId = match[0];
                taskNode.status = 'running';
                team.agentIds.push(match[0]);
                team.agents.push({
                    agentId: match[0],
                    role: taskNode.role,
                    label: `${role.icon} ${role.name}`,
                    status: 'running',
                    task: taskNode.task,
                    result: null,
                });
                return match[0];
            }
        }
        return null;
    }

    // ── List Teams ──────────────────────────────────────────
    function listTeams(input) {
        const teamList = Object.values(teams);
        if (teamList.length === 0) return { result: 'No teams. Use create_team to create one.' };

        let report = `👥 TEAMS (${teamList.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const t of teamList) {
            const statusIcon = { idle: '⬜', running: '🔄', paused: '⏸️', done: '✅', failed: '❌' }[t.status] || '❓';
            report += `${statusIcon} ${t.name} (${t.id})\n`;
            report += `   Strategy: ${t.strategy} | Agents: ${t.agentIds.length} | Tasks: ${t.completedTasks}/${t.totalTasks}\n`;
            report += `   Memory: ${t.sharedMemory.length} entries | Created: ${t.createdAt}\n`;
        }
        return { result: report };
    }

    // ── Delete Team ─────────────────────────────────────────
    function deleteTeam(input) {
        const id = input.id || input.team_id;
        if (!id || !teams[id]) return { error: `Team "${id}" not found.` };

        // Kill all running agents
        const team = teams[id];
        for (const agentId of team.agentIds) {
            if (window.FLOWORKOS_SubAgents) {
                window.FLOWORKOS_SubAgents.killSubagent(agentId);
            }
        }

        const name = team.name;
        delete teams[id];
        _savePersistent();
        return { result: `🗑️ Team "${name}" (${id}) deleted. All agents killed.` };
    }

    // ── Share Memory ────────────────────────────────────────
    function shareMemory(input) {
        const id = input.id || input.team_id;
        if (!id || !teams[id]) return { error: `Team "${id}" not found.` };

        const data = input.data || input.memory || input.content;
        if (!data) return { error: 'Missing data to share.' };

        teams[id].sharedMemory.push({
            content: typeof data === 'string' ? data : JSON.stringify(data),
            from: input.from || 'user',
            ts: new Date().toISOString(),
        });

        // Keep last 100 memory entries per team
        if (teams[id].sharedMemory.length > 100) {
            teams[id].sharedMemory = teams[id].sharedMemory.slice(-100);
        }

        _savePersistent();
        return { result: `📝 Shared memory added to team "${teams[id].name}". Total entries: ${teams[id].sharedMemory.length}` };
    }

    // ── Sync Team ───────────────────────────────────────────
    function syncTeam(input) {
        const id = input.id || input.team_id;
        if (!id || !teams[id]) return { error: `Team "${id}" not found.` };

        const team = teams[id];
        const agentStatuses = [];

        // Gather all agent results
        for (const agent of team.agents) {
            let status = { id: agent.agentId, status: 'unknown' };

            if (window.FLOWORKOS_SubAgents) {
                const runStatus = window.FLOWORKOS_SubAgents.getRunStatus(agent.agentId);
                if (runStatus) {
                    status = runStatus;
                    agent.status = runStatus.status;
                    if (runStatus.result) agent.result = runStatus.result;
                }
            } else if (window.agentPool) {
                try {
                    const checkResult = window.agentPool.checkAgent({ id: agent.agentId });
                    const parsed = JSON.parse(checkResult.result);
                    status = parsed;
                    agent.status = parsed.status;
                    if (parsed.result) agent.result = parsed.result;
                } catch (e) {
                    status = { id: agent.agentId, status: 'unknown', error: e.message };
                }
            }

            agentStatuses.push(status);
        }

        // Update task graph statuses
        for (const taskNode of team.taskGraph) {
            if (taskNode.agentId) {
                const agentStatus = team.agents.find(a => a.agentId === taskNode.agentId);
                if (agentStatus) {
                    taskNode.status = agentStatus.status;
                    taskNode.result = agentStatus.result;
                }
            }
        }

        // Check for dependency resolution — spawn blocked tasks
        if (team.strategy === 'sequential' || team.strategy === 'pipeline' || team.strategy === 'waterfall') {
            for (const taskNode of team.taskGraph) {
                if (taskNode.status === 'pending') {
                    const depsComplete = taskNode.dependsOn.every(depId => {
                        return team.taskGraph[depId]?.status === 'done';
                    });
                    if (depsComplete) {
                        // Pipeline: inject previous task's result as context
                        if (team.strategy === 'pipeline' && taskNode.dependsOn.length > 0) {
                            const prevResults = taskNode.dependsOn
                                .map(depId => team.taskGraph[depId]?.result)
                                .filter(Boolean)
                                .join('\n');
                            if (prevResults) {
                                shareMemory({
                                    id: team.id,
                                    data: `Previous task output:\n${prevResults}`,
                                    from: 'pipeline',
                                });
                            }
                        }
                        _spawnForTask(team, taskNode, input?.model);
                    }
                }
            }
        }

        // Count completions
        team.completedTasks = team.taskGraph.filter(t => t.status === 'done').length;
        const allDone = team.taskGraph.every(t => t.status === 'done' || t.status === 'failed' || t.status === 'killed');
        if (allDone && team.totalTasks > 0) {
            team.status = team.taskGraph.some(t => t.status === 'failed') ? 'failed' : 'done';
        }

        _savePersistent();

        // Build report
        let report = `🔄 TEAM SYNC: "${team.name}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `Status: ${team.status} | Strategy: ${team.strategy}\n`;
        report += `Progress: ${team.completedTasks}/${team.totalTasks} tasks\n\n`;

        report += `📋 TASK GRAPH:\n`;
        for (const t of team.taskGraph) {
            const icon = { pending: '⬜', running: '🔄', done: '✅', failed: '❌', killed: '🛑' }[t.status] || '❓';
            const role = ROLES[t.role] || { icon: '🤖', name: t.role };
            const deps = t.dependsOn.length > 0 ? ` ← depends on [${t.dependsOn.join(',')}]` : '';
            report += `  ${icon} ${t.id}. ${role.icon} ${t.task.substring(0, 60)}${deps}\n`;
            if (t.result) {
                const resultStr = typeof t.result === 'string' ? t.result : JSON.stringify(t.result);
                report += `     → ${resultStr.substring(0, 150)}\n`;
            }
        }

        if (team.sharedMemory.length > 0) {
            report += `\n📝 SHARED MEMORY (${team.sharedMemory.length} entries):\n`;
            for (const mem of team.sharedMemory.slice(-5)) {
                report += `  [${mem.from}] ${mem.content.substring(0, 100)}\n`;
            }
        }

        return { result: report };
    }

    // ── Agent Templates ─────────────────────────────────────
    function saveTemplate(input) {
        const name = input.name || input.template_name;
        if (!name) return { error: 'Missing template "name"' };

        const templateId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        _templates[templateId] = {
            id: templateId,
            name: name,
            role: input.role || 'developer',
            model: input.model || 'inherit',
            tools: input.tools || [],
            systemPrompt: input.system_prompt || input.systemPrompt || '',
            maxTicks: input.max_ticks || 30,
            createdAt: new Date().toISOString(),
        };

        _saveTemplates();
        return { result: `💾 Agent template "${name}" saved (${templateId})` };
    }

    function listTemplates(input) {
        const templateList = Object.values(_templates);
        const builtinRoles = Object.entries(ROLES);

        let report = `📋 AGENT TEMPLATES\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        report += `\n🏭 Built-in Roles:\n`;
        for (const [id, role] of builtinRoles) {
            report += `  ${role.icon} ${role.name} (${id}) — ${role.description}\n`;
        }

        if (templateList.length > 0) {
            report += `\n💾 Custom Templates:\n`;
            for (const t of templateList) {
                const role = ROLES[t.role] || { icon: '🤖' };
                report += `  ${role.icon} ${t.name} (${t.id}) — Role: ${t.role}, Model: ${t.model}\n`;
            }
        }

        return { result: report };
    }

    function deleteTemplate(input) {
        const id = input.id || input.template_id;
        if (!id || !_templates[id]) return { error: `Template "${id}" not found.` };
        const name = _templates[id].name;
        delete _templates[id];
        _saveTemplates();
        return { result: `🗑️ Template "${name}" deleted.` };
    }

    // ── Team Pause/Resume ───────────────────────────────────
    function pauseTeam(input) {
        const id = input.id || input.team_id;
        if (!id || !teams[id]) return { error: `Team "${id}" not found.` };
        teams[id].status = 'paused';
        _savePersistent();
        return { result: `⏸️ Team "${teams[id].name}" paused.` };
    }

    function resumeTeam(input) {
        const id = input.id || input.team_id;
        if (!id || !teams[id]) return { error: `Team "${id}" not found.` };
        teams[id].status = 'running';
        _savePersistent();

        // Re-trigger sync to spawn pending tasks
        return syncTeam({ id });
    }

    // ── List Roles ──────────────────────────────────────────
    function listRoles(input) {
        let report = `👥 AVAILABLE ROLES\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const [id, role] of Object.entries(ROLES)) {
            report += `${role.icon} ${role.name} (${id})\n`;
            report += `   ${role.description}\n`;
            report += `   Tools: ${role.allowedTools.join(', ')}\n\n`;
        }
        return { result: report };
    }

    // ── List Strategies ─────────────────────────────────────
    function listStrategies(input) {
        let report = `🎯 TEAM STRATEGIES\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const [id, strat] of Object.entries(STRATEGIES)) {
            report += `  📌 ${strat.name} (${id}) — ${strat.description}\n`;
        }
        return { result: report };
    }

    // ── Expose ──────────────────────────────────────────────
    window.teamManager = {
        // Core
        createTeam,
        listTeams,
        deleteTeam,
        shareMemory,
        syncTeam,
        // v2: Task decomposition
        decomposeTask,
        // v2: Templates
        saveTemplate,
        listTemplates,
        deleteTemplate,
        // v2: Control
        pauseTeam,
        resumeTeam,
        // v2: Info
        listRoles,
        listStrategies,
        // v2: Constants
        ROLES,
        STRATEGIES,
    };

    // Load persistent state
    _loadPersistent();

    console.log('[Brain] ✅ Team Manager v2 loaded (roles, strategies, templates, dependency graphs)');

})();
