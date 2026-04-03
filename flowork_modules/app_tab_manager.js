// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: flowork_modules/app_tab_manager.js
// DESKRIPSI: Multi-App Tab System via BrowserView.
//            Creates/manages BrowserView tabs for apps opened from store/login.
// =========================================================================

const { BrowserView } = require('electron');

module.exports = {
    name: 'App Tab Manager',

    init: function(ipcMain, FloworkState, childProcess, pathModule, appModule, baseDir, fs, session) {
        console.log(`[PLUGIN] ${this.name} Loaded Successfully!`);

        // State for app tabs (separate from bot browserViews)
        if (!FloworkState.appTabs) {
            FloworkState.appTabs = {}; // { tabId: { view: BrowserView, name, url } }
        }
        if (!FloworkState.activeAppTabId) {
            FloworkState.activeAppTabId = null;
        }

        function getTabBounds() {
            const mainWindow = FloworkState.mainWindow;
            if (!mainWindow) return { x: 0, y: 0, width: 800, height: 600 };
            const [winWidth, winHeight] = mainWindow.getContentSize();
            const sidebar = 70; // Width of fw-tab-bar
            const controlPanel = 60; // Height of control-panel
            // Header tabs are now inline in control panel (no extra height)
            return {
                x: sidebar,
                y: controlPanel,
                width: winWidth - sidebar,
                height: winHeight - controlPanel
            };
        }

        function hideMainFloworkView() {
            const mainWindow = FloworkState.mainWindow;
            const mainFloworkView = FloworkState.mainFloworkView;
            if (mainWindow && mainFloworkView) {
                mainWindow.removeBrowserView(mainFloworkView);
            }
        }

        function showMainFloworkView() {
            const mainWindow = FloworkState.mainWindow;
            const mainFloworkView = FloworkState.mainFloworkView;
            if (mainWindow && mainFloworkView) {
                // Re-add mainFloworkView
                mainWindow.addBrowserView(mainFloworkView);
                // Restore bounds excluding top bar (60px) and left tab bar (70px)
                const [winWidth, winHeight] = mainWindow.getContentSize();
                mainFloworkView.setBounds({
                    x: 70,
                    y: 60,
                    width: winWidth - 70,
                    height: winHeight - 60
                });
            }
        }

        function hideAllAppTabs() {
            const mainWindow = FloworkState.mainWindow;
            if (!mainWindow) return;
            for (const id in FloworkState.appTabs) {
                const tab = FloworkState.appTabs[id];
                if (tab.view && !tab.view.webContents.isDestroyed()) {
                    mainWindow.removeBrowserView(tab.view);
                }
            }
        }

        function showAppTab(tabId) {
            const mainWindow = FloworkState.mainWindow;
            if (!mainWindow) return;
            const tab = FloworkState.appTabs[tabId];
            if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;

            // Hide main flowork view
            hideMainFloworkView();

            // Hide all other app tabs
            hideAllAppTabs();

            // Show this tab
            mainWindow.addBrowserView(tab.view);
            tab.view.setBounds(getTabBounds());

            FloworkState.activeAppTabId = tabId;
        }

        // ═════════════════════════════════════════════════════════════
        // IPC: OPEN APP TAB
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:open-app-tab', (event, appId, appName, appUrl) => {
            const mainWindow = FloworkState.mainWindow;
            if (!mainWindow) return { success: false, error: 'No main window' };

            // If tab already exists, just switch to it
            if (FloworkState.appTabs[appId]) {
                showAppTab(appId);
                // Notify index.html to update tab UI
                mainWindow.webContents.send('app:tab-opened', appId, appName);
                return { success: true, tabId: appId, existing: true };
            }

            // Create preload session for app tab
            const partition = `persist:apptab_${appId}`;
            const tabSession = session.fromPartition(partition);

            // Create new BrowserView for this app
            const view = new BrowserView({
                webPreferences: {
                    partition: partition,
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: false
                }
            });

            view.webContents.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            view.webContents.loadURL(appUrl);

            // Store tab
            FloworkState.appTabs[appId] = {
                view: view,
                name: appName || appId,
                url: appUrl,
                partition: partition
            };

            // Attach console listener for AI
            if (!FloworkState.consoleLogs[`tab:${appId}`]) {
                FloworkState.consoleLogs[`tab:${appId}`] = [];
            }
            view.webContents.on('console-message', (ev, level, message, line, sourceId) => {
                const levelMap = { 0: 'LOG', 1: 'WARN', 2: 'ERROR' };
                const entry = {
                    level: levelMap[level] || 'LOG',
                    message: message ? message.substring(0, 500) : '',
                    source: sourceId ? sourceId.substring(0, 100) : '',
                    line: line,
                    ts: Date.now()
                };
                if (!FloworkState.consoleLogs[`tab:${appId}`]) {
                    FloworkState.consoleLogs[`tab:${appId}`] = [];
                }
                FloworkState.consoleLogs[`tab:${appId}`].push(entry);
                if (FloworkState.consoleLogs[`tab:${appId}`].length > 100) {
                    FloworkState.consoleLogs[`tab:${appId}`] = FloworkState.consoleLogs[`tab:${appId}`].slice(-100);
                }
            });

            // Show this tab
            showAppTab(appId);

            // Notify BOTH index.html AND mainFloworkView about the new tab
            mainWindow.webContents.send('app:tab-opened', appId, appName);
            if (FloworkState.mainFloworkView && !FloworkState.mainFloworkView.webContents.isDestroyed()) {
                FloworkState.mainFloworkView.webContents.send('app:tab-opened', appId, appName);
            }

            if (FloworkState.methods && FloworkState.methods.resizeAllViews) {
                FloworkState.methods.resizeAllViews();
            }

            return { success: true, tabId: appId };
        });

        // ═════════════════════════════════════════════════════════════
        // IPC: CLOSE APP TAB — Full kill: destroy BrowserView + clear memory
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:close-app-tab', (event, appId) => {
            const mainWindow = FloworkState.mainWindow;
            const tab = FloworkState.appTabs[appId];
            if (!tab) return { success: false, error: 'Tab not found' };

            // Step 1: Remove from window
            if (mainWindow && tab.view) {
                mainWindow.removeBrowserView(tab.view);
            }

            // Step 2: Full kill the webContents
            if (tab.view && !tab.view.webContents.isDestroyed()) {
                try {
                    // Stop any ongoing loading
                    tab.view.webContents.stop();
                    // Navigate to blank to halt all JS execution immediately
                    tab.view.webContents.loadURL('about:blank');
                    // Remove all event listeners to prevent leaks
                    tab.view.webContents.removeAllListeners();
                    // Destroy the webContents (frees Chromium renderer process)
                    tab.view.webContents.destroy();
                } catch (e) {
                    console.log(`[TabManager] Cleanup error for ${appId}:`, e.message);
                }
            }

            // Step 3: Clear session cache for this tab's partition
            if (tab.partition) {
                try {
                    const tabSession = session.fromPartition(tab.partition);
                    tabSession.clearCache();
                    tabSession.clearStorageData();
                } catch (e) {
                    // Partition might already be cleaned
                }
            }

            // Step 4: Remove from state
            delete FloworkState.appTabs[appId];
            delete FloworkState.consoleLogs[`tab:${appId}`];

            // Step 5: Switch to another tab or home
            if (FloworkState.activeAppTabId === appId) {
                const remainingTabs = Object.keys(FloworkState.appTabs);
                if (remainingTabs.length > 0) {
                    showAppTab(remainingTabs[remainingTabs.length - 1]);
                } else {
                    FloworkState.activeAppTabId = null;
                    showMainFloworkView();
                }
            }

            // Step 6: Notify UI
            if (mainWindow) {
                mainWindow.webContents.send('app:tab-closed', appId);
            }
            if (FloworkState.mainFloworkView && !FloworkState.mainFloworkView.webContents.isDestroyed()) {
                FloworkState.mainFloworkView.webContents.send('app:tab-closed', appId);
            }

            if (FloworkState.methods && FloworkState.methods.resizeAllViews) {
                FloworkState.methods.resizeAllViews();
            }

            console.log(`[TabManager] Tab ${appId} fully destroyed.`);
            return { success: true };
        });

        // ═════════════════════════════════════════════════════════════
        // IPC: SWITCH APP TAB
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:switch-app-tab', (event, appId) => {
            if (appId === '__HOME__' || !appId) {
                hideAllAppTabs();
                FloworkState.activeAppTabId = null;
                showMainFloworkView();
                return { success: true };
            }

            if (!FloworkState.appTabs[appId]) {
                return { success: false, error: 'Tab not found' };
            }

            showAppTab(appId);
            return { success: true };
        });

        // ═════════════════════════════════════════════════════════════
        // IPC: RELOAD APP TAB
        // ═════════════════════════════════════════════════════════════
        ipcMain.handle('app:reload-app-tab', (event, appId) => {
            if (appId === '__HOME__' || !appId) {
                if (FloworkState.mainFloworkView && !FloworkState.mainFloworkView.webContents.isDestroyed()) {
                    FloworkState.mainFloworkView.webContents.reloadIgnoringCache();
                    return { success: true };
                }
            } else if (appId && FloworkState.appTabs[appId]) {
                const tab = FloworkState.appTabs[appId];
                if (tab.view && !tab.view.webContents.isDestroyed()) {
                    tab.view.webContents.reloadIgnoringCache();
                    return { success: true };
                }
            }
            return { success: false, error: 'Tab not found or destroyed' };
        });

        // ═════════════════════════════════════════════════════════════
        // RESIZE HANDLER — adjust tab bounds on window resize
        // ═════════════════════════════════════════════════════════════
        const originalResizeAll = FloworkState.methods.resizeAllViews;
        FloworkState.methods.resizeAllViews = function() {
            // Call original resize logic
            if (originalResizeAll) originalResizeAll();

            // Also resize active app tab
            if (FloworkState.activeAppTabId && FloworkState.appTabs[FloworkState.activeAppTabId]) {
                const tab = FloworkState.appTabs[FloworkState.activeAppTabId];
                if (tab.view && !tab.view.webContents.isDestroyed()) {
                    tab.view.setBounds(getTabBounds());
                }
            }
        };
    }
};
