//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : flowork_modules/view_manager.js
//#1. Dynamic Component Discovery (DCD): Modul ini akan otomatis terdeteksi.
//#2. Atomic Isolation: Khusus menghandle logic UI Layout, Grid, Sidebar & Modal.
//#######################################################################

const { BrowserView } = require('electron');

module.exports = {
    name: 'View & Layout Manager',

    init: function (ipcMain, FloworkState, childProcess, pathModule, appModule, baseDir, fs, session) {
        console.log(`[PLUGIN] ${this.name} Loaded Successfully!`);

        // Mendaftarkan fungsi ke global methods agar bisa dipanggil oleh modul lain (seperti bot_manager)
        FloworkState.methods.updateViewsVisibility = function () {
            const mainWindow = FloworkState.mainWindow;
            const mainFloworkView = FloworkState.mainFloworkView;
            const browserViews = FloworkState.browserViews;
            const isModalOpen = FloworkState.isModalOpen;
            const activeMode = FloworkState.activeMode;
            const activeNormalDeviceId = FloworkState.activeNormalDeviceId;

            if (!mainWindow) return;
            if (mainFloworkView) mainWindow.removeBrowserView(mainFloworkView);
            for (const id in browserViews) {
                if (browserViews[id] && browserViews[id].constructor && browserViews[id].constructor.name === 'BrowserWindow') continue;
                try { mainWindow.removeBrowserView(browserViews[id]); } catch (e) {}
            }

            if (FloworkState.appTabs) {
                for (const id in FloworkState.appTabs) {
                    if (FloworkState.appTabs[id] && FloworkState.appTabs[id].view) {
                        try { mainWindow.removeBrowserView(FloworkState.appTabs[id].view); } catch (e) { }
                    }
                }
            }

            if (isModalOpen) {
                return;
            }

            if (activeMode === 'FLOWORK') {
                if (FloworkState.activeAppTabId && FloworkState.appTabs && FloworkState.appTabs[FloworkState.activeAppTabId] && FloworkState.appTabs[FloworkState.activeAppTabId].view) {
                    mainWindow.addBrowserView(FloworkState.appTabs[FloworkState.activeAppTabId].view);
                } else if (mainFloworkView) {
                    mainWindow.addBrowserView(mainFloworkView);
                }
            } else if (activeMode === 'GRID') {
                for (const id in browserViews) {
                    if (browserViews[id] && browserViews[id].constructor && browserViews[id].constructor.name === 'BrowserWindow') continue;
                    try { mainWindow.addBrowserView(browserViews[id]); } catch (e) {}
                }
            } else if (activeMode === 'NORMAL' && activeNormalDeviceId && browserViews[activeNormalDeviceId]) {
                if (browserViews[activeNormalDeviceId] && browserViews[activeNormalDeviceId].constructor && browserViews[activeNormalDeviceId].constructor.name !== 'BrowserWindow') {
                    try { mainWindow.addBrowserView(browserViews[activeNormalDeviceId]); } catch (e) {}
                }
            }
            if (FloworkState.methods.resizeAllViews) FloworkState.methods.resizeAllViews();
        };

        FloworkState.methods.resizeAllViews = function () {
            const mainWindow = FloworkState.mainWindow;
            const isSidebarOpen = FloworkState.isSidebarOpen;
            const activeMode = FloworkState.activeMode;
            const mainFloworkView = FloworkState.mainFloworkView;
            const activeNormalDeviceId = FloworkState.activeNormalDeviceId;
            const browserViews = FloworkState.browserViews;
            const gridOrder = FloworkState.gridOrder;
            let gridScrollY = FloworkState.gridScrollY;

            if (!mainWindow) return;
            const [winWidth, winHeight] = mainWindow.getContentSize();
            const GAP = 15;
            let TOP_BAR_HEIGHT = 60; // Default Top offset for index.html control-panel
            let LEFT_OFFSET = 70;    // Default Left offset for index.html fw-tab-bar
            let viewWidth = winWidth - LEFT_OFFSET;

            // centerBounds is only applicable if we render something *inside* the dashboard workspace
            if (activeMode === 'FLOWORK' && FloworkState.centerBounds && FloworkState.centerBounds.width > 0) {
                TOP_BAR_HEIGHT = FloworkState.centerBounds.y + 60; // Offset by index.html top bar
                LEFT_OFFSET = FloworkState.centerBounds.x + 70; // Offset by index.html sidebar
                viewWidth = FloworkState.centerBounds.width;
            }

            const TOTAL_TOP_OFFSET = TOP_BAR_HEIGHT;
            let layoutData = [];

            // mainFloworkView is the dashboard — exclude 70px sidebar, 60px top bar
            // Header tabs are now inline in control panel (no extra height needed)
            if (activeMode === 'FLOWORK' && mainFloworkView) {
                mainFloworkView.setBounds({ x: 70, y: 60, width: winWidth - 70, height: winHeight - 60 });
            }
            else if (activeMode === 'NORMAL' && activeNormalDeviceId && browserViews[activeNormalDeviceId]) {
                browserViews[activeNormalDeviceId].setBounds({ x: LEFT_OFFSET, y: TOTAL_TOP_OFFSET, width: viewWidth, height: winHeight - TOTAL_TOP_OFFSET });
            }
            else if (activeMode === 'GRID') {
                const keys = gridOrder.filter(id => browserViews[id]);
                const viewsCount = keys.length;

                if (viewsCount > 0) {
                    const FRAME_HEADER = 35;
                    const FRAME_FOOTER = 30;
                    const FRAME_SIDE = 10;

                    let cols = Math.max(1, Math.floor((viewWidth - GAP) / (360 + GAP)));
                    let rows = Math.ceil(viewsCount / cols);

                    let webW = Math.floor((viewWidth - (cols + 1) * GAP) / cols) - (FRAME_SIDE * 2);
                    let webH = Math.floor(webW * 1.5);
                    if (webH < 450) webH = 450;

                    let cardW = webW + (FRAME_SIDE * 2);
                    let cardH = webH + FRAME_HEADER + FRAME_FOOTER;

                    let totalHeight = GAP + rows * (cardH + GAP);
                    let maxGridScrollY = Math.max(0, totalHeight - (winHeight - TOTAL_TOP_OFFSET));
                    FloworkState.maxGridScrollY = maxGridScrollY;

                    if (gridScrollY > maxGridScrollY) gridScrollY = maxGridScrollY;
                    if (gridScrollY < 0) gridScrollY = 0;
                    FloworkState.gridScrollY = gridScrollY;

                    let colIdx = 0, rowIdx = 0;
                    for (let i = 0; i < viewsCount; i++) {
                        const id = keys[i];

                        // Apply LEFT_OFFSET to properly shift the grid away from the new sidebar
                        let cardX = LEFT_OFFSET + GAP + colIdx * (cardW + GAP);
                        let cardY = TOTAL_TOP_OFFSET + GAP + rowIdx * (cardH + GAP) - gridScrollY;

                        let bvX = cardX + FRAME_SIDE;
                        let bvY = cardY + FRAME_HEADER;

                        browserViews[id].setBounds({ x: bvX, y: bvY, width: webW, height: webH });

                        layoutData.push({ id, x: cardX, y: cardY, w: cardW, h: cardH });

                        colIdx++;
                        if (colIdx >= cols) { colIdx = 0; rowIdx++; }
                    }
                }
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('app:update-grid-ui', layoutData, activeMode);
            }
        };

        ipcMain.handle('app:toggle-modal', (event, isOpen) => {
            FloworkState.isModalOpen = isOpen;
            if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
            return { success: true };
        });

        ipcMain.handle('app:toggle-sidebar-margin', (event, isOpen) => {
            FloworkState.isSidebarOpen = isOpen;
            if (FloworkState.methods.resizeAllViews) FloworkState.methods.resizeAllViews();
            return { success: true };
        });

        ipcMain.handle('app:swap-devices', (event, id1, id2) => {
            const gridOrder = FloworkState.gridOrder;
            const idx1 = gridOrder.indexOf(id1);
            const idx2 = gridOrder.indexOf(id2);
            if (idx1 !== -1 && idx2 !== -1) {
                [gridOrder[idx1], gridOrder[idx2]] = [gridOrder[idx2], gridOrder[idx1]];
                FloworkState.gridOrder = gridOrder;
                if (FloworkState.methods.resizeAllViews) FloworkState.methods.resizeAllViews();
            }
            return { success: true };
        });

        ipcMain.handle('app:init-flowork', async () => {
            if (!FloworkState.mainWindow) return { success: false };
            const coreSession = session.fromPartition('persist:flowork_core');
            try {
                if (fs.existsSync(FloworkState.EXTENSION_PATH)) {
                    const loadedExts = coreSession.getAllExtensions();
                    if (loadedExts.length === 0) await coreSession.loadExtension(FloworkState.EXTENSION_PATH, { allowFileAccess: true });
                }
            } catch (err) { }

            if (!FloworkState.mainFloworkView) {
                FloworkState.mainFloworkView = new BrowserView({
                    webPreferences: {
                        partition: 'persist:flowork_core',
                        nodeIntegration: true,
                        contextIsolation: false,
                        preload: pathModule.join(baseDir, 'preload.js')
                    }
                });
                // Load local dashboard instead of remote webview
                const dashboardPath = pathModule.join(baseDir, 'dashboard.html');
                if (fs.existsSync(dashboardPath)) {
                    FloworkState.mainFloworkView.webContents.loadFile(dashboardPath);
                    console.log('[ViewManager] ✅ Dashboard loaded as initial view (satu tubuh)');
                } else {
                    FloworkState.mainFloworkView.webContents.loadURL(FloworkState.TARGET_URL);
                    console.log('[ViewManager] Dashboard not found, fallback to webview');
                }
            }
            FloworkState.activeMode = 'FLOWORK';
            if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
            return { success: true };
        });

        // [NAV WEBVIEW] Navigate mainFloworkView to a specific webview URL
        ipcMain.handle('app:navigate-flowork', async (event, url) => {
            if (!FloworkState.mainWindow) return { success: false };

            // Ensure mainFloworkView exists (init if needed)
            if (!FloworkState.mainFloworkView) {
                const coreSession = session.fromPartition('persist:flowork_core');
                try {
                    if (fs.existsSync(FloworkState.EXTENSION_PATH)) {
                        const loadedExts = coreSession.getAllExtensions();
                        if (loadedExts.length === 0) await coreSession.loadExtension(FloworkState.EXTENSION_PATH, { allowFileAccess: true });
                    }
                } catch (err) { }

                FloworkState.mainFloworkView = new BrowserView({
                    webPreferences: {
                        partition: 'persist:flowork_core',
                        nodeIntegration: true,
                        contextIsolation: false,
                        preload: pathModule.join(baseDir, 'preload.js')
                    }
                });
            }

            // Navigate to requested URL
            FloworkState.mainFloworkView.webContents.loadURL(url);
            FloworkState.activeMode = 'FLOWORK';
            if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
            return { success: true };
        });

        ipcMain.handle('app:switch-to-grid', () => {
            if (!FloworkState.mainWindow) return { success: false };
            FloworkState.activeMode = 'GRID';
            if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
            return { success: true };
        });

        ipcMain.handle('app:switch-to-normal', (event, id) => {
            if (!FloworkState.mainWindow || !FloworkState.browserViews[id]) return { success: false };
            FloworkState.activeMode = 'NORMAL';
            FloworkState.activeNormalDeviceId = id;
            if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
            return { success: true };
        });

        ipcMain.handle('app:scroll-grid', (event, offsetY) => {
            FloworkState.gridScrollY += offsetY;
            if (FloworkState.gridScrollY < 0) FloworkState.gridScrollY = 0;
            if (FloworkState.gridScrollY > FloworkState.maxGridScrollY) FloworkState.gridScrollY = FloworkState.maxGridScrollY;
            if (FloworkState.methods.resizeAllViews) FloworkState.methods.resizeAllViews();
            return { success: true };
        });

        // [DASHBOARD] — Quick Action navigation from dashboard cards
        ipcMain.handle('app:dashboard-navigate', async (event, target) => {
            if (!FloworkState.mainWindow) return { success: false };

            console.log('[Dashboard] Navigate:', target);
            
            // Forward everything to the index.html renderer to handle using the "normal header" logic
            if (FloworkState.mainWindow && !FloworkState.mainWindow.isDestroyed()) {
                FloworkState.mainWindow.webContents.send('app:dashboard-action', target);
            }
            return { success: true };
        });

        // [TUTORIAL] Fetch YouTube playlist RSS via Node.js (bypass CORS in renderer)
        ipcMain.handle('app:fetch-tutorials', async () => {
            const PLAYLIST_ID = 'PLATUnnrT5igDXCqjBVvkmE4UKq9XASUtT';
            const rssUrl = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + PLAYLIST_ID;
            try {
                const response = await require('electron').net.fetch(rssUrl);
                const text = await response.text();
                // Parse XML entries
                const entries = [];
                const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
                let match;
                while ((match = entryRegex.exec(text)) !== null) {
                    const entry = match[1];
                    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
                    const linkMatch = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/>/);
                    const videoIdMatch = entry.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/);
                    const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
                    const title = titleMatch ? titleMatch[1].trim() : 'Unknown Title';
                    const link = linkMatch ? linkMatch[1] : '#';
                    let videoId = '';
                    if (videoIdMatch) {
                        videoId = videoIdMatch[1].trim();
                    } else if (idMatch) {
                        videoId = idMatch[1].replace('yt:video:', '').trim();
                    }
                    entries.push({
                        title,
                        link,
                        videoId,
                        thumbnail: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg'
                    });
                }
                console.log('[Tutorial] Fetched ' + entries.length + ' tutorials from YouTube RSS');
                return { success: true, tutorials: entries };
            } catch (err) {
                console.error('[Tutorial] RSS fetch failed:', err.message);
                return { success: false, error: err.message, tutorials: [] };
            }
        });
    }
};