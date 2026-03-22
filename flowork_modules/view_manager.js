//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : flowork_modules/view_manager.js
//#1. Dynamic Component Discovery (DCD): Modul ini akan otomatis terdeteksi.
//#2. Atomic Isolation: Khusus menghandle logic UI Layout, Grid, Sidebar & Modal.
//#######################################################################

const { BrowserView } = require('electron');

module.exports = {
    name: 'View & Layout Manager',

    init: function(ipcMain, FloworkState, childProcess, pathModule, appModule, baseDir, fs, session) {
        console.log(`[PLUGIN] ${this.name} Loaded Successfully!`);

        // Mendaftarkan fungsi ke global methods agar bisa dipanggil oleh modul lain (seperti bot_manager)
        FloworkState.methods.updateViewsVisibility = function() {
            const mainWindow = FloworkState.mainWindow;
            const mainFloworkView = FloworkState.mainFloworkView;
            const browserViews = FloworkState.browserViews;
            const isModalOpen = FloworkState.isModalOpen;
            const activeMode = FloworkState.activeMode;
            const activeNormalDeviceId = FloworkState.activeNormalDeviceId;

            if (!mainWindow) return;
            if (mainFloworkView) mainWindow.removeBrowserView(mainFloworkView);
            for (const id in browserViews) mainWindow.removeBrowserView(browserViews[id]);

            if (isModalOpen) {
                return;
            }

            if (activeMode === 'FLOWORK' && mainFloworkView) {
                mainWindow.addBrowserView(mainFloworkView);
            } else if (activeMode === 'GRID') {
                for (const id in browserViews) mainWindow.addBrowserView(browserViews[id]);
            } else if (activeMode === 'NORMAL' && activeNormalDeviceId && browserViews[activeNormalDeviceId]) {
                mainWindow.addBrowserView(browserViews[activeNormalDeviceId]);
            }
            if (FloworkState.methods.resizeAllViews) FloworkState.methods.resizeAllViews();
        };

        FloworkState.methods.resizeAllViews = function() {
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
            const TOP_BAR_HEIGHT = 60;
            const GAP = 15;
            const SIDEBAR_WIDTH = 260;

            let viewWidth = winWidth;
            if (isSidebarOpen) {
                viewWidth = winWidth - SIDEBAR_WIDTH;
            }

            let layoutData = [];

            if (activeMode === 'FLOWORK' && mainFloworkView) {
                mainFloworkView.setBounds({ x: 0, y: TOP_BAR_HEIGHT, width: viewWidth, height: winHeight - TOP_BAR_HEIGHT });
            }
            else if (activeMode === 'NORMAL' && activeNormalDeviceId && browserViews[activeNormalDeviceId]) {
                browserViews[activeNormalDeviceId].setBounds({ x: 0, y: TOP_BAR_HEIGHT, width: viewWidth, height: winHeight - TOP_BAR_HEIGHT });
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
                    let maxGridScrollY = Math.max(0, totalHeight - (winHeight - TOP_BAR_HEIGHT));
                    FloworkState.maxGridScrollY = maxGridScrollY;

                    if (gridScrollY > maxGridScrollY) gridScrollY = maxGridScrollY;
                    if (gridScrollY < 0) gridScrollY = 0;
                    FloworkState.gridScrollY = gridScrollY;

                    let colIdx = 0, rowIdx = 0;
                    for (let i = 0; i < viewsCount; i++) {
                        const id = keys[i];

                        let cardX = GAP + colIdx * (cardW + GAP);
                        let cardY = TOP_BAR_HEIGHT + GAP + rowIdx * (cardH + GAP) - gridScrollY;

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
            } catch (err) {}

            if (!FloworkState.mainFloworkView) {
                FloworkState.mainFloworkView = new BrowserView({
                    webPreferences: {
                        partition: 'persist:flowork_core',
                        nodeIntegration: false,
                        contextIsolation: true,
                        preload: pathModule.join(baseDir, 'preload.js')
                    }
                });
                FloworkState.mainFloworkView.webContents.loadURL(FloworkState.TARGET_URL);
            }
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
    }
};