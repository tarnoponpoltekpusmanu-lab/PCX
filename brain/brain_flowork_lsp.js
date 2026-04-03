// =========================================================================
// FLOWORK OS — Brain LSP Client Module  
// Language Server Protocol client for code intelligence.
// Spawns language servers (TypeScript, Python, etc.) and queries them.
// =========================================================================

(function() {
    'use strict';

    const childProcess = window.originalNodeRequire?.('child_process') || null;
    const servers = {};  // language → { process, connected, requestId, pending }

    const SERVER_COMMANDS = {
        'typescript': { cmd: 'npx', args: ['typescript-language-server', '--stdio'] },
        'javascript': { cmd: 'npx', args: ['typescript-language-server', '--stdio'] },
        'python': { cmd: 'pylsp', args: [] },
        'go': { cmd: 'gopls', args: ['serve'] },
        'html': { cmd: 'npx', args: ['vscode-html-language-server', '--stdio'] },
        'css': { cmd: 'npx', args: ['vscode-css-language-server', '--stdio'] },
    };

    function _getOrStartServer(language) {
        if (servers[language]?.connected) return servers[language];

        if (!childProcess) {
            return null;
        }

        const config = SERVER_COMMANDS[language];
        if (!config) return null;

        try {
            const proc = childProcess.spawn(config.cmd, config.args, {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            const server = {
                process: proc,
                connected: true,
                requestId: 0,
                pending: {},
                buffer: '',
                language,
            };

            proc.stdout.on('data', (data) => {
                server.buffer += data.toString();
                _processLSPBuffer(server);
            });

            proc.on('exit', () => { server.connected = false; });
            proc.on('error', () => { server.connected = false; });

            servers[language] = server;

            // Send initialize
            _sendLSPRequest(server, 'initialize', {
                processId: process.pid,
                capabilities: {},
                rootUri: `file:///${(window._fmBasePath || '.').replace(/\\/g, '/')}`,
            });

            return server;
        } catch(e) {
            console.error(`[LSP] Failed to start ${language} server:`, e.message);
            return null;
        }
    }

    function _processLSPBuffer(server) {
        // LSP uses Content-Length header framing
        while (true) {
            const headerEnd = server.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break;

            const header = server.buffer.substring(0, headerEnd);
            const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch) {
                server.buffer = server.buffer.substring(headerEnd + 4);
                continue;
            }

            const contentLength = parseInt(contentLengthMatch[1]);
            const bodyStart = headerEnd + 4;
            if (server.buffer.length < bodyStart + contentLength) break;

            const body = server.buffer.substring(bodyStart, bodyStart + contentLength);
            server.buffer = server.buffer.substring(bodyStart + contentLength);

            try {
                const msg = JSON.parse(body);
                if (msg.id && server.pending[msg.id]) {
                    server.pending[msg.id].resolve(msg.result);
                    delete server.pending[msg.id];
                }
            } catch(e) {}
        }
    }

    function _sendLSPRequest(server, method, params) {
        return new Promise((resolve, reject) => {
            if (!server?.process?.stdin?.writable) {
                reject(new Error('LSP server not running'));
                return;
            }

            const id = ++server.requestId;
            const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
            const packet = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;

            server.pending[id] = {
                resolve,
                reject,
                timeout: setTimeout(() => {
                    delete server.pending[id];
                    resolve(null);  // Timeout returns null instead of error
                }, 10000),
            };

            server.process.stdin.write(packet);
        });
    }

    function _detectLanguage(filePath) {
        const ext = (filePath || '').split('.').pop()?.toLowerCase();
        const map = { js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript', py: 'python', go: 'go', html: 'html', css: 'css' };
        return map[ext] || 'javascript';
    }

    // ─── Tool Handlers ──────────────────────────────────────────────────

    async function findDefinition(input) {
        const file = input.file || input.path;
        const line = (input.line || 1) - 1;  // LSP is 0-indexed
        const col = (input.column || input.col || 1) - 1;

        if (!file) return { error: 'Missing file path.' };

        const lang = _detectLanguage(file);
        const server = _getOrStartServer(lang);
        if (!server) return { result: `LSP server for "${lang}" not available. Install: ${SERVER_COMMANDS[lang]?.cmd || 'unknown'}` };

        try {
            const result = await _sendLSPRequest(server, 'textDocument/definition', {
                textDocument: { uri: `file:///${file.replace(/\\/g, '/')}` },
                position: { line, character: col },
            });

            if (!result) return { result: 'No definition found.' };
            const locations = Array.isArray(result) ? result : [result];
            return {
                result: locations.map(l => `${l.uri}:${(l.range?.start?.line || 0) + 1}:${(l.range?.start?.character || 0) + 1}`).join('\n')
            };
        } catch(e) {
            return { error: `LSP error: ${e.message}` };
        }
    }

    async function findReferences(input) {
        const file = input.file || input.path;
        const line = (input.line || 1) - 1;
        const col = (input.column || input.col || 1) - 1;

        if (!file) return { error: 'Missing file path.' };

        const lang = _detectLanguage(file);
        const server = _getOrStartServer(lang);
        if (!server) return { result: `LSP server for "${lang}" not available.` };

        try {
            const result = await _sendLSPRequest(server, 'textDocument/references', {
                textDocument: { uri: `file:///${file.replace(/\\/g, '/')}` },
                position: { line, character: col },
                context: { includeDeclaration: true },
            });

            if (!result || result.length === 0) return { result: 'No references found.' };
            return {
                result: `Found ${result.length} references:\n` +
                    result.map(r => `  ${r.uri}:${(r.range?.start?.line || 0) + 1}`).join('\n')
            };
        } catch(e) {
            return { error: `LSP error: ${e.message}` };
        }
    }

    async function documentSymbols(input) {
        const file = input.file || input.path;
        if (!file) return { error: 'Missing file path.' };

        const lang = _detectLanguage(file);
        const server = _getOrStartServer(lang);
        if (!server) return { result: `LSP server for "${lang}" not available.` };

        try {
            const result = await _sendLSPRequest(server, 'textDocument/documentSymbol', {
                textDocument: { uri: `file:///${file.replace(/\\/g, '/')}` },
            });

            if (!result || result.length === 0) return { result: 'No symbols found.' };

            const symbolKinds = ['', 'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant'];

            return {
                result: `Symbols in ${file}:\n` +
                    result.map(s => `  ${symbolKinds[s.kind] || 'Unknown'} ${s.name} @ line ${(s.range?.start?.line || s.location?.range?.start?.line || 0) + 1}`).join('\n')
            };
        } catch(e) {
            return { error: `LSP error: ${e.message}` };
        }
    }

    async function hoverInfo(input) {
        const file = input.file || input.path;
        const line = (input.line || 1) - 1;
        const col = (input.column || input.col || 1) - 1;

        if (!file) return { error: 'Missing file path.' };

        const lang = _detectLanguage(file);
        const server = _getOrStartServer(lang);
        if (!server) return { result: `LSP server for "${lang}" not available.` };

        try {
            const result = await _sendLSPRequest(server, 'textDocument/hover', {
                textDocument: { uri: `file:///${file.replace(/\\/g, '/')}` },
                position: { line, character: col },
            });

            if (!result?.contents) return { result: 'No hover information available.' };

            const contents = typeof result.contents === 'string' ? result.contents :
                result.contents.value || JSON.stringify(result.contents);
            return { result: contents };
        } catch(e) {
            return { error: `LSP error: ${e.message}` };
        }
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkLSP = { findDefinition, findReferences, documentSymbols, hoverInfo };

    console.log('[Brain] ✅ LSP Client loaded');
})();
