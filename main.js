//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\main.js
//#1. Dynamic Component Discovery (DCD): Hub wajib melakukan scanning file secara otomatis.
//#2. Lazy Loading: Modul hanya di-import ke RAM saat dipanggil (On-Demand).
//#3. Atomic Isolation: 1 File = 1 Fungsi dengan nama file yang identik dengan nama fungsi aslinya.
//#4. Zero Logic Mutation: Dilarang merubah alur logika, nama variabel, atau struktur if/try/loop.
//#######################################################################

const { app, BrowserWindow, session, ipcMain, shell, Tray, Menu, nativeImage, BrowserView } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const { WebSocketServer } = require('ws');

// Enable Remote Debugging so external tools can visually inspect & control Flowork OS
app.commandLine.appendSwitch('remote-debugging-port', '9222');

// ═══════════════════════════════════════════════════════════════
//  BRAIN LOADER: Extract brain.zip + decode encoded files
//  brain.zip contains: V8 bytecode (.jsc) + XOR encoded files
//  This runs in main process (full Node.js) before any window loads
// ═══════════════════════════════════════════════════════════════
(function() {
    const brainDir = path.join(__dirname, 'brain');
    const brainZip = path.join(__dirname, 'brain.zip');
    const brainExists = fs.existsSync(brainDir) && fs.statSync(brainDir).isDirectory();

    // ── Decode Key (must match compile_brain.js) ──
    const ENCODE_KEY = Buffer.from('FLOWORKOS_BRAIN_ENGINE_KEY_2026_SECURE');
    const MAGIC = Buffer.from([0xF1, 0x0A, 0xC5, 0x15]);

    function xorDecode(buf) {
        // Check magic header
        if (buf.length < MAGIC.length) return buf;
        for (let i = 0; i < MAGIC.length; i++) {
            if (buf[i] !== MAGIC[i]) return buf; // Not encoded
        }
        // Strip magic header and XOR decode
        const content = buf.slice(MAGIC.length);
        const result = Buffer.alloc(content.length);
        for (let i = 0; i < content.length; i++) {
            result[i] = content[i] ^ ENCODE_KEY[i % ENCODE_KEY.length];
        }
        return result;
    }

    function decodeFilesRecursive(dir) {
        let decoded = 0;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                decoded += decodeFilesRecursive(fullPath);
            } else if (!entry.name.endsWith('.jsc')) {
                // .jsc = V8 bytecode, leave as-is
                // Everything else: check if XOR encoded
                try {
                    const raw = fs.readFileSync(fullPath);
                    if (raw.length >= MAGIC.length &&
                        raw[0] === MAGIC[0] && raw[1] === MAGIC[1] &&
                        raw[2] === MAGIC[2] && raw[3] === MAGIC[3]) {
                        const original = xorDecode(raw);
                        fs.writeFileSync(fullPath, original);
                        decoded++;
                    }
                } catch(e) {}
            }
        }
        return decoded;
    }

    if (!brainExists && fs.existsSync(brainZip)) {
        try {
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(brainZip);
            fs.mkdirSync(brainDir, { recursive: true });
            zip.extractAllTo(brainDir, true);
            const entries = zip.getEntries();
            const jscCount = entries.filter(e => e.entryName.endsWith('.jsc')).length;

            // Decode XOR-encoded files
            const decodedCount = decodeFilesRecursive(brainDir);

            console.log('[BrainLoader] PROD MODE: Extracted ' + entries.length + ' files');
            console.log('[BrainLoader] V8 Bytecode: ' + jscCount + ' .jsc | Decoded: ' + decodedCount + ' files');
        } catch (e) {
            console.error('[BrainLoader] Failed to extract brain.zip:', e.message);
        }
    } else if (brainExists) {
        const hasJsc = fs.existsSync(path.join(brainDir, 'agent_state.jsc'));
        console.log('[BrainLoader] ' + (hasJsc ? 'PROD' : 'DEV') + ' MODE: brain/ folder found');
    } else {
        console.warn('[BrainLoader] WARNING: No brain/ folder and no brain.zip!');
    }
})();

const isPackaged = app.isPackaged;
const portablePath = isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'FloworkData')
    : path.join(__dirname, 'FloworkData');

if (!fs.existsSync(portablePath)) {
    fs.mkdirSync(portablePath, { recursive: true });
}
app.setPath('userData', portablePath);

const profileFile = path.join(portablePath, 'profiles.json');

