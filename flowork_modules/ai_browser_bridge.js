// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: flowork_modules/ai_browser_bridge.js
// DESKRIPSI: Bridge antara AI Mother WebSocket commands dan BrowserView bot instances.
//            Menangkap console logs, navigate, inject scripts ke bot BrowserView.
// =========================================================================

module.exports = {
    name: 'AI Browser Bridge',

    init: function(ipcMain, FloworkState, childProcess, pathModule, appModule, baseDir, fs, session) {
        console.log(`[PLUGIN] ${this.name} Loaded Successfully!`);

        // ═════════════════════════════════════════════════════════════
        // CONSOLE LOG CAPTURE — Intercept console-message dari setiap BrowserView
        // ═════════════════════════════════════════════════════════════
        if (!FloworkState.consoleLogs) {
            FloworkState.consoleLogs = {}; // { deviceId: [{ level, message, source, line, ts }] }
        }

        // Hook into addDevice to attach console listener
        const originalAddDeviceHook = FloworkState.methods.onDeviceCreated;
        FloworkState.methods.onDeviceCreated = function(deviceId, browserView) {
            // Chain existing hook if present
            if (originalAddDeviceHook) originalAddDeviceHook(deviceId, browserView);

            // Initialize console log buffer for this device
            if (!FloworkState.consoleLogs[deviceId]) {
                FloworkState.consoleLogs[deviceId] = [];
            }

            // Listen for console-message events from BrowserView
            if (browserView && browserView.webContents) {
                browserView.webContents.on('console-message', (event, level, message, line, sourceId) => {
                    const levelMap = { 0: 'LOG', 1: 'WARN', 2: 'ERROR' };
                    const entry = {
                        level: levelMap[level] || 'LOG',
                        message: message ? message.substring(0, 500) : '',
                        source: sourceId ? sourceId.substring(0, 100) : '',
                        line: line,
                        ts: Date.now()
                    };

                    if (!FloworkState.consoleLogs[deviceId]) {
                        FloworkState.consoleLogs[deviceId] = [];
                    }

                    FloworkState.consoleLogs[deviceId].push(entry);

                    // Keep only last 100 entries per device
                    if (FloworkState.consoleLogs[deviceId].length > 100) {
                        FloworkState.consoleLogs[deviceId] = FloworkState.consoleLogs[deviceId].slice(-100);
                    }
                });
            }
        };

        // ═════════════════════════════════════════════════════════════
        // IPC HANDLER: AI get console logs from a bot BrowserView
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-get-console-logs', (event, deviceId) => {
            if (!deviceId) {
                // Return all console logs grouped by device
                const allLogs = {};
                for (const [id, logs] of Object.entries(FloworkState.consoleLogs || {})) {
                    allLogs[id] = logs.slice(-30);
                }
                return { status: 'success', data: allLogs };
            }

            const logs = (FloworkState.consoleLogs[deviceId] || []).slice(-50);
            // Clear after reading
            FloworkState.consoleLogs[deviceId] = [];
            return { status: 'success', data: logs };
        });

        // ═════════════════════════════════════════════════════════════
        // IPC HANDLER: AI navigate a bot BrowserView to a URL
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-navigate', (event, deviceId, url) => {
            const bv = FloworkState.browserViews[deviceId];
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found or destroyed.` };
            }
            try {
                bv.webContents.loadURL(url);
                return { status: 'success', message: `Navigating ${deviceId} to ${url}` };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        // ═════════════════════════════════════════════════════════════
        // IPC HANDLER: AI execute JavaScript inside a bot BrowserView
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-exec', async (event, deviceId, script) => {
            const bv = FloworkState.browserViews[deviceId];
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found or destroyed.` };
            }
            try {
                const result = await bv.webContents.executeJavaScript(script);
                return { status: 'success', data: result };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        // ═════════════════════════════════════════════════════════════
        // IPC HANDLER: AI capture screenshot of a bot BrowserView
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-capture', async (event, deviceId) => {
            const bv = FloworkState.browserViews[deviceId];
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found or destroyed.` };
            }
            try {
                const image = await bv.webContents.capturePage();
                return { status: 'success', data: image.toDataURL() };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        // ═════════════════════════════════════════════════════════════
        // IPC HANDLER: AI get current URL of a bot BrowserView
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-get-url', (event, deviceId) => {
            const bv = FloworkState.browserViews[deviceId] || (FloworkState.appTabs[deviceId] && FloworkState.appTabs[deviceId].view);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            return { status: 'success', data: bv.webContents.getURL() };
        });

        // Helper: resolve BrowserView from deviceId (supports both bots and app tabs)
        function resolveView(deviceId) {
            if (FloworkState.browserViews[deviceId]) return FloworkState.browserViews[deviceId];
            if (FloworkState.appTabs && FloworkState.appTabs[deviceId] && FloworkState.appTabs[deviceId].view) {
                return FloworkState.appTabs[deviceId].view;
            }
            return null;
        }

        // ═════════════════════════════════════════════════════════════
        // COOKIE MANAGEMENT — Get, Set, Delete cookies
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-get-cookies', async (event, deviceId, filter) => {
            const bv = resolveView(deviceId);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            try {
                const cookies = await bv.webContents.session.cookies.get(filter || {});
                return { status: 'success', data: cookies };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        ipcMain.handle('app:ai-browser-set-cookie', async (event, deviceId, cookie) => {
            const bv = resolveView(deviceId);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            try {
                await bv.webContents.session.cookies.set(cookie);
                return { status: 'success', message: 'Cookie set.' };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        ipcMain.handle('app:ai-browser-delete-cookie', async (event, deviceId, url, name) => {
            const bv = resolveView(deviceId);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            try {
                await bv.webContents.session.cookies.remove(url, name);
                return { status: 'success', message: `Cookie ${name} removed.` };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        // ═════════════════════════════════════════════════════════════
        // DOM SCRAPING — Extract text, HTML, attributes, tables
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-scrape', async (event, deviceId, options) => {
            const bv = resolveView(deviceId);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            try {
                const { selector, action, attribute } = options || {};
                let script = '';

                if (action === 'text') {
                    script = `(() => {
                        const el = document.querySelector('${selector || 'body'}');
                        return el ? el.innerText.substring(0, 10000) : null;
                    })()`;
                } else if (action === 'html') {
                    script = `(() => {
                        const el = document.querySelector('${selector || 'body'}');
                        return el ? el.innerHTML.substring(0, 20000) : null;
                    })()`;
                } else if (action === 'attribute') {
                    script = `(() => {
                        const el = document.querySelector('${selector}');
                        return el ? el.getAttribute('${attribute}') : null;
                    })()`;
                } else if (action === 'table') {
                    script = `(() => {
                        const table = document.querySelector('${selector || 'table'}');
                        if (!table) return null;
                        const rows = [];
                        table.querySelectorAll('tr').forEach(tr => {
                            const cells = [];
                            tr.querySelectorAll('td, th').forEach(td => cells.push(td.innerText.trim()));
                            rows.push(cells);
                        });
                        return rows;
                    })()`;
                } else if (action === 'links') {
                    script = `(() => {
                        const links = [];
                        document.querySelectorAll('${selector || 'a[href]'}').forEach(a => {
                            links.push({ text: a.innerText.trim().substring(0, 100), href: a.href });
                        });
                        return links.slice(0, 200);
                    })()`;
                } else if (action === 'queryAll') {
                    script = `(() => {
                        const results = [];
                        document.querySelectorAll('${selector}').forEach(el => {
                            results.push({
                                tag: el.tagName,
                                text: el.innerText ? el.innerText.substring(0, 200) : '',
                                id: el.id || '',
                                className: el.className || ''
                            });
                        });
                        return results.slice(0, 100);
                    })()`;
                } else {
                    // Default: return page info
                    script = `(() => ({
                        title: document.title,
                        url: location.href,
                        bodyLength: document.body.innerHTML.length,
                        forms: document.forms.length,
                        inputs: document.querySelectorAll('input').length,
                        buttons: document.querySelectorAll('button').length,
                        images: document.querySelectorAll('img').length,
                        links: document.querySelectorAll('a').length
                    }))()`;
                }

                const result = await bv.webContents.executeJavaScript(script);
                return { status: 'success', data: result };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        // ═════════════════════════════════════════════════════════════
        // USER AGENT — Set custom user agent
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-set-ua', (event, deviceId, userAgent) => {
            const bv = resolveView(deviceId);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            try {
                bv.webContents.setUserAgent(userAgent);
                return { status: 'success', message: `UA set to: ${userAgent.substring(0, 80)}` };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        // ═════════════════════════════════════════════════════════════
        // LOCAL/SESSION STORAGE — Read/Write browser storage
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-storage', async (event, deviceId, options) => {
            const bv = resolveView(deviceId);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            try {
                const { storageType, action, key, value } = options || {};
                const store = storageType === 'session' ? 'sessionStorage' : 'localStorage';
                let script = '';

                if (action === 'get') {
                    script = `${store}.getItem('${key}')`;
                } else if (action === 'set') {
                    script = `${store}.setItem('${key}', '${(value || '').replace(/'/g, "\\'")}'); 'ok'`;
                } else if (action === 'remove') {
                    script = `${store}.removeItem('${key}'); 'ok'`;
                } else if (action === 'keys') {
                    script = `Object.keys(${store})`;
                } else if (action === 'getAll') {
                    script = `(() => { const r = {}; for(let i=0;i<${store}.length;i++){const k=${store}.key(i);r[k]=${store}.getItem(k);} return r; })()`;
                } else {
                    return { status: 'error', message: 'Invalid action. Use: get, set, remove, keys, getAll' };
                }

                const result = await bv.webContents.executeJavaScript(script);
                return { status: 'success', data: result };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        // ═════════════════════════════════════════════════════════════
        // PAGE LIFECYCLE — Go back, forward, reload, stop, pdf
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-lifecycle', async (event, deviceId, action) => {
            const bv = resolveView(deviceId);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            try {
                if (action === 'back') {
                    bv.webContents.goBack();
                } else if (action === 'forward') {
                    bv.webContents.goForward();
                } else if (action === 'reload') {
                    bv.webContents.reload();
                } else if (action === 'stop') {
                    bv.webContents.stop();
                } else if (action === 'pdf') {
                    const pdfData = await bv.webContents.printToPDF({});
                    return { status: 'success', data: pdfData.toString('base64').substring(0, 50000) };
                } else if (action === 'zoom_in') {
                    bv.webContents.setZoomLevel(bv.webContents.getZoomLevel() + 0.5);
                } else if (action === 'zoom_out') {
                    bv.webContents.setZoomLevel(bv.webContents.getZoomLevel() - 0.5);
                } else if (action === 'zoom_reset') {
                    bv.webContents.setZoomLevel(0);
                } else if (action === 'devtools') {
                    bv.webContents.toggleDevTools();
                } else {
                    return { status: 'error', message: `Unknown action: ${action}` };
                }
                return { status: 'success', message: `Action '${action}' executed.` };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });

        // ═════════════════════════════════════════════════════════════
        // NETWORK — Intercept/modify requests (for headers, auth, etc.)
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:ai-browser-set-headers', (event, deviceId, headers) => {
            const bv = resolveView(deviceId);
            if (!bv || bv.webContents.isDestroyed()) {
                return { status: 'error', message: `Device ${deviceId} not found.` };
            }
            try {
                // Set extra HTTP headers for all requests in this view
                bv.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
                    for (const [key, value] of Object.entries(headers)) {
                        details.requestHeaders[key] = value;
                    }
                    callback({ requestHeaders: details.requestHeaders });
                });
                return { status: 'success', message: 'Custom headers applied.' };
            } catch (e) {
                return { status: 'error', message: e.message };
            }
        });
    }
};
