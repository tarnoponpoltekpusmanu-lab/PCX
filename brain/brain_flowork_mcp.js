// =========================================================================
// FLOWORK OS — Brain MCP Client Module
// Model Context Protocol client — connect to external MCP servers via stdio.
// Enables AI to use thousands of external tools from the MCP ecosystem.
// =========================================================================

(function() {
    'use strict';

    const STORAGE_KEY = 'flowork_mcp_servers';
    const servers = {};  // serverId → { id, config, process, connected, tools }
    let serverCounter = 0;
    let requestCounter = 0;
    const pendingRequests = {};  // requestId → { resolve, reject, timeout }

    // Load saved server configs
    let savedConfigs = {};
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) savedConfigs = JSON.parse(saved);
    } catch(e) {}

    function _saveConfigs() {
        const configs = {};
        for (const [id, s] of Object.entries(servers)) {
            configs[id] = { id: s.id, config: s.config, connected: false };
        }
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(configs)); } catch(e) {}
    }

    // ─── Connect to MCP Server ──────────────────────────────────────────
    async function connect(input) {
        const command = input.command || input.cmd;
        const args = input.args || [];
        const env = input.env || {};
        const name = input.name || input.server_name || `mcp_${++serverCounter}`;

        if (!command) {
            return { error: 'Missing "command" for MCP server. Example: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }' };
        }

        // Check if child_process is available (Electron with nodeIntegration)
        const childProcess = window.originalNodeRequire?.('child_process');
        if (!childProcess) {
            return { error: 'child_process not available. MCP requires Electron with nodeIntegration enabled.' };
        }

        const serverId = name;

        // Kill existing if reconnecting
        if (servers[serverId]?.process) {
            try { servers[serverId].process.kill(); } catch(e) {}
        }

        try {
            // Spawn MCP server process (shell:true needed on Windows for .cmd executables like npx)
            const isWin = process.platform === 'win32';
            const proc = childProcess.spawn(command, args, {
                env: { ...process.env, ...env },
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: isWin,
            });

            const server = {
                id: serverId,
                config: { command, args, env, name },
                process: proc,
                connected: false,
                tools: [],
                resources: [],
                buffer: '',
            };

            servers[serverId] = server;

            // Handle stdout (JSON-RPC messages)
            proc.stdout.on('data', (data) => {
                server.buffer += data.toString();
                _processBuffer(serverId);
            });

            // Handle stderr (logs)
            proc.stderr.on('data', (data) => {
                console.log(`[MCP:${serverId}] stderr:`, data.toString().trim());
            });

            proc.on('exit', (code) => {
                console.log(`[MCP:${serverId}] Process exited with code ${code}`);
                server.connected = false;
            });

            proc.on('error', (err) => {
                console.error(`[MCP:${serverId}] Process error:`, err.message);
                server.connected = false;
            });

            // Send initialize request
            const initResult = await _sendRequest(serverId, 'initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'Flowork OS', version: '1.0.0' },
            });

            if (initResult) {
                server.connected = true;
                // Send initialized notification
                _sendNotification(serverId, 'notifications/initialized', {});

                // Auto-list tools
                const toolsResult = await _sendRequest(serverId, 'tools/list', {});
                if (toolsResult?.tools) {
                    server.tools = toolsResult.tools;
                }

                _saveConfigs();
                console.log(`[MCP] ✅ Connected to ${serverId}: ${server.tools.length} tools available`);

                return {
                    result: `✅ MCP Server "${serverId}" connected!\n` +
                            `Command: ${command} ${args.join(' ')}\n` +
                            `Tools available: ${server.tools.length}\n` +
                            (server.tools.length > 0 ? `\nTools:\n${server.tools.map(t => `  • ${t.name}: ${(t.description || '').substring(0, 80)}`).join('\n')}` : '')
                };
            } else {
                proc.kill();
                delete servers[serverId];
                return { error: 'MCP initialize handshake failed. Server did not respond.' };
            }

        } catch(err) {
            console.error(`[MCP] ❌ Failed to connect ${serverId}:`, err);
            return { error: `Failed to start MCP server: ${err.message}` };
        }
    }

    // ─── JSON-RPC over stdio ────────────────────────────────────────────
    function _processBuffer(serverId) {
        const server = servers[serverId];
        if (!server) return;

        // MCP uses Content-Length header framing or newline-delimited JSON
        const lines = server.buffer.split('\n');
        server.buffer = lines.pop() || '';  // Keep incomplete line

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('Content-Length')) continue;

            try {
                const msg = JSON.parse(trimmed);
                if (msg.id !== undefined && pendingRequests[msg.id]) {
                    // Response to our request
                    const pending = pendingRequests[msg.id];
                    clearTimeout(pending.timeout);
                    delete pendingRequests[msg.id];

                    if (msg.error) {
                        pending.reject(new Error(msg.error.message || 'MCP error'));
                    } else {
                        pending.resolve(msg.result);
                    }
                } else if (msg.method) {
                    // Server notification — log it
                    console.log(`[MCP:${serverId}] Notification: ${msg.method}`);
                }
            } catch(e) {
                // Not valid JSON, skip
            }
        }
    }

    function _sendRequest(serverId, method, params) {
        return new Promise((resolve, reject) => {
            const server = servers[serverId];
            if (!server?.process?.stdin?.writable) {
                reject(new Error('Server not connected'));
                return;
            }

            const id = ++requestCounter;
            const message = JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                params: params || {},
            });

            // Set timeout
            const timeout = setTimeout(() => {
                delete pendingRequests[id];
                reject(new Error(`MCP request timeout: ${method}`));
            }, 15000);

            pendingRequests[id] = { resolve, reject, timeout };

            try {
                server.process.stdin.write(message + '\n');
            } catch(err) {
                clearTimeout(timeout);
                delete pendingRequests[id];
                reject(err);
            }
        });
    }

    function _sendNotification(serverId, method, params) {
        const server = servers[serverId];
        if (!server?.process?.stdin?.writable) return;

        const message = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params: params || {},
        });

        try {
            server.process.stdin.write(message + '\n');
        } catch(e) {}
    }

    // ─── Call MCP Tool ──────────────────────────────────────────────────
    async function callTool(input) {
        const serverId = input.server_id || input.server;
        const toolName = input.tool || input.name;
        const toolArgs = input.arguments || input.args || input.input || {};

        if (!serverId) return { error: 'Missing server_id.' };
        if (!toolName) return { error: 'Missing tool name.' };

        const server = servers[serverId];
        if (!server?.connected) return { error: `Server "${serverId}" not connected. Use mcp_connect first.` };

        try {
            const result = await _sendRequest(serverId, 'tools/call', {
                name: toolName,
                arguments: toolArgs,
            });

            // Format response
            if (result?.content) {
                const textContent = result.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n');
                return { result: textContent || JSON.stringify(result.content) };
            }
            return { result: JSON.stringify(result) };
        } catch(err) {
            return { error: `MCP tool call failed: ${err.message}` };
        }
    }

    // ─── Disconnect ─────────────────────────────────────────────────────
    function disconnect(input) {
        const serverId = input.server_id || input.server || input.id;
        if (!serverId) return { error: 'Missing server_id.' };

        const server = servers[serverId];
        if (!server) return { error: `Server "${serverId}" not found.` };

        if (server.process) {
            try { server.process.kill(); } catch(e) {}
        }
        delete servers[serverId];
        _saveConfigs();

        return { result: `🔌 MCP Server "${serverId}" disconnected.` };
    }

    // ─── List Tools on a Server ─────────────────────────────────────────
    async function listTools(input) {
        const serverId = input.server_id || input.server;
        if (!serverId) return { error: 'Missing server_id.' };

        const server = servers[serverId];
        if (!server?.connected) return { error: `Server "${serverId}" not connected.` };

        // Refresh tools list
        try {
            const result = await _sendRequest(serverId, 'tools/list', {});
            if (result?.tools) {
                server.tools = result.tools;
            }
        } catch(e) {}

        if (server.tools.length === 0) return { result: `Server "${serverId}" has no tools.` };

        let report = `🔧 MCP TOOLS on "${serverId}" (${server.tools.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const tool of server.tools) {
            report += `\n• ${tool.name}\n`;
            if (tool.description) report += `  ${tool.description.substring(0, 120)}\n`;
            if (tool.inputSchema?.properties) {
                const params = Object.keys(tool.inputSchema.properties).join(', ');
                report += `  Params: ${params}\n`;
            }
        }
        return { result: report };
    }

    // ─── List All Servers ───────────────────────────────────────────────
    function listServers(input) {
        const serverList = Object.values(servers);
        if (serverList.length === 0) return { result: 'No MCP servers configured. Use mcp_connect to add one.' };

        let report = `🖥️ MCP SERVERS (${serverList.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const s of serverList) {
            const icon = s.connected ? '🟢' : '🔴';
            report += `${icon} ${s.id} | ${s.connected ? 'Connected' : 'Disconnected'} | ${s.tools.length} tools\n`;
            report += `   Command: ${s.config.command} ${(s.config.args || []).join(' ')}\n`;
        }
        return { result: report };
    }

    function serverStart(input) {
        // Alias for connect
        return connect(input);
    }

    function serverStop(input) {
        // Alias for disconnect
        return disconnect(input);
    }

    // ─── Auto-Connect: Reconnect saved servers on startup ───────────────
    async function autoConnect() {
        // 1. Reconnect previously saved servers
        for (const [id, saved] of Object.entries(savedConfigs)) {
            if (saved.config?.command) {
                console.log(`[MCP] 🔄 Auto-reconnecting saved server: ${id}`);
                try {
                    await connect(saved.config);
                } catch(e) {
                    console.warn(`[MCP] ⚠️ Failed to auto-reconnect ${id}:`, e.message);
                }
            }
        }

        // 2. Auto-connect filesystem MCP server for current project
        const basePath = window._fmBasePath || '.';
        if (basePath && basePath !== '.' && !servers['filesystem']) {
            // Verify npx is available before attempting
            const childProcess = window.originalNodeRequire?.('child_process');
            if (childProcess) {
                try {
                    // Test if npx is reachable
                    const testCmd = process.platform === 'win32' ? 'where npx' : 'which npx';
                    childProcess.execSync(testCmd, { timeout: 3000, stdio: 'pipe' });

                    console.log(`[MCP] 🗂️ Auto-connecting filesystem server for: ${basePath}`);
                    await connect({
                        command: 'npx',
                        args: ['-y', '@modelcontextprotocol/server-filesystem', basePath],
                        name: 'filesystem',
                    });
                } catch(e) {
                    console.log('[MCP] ℹ️ Filesystem MCP skipped — npx not found or @modelcontextprotocol/server-filesystem not installed.');
                    console.log('[MCP] ℹ️ To enable: npm install -g @modelcontextprotocol/server-filesystem');
                }
            }
        }
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.mcpManager = {
        connect,
        callTool,
        disconnect,
        listTools,
        listServers,
        serverStart,
        serverStop,
        autoConnect,
    };

    console.log('[Brain] ✅ MCP Client module loaded');

    // Auto-connect after a delay (ensure all modules loaded first)
    setTimeout(() => {
        if (window.floworkFeatures?.isEnabled?.('mcp')) {
            autoConnect().catch(e => console.warn('[MCP] Auto-connect skipped:', e.message));
        }
    }, 5000);

})();