const isAiBuilderMode = process.argv.includes('--ai-builder');
const gotTheLock = isAiBuilderMode ? true : app.requestSingleInstanceLock();

let tray = null;

if (!gotTheLock) {
    app.quit();
} else {
    app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
    app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
    app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests');
    app.commandLine.appendSwitch('disable-web-security', 'true');

    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

    app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

    let mainWindow;
    let logWindow;
    let splashWindow;
    let aiBuilderWindow = null;
    let isQuitting = false;

    const logBuffer = [];
    const browserViews = {};
    let activeMode = 'FLOWORK';
    let mainFloworkView = null;
    let activeNormalDeviceId = null;
    const autoScrollTasks = {};

    let autoRefreshIntervalId = null;

    let gridScrollY = 0;
    let maxGridScrollY = 0;
    let isSidebarOpen = false;

    let gridOrder = [];
    const botFpConfigs = {};
    const botSleepStates = {};

    let isModalOpen = false;

    const bypassMemoryFile = path.join(portablePath, 'bypass_memory.json');
    let bypassDatabase = [];
    if (fs.existsSync(bypassMemoryFile)) {
        try { bypassDatabase = JSON.parse(fs.readFileSync(bypassMemoryFile, 'utf8')); } catch (err) { }
    }

    let masterSyncId = null;
    let followerSyncStates = {};

    const TARGET_URL = 'https://floworkos.com/webview/login';

    let EXTENSION_PATH = path.join(__dirname, 'FLOWORK_EXTENTION');
    if (__dirname.includes('app.asar')) {
        EXTENSION_PATH = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'FLOWORK_EXTENTION');
    }
    const iconPath = path.join(__dirname, 'icon.png');
    global.FloworkState = {
        get mainWindow() { return mainWindow; },
        get browserViews() { return browserViews; },
        get activeMode() { return activeMode; },
        set activeMode(val) { activeMode = val; },
        get gridOrder() { return gridOrder; },
        set gridOrder(val) { gridOrder = val; },
        get botFpConfigs() { return botFpConfigs; },
        get botSleepStates() { return botSleepStates; },
        get masterSyncId() { return masterSyncId; },
        set masterSyncId(val) { masterSyncId = val; },
        get followerSyncStates() { return followerSyncStates; },
        get profileFile() { return profileFile; },
        get autoScrollTasks() { return autoScrollTasks; },
        get autoRefreshIntervalId() { return autoRefreshIntervalId; },
        set autoRefreshIntervalId(val) { autoRefreshIntervalId = val; },
        get mainFloworkView() { return mainFloworkView; },
        set mainFloworkView(val) { mainFloworkView = val; },
        get activeNormalDeviceId() { return activeNormalDeviceId; },
        set activeNormalDeviceId(val) { activeNormalDeviceId = val; },
        get isModalOpen() { return isModalOpen; },
        set isModalOpen(val) { isModalOpen = val; },
        get isSidebarOpen() { return isSidebarOpen; },
        set isSidebarOpen(val) { isSidebarOpen = val; },
        get gridScrollY() { return gridScrollY; },
        set gridScrollY(val) { gridScrollY = val; },
        get maxGridScrollY() { return maxGridScrollY; },
        set maxGridScrollY(val) { maxGridScrollY = val; },
        get EXTENSION_PATH() { return EXTENSION_PATH; },
        get TARGET_URL() { return TARGET_URL; },
        get iconPath() { return iconPath; },
        consoleLogs: {},
        appTabs: {},
        activeAppTabId: null,
        methods: {}
    };

    if (process.platform === 'win32') {
        if (process.stdout) process.stdout.write = () => true;
        if (process.stderr) process.stderr.write = () => true;
    }
    process.removeAllListeners('warning');
    process.on('warning', (warning) => {
        if (warning.name === 'ExtensionLoadWarning') return;
        console.warn(`[${warning.name}] ${warning.message}`);
    });

    ipcMain.on('app:request-bypass-db', (event) => {
        event.sender.send('app:update-bypass-db', bypassDatabase);
    });

    ipcMain.handle('app:toggle-record-mode', (event, mode) => {
        for (const id in browserViews) {
            if (!browserViews[id].webContents.isDestroyed()) {
                browserViews[id].webContents.send('app:set-record-mode', mode);
            }
        }
        return { success: true };
    });

    ipcMain.on('app:update-bounds', (event, bounds) => {
        global.FloworkState.centerBounds = bounds;
        if (global.FloworkState.methods && global.FloworkState.methods.resizeAllViews) {
            global.FloworkState.methods.resizeAllViews();
        }
    });

    ipcMain.handle('app:clear-bypass-db', () => {
        bypassDatabase = [];
        fs.writeFileSync(bypassMemoryFile, JSON.stringify(bypassDatabase, null, 2));
        for (const id in browserViews) {
            if (!browserViews[id].webContents.isDestroyed()) {
                browserViews[id].webContents.send('app:update-bypass-db', bypassDatabase);
            }
        }
        return { success: true };
    });

    ipcMain.on('app:save-bypass-click', (event, payload) => {
        let exists = bypassDatabase.find(r => r.tag === payload.tag && r.text === payload.text && r.className === payload.className);
        if (!exists) {
            bypassDatabase.push(payload);
            fs.writeFileSync(bypassMemoryFile, JSON.stringify(bypassDatabase, null, 2));
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:record-finished');
        }

        for (const id in browserViews) {
            if (!browserViews[id].webContents.isDestroyed()) {
                browserViews[id].webContents.send('app:set-record-mode', false);
                browserViews[id].webContents.send('app:update-bypass-db', bypassDatabase);
            }
        }
    });

    ipcMain.handle('app:open-external', (event, url) => {
        shell.openExternal(url);
        return { success: true };
    });

    function createSplashWindow() {
        splashWindow = new BrowserWindow({
            width: 450, height: 550, transparent: true, frame: false, alwaysOnTop: true, show: false,
            icon: iconPath, webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        splashWindow.loadFile(path.join(__dirname, 'splash.html'));
        splashWindow.once('ready-to-show', () => splashWindow.show());
        splashWindow.on('closed', () => splashWindow = null);
    }

    function createLogWindow() {
        logWindow = new BrowserWindow({
            width: 800, height: 600, title: 'Flowork Engine Terminal Logs', backgroundColor: '#050505',
            autoHideMenuBar: true, show: false, icon: iconPath,
            alwaysOnTop: true,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });

        logWindow.loadFile(path.join(__dirname, 'log-viewer.html'));
        logWindow.webContents.on('did-finish-load', () => {
            setTimeout(() => {
                logBuffer.forEach(logData => logWindow.webContents.send('engine:receive-log', logData));
                logBuffer.length = 0;
            }, 500);
        });

        logWindow.on('blur', () => {
            setTimeout(() => {
                if (logWindow && !logWindow.isDestroyed() && logWindow.isVisible()) {
                    logWindow.setAlwaysOnTop(false);
                    logWindow.setAlwaysOnTop(true, 'pop-up-menu');
                }
            }, 150);
        });

        logWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); logWindow.hide(); } });
        logWindow.on('closed', () => logWindow = null);
    }

    function createWindow() {
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            const responseHeaders = Object.assign({}, details.responseHeaders);
            delete responseHeaders['Content-Security-Policy'];
            delete responseHeaders['content-security-policy'];
            callback({ cancel: false, responseHeaders: responseHeaders });
        });

        mainWindow = new BrowserWindow({
            width: 1280, height: 800, minWidth: 960, minHeight: 600, show: false,
            title: 'Flowork OS', backgroundColor: '#000000', autoHideMenuBar: true, icon: iconPath,
            webPreferences: { nodeIntegration: true, contextIsolation: false, preload: path.join(__dirname, 'preload.js'), webSecurity: false }
        });

        mainWindow.on('focus', () => {
            setTimeout(() => {
                if (logWindow && !logWindow.isDestroyed() && logWindow.isVisible()) {
                    logWindow.setAlwaysOnTop(false);
                    logWindow.setAlwaysOnTop(true, 'pop-up-menu');
                }
            }, 150);
        });

        mainWindow.loadFile(path.join(__dirname, 'index.html'));
        mainWindow.on('resize', () => { if (global.FloworkState.methods.resizeAllViews) global.FloworkState.methods.resizeAllViews(); });
        mainWindow.on('show', () => { if (global.FloworkState.methods.updateViewsVisibility) global.FloworkState.methods.updateViewsVisibility(); });
        mainWindow.on('restore', () => { if (global.FloworkState.methods.updateViewsVisibility) global.FloworkState.methods.updateViewsVisibility(); });
        mainWindow.once('ready-to-show', () => {
            if (splashWindow) splashWindow.close();
            mainWindow.maximize();
            mainWindow.show();
        });

        mainWindow.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
            if (isMain) {
                if (splashWindow) splashWindow.close();
                mainWindow.loadFile(path.join(__dirname, 'offline.html'));
                mainWindow.maximize();
                mainWindow.show();
            }
        });

        mainWindow.on('close', (event) => {
            if (!isQuitting) { event.preventDefault(); mainWindow.hide(); if (logWindow) logWindow.hide(); }
        });

        mainWindow.on('closed', () => { mainWindow = null; if (logWindow && isQuitting) logWindow.close(); });
    }

    function createTray() {
        const trayIcon = nativeImage.createFromPath(iconPath);
        tray = new Tray(trayIcon);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Open Flowork OS', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
            {
                label: 'View Terminal Logs', click: () => {
                    if (!logWindow || logWindow.isDestroyed()) {
                        createLogWindow();
                        logWindow.once('ready-to-show', () => {
                            logWindow.show();
                            logWindow.setAlwaysOnTop(true, 'pop-up-menu');
                            logWindow.focus();
                        });
                    } else {
                        if (!logWindow.isVisible()) logWindow.show();
                        if (logWindow.isMinimized()) logWindow.restore();
                        logWindow.setAlwaysOnTop(true, 'pop-up-menu');
                        logWindow.focus();
                    }
                }
            },
            { type: 'separator' },
            { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
        ]);
        tray.setToolTip('Flowork OS - Running in Background');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
    }

    app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });

    function loadFloworkModules() {
        const floworkModulesPath = path.join(__dirname, 'flowork_modules');
        if (!fs.existsSync(floworkModulesPath)) {
            fs.mkdirSync(floworkModulesPath, { recursive: true });
            console.log("[DCD] Created 'flowork_modules' directory.");
        }

        console.log("[DCD] Scanning for external modules in:", floworkModulesPath);
        const files = fs.readdirSync(floworkModulesPath);

        for (const file of files) {
            if (file.endsWith('.js')) {
                try {
                    const modPath = path.join(floworkModulesPath, file);
                    const mod = require(modPath);
                    if (mod && mod.init) {
                        console.log(`[DCD] Autoloading Module: ${mod.name || file}`);
                        mod.init(ipcMain, global.FloworkState, { exec, spawn }, path, app, __dirname, fs, session);
                    }
                } catch (err) {
                    console.error(`[DCD] Failed to load module ${file}:`, err);
                }
            }
        }
    }

    app.whenReady().then(async () => {
        // ═══════════════════════════════════════════════════
        // WebSocket Server MUST be created FIRST — even in AI Builder mode!
        // AI Assistant needs this to use open_ai_tab, capture_browser, etc.
        // ═══════════════════════════════════════════════════
        try {
            const wss = new WebSocketServer({ port: 5001 });

            // Global broadcaster for crashes
            global.broadcastToAi = (payload) => {
                wss.clients.forEach(client => {
                    if (client.readyState === 1) client.send(JSON.stringify(payload));
                });
            };

            wss.on('connection', (ws) => {
                ws.on('message', async (message) => {
                    try {
                        const req = JSON.parse(message);
                        if (req.action === 'open_ai_tab') {
                            const tabId = req.tabId;
                            const url = req.url;

                            // ═══ STRATEGY 1: Open INSIDE Flowork main window as BrowserView tab ═══
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                // Create BrowserView for the app
                                const partition = `persist:apptab_${tabId}`;
                                const view = new BrowserView({
                                    webPreferences: {
                                        partition: partition,
                                        nodeIntegration: false,
                                        contextIsolation: true,
                                        webSecurity: false
                                    }
                                });
                                view.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                                view.webContents.loadURL(url);

                                // Store in FloworkState.appTabs (integrates with app_tab_manager resize)
                                global.FloworkState.appTabs[tabId] = {
                                    view: view,
                                    name: tabId,
                                    url: url,
                                    partition: partition
                                };
                                global.FloworkState.activeAppTabId = tabId;

                                // Create a proxy object so capture_browser/execute_browser_script/list_browsers
                                // can use browserViews[tabId] the same way as before (they expect .webContents)
                                browserViews[tabId] = {
                                    webContents: view.webContents,
                                    isDestroyed: () => view.webContents.isDestroyed(),
                                    _isBrowserView: true,
                                    _view: view,
                                    _partition: partition
                                };

                                // Hide mainFloworkView and other app tabs, show this one
                                if (mainFloworkView) {
                                    try { mainWindow.removeBrowserView(mainFloworkView); } catch(e) {}
                                }
                                for (const id in global.FloworkState.appTabs) {
                                    if (id !== tabId && global.FloworkState.appTabs[id].view) {
                                        try { mainWindow.removeBrowserView(global.FloworkState.appTabs[id].view); } catch(e) {}
                                    }
                                }
                                mainWindow.addBrowserView(view);

                                // Set bounds (match app_tab_manager layout dynamically)
                                if (global.FloworkState.methods && global.FloworkState.methods.resizeAllViews) {
                                    global.FloworkState.methods.resizeAllViews();
                                } else {
                                    const [winWidth, winHeight] = mainWindow.getContentSize();
                                    view.setBounds({ x: 70, y: 60, width: winWidth - 70, height: winHeight - 60 });
                                }

                                // Ensure Flowork is in FLOWORK mode
                                activeMode = 'FLOWORK';

                                // Console log capture for AI debugging (get_console_logs)
                                if (!global.FloworkState.consoleLogs[tabId]) global.FloworkState.consoleLogs[tabId] = [];
                                view.webContents.on('console-message', (ev, level, message, line, sourceId) => {
                                    const levelMap = { 0: 'LOG', 1: 'WARN', 2: 'ERROR' };
                                    global.FloworkState.consoleLogs[tabId].push({
                                        level: levelMap[level] || 'LOG',
                                        message: message ? message.substring(0, 500) : '',
                                        source: sourceId ? sourceId.substring(0, 100) : '',
                                        line: line, ts: Date.now()
                                    });
                                    if (global.FloworkState.consoleLogs[tabId].length > 100) {
                                        global.FloworkState.consoleLogs[tabId] = global.FloworkState.consoleLogs[tabId].slice(-100);
                                    }
                                });

                                // Notify main window renderer about new tab (shows in tab bar UI)
                                mainWindow.webContents.send('app:tab-opened', tabId, tabId);
                                if (mainFloworkView && !mainFloworkView.webContents.isDestroyed()) {
                                    mainFloworkView.webContents.send('app:tab-opened', tabId, tabId);
                                }

                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'AI Tab opened in Flowork: ' + tabId }));
                            }
                            // ═══ STRATEGY 2: Fallback to standalone BrowserWindow (AI Builder-only mode) ═══
                            else {
                                let win = new BrowserWindow({
                                    width: 1024, height: 768, show: true, title: 'AI Automation: ' + tabId,
                                    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
                                });
                                win.loadURL(url);
                                browserViews[tabId] = win;
                                win.on('closed', () => delete browserViews[tabId]);
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'AI Tab created (popup): ' + tabId }));
                            }
                        } else if (req.action === 'close_ai_tab') {
                            const tabId = req.tabId;

                            // ═══ Check if it's a BrowserView tab inside Flowork main window ═══
                            if (global.FloworkState.appTabs[tabId]) {
                                const tab = global.FloworkState.appTabs[tabId];

                                // Remove from main window
                                if (mainWindow && !mainWindow.isDestroyed() && tab.view) {
                                    try { mainWindow.removeBrowserView(tab.view); } catch(e) {}
                                }

                                // Destroy webContents
                                if (tab.view && !tab.view.webContents.isDestroyed()) {
                                    try {
                                        tab.view.webContents.stop();
                                        tab.view.webContents.loadURL('about:blank');
                                        tab.view.webContents.removeAllListeners();
                                        tab.view.webContents.destroy();
                                    } catch(e) {}
                                }

                                // Clean up session
                                if (tab.partition) {
                                    try {
                                        const tabSession = session.fromPartition(tab.partition);
                                        tabSession.clearCache();
                                        tabSession.clearStorageData();
                                    } catch(e) {}
                                }

                                // Remove from state
                                delete global.FloworkState.appTabs[tabId];
                                delete browserViews[tabId];
                                delete global.FloworkState.consoleLogs[tabId];

                                // Switch to another tab or show home
                                if (global.FloworkState.activeAppTabId === tabId) {
                                    const remaining = Object.keys(global.FloworkState.appTabs);
                                    if (remaining.length > 0) {
                                        const nextId = remaining[remaining.length - 1];
                                        const nextTab = global.FloworkState.appTabs[nextId];
                                        if (mainWindow && !mainWindow.isDestroyed() && nextTab.view) {
                                            mainWindow.addBrowserView(nextTab.view);
                                            const [w, h] = mainWindow.getContentSize();
                                            nextTab.view.setBounds({ x: 0, y: 95, width: w, height: h - 95 });
                                        }
                                        global.FloworkState.activeAppTabId = nextId;
                                    } else {
                                        global.FloworkState.activeAppTabId = null;
                                        // Restore mainFloworkView (home)
                                        if (mainWindow && !mainWindow.isDestroyed() && mainFloworkView) {
                                            mainWindow.addBrowserView(mainFloworkView);
                                            const [w, h] = mainWindow.getContentSize();
                                            mainFloworkView.setBounds({ x: 0, y: 60, width: w, height: h - 60 });
                                        }
                                    }
                                }

                                // Notify UI
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('app:tab-closed', tabId);
                                }

                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'Tab closed from Flowork.' }));
                            }
                            // ═══ Fallback: standalone BrowserWindow ═══
                            else {
                                const bv = browserViews[tabId];
                                if (bv && typeof bv.isDestroyed === 'function' && !bv.isDestroyed() && typeof bv.close === 'function') {
                                    bv.close();
                                    delete browserViews[tabId];
                                    ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'Tab closed.' }));
                                } else {
                                    delete browserViews[tabId];
                                    ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'Tab already closed.' }));
                                }
                            }
                        } else if (req.action === 'capture_browser') {
                            const bView = browserViews[req.tabId];
                            if (bView && !bView.webContents.isDestroyed()) {
                                const image = await bView.webContents.capturePage();
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: image.toDataURL() }));
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        } else if (req.action === 'execute_browser_script') {
                            const bView = browserViews[req.tabId];
                            if (bView && !bView.webContents.isDestroyed()) {
                                const res = await bView.webContents.executeJavaScript(req.script);
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: res }));
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        } else if (req.action === 'list_browsers') {
                            const tabs = Object.keys(browserViews).map(k => ({
                                id: k,
                                url: browserViews[k].webContents ? browserViews[k].webContents.getURL() : 'unknown'
                            }));
                            ws.send(JSON.stringify({ id: req.id, status: 'success', data: tabs }));
                        } else if (req.action === 'get_console_logs') {
                            const deviceId = req.tabId;
                            const consoleLogs = global.FloworkState.consoleLogs || {};
                            if (deviceId && consoleLogs[deviceId]) {
                                const logs = consoleLogs[deviceId].slice(-50);
                                consoleLogs[deviceId] = [];
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: logs }));
                            } else if (!deviceId) {
                                const allLogs = {};
                                for (const [id, logs] of Object.entries(consoleLogs)) {
                                    allLogs[id] = logs.slice(-30);
                                }
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: allLogs }));
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: [] }));
                            }
                        } else if (req.action === 'ai_navigate') {
                            const bView = browserViews[req.tabId];
                            if (bView && !bView.webContents.isDestroyed()) {
                                bView.webContents.loadURL(req.url);
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: `Navigating to ${req.url}` }));
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        }
                        // ═══════ FULL BROWSER AUTOMATION ═══════
                        else if (req.action === 'get_cookies') {
                            const result = await ipcMain.handle && global.FloworkState ?
                                await new Promise(resolve => {
                                    const bv = browserViews[req.tabId] || (global.FloworkState.appTabs[req.tabId] && global.FloworkState.appTabs[req.tabId].view);
                                    if (!bv || bv.webContents.isDestroyed()) return resolve({ status: 'error', message: 'Tab not found' });
                                    bv.webContents.session.cookies.get(req.filter || {}).then(c => resolve({ status: 'success', data: c })).catch(e => resolve({ status: 'error', message: e.message }));
                                }) : { status: 'error', message: 'Not available' };
                            ws.send(JSON.stringify({ id: req.id, ...result }));
                        } else if (req.action === 'set_cookie') {
                            const bv = browserViews[req.tabId] || (global.FloworkState.appTabs[req.tabId] && global.FloworkState.appTabs[req.tabId].view);
                            if (bv && !bv.webContents.isDestroyed()) {
                                await bv.webContents.session.cookies.set(req.cookie);
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'Cookie set' }));
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        } else if (req.action === 'delete_cookie') {
                            const bv = browserViews[req.tabId] || (global.FloworkState.appTabs[req.tabId] && global.FloworkState.appTabs[req.tabId].view);
                            if (bv && !bv.webContents.isDestroyed()) {
                                await bv.webContents.session.cookies.remove(req.url, req.name);
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'Cookie deleted' }));
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        } else if (req.action === 'scrape_page') {
                            const bv = browserViews[req.tabId] || (global.FloworkState.appTabs[req.tabId] && global.FloworkState.appTabs[req.tabId].view);
                            if (bv && !bv.webContents.isDestroyed()) {
                                try {
                                    const res = await bv.webContents.executeJavaScript(req.script || `document.body.innerText.substring(0, 10000)`);
                                    ws.send(JSON.stringify({ id: req.id, status: 'success', data: res }));
                                } catch(e) {
                                    ws.send(JSON.stringify({ id: req.id, status: 'error', message: e.message }));
                                }
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        } else if (req.action === 'browser_lifecycle') {
                            const bv = browserViews[req.tabId] || (global.FloworkState.appTabs[req.tabId] && global.FloworkState.appTabs[req.tabId].view);
                            if (bv && !bv.webContents.isDestroyed()) {
                                if (req.lifecycleAction === 'back') bv.webContents.goBack();
                                else if (req.lifecycleAction === 'forward') bv.webContents.goForward();
                                else if (req.lifecycleAction === 'reload') bv.webContents.reload();
                                else if (req.lifecycleAction === 'stop') bv.webContents.stop();
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: `${req.lifecycleAction} done` }));
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        } else if (req.action === 'set_user_agent') {
                            const bv = browserViews[req.tabId] || (global.FloworkState.appTabs[req.tabId] && global.FloworkState.appTabs[req.tabId].view);
                            if (bv && !bv.webContents.isDestroyed()) {
                                bv.webContents.setUserAgent(req.userAgent);
                                ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'UA set' }));
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        }
                        // ═══ FILE UPLOAD TO INPUT ═══
                        else if (req.action === 'upload_file_to_input') {
                            const bv = browserViews[req.tabId] || (global.FloworkState.appTabs[req.tabId] && global.FloworkState.appTabs[req.tabId].view);
                            if (bv && !bv.webContents.isDestroyed()) {
                                try {
                                    // Use Chromium DevTools Protocol to set file on input
                                    const debugger_ = bv.webContents.debugger;
                                    debugger_.attach('1.3');
                                    
                                    // Find the file input node
                                    const doc = await debugger_.sendCommand('DOM.getDocument');
                                    const nodes = await debugger_.sendCommand('DOM.querySelectorAll', {
                                        nodeId: doc.root.nodeId,
                                        selector: req.selector || 'input[type="file"]'
                                    });
                                    
                                    if (nodes.nodeIds && nodes.nodeIds.length > 0) {
                                        await debugger_.sendCommand('DOM.setFileInputFiles', {
                                            nodeId: nodes.nodeIds[0],
                                            files: [req.filePath]
                                        });
                                        debugger_.detach();
                                        ws.send(JSON.stringify({ id: req.id, status: 'success', data: 'File set on input' }));
                                    } else {
                                        debugger_.detach();
                                        ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'No file input found matching: ' + req.selector }));
                                    }
                                } catch(uploadErr) {
                                    try { bv.webContents.debugger.detach(); } catch(e2) {}
                                    ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Upload failed: ' + uploadErr.message }));
                                }
                            } else {
                                ws.send(JSON.stringify({ id: req.id, status: 'error', message: 'Tab not found' }));
                            }
                        }
                    } catch (e) {}
                });
            });

            // SELF-HEALING KERNEL: Intercept all fatal crashes and send them to Mother AI!
            process.on('uncaughtException', (err) => {
                const stack = err.stack || err.toString();
                console.error("[SELF-HEALING] Intercepted Crash:", stack);
                global.broadcastToAi({ type: 'CRASH_REPORT', data: stack });
            });
            process.on('unhandledRejection', (reason, promise) => {
                const stack = reason.stack || reason.toString();
                console.error("[SELF-HEALING] Unhandled Rejection:", stack);
                global.broadcastToAi({ type: 'CRASH_REPORT', data: stack });
            });

        } catch(e) { }

        // ═══════════════════════════════════════════════════
        // AI BUILDER MODE — early return AFTER WebSocket is up
        // ═══════════════════════════════════════════════════
        if (isAiBuilderMode) {
            aiBuilderWindow = new BrowserWindow({
                width: 1400,
                height: 900,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                    webSecurity: false
                },
                autoHideMenuBar: true,
                title: 'AI Assistant - Flowork OS',
                icon: iconPath
            });
            aiBuilderWindow.loadFile(path.join(__dirname, 'ai-builder.html'));
            aiBuilderWindow.on('closed', () => app.quit());
            aiBuilderWindow.once('ready-to-show', () => aiBuilderWindow.show());
            return;
        }

        try {
            if (fs.existsSync(EXTENSION_PATH)) await session.defaultSession.loadExtension(EXTENSION_PATH, { allowFileAccess: true });
        } catch (error) { }

        loadFloworkModules();

        createSplashWindow();
        createTray();
        setTimeout(() => { createWindow(); }, 2000);
        app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createSplashWindow(); });
    });

    app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isQuitting) app.quit(); });

    ipcMain.on('sync-storage-to-main', (event, changes) => {
        const payload = {};
        for (let key in changes) payload[key] = changes[key].newValue;

        if (mainFloworkView) {
            mainFloworkView.webContents.executeJavaScript(`
              window.postMessage({ type: 'FLOWORK_SYNC_STORAGE', detail: ${JSON.stringify(payload)} }, '*');
          `).catch(() => { });
        }
    });

    ipcMain.handle('app:shutdown', () => { isQuitting = true; app.quit(); });

    ipcMain.handle('app:open-log-window', () => {
        if (!logWindow || logWindow.isDestroyed()) {
            createLogWindow();
            logWindow.once('ready-to-show', () => {
                logWindow.show();
            });
        } else {
            if (!logWindow.isVisible()) {
                logWindow.show();
            }
            if (logWindow.isMinimized()) {
                logWindow.restore();
            }
            logWindow.focus();
        }
        return { success: true };
    });

    ipcMain.handle('app:open-ai-builder', () => {
        const childArgs = app.isPackaged ? ['--ai-builder'] : ['.', '--ai-builder'];
        const child = spawn(process.execPath, childArgs, { detached: true, stdio: 'ignore' });
        child.unref();
        return { success: true };
    });


    const originalLog = console.log; const originalError = console.error; const originalWarn = console.warn; const originalInfo = console.info;

    function sendToLogViewer(type, originalFn, args) {
        const textMsg = args.join(' ');
        if (textMsg.includes('ExtensionLoadWarning')) return;

        try { originalFn.apply(console, args); } catch (e) { }
        const logEntry = { text: textMsg, type: type, time: new Date().toLocaleTimeString() };

        if (logWindow && !logWindow.isDestroyed()) logWindow.webContents.send('engine:receive-log', logEntry);
        else logBuffer.push(logEntry);

        // Also forward to dashboard (if loaded)
        try {
            if (mainFloworkView && !mainFloworkView.webContents.isDestroyed()) {
                mainFloworkView.webContents.send('engine:log', logEntry);
            }
        } catch(e) {}
    }

    console.log = function (...args) { sendToLogViewer('engine', originalLog, args); };
    console.error = function (...args) { sendToLogViewer('error', originalError, args); };
    console.warn = function (...args) { sendToLogViewer('warn', originalWarn, args); };
    console.info = function (...args) { sendToLogViewer('engine', originalInfo, args); };

    ipcMain.on('app:log', (event, data) => {
        const type = data.type || 'INFO';
        let msg = data.isEngineLog ? data.message : `[Web UI] [${type}] ${data.message}`;
        if (!data.isEngineLog) { try { originalLog(msg); } catch (e) { } }
        const logEntry = { text: msg, type: type.toLowerCase(), time: new Date().toLocaleTimeString() };
        if (logWindow && !logWindow.isDestroyed()) logWindow.webContents.send('engine:receive-log', logEntry);
        else logBuffer.push(logEntry);
    });

    const { dialog } = require('electron');
    global.confirm = function (message) {
        const choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'question',
            buttons: ['Yes', 'Cancel'],
            title: 'Confirm Action',
            message: message
        });
        return choice === 0;
    };

    ipcMain.handle('app:set-sync-role', (event, id, role) => {
        if (role.isMaster) {
            masterSyncId = id;
        } else if (masterSyncId === id) {
            masterSyncId = null;
        }
        followerSyncStates[id] = role.isFollower;
        return { success: true };
    });

    ipcMain.on('app:sync-action', (event, action) => {
        let senderId = null;
        for (const id in browserViews) {
            if (browserViews[id] && browserViews[id].webContents && browserViews[id].webContents.id === event.sender.id) {
                senderId = id;
                break;
            }
        }

        if (senderId && senderId === masterSyncId) {
            for (const id in browserViews) {
                if (id !== masterSyncId && followerSyncStates[id] !== false && browserViews[id] && !browserViews[id].webContents.isDestroyed()) {
                    browserViews[id].webContents.send('app:execute-sync', action);
                }
            }
        }
    });

    ipcMain.on('app:get-fp-config', (event) => {
        event.returnValue = botFpConfigs[event.sender.id] || { cpu: 8, ram: 8, vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel)', noiseR: 1, noiseG: 1, noiseB: 1, ghostCursor: false, bandwidthSaver: false };
    });
}