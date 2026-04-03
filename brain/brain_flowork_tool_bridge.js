// =========================================================================
// FLOWORK OS — Brain Tool Bridge
// Bridges brain adapter's tool_use blocks to the EXISTING 5000-line
// tool dispatch in agent_engine.js. This gives the brain "hands".
//
// Strategy: Instead of reimplementing all tool handlers, we directly
// call the old engine's processing code for each action.
// =========================================================================

(function() {
    'use strict';

    // ─── REFERENCE: The old engine stores tool handler logic inside agentTick.
    // We can't extract it directly, but we CAN simulate the execution by:
    // 1. Pushing the action to chatHistory as 'agent' role
    // 2. Triggering the engine's loop handler
    //
    // BETTER: We create a standalone dispatch function that mirrors the old
    // engine's if/else chain, but calls the SAME underlying APIs.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Execute a Flowork action using the OLD engine's proven logic.
     * This wraps the existing window.* functions and IPC calls.
     *
     * @param {string} actionType - Tool name (write_files, click_element, etc.)
     * @param {object} input - Tool input parameters
     * @returns {Promise<{result: string, error?: string}>}
     */
    // ═══ SMART ROUTER — Runtime vs File dispatch intelligence ═══════════
    const _STARTUP_MODULES = [
        'brain_flowork_adapter', 'brain_flowork_tool_bridge',
        'brain_flowork_tool_registry', 'brain_flowork_config',
        'brain_flowork_evolution', 'brain_flowork_permissions',
        'brain_flowork_native_dispatcher', 'brain_flowork_memory_bridge',
        'brain_flowork_features', 'brain_flowork_self_heal',
        'brain_flowork_agents', 'brain_flowork_review',
        'brain_flowork_nas', 'brain_flowork_synthesizer',
    ];

    function _smartRouteCheck(toolName, input) {
        // Case 1: js_code targeting a startup module → BLOCK
        if (toolName === 'js_code' && typeof input?.code === 'string') {
            const code = input.code;
            const targetsStartup = _STARTUP_MODULES.some(m =>
                code.includes(m) || code.includes(`window.${m.replace('brain_flowork_', '')}`)
            );
            if (targetsStartup) {
                return {
                    blocked: true,
                    error: `[SMART-ROUTE] Cannot patch startup module via js_code — it was loaded once at boot. ` +
                           `Use write_files to modify the source file, then the user must restart. ` +
                           `Runtime patches to brain/ modules are ineffective.`
                };
            }
        }

        // Case 2: write_files / patch_file targeting brain/ → Add restart warning
        if (['write_files', 'patch_file', 'smart_patch'].includes(toolName)) {
            const path = input?.path || input?.file_path || '';
            if (path.includes('/brain/') || path.includes('\\brain\\')) {
                const isBrainCore = _STARTUP_MODULES.some(m => path.includes(m));
                if (isBrainCore) {
                    if (window.chatHistory) {
                        window.chatHistory.push({
                            role: 'system',
                            content: `[SMART-ROUTE] ⚠️ You modified a brain core file (${path.split(/[/\\]/).pop()}). Changes take effect after app restart.`
                        });
                    }
                }
            }
        }

        return { blocked: false };
    }

    function _productionSandboxCheck(toolName, input) {
        const writeTools = [
            'write_files', 'patch_file', 'smart_patch', 'delete_file', 
            'rename_file', 'dev_write_file', 'dev_patch_file', 'run_command', 
            'terminal_start', 'terminal_input'
        ];

        if (!writeTools.includes(toolName)) {
            return { blocked: false };
        }

        const pathLib = window.originalNodeRequire ? window.originalNodeRequire('path') : (typeof require !== 'undefined' ? require('path') : null);
        if (!pathLib) return { blocked: false }; // Fallback if no node
        
        const engineRoot = window.floworkEngineRoot || 'C:\\flowork\\ENGINE';

        const allowedCrudFolders = [
            'brain_extensions', 'models', 'nodes', 
            'tools', 'workspace', 'workflows'
        ].map(f => pathLib.join(engineRoot, f).toLowerCase());

        const allowedCreateFolder = pathLib.join(engineRoot, 'runtimes').toLowerCase();

        // Extract native shell dangerous ops
        if (arguments[0] === 'run_command' || arguments[0] === 'terminal_start' || arguments[0] === 'terminal_input') {
            const cmdStr = (input?.command || input?.input || '').toLowerCase().trim();
            // Block shell deletion/rename commands to force AI through strictly-sandboxed native tools
            if (/(^|\s)(rm|del|rmdir|rd|mv|rename|remove-item)\s/i.test(cmdStr)) {
                return {
                    blocked: true,
                    error: `[SECURITY SANDBOX] Terminal command blocked. In Production Mode, you MUST use native AI tools (delete_file / rename_file) to alter files so the Sandbox can audit them.`
                };
            }
            return { blocked: false };
        }

        let targetPaths = [];
        if (input?.file) targetPaths.push(input.file);
        if (input?.path) targetPaths.push(input.path);
        if (input?.file_path) targetPaths.push(input.file_path);
        if (input?.old_name) targetPaths.push(input.old_name);
        if (input?.new_name) targetPaths.push(input.new_name);

        if (input?.files && typeof input.files === 'object') {
            targetPaths.push(...Object.keys(input.files));
        }

        for (let p of targetPaths) {
            if (!p) continue;
            
            let absPath = pathLib.isAbsolute(p) ? p : pathLib.join(engineRoot, p);
            absPath = absPath.toLowerCase();

            let isCrudAllowed = allowedCrudFolders.some(allowed => absPath.startsWith(allowed + pathLib.sep) || absPath === allowed);
            let isCreateOnly = absPath.startsWith(allowedCreateFolder + pathLib.sep) || absPath === allowedCreateFolder;

            if (!isCrudAllowed && !isCreateOnly) {
                return {
                    blocked: true,
                    error: `[SECURITY SANDBOX] Modifying path '${p}' is BLOCKED in Production. Agent only has CRUD access to: /brain_extensions, /models, /nodes, /tools, /workspace, /workflows.`
                };
            }

            if (isCreateOnly) {
                const isCreationTool = toolName === 'write_files' || toolName === 'dev_write_file';
                if (!isCreationTool) {
                    return {
                        blocked: true,
                        error: `[SECURITY SANDBOX] Modifying path '${p}' in /runtimes is BLOCKED. Sandbox rule: You can only CREATE files inside /runtimes. Deleting, editing, or renaming is strictly forbidden.`
                    };
                }
            }
        }

        return { blocked: false };
    }

    window.brainToolBridge = async function(actionType, input) {
        const act = { action: actionType, ...input };
        let toolResultStr = '';

        try {
            // ═══ SMART ROUTE CHECK — Block runtime patches to startup modules ═══
            const routeCheck = _smartRouteCheck(actionType, input);
            if (routeCheck.blocked) {
                console.warn(`[SmartRoute] Blocked: ${routeCheck.error}`);
                return { error: routeCheck.error };
            }

            // ═══ PRODUCTION SANDBOX CHECK ═══
            const sandboxCheck = _productionSandboxCheck(actionType, input);
            if (sandboxCheck.blocked) {
                console.warn(`[Sandbox] Action blocked: ${actionType} -> ${sandboxCheck.error}`);
                if (window.appendToolMessage) window.appendToolMessage(actionType, 'error', sandboxCheck.error);
                return { error: sandboxCheck.error };
            }

            // ═══════════════════════════════════════════════════════════════
            // DEV MODE TOOLS — Full Engine Access (self-evolution)
            // Only available when running from source, NOT in EXE build
            // ═══════════════════════════════════════════════════════════════

            if (actionType === 'dev_read_file') {
                if (!window.floworkDevMode) return { error: '🔒 DEV MODE required. This tool is disabled in published builds.' };
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const filePath = act.path || act.file || '';
                    const root = window.floworkEngineRoot || __dirname;
                    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
                    // Security: Must be within engine root
                    if (!fullPath.startsWith(root) && !fullPath.startsWith(path.dirname(root))) {
                        return { error: `Access denied. Path must be within ${root}` };
                    }
                    if (!fs.existsSync(fullPath)) return { error: `File not found: ${filePath}` };
                    const stat = fs.statSync(fullPath);
                    if (stat.size > 500000) return { error: `File too large: ${(stat.size/1024).toFixed(0)}KB (max 500KB)` };
                    const content = fs.readFileSync(fullPath, 'utf8');
                    if (window.appendToolMessage) window.appendToolMessage('dev_read_file', 'success', `🔧 ${path.basename(fullPath)}`);
                    return { result: content };
                } catch(e) { return { error: e.message }; }
            }

            if (actionType === 'dev_write_file') {
                if (!window.floworkDevMode) return { error: '🔒 DEV MODE required. This tool is disabled in published builds.' };
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const filePath = act.path || act.file || '';
                    const content = act.content || '';
                    const root = window.floworkEngineRoot || __dirname;
                    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
                    if (!fullPath.startsWith(root) && !fullPath.startsWith(path.dirname(root))) {
                        return { error: `Access denied. Path must be within ${root}` };
                    }
                    // Create parent dirs if needed
                    const dir = path.dirname(fullPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    // Backup existing file before overwrite
                    if (fs.existsSync(fullPath)) {
                        const bakDir = path.join(root, '_bak', 'dev_edits');
                        if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
                        const bakName = `${path.basename(fullPath)}.${Date.now()}.bak`;
                        fs.copyFileSync(fullPath, path.join(bakDir, bakName));
                    }
                    fs.writeFileSync(fullPath, content, 'utf8');
                    if (window.appendToolMessage) window.appendToolMessage('dev_write_file', 'success', `🔧✏️ ${path.basename(fullPath)}`);
                    return { result: `DEV file written: ${filePath} (${content.length} chars). Backup saved.` };
                } catch(e) { return { error: e.message }; }
            }

            if (actionType === 'dev_patch_file') {
                if (!window.floworkDevMode) return { error: '🔒 DEV MODE required.' };
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const filePath = act.path || act.file || '';
                    const root = window.floworkEngineRoot || __dirname;
                    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
                    if (!fullPath.startsWith(root) && !fullPath.startsWith(path.dirname(root))) {
                        return { error: `Access denied.` };
                    }
                    if (!fs.existsSync(fullPath)) return { error: `File not found: ${filePath}` };
                    let content = fs.readFileSync(fullPath, 'utf8');
                    // Backup
                    const bakDir = path.join(root, '_bak', 'dev_edits');
                    if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
                    fs.copyFileSync(fullPath, path.join(bakDir, `${path.basename(fullPath)}.${Date.now()}.bak`));
                    // Apply patches
                    const patches = act.patches || [{ search: act.search, replace: act.replace }];
                    let applied = 0;
                    for (const p of patches) {
                        if (content.includes(p.search)) {
                            content = content.replace(p.search, p.replace);
                            applied++;
                        }
                    }
                    if (applied === 0) return { error: `No patches matched in ${filePath}` };
                    fs.writeFileSync(fullPath, content, 'utf8');
                    if (window.appendToolMessage) window.appendToolMessage('dev_patch_file', 'success', `🔧✏️ ${applied} patches in ${path.basename(fullPath)}`);
                    return { result: `Patched ${filePath}: ${applied}/${patches.length} patches applied. Backup saved.` };
                } catch(e) { return { error: e.message }; }
            }

            if (actionType === 'dev_list_dir') {
                if (!window.floworkDevMode) return { error: '🔒 DEV MODE required.' };
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const dirPath = act.path || act.folder || '.';
                    const root = window.floworkEngineRoot || __dirname;
                    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(root, dirPath);
                    if (!fs.existsSync(fullPath)) return { error: `Directory not found: ${dirPath}` };
                    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
                    const items = entries.map(e => {
                        if (e.isDirectory()) {
                            const children = fs.readdirSync(path.join(fullPath, e.name)).length;
                            return `📂 ${e.name}/ (${children} items)`;
                        }
                        const size = fs.statSync(path.join(fullPath, e.name)).size;
                        return `📄 ${e.name} (${size > 1024 ? (size/1024).toFixed(0) + 'KB' : size + 'B'})`;
                    });
                    return { result: `Contents of ${dirPath}/:\n${items.join('\n')}` };
                } catch(e) { return { error: e.message }; }
            }

            if (actionType === 'dev_search') {
                if (!window.floworkDevMode) return { error: '🔒 DEV MODE required.' };
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const query = act.query || act.search || '';
                    const root = window.floworkEngineRoot || __dirname;
                    const targetDir = act.path ? (path.isAbsolute(act.path) ? act.path : path.join(root, act.path)) : root;
                    const ext = act.ext || '.js';
                    const results = [];
                    function searchDir(dir, depth) {
                        if (depth > 4 || results.length >= 30) return;
                        try {
                            const entries = fs.readdirSync(dir, { withFileTypes: true });
                            for (const e of entries) {
                                if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_bak') continue;
                                const full = path.join(dir, e.name);
                                if (e.isDirectory()) { searchDir(full, depth + 1); continue; }
                                if (!e.name.endsWith(ext)) continue;
                                try {
                                    const content = fs.readFileSync(full, 'utf8');
                                    const lines = content.split('\n');
                                    for (let i = 0; i < lines.length; i++) {
                                        if (lines[i].includes(query)) {
                                            results.push({ file: path.relative(root, full), line: i + 1, text: lines[i].trim().substring(0, 120) });
                                            if (results.length >= 30) return;
                                        }
                                    }
                                } catch(x) {}
                            }
                        } catch(x) {}
                    }
                    searchDir(targetDir, 0);
                    if (window.appendToolMessage) window.appendToolMessage('dev_search', 'success', `🔍 ${results.length} matches`);
                    return { result: results.length ? JSON.stringify(results) : `No matches for "${query}" in ${ext} files` };
                } catch(e) { return { error: e.message }; }
            }

            if (actionType === 'dev_tree') {
                if (!window.floworkDevMode) return { error: '🔒 DEV MODE required.' };
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const root = window.floworkEngineRoot || __dirname;
                    const targetDir = act.path ? path.join(root, act.path) : root;
                    const lines = [];
                    function tree(dir, prefix, depth) {
                        if (depth > 2 || lines.length > 100) return;
                        const entries = fs.readdirSync(dir, { withFileTypes: true })
                            .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '_bak')
                            .sort((a, b) => a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1);
                        entries.forEach((e, i) => {
                            const isLast = i === entries.length - 1;
                            const connector = isLast ? '└── ' : '├── ';
                            if (e.isDirectory()) {
                                lines.push(`${prefix}${connector}📂 ${e.name}/`);
                                tree(path.join(dir, e.name), prefix + (isLast ? '    ' : '│   '), depth + 1);
                            } else {
                                const size = fs.statSync(path.join(dir, e.name)).size;
                                lines.push(`${prefix}${connector}${e.name} (${size > 1024 ? (size/1024).toFixed(0)+'KB' : size+'B'})`);
                            }
                        });
                    }
                    tree(targetDir, '', 0);
                    return { result: `Engine tree:\n${lines.join('\n')}` };
                } catch(e) { return { error: e.message }; }
            }

            if (actionType === 'dev_status') {
                return {
                    result: JSON.stringify({
                        devMode: !!window.floworkDevMode,
                        engineRoot: window.floworkEngineRoot || 'unknown',
                        platform: typeof process !== 'undefined' ? process.platform : 'browser',
                        nodeVersion: typeof process !== 'undefined' ? process.version : 'N/A',
                        electronVersion: typeof process !== 'undefined' ? process.versions?.electron : 'N/A',
                        totalToolsInBridge: 89,
                        brainModules: ['adapter', 'config', 'evolution', 'llm_adapter', 'memory_bridge', 'self_heal', 'tool_bridge', 'tool_registry'],
                    })
                };
            }

            // ═══ CHAT / CONTROL ═══
            if (actionType === 'chat' || actionType === 'send_message') {
                const msg = act.message || '';
                if (window.appendChatMessage) window.appendChatMessage('agent', msg);
                return { result: msg, _controlKeywords: _extractKeywords(msg) };
            }

            if (actionType === 'ask_user') {
                const q = act.question || act.message || '';
                if (window.appendChatMessage) window.appendChatMessage('agent', q);
                return { result: q, _controlKeywords: { waitingApproval: true } };
            }

            // ═══ ROADMAP / TODO ═══
            if (actionType === 'update_roadmap') {
                if (act.project_id) {
                    window.currentAppId = act.project_id;
                }
                window.roadmap = act.tasks || [];
                if (window.renderRoadmap) window.renderRoadmap();
                if (window.appendToolMessage) window.appendToolMessage('update_roadmap', 'success', `📋 ${(act.tasks || []).length} tasks`);
                return { result: `Roadmap updated with ${(act.tasks || []).length} tasks.` };
            }

            if (actionType === 'todo_write') {
                const todos = act.todos || [];
                if (window._floworkTodos !== undefined) {
                    window._floworkTodos = todos;
                }
                if (window.appendToolMessage) window.appendToolMessage('todo_write', 'success', `✅ ${todos.length} items`);
                return { result: `Todo list updated: ${todos.length} items.` };
            }

            if (actionType === 'todo_list') {
                return { result: JSON.stringify(window._floworkTodos || []) };
            }

            // ═══ FILE OPERATIONS (Go API :5000) ═══
            if (actionType === 'write_files') {
                const files = act.files || {};
                const appId = window.currentAppId || 'default';
                const outputType = window.getEl?.('select-output-type')?.value || 'app';
                const res = await fetch('http://127.0.0.1:5000/api/ai-write', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ output_type: outputType, app_id: appId, files })
                });
                const data = await res.json();
                // Update UI
                if (data.status === 'success') {
                    window.generatedFiles = { ...(window.generatedFiles || {}), ...files };
                    if (window.renderFileTabs) window.renderFileTabs();
                    const fileKeys = Object.keys(files);
                    const fileList = fileKeys.join(', ');
                    
                    // Auto-open IDE for visual feedback
                    if (window.showIDEMode) window.showIDEMode();
                    if (window.renderIDEFiles) window.renderIDEFiles();
                    if (fileKeys.length > 0 && window.openFileContent) {
                        window.openFileContent(fileKeys[0], files[fileKeys[0]]);
                    }

                    if (window.appendToolMessage) window.appendToolMessage('write_files', 'success', `📁 ${fileList}`);
                    return { result: `Files written: ${fileList}` };
                }
                return { error: data.message || 'write_files failed' };
            }

            if (actionType === 'patch_file' || actionType === 'smart_patch') {
                const appId = window.currentAppId || 'default';
                const outputType = window.getEl?.('select-output-type')?.value || 'app';
                let body;
                if (actionType === 'smart_patch') {
                    body = { output_type: outputType, app_id: appId, file: act.file, patches: act.patches };
                } else {
                    body = { output_type: outputType, app_id: appId, file: act.file, search: act.search, replace: act.replace };
                }
                const res = await fetch('http://127.0.0.1:5000/api/ai-write', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (data.status === 'success') {
                    if (window.appendToolMessage) window.appendToolMessage(actionType, 'success', `✏️ ${act.file}`);
                    return { result: `${act.file} patched successfully.` };
                }
                return { error: data.message || `${actionType} failed` };
            }

            if (actionType === 'read_file') {
                const file = act.file || '';
                if (!file) {
                    // List project files
                    const appId = window.currentAppId || 'default';
                    const outputType = window.getEl?.('select-output-type')?.value || 'app';
                    const res = await fetch(`http://127.0.0.1:5000/api/ai-read/project?app_id=${appId}&output_type=${outputType}`);
                    const data = await res.json();
                    return { result: JSON.stringify(data) };
                }
                const appId = window.currentAppId || 'default';
                const outputType = window.getEl?.('select-output-type')?.value || 'app';
                const res = await fetch(`http://127.0.0.1:5000/api/ai-read/file?app_id=${appId}&output_type=${outputType}&file=${encodeURIComponent(file)}`);
                const data = await res.json();
                if (data.status === 'success') {
                    if (window.appendToolMessage) window.appendToolMessage('read_file', 'success', `📄 ${file}`);
                    return { result: data.content || JSON.stringify(data) };
                }
                return { error: data.message || 'read_file failed' };
            }

            if (actionType === 'search_files') {
                const res = await fetch('http://127.0.0.1:5000/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: act.query, app_id: window.currentAppId })
                });
                const data = await res.json();
                return { result: JSON.stringify(data) };
            }

            if (actionType === 'delete_file') {
                const res = await fetch('http://127.0.0.1:5000/api/fs/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file: act.file, app_id: window.currentAppId })
                });
                return { result: `Deleted ${act.file}` };
            }

            if (actionType === 'rename_file') {
                const res = await fetch('http://127.0.0.1:5000/api/fs/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ old_name: act.old_name, new_name: act.new_name, app_id: window.currentAppId })
                });
                return { result: `Renamed ${act.old_name} → ${act.new_name}` };
            }

            // ═══ TERMINAL (Go API) ═══
            if (actionType === 'run_command') {
                const appId = window.currentAppId || 'default';
                const outputType = window.getEl?.('select-output-type')?.value || 'app';
                const res = await fetch('http://127.0.0.1:5000/api/ai-exec', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: act.command, app_id: appId, output_type: outputType })
                });
                const data = await res.json();
                if (window.appendToolMessage) window.appendToolMessage('run_command', data.status || 'success', `💻 ${(act.command || '').substring(0, 40)}`);
                return { result: data.output || data.stdout || JSON.stringify(data) };
            }

            if (actionType === 'terminal_start') {
                const res = await fetch('http://127.0.0.1:5000/api/terminal/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: act.command, session_id: act.session_id })
                });
                return await res.json();
            }

            if (actionType === 'terminal_status') {
                const res = await fetch(`http://127.0.0.1:5000/api/terminal/status?session_id=${act.session_id}`);
                return await res.json();
            }

            if (actionType === 'terminal_input') {
                const res = await fetch('http://127.0.0.1:5000/api/terminal/input', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: act.session_id, input: act.input })
                });
                return await res.json();
            }

            if (actionType === 'terminal_kill') {
                const res = await fetch('http://127.0.0.1:5000/api/terminal/kill', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: act.session_id })
                });
                return await res.json();
            }

            // ═══ BROWSER AUTOMATION (WebSocket IPC :5001) ═══
            if (actionType === 'open_browser_tab') {
                const tabId = act.tab_id || act.tabId || act.label || `ai_tab_${Date.now()}`;
                const url = act.url || 'about:blank';
                const res = await window.wsCommand('open_ai_tab', { tabId, url, label: act.label || tabId });
                window.activeAppBrowserTabId = tabId;
                if (window.appendToolMessage) window.appendToolMessage('open_browser_tab', 'success', `🌐 ${tabId}`);
                return { result: `Browser tab "${tabId}" opened at ${url}. Use tabId "${tabId}" for all browser tools.` };
            }

            if (actionType === 'close_browser_tab') {
                const tabId = act.tab_id || act.tabId;
                await window.wsCommand('close_ai_tab', { tabId });
                if (window.appendToolMessage) window.appendToolMessage('close_browser_tab', 'success', `🗑️ ${tabId}`);
                return { result: `Tab "${tabId}" closed.` };
            }

            if (actionType === 'navigate_browser') {
                let url = act.url || '';
                const tabId = act.tab_id || act.tabId || window.activeAppBrowserTabId;
                if (!url.startsWith('http')) url = 'https://' + url;
                await window.wsCommand('ai_navigate', { tabId, url });
                if (window.appendToolMessage) window.appendToolMessage('navigate_browser', 'success', `🧭 ${url.substring(0, 40)}`);
                return { result: `Navigating "${tabId}" to ${url}. Wait 2-3 seconds then use capture_browser to see the result.` };
            }

            if (actionType === 'capture_browser') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                if (!tabId) return { error: 'No tabId. Use list_browsers first.' };
                const res = await window.wsCommand('capture_browser', { tabId });
                if (res.status === 'success') {
                    // INJECT IMAGE INTO CHAT HISTORY — this is the "eyes" fix!
                    window.chatHistory.push({
                        role: 'system',
                        content: `[Screenshot of ${tabId}]`,
                        image: res.data
                    });
                    if (window.appendChatMessage) window.appendChatMessage('agent', `📸 Screenshot of **${tabId}**:`, res.data);
                    if (window.appendToolMessage) window.appendToolMessage('capture_browser', 'success', '📸 Screenshot captured');
                    return { result: `Screenshot captured and added to your vision. Analyze the UI state to decide next action.` };
                }
                return { error: res.message || 'capture failed' };
            }

            if (actionType === 'click_element') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const selector = act.selector;
                const script = `(function(){
                    const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                    if (!el) return 'Element not found: ${selector}';
                    el.scrollIntoView({behavior:'smooth',block:'center'});
                    el.click();
                    return 'Clicked: ' + el.tagName + ' ' + (el.textContent||'').substring(0,50);
                })()`;
                const res = await window.wsCommand('execute_browser_script', { tabId, script });
                if (window.appendToolMessage) window.appendToolMessage('click_element', res.status, `👆 ${selector.substring(0, 30)}`);
                return { result: res.data || JSON.stringify(res) };
            }

            if (actionType === 'type_text') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const selector = act.selector;
                const text = act.text || '';
                const script = `(function(){
                    const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                    if (!el) return 'Element not found: ${selector}';
                    el.focus();
                    el.value = '${text.replace(/'/g, "\\'")}';
                    el.dispatchEvent(new Event('input', {bubbles:true}));
                    el.dispatchEvent(new Event('change', {bubbles:true}));
                    return 'Typed into: ' + el.tagName;
                })()`;
                const res = await window.wsCommand('execute_browser_script', { tabId, script });
                if (window.appendToolMessage) window.appendToolMessage('type_text', res.status, `⌨️ ${text.substring(0, 20)}`);
                return { result: res.data || JSON.stringify(res) };
            }

            if (actionType === 'scroll_page') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const amount = act.amount || 300;
                const direction = act.direction || 'down';
                const px = direction === 'up' ? -amount : amount;
                const script = `window.scrollBy(0, ${px}); 'Scrolled ${direction} ${amount}px'`;
                const res = await window.wsCommand('execute_browser_script', { tabId, script });
                return { result: `Scrolled ${direction} ${amount}px` };
            }

            if (actionType === 'read_dom') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const selector = act.selector || 'body';
                const script = `document.querySelector('${selector.replace(/'/g, "\\'")}')?.innerHTML?.substring(0, 10000) || 'Not found'`;
                const res = await window.wsCommand('execute_browser_script', { tabId, script });
                return { result: res.data || JSON.stringify(res) };
            }

            if (actionType === 'keyboard_event') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const key = act.key || 'Enter';
                const script = `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true})); document.activeElement.dispatchEvent(new KeyboardEvent('keyup',{key:'${key}',bubbles:true})); 'Key pressed: ${key}'`;
                const res = await window.wsCommand('execute_browser_script', { tabId, script });
                return { result: `Key pressed: ${key}` };
            }

            if (actionType === 'execute_browser_script') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const res = await window.wsCommand('execute_browser_script', { tabId, script: act.script });
                if (window.appendToolMessage) window.appendToolMessage('execute_browser_script', res.status, 'DOM Injected');
                return { result: res.data || JSON.stringify(res) };
            }

            if (actionType === 'list_browsers') {
                const res = await window.wsCommand('list_browsers', {});
                if (window.appendToolMessage) window.appendToolMessage('list_browsers', 'success', `${(res.data||[]).length} tabs`);
                return { result: JSON.stringify(res.data || res) };
            }

            if (actionType === 'get_console_logs') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const res = await window.wsCommand('get_console_logs', { tabId });
                return { result: JSON.stringify(res.data || res) };
            }

            // ═══ WORKSPACE FILE TOOLS (Node.js direct) ═══
            if (actionType === 'list_workspace') {
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const basePath = window._fmBasePath || path.join(__dirname, 'workspace');
                    const subDir = act.path || act.folder || '';
                    const targetDir = subDir ? path.join(basePath, subDir) : basePath;
                    if (!fs.existsSync(targetDir)) return { result: `Folder "${subDir || 'workspace'}" not found.` };
                    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
                    const items = entries.map(e => {
                        if (e.isDirectory()) return `📂 ${e.name}/`;
                        const size = fs.statSync(path.join(targetDir, e.name)).size;
                        return `📄 ${e.name} (${size > 1024 ? (size/1024).toFixed(0) + 'KB' : size + 'B'})`;
                    });
                    return { result: `Files in ${subDir || 'workspace'}/:\n${items.join('\n')}` };
                } catch(e) { return { error: e.message }; }
            }

            if (actionType === 'read_workspace_file') {
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const basePath = window._fmBasePath || path.join(__dirname, 'workspace');
                    const filePath = act.path || act.file || '';
                    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(basePath, filePath);
                    if (!fs.existsSync(fullPath)) return { error: `File not found: ${filePath}` };
                    return { result: fs.readFileSync(fullPath, 'utf-8') };
                } catch(e) { return { error: e.message }; }
            }

            // ═══ KB / TOOLS (Cloud API) ═══
            if (actionType === 'kb_search') {
                const q = act.query || act.q || act.topic || '';
                // If empty query, fallback to kb_list (Cloudflare rejects empty q)
                if (!q.trim()) {
                    const res = await fetch(`https://floworkos.com/api/v1/kb/list?limit=${act.limit || 50}`);
                    return { result: JSON.stringify(await res.json()) };
                }
                const res = await fetch(`https://floworkos.com/api/v1/kb/search?q=${encodeURIComponent(q)}&limit=${act.limit || 15}`);
                const data = await res.json();
                return { result: JSON.stringify(data.results || data) };
            }

            if (actionType === 'kb_read') {
                // Worker is [id].js → params.id from URL path, NOT query string
                const articleId = act.id || act.article_id || '';
                const res = await fetch(`https://floworkos.com/api/v1/kb/${encodeURIComponent(articleId)}`);
                return { result: JSON.stringify(await res.json()) };
            }

            if (actionType === 'tools_search') {
                const res = await fetch(`https://floworkos.com/api/v1/tools/search?q=${encodeURIComponent(act.query || '')}`);
                return { result: JSON.stringify(await res.json()) };
            }

            if (actionType === 'tools_get') {
                const res = await fetch(`https://floworkos.com/api/v1/tools/read?id=${encodeURIComponent(act.id || '')}`);
                return { result: JSON.stringify(await res.json()) };
            }

            if (actionType === 'tools_save') {
                const res = await fetch('https://floworkos.com/api/v1/tools/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(act.tool || act)
                });
                return { result: JSON.stringify(await res.json()) };
            }

            // ═══ GIT ═══
            if (actionType === 'git' || actionType === 'git_commit' || actionType === 'git_push' || actionType === 'git_status' || actionType === 'git_diff') {
                const appId = window.currentAppId || 'default';
                const outputType = window.getEl?.('select-output-type')?.value || 'app';
                // Map aliased tool names to git actions
                let gitAction = act.git_action || act.action_type || actionType.replace('git_', '');
                if (actionType === 'git') gitAction = act.git_action || 'status';
                const res = await fetch('http://127.0.0.1:5000/api/git', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ app_id: appId, output_type: outputType, action: gitAction, message: act.message })
                });
                const data = await res.json();
                if (window.appendToolMessage) window.appendToolMessage('git', data.status || 'success', `🔀 ${gitAction}`);
                return { result: data.output || data.data || JSON.stringify(data) };
            }

            // ═══ COOKIES ═══
            if (actionType === 'import_cookies') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                if (!tabId) return { error: 'No tabId' };
                // Parse Netscape format
                let cookies = act.cookies || [];
                if (act.netscape) {
                    const lines = act.netscape.replace(/\\n/g, '\n').split('\n');
                    cookies = [];
                    for (const line of lines) {
                        const t = line.trim();
                        if (!t || t.startsWith('#')) continue;
                        const parts = t.split('\t');
                        if (parts.length >= 7) {
                            cookies.push({
                                url: `https://${parts[0].replace(/^\./, '')}${parts[2]}`,
                                name: parts[5], value: parts[6],
                                domain: parts[0], path: parts[2],
                                secure: parts[3] === 'TRUE'
                            });
                        }
                    }
                }
                let imported = 0;
                for (const c of cookies) {
                    try {
                        await window.wsCommand('set_cookie', { tabId, cookie: c });
                        imported++;
                    } catch(e) {}
                }
                await window.wsCommand('execute_browser_script', { tabId, script: 'window.location.reload()' });
                return { result: `🍪 Imported ${imported}/${cookies.length} cookies. Page reloaded.` };
            }

            // ═══ WORKFLOW / NODE ═══
            if (actionType === 'create_node') {
                const res = await fetch('http://127.0.0.1:5000/api/nodes/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(act)
                });
                return await res.json();
            }

            if (actionType === 'create_workflow') {
                const res = await fetch('http://127.0.0.1:5000/api/workflows/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(act)
                });
                return await res.json();
            }

            // ═══ WEB TOOLS ═══
            if (actionType === 'web_search') {
                const res = await fetch('http://127.0.0.1:5000/api/web-search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: act.query })
                });
                return await res.json();
            }

            if (actionType === 'web_fetch' || actionType === 'read_url') {
                const res = await fetch('http://127.0.0.1:5000/api/web-fetch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: act.url, method: act.method || 'GET' })
                });
                return await res.json();
            }

            // ═══ OPEN APP ═══
            if (actionType === 'open_app') {
                const appName = act.app_name || act.app || '';
                const tabId = `${appName}-${Date.now()}`;

                // Determine URL - same logic as old agent_engine
                let appUrl;
                if (act.url) {
                    appUrl = act.url;
                } else if (act.source === 'store' || act.source === 'cloud') {
                    appUrl = `https://floworkos.com/webview/flow/${appName}`;
                } else {
                    // Default: local engine serves at /local-apps/
                    appUrl = `http://127.0.0.1:5000/local-apps/${appName}/`;
                }

                // Try wsCommand first
                if (typeof window.wsCommand === 'function') {
                    const res = await window.wsCommand('open_ai_tab', { tabId, url: appUrl, label: appName });
                    if (res?.status !== 'success') {
                        // Fallback: try file:// protocol directly
                        try {
                            const path = window.originalNodeRequire('path');
                            const fs = window.originalNodeRequire('fs');
                            const localPath = path.join(__dirname, 'apps', appName, 'index.html');
                            if (fs.existsSync(localPath)) {
                                const fileUrl = `file://${localPath.replace(/\\/g, '/')}`;
                                await window.wsCommand('open_ai_tab', { tabId, url: fileUrl, label: appName });
                                appUrl = fileUrl;
                            }
                        } catch(e2) {}
                    }
                } else if (typeof window.openWebviewTab === 'function') {
                    window.openWebviewTab(appName, appName, appUrl);
                }

                window._agenticTabs = window._agenticTabs || {};
                window._agenticTabs[appName] = { tabId, url: appUrl, openedAt: Date.now() };
                window.activeAppBrowserTabId = tabId;
                const isLocal = appUrl.includes('127.0.0.1') || appUrl.includes('localhost') || appUrl.startsWith('file://');
                if (window.appendToolMessage) window.appendToolMessage('open_app', 'success', `🖥️ ${appName} (${isLocal ? 'Local' : 'Store'})`);
                return { result: `App "${appName}" opened in tab "${tabId}" at ${appUrl}. Use tabId "${tabId}" for browser tools.` };
            }

            // ═══ UTILITY ═══
            if (actionType === 'sleep' || actionType === 'wait') {
                const ms = act.duration_ms || act.seconds * 1000 || 1000;
                await new Promise(r => setTimeout(r, ms));
                return { result: `Waited ${ms}ms` };
            }

            if (actionType === 'glob') {
                try {
                    const fs = window.originalNodeRequire?.('fs') || require('fs');
                    const pathMod = window.originalNodeRequire?.('path') || require('path');

                    const pattern = act.pattern || '*';
                    const basePath = act.base_path || '.';

                    // Resolve base path relative to engine dir
                    const resolvedBase = pathMod.isAbsolute(basePath)
                        ? basePath
                        : pathMod.resolve(basePath);

                    if (!fs.existsSync(resolvedBase)) {
                        return { error: `Base path not found: ${resolvedBase}` };
                    }

                    // Convert glob pattern to regex
                    const globToRegex = (glob) => {
                        let regex = glob
                            .replace(/\./g, '\\.')
                            .replace(/\*\*/g, '{{DOUBLESTAR}}')
                            .replace(/\*/g, '[^/\\\\]*')
                            .replace(/\?/g, '[^/\\\\]')
                            .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
                        return new RegExp('^' + regex + '$', 'i');
                    };
                    const re = globToRegex(pattern);

                    // Recursive file walk (max depth 5, max 500 files)
                    const results = [];
                    const walk = (dir, depth = 0) => {
                        if (depth > 5 || results.length > 500) return;
                        try {
                            const entries = fs.readdirSync(dir, { withFileTypes: true });
                            for (const entry of entries) {
                                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                                const fullPath = pathMod.join(dir, entry.name);
                                const relPath = pathMod.relative(resolvedBase, fullPath).replace(/\\/g, '/');
                                if (entry.isDirectory()) {
                                    walk(fullPath, depth + 1);
                                } else if (re.test(relPath) || re.test(entry.name)) {
                                    results.push(relPath);
                                }
                            }
                        } catch(e) { /* permission denied, etc */ }
                    };
                    walk(resolvedBase);

                    return { result: results.length > 0
                        ? `Found ${results.length} files:\n${results.slice(0, 100).join('\n')}`
                        : `No files matched pattern "${pattern}" in ${resolvedBase}`
                    };
                } catch(e) {
                    return { error: `Glob failed: ${e.message}` };
                }
            }

            // ═══ COMPILE ═══
            if (actionType === 'compile_script' || actionType === 'compile_app') {
                const res = await fetch('http://127.0.0.1:5000/api/compile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ script_path: act.script_path, app_name: act.app_name })
                });
                return await res.json();
            }

            // ═══ PROGRESS ═══
            if (actionType === 'save_progress') {
                window.progressLog = window.progressLog || [];
                window.progressLog.push({ ...act.entry, ts: new Date().toISOString() });
                return { result: `Progress logged: ${act.entry?.description || 'entry saved'}` };
            }

            if (actionType === 'read_progress') {
                return { result: JSON.stringify(window.progressLog || []) };
            }

            // ═══ CLOSE APP ═══
            if (actionType === 'close_app') {
                const appName = act.app_name || act.app || '';
                const tabId = act.tab_id || act.tabId || (window._agenticTabs?.[appName]?.tabId);
                if (tabId && typeof window.wsCommand === 'function') {
                    await window.wsCommand('close_ai_tab', { tabId });
                    if (window._agenticTabs?.[appName]) delete window._agenticTabs[appName];
                    if (window.activeAppBrowserTabId === tabId) window.activeAppBrowserTabId = null;
                    if (window.appendToolMessage) window.appendToolMessage('close_app', 'success', `🗑️ ${appName || tabId}`);
                    return { result: `App "${appName}" (tab ${tabId}) closed.` };
                }
                return { error: 'No tab found for app: ' + appName };
            }

            // ═══ LIST INSTALLED APPS / DISCOVER APPS ═══
            if (actionType === 'list_installed_apps' || actionType === 'discover_apps') {
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const appsDir = path.join(__dirname, 'apps');
                    if (!fs.existsSync(appsDir)) return { result: 'No apps directory found.' };
                    const entries = fs.readdirSync(appsDir, { withFileTypes: true });
                    const apps = [];
                    for (const e of entries) {
                        if (!e.isDirectory()) continue;
                        const manifestPath = path.join(appsDir, e.name, 'manifest.json');
                        let manifest = { id: e.name, name: e.name };
                        try {
                            if (fs.existsSync(manifestPath)) {
                                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                            }
                        } catch(x) {}
                        const indexExists = fs.existsSync(path.join(appsDir, e.name, 'index.html'));
                        apps.push({ id: manifest.id || e.name, name: manifest.name || e.name, hasIndex: indexExists, category: manifest.category || 'unknown' });
                    }
                    if (window.appendToolMessage) window.appendToolMessage(actionType, 'success', `📱 ${apps.length} apps found`);
                    return { result: JSON.stringify(apps) };
                } catch(e) { return { error: e.message }; }
            }

            // ═══ NAVIGATE FLOWORK ═══
            if (actionType === 'navigate_flowork') {
                const page = act.page || act.target || 'dashboard';
                if (typeof window.navigateFlowork === 'function') {
                    window.navigateFlowork(page);
                    return { result: `Navigated to Flowork ${page}` };
                }
                return { error: 'navigateFlowork not available in current context' };
            }

            // ═══ EXPORT COOKIES ═══
            if (actionType === 'export_cookies') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                if (!tabId) return { error: 'No tabId' };
                const script = `document.cookie`;
                const res = await window.wsCommand('execute_browser_script', { tabId, script });
                if (window.appendToolMessage) window.appendToolMessage('export_cookies', 'success', '🍪 Cookies exported');
                return { result: res.data || JSON.stringify(res) };
            }

            // ═══ DRAG & DROP ═══
            if (actionType === 'drag_drop') {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const script = `(function(){
                    const src = document.querySelector('${(act.from_selector || '').replace(/'/g, "\\'")}');
                    const tgt = document.querySelector('${(act.to_selector || '').replace(/'/g, "\\'")}');
                    if (!src) return 'Source not found: ${act.from_selector}';
                    if (!tgt) return 'Target not found: ${act.to_selector}';
                    const srcRect = src.getBoundingClientRect();
                    const tgtRect = tgt.getBoundingClientRect();
                    const events = ['dragstart','drag','dragenter','dragover','drop','dragend'];
                    const dt = new DataTransfer();
                    src.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer:dt}));
                    tgt.dispatchEvent(new DragEvent('dragover', {bubbles:true, dataTransfer:dt}));
                    tgt.dispatchEvent(new DragEvent('drop', {bubbles:true, dataTransfer:dt}));
                    src.dispatchEvent(new DragEvent('dragend', {bubbles:true, dataTransfer:dt}));
                    return 'Drag-drop from ' + src.tagName + ' to ' + tgt.tagName;
                })()`;
                const res = await window.wsCommand('execute_browser_script', { tabId, script });
                return { result: res.data || JSON.stringify(res) };
            }

            // ═══ DOWNLOAD VIDEO ═══
            if (actionType === 'download_video') {
                const res = await fetch('http://127.0.0.1:5000/api/download-video', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: act.url, filename: act.filename })
                });
                const data = await res.json();
                if (window.appendToolMessage) window.appendToolMessage('download_video', data.status || 'success', `📥 ${act.filename || act.url}`);
                return { result: data.path || data.output || JSON.stringify(data) };
            }

            // ═══ AUTO TEST APP ═══
            if (actionType === 'auto_test_app') {
                const appName = act.app_name || act.app || window.currentAppId || 'default';
                // Open app, take screenshot, check console, report
                const tabId = `test_${appName}_${Date.now()}`;
                const appUrl = `http://127.0.0.1:5000/local-apps/${appName}/`;
                try {
                    await window.wsCommand('open_ai_tab', { tabId, url: appUrl, label: 'Test: ' + appName });
                    await new Promise(r => setTimeout(r, 3000)); // Wait for load
                    const screenshot = await window.wsCommand('capture_browser', { tabId });
                    const logs = await window.wsCommand('get_console_logs', { tabId });
                    const dom = await window.wsCommand('execute_browser_script', { tabId, script: 'document.title + " | " + document.body?.innerText?.substring(0,200)' });
                    const errors = (logs.data || []).filter(l => l.level === 'ERROR');
                    if (screenshot?.data) {
                        window.chatHistory.push({ role: 'system', content: `[Auto-Test Screenshot of ${appName}]`, image: screenshot.data });
                    }
                    await window.wsCommand('close_ai_tab', { tabId });
                    return {
                        result: `Auto-test of "${appName}": ${errors.length} errors found.\nPage title/content: ${dom.data || 'N/A'}\nErrors: ${errors.map(e => e.message).join('; ') || 'None'}`
                    };
                } catch(e) { return { error: 'Auto-test failed: ' + e.message }; }
            }

            // ═══ LOAD PROJECT CONTEXT ═══
            if (actionType === 'load_project_context') {
                try {
                    const fs = window.originalNodeRequire('fs');
                    const path = window.originalNodeRequire('path');
                    const appId = act.app_id || act.project_id || window.currentAppId || 'default';
                    const outputType = window.getEl?.('select-output-type')?.value || 'app';
                    const baseDir = path.join(__dirname, 'apps', appId);
                    if (!fs.existsSync(baseDir)) return { error: `Project "${appId}" not found in apps/` };
                    const files = {};
                    const entries = fs.readdirSync(baseDir);
                    for (const f of entries) {
                        const fp = path.join(baseDir, f);
                        const stat = fs.statSync(fp);
                        if (stat.isFile() && stat.size < 50000) {
                            files[f] = fs.readFileSync(fp, 'utf8');
                        } else if (stat.isFile()) {
                            files[f] = `[FILE: ${(stat.size/1024).toFixed(0)}KB — too large to load]`;
                        }
                    }
                    return { result: JSON.stringify({ project: appId, files }) };
                } catch(e) { return { error: e.message }; }
            }

            // ═══ KB PUBLISH / UPDATE / LIST ═══
            if (actionType === 'kb_publish') {
                // Worker expects: { article: { id, title, ... }, change_reason? }
                // AI may send flat or nested — normalize here
                const articleData = act.article || {
                    id: act.id,
                    title: act.title,
                    tags: act.tags,
                    category: act.category,
                    type: act.type,
                    language: act.language,
                    summary: act.summary,
                    architecture: act.architecture,
                    key_patterns: act.key_patterns,
                    files_structure: act.files_structure,
                    code_snippets: act.code_snippets,
                    common_errors: act.common_errors,
                    article_body: act.article_body || act.content || act.body,
                    keywords: act.keywords,
                };
                const payload = {
                    article: articleData,
                    change_reason: act.change_reason || act.reason || '',
                };
                const res = await fetch('https://floworkos.com/api/v1/kb/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (window.appendToolMessage) window.appendToolMessage('kb_publish', data.status || 'success', `📝 Published`);
                return { result: JSON.stringify(data) };
            }

            if (actionType === 'kb_update') {
                // Same fix as kb_publish — wrap in { article: {...} }
                const articleData = act.article || {
                    id: act.id,
                    title: act.title,
                    tags: act.tags,
                    category: act.category,
                    type: act.type,
                    language: act.language,
                    summary: act.summary,
                    architecture: act.architecture,
                    key_patterns: act.key_patterns,
                    files_structure: act.files_structure,
                    code_snippets: act.code_snippets,
                    common_errors: act.common_errors,
                    article_body: act.article_body || act.content || act.body,
                    keywords: act.keywords,
                };
                const payload = {
                    article: articleData,
                    change_reason: act.change_reason || act.reason || '',
                };
                const res = await fetch('https://floworkos.com/api/v1/kb/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (window.appendToolMessage) window.appendToolMessage('kb_update', data.status || 'success', `📝 Updated`);
                return { result: JSON.stringify(data) };
            }

            if (actionType === 'kb_list' || actionType === 'list_knowledge') {
                const category = act.category ? `&category=${encodeURIComponent(act.category)}` : '';
                const limit = act.limit || 100;
                const res = await fetch(`https://floworkos.com/api/v1/kb/list?limit=${limit}${category}`);
                const data = await res.json();
                return { result: JSON.stringify(data) };
            }

            if (actionType === 'save_knowledge') {
                // Alias for kb_publish
                const articleData = act.article || {
                    id: act.id,
                    title: act.title,
                    tags: act.tags,
                    category: act.category || 'general',
                    language: act.language || 'javascript',
                    summary: act.summary || act.content,
                    article_body: act.article_body || act.content || act.body,
                };
                const payload = { article: articleData, change_reason: act.change_reason || '' };
                const res = await fetch('https://floworkos.com/api/v1/kb/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                return { result: JSON.stringify(await res.json()) };
            }

            if (actionType === 'recall_knowledge') {
                // Alias for kb_search
                const q = act.query || act.q || act.topic || '';
                const res = await fetch(`https://floworkos.com/api/v1/kb/search?q=${encodeURIComponent(q)}&limit=${act.limit || 15}`);
                const data = await res.json();
                return { result: JSON.stringify(data.results || data) };
            }

            // ═══ CONFIG (wire to brain config) ═══
            if (actionType === 'get_config') {
                if (window.getConfig) {
                    const key = act.key;
                    if (key) return { result: JSON.stringify({ [key]: window.getConfig(key) }) };
                    return { result: JSON.stringify(window.getConfig()) };
                }
                return { error: 'Config module not loaded' };
            }

            if (actionType === 'set_config') {
                if (window.setConfig) {
                    window.setConfig(act.key, act.value);
                    return { result: `Config "${act.key}" set to "${act.value}"` };
                }
                return { error: 'Config module not loaded' };
            }

            // ═══ EVOLVED TOOL EXECUTION (Sandboxed) ═══
            const evolvedTool = window.brainToolRegistry && window.brainToolRegistry[actionType];
            if (evolvedTool && evolvedTool.custom && evolvedTool.handler === 'js_code') {
                // 🔒 DEV mode check
                if (!window.floworkDevMode) {
                    return { error: '🔒 Evolved tools only execute in DEV mode.' };
                }

                try {
                    // 🔒 Build sandboxed scope — only safe, read-only APIs
                    const _safeToolProxy = async (toolName, toolInput) => {
                        // Block evolution/destructive tools from sandbox
                        if (window.brainEvolution?.isToolBlockedInSandbox?.(toolName)) {
                            throw new Error(`🔒 Tool "${toolName}" is blocked inside evolved tools (anti-recursion).`);
                        }
                        // Allow calling safe tools (read_file, search, etc)
                        if (window.brainToolBridge) {
                            return await window.brainToolBridge(toolName, toolInput);
                        }
                        throw new Error('Tool bridge not available');
                    };

                    const safeScope = {
                        // Data processing
                        JSON, Math, Date, Array, Object, String, Number, RegExp, Map, Set,
                        parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
                        // Async
                        Promise,
                        // Console (safe)
                        console: { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) },
                        // Tool calling (safe proxy with evolution isolation)
                        callTool: _safeToolProxy,
                        // Read-only Flowork context
                        chatHistory: JSON.parse(JSON.stringify(window.chatHistory || [])),
                        // BLOCKED — undefined prevents access
                        window: undefined, document: undefined, globalThis: undefined,
                        require: undefined, process: undefined, global: undefined,
                        fetch: undefined, XMLHttpRequest: undefined, WebSocket: undefined,
                        localStorage: undefined, sessionStorage: undefined, indexedDB: undefined,
                        eval: undefined, Function: undefined, setTimeout: undefined, setInterval: undefined,
                    };

                    // Execute with timeout
                    const _execPromise = new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('⏰ Evolved tool timeout (5s limit)')), 5000);
                        try {
                            const fn = new Function('input', 'scope', 'callTool',
                                `"use strict"; with(scope) { return (async function() { ${evolvedTool.code} })(); }`
                            );
                            Promise.resolve(fn(input, safeScope, _safeToolProxy))
                                .then(r => { clearTimeout(timer); resolve(r); })
                                .catch(e => { clearTimeout(timer); reject(e); });
                        } catch(e) {
                            clearTimeout(timer);
                            reject(e);
                        }
                    });

                    const result = await _execPromise;
                    if (window.appendToolMessage) window.appendToolMessage(actionType, 'success', `🧬 Evolved Tool Executed (sandboxed)`);
                    return { result: typeof result === 'string' ? result : JSON.stringify(result) };
                } catch(e) {
                    return { error: `Evolved tool "${actionType}" failed: ${e.message}` };
                }
            }

            // ═══ FALLBACK: Use brainToolRegistry routing ═══
            if (window.brainToolRegistry && window.brainToolRegistry[actionType]) {
                return await window.brainExecuteTool(actionType, input);
            }

            return { error: `Unknown tool: ${actionType}` };

        } catch(err) {
            console.error(`[ToolBridge] ${actionType} error:`, err);
            if (window.appendToolMessage) window.appendToolMessage(actionType, 'error', err.message);
            return { error: err.message };
        }
    };

    // ─── Extract control keywords from chat message ───
    function _extractKeywords(msg) {
        const upper = (msg || '').toUpperCase();
        return {
            taskComplete: upper.includes('[TASK_COMPLETE]'),
            waitingApproval: upper.includes('[WAITING_APPROVAL]'),
            autoContinue: upper.includes('[AUTO_CONTINUE]'),
        };
    }

    // ─── Register window.globTool for agent_engine.js compatibility ───
    window.globTool = {
        async match(pattern, basePath) {
            try {
                const fs = window.originalNodeRequire?.('fs') || require('fs');
                const pathMod = window.originalNodeRequire?.('path') || require('path');

                const resolvedBase = pathMod.isAbsolute(basePath)
                    ? basePath
                    : pathMod.resolve(basePath);

                if (!fs.existsSync(resolvedBase)) return [];

                const globToRegex = (glob) => {
                    let regex = glob
                        .replace(/\./g, '\\.')
                        .replace(/\*\*/g, '{{DS}}')
                        .replace(/\*/g, '[^/\\\\]*')
                        .replace(/\?/g, '[^/\\\\]')
                        .replace(/\{\{DS\}\}/g, '.*');
                    return new RegExp('^' + regex + '$', 'i');
                };
                const re = globToRegex(pattern);
                const results = [];
                const walk = (dir, depth = 0) => {
                    if (depth > 5 || results.length > 500) return;
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                            const fullPath = pathMod.join(dir, entry.name);
                            const relPath = pathMod.relative(resolvedBase, fullPath).replace(/\\/g, '/');
                            if (entry.isDirectory()) walk(fullPath, depth + 1);
                            else if (re.test(relPath) || re.test(entry.name)) results.push(relPath);
                        }
                    } catch(e) {}
                };
                walk(resolvedBase);
                return results;
            } catch(e) {
                return { error: e.message };
            }
        }
    };

    console.log('[Brain] ✅ Tool Bridge loaded — hands connected to old engine APIs');

})();
