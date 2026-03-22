//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : flowork_modules/bot_manager.js
//#1. Dynamic Component Discovery (DCD): Modul ini akan otomatis terdeteksi.
//#2. Atomic Isolation: Khusus menghandle logic Core Bot, Scanner Popup, Menu & Navigasi.
//#######################################################################

const { BrowserView, BrowserWindow, Menu, shell } = require('electron');

module.exports = {
    name: 'Bot Engine & Stealth Manager',

    init: function(ipcMain, FloworkState, childProcess, pathModule, appModule, baseDir, fs, session) {
        console.log(`[PLUGIN] ${this.name} Loaded Successfully!`);

        async function openScannerPopup(targetUrl, botPartition, sourceContents, sourceId, fpConfig, customUA) {
            if (!FloworkState.mainWindow) return;

            try {
                let sourceUrl = "https://floworkos.com";
                let rawCookiesArray = [];

                if (sourceContents) {
                    sourceUrl = sourceContents.getURL();
                    rawCookiesArray = await sourceContents.session.cookies.get({});
                }

                const extSessionData = {
                    deviceId: sourceId || 9999,
                    url: sourceUrl,
                    cookies: rawCookiesArray
                };

                const popupWin = new BrowserWindow({
                    width: 1100,
                    height: 750,
                    title: 'Flowork DeepScan',
                    icon: FloworkState.iconPath,
                    webPreferences: {
                        partition: botPartition,
                        nodeIntegration: false,
                        contextIsolation: true,
                        nodeIntegrationInSubFrames: true,
                        preload: pathModule.join(baseDir, 'stealth-preload.js')
                    }
                });

                let finalFp = fpConfig || { cpu: 8, ram: 8, vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel)', noiseR: 1, noiseG: 1, noiseB: 1, proxy: 'Direct' };
                FloworkState.botFpConfigs[popupWin.webContents.id] = finalFp;

                popupWin.webContents.once('destroyed', () => {
                    delete FloworkState.botFpConfigs[popupWin.webContents.id];
                });

                let finalUA = customUA || appModule.userAgentFallback;
                popupWin.webContents.setUserAgent(finalUA);

                popupWin.setMenuBarVisibility(false);

                popupWin.webContents.once('did-finish-load', () => {
                    popupWin.webContents.executeJavaScript(`
                        if (window.chrome && window.chrome.storage) {
                            window.chrome.storage.local.set({
                                flowork_active_session: ${JSON.stringify(extSessionData)},
                                flowork_target_tab_id: ${JSON.stringify(sourceId || 9999)}
                            });
                        }
                    `).catch(()=>{});
                });

                popupWin.loadURL(targetUrl);

            } catch (err) {
                console.error("Gagal membuka Scanner Popup:", err);
            }
        }

        appModule.on('web-contents-created', (event, contents) => {
            contents.setWindowOpenHandler(({ url }) => {
                if (url.includes('floworkos.com/webview/') || url.includes('localhost:5173/webview/')) {
                    let sourceId = null;
                    let botPartition = 'persist:flowork_core';

                    let fpConfig = null;
                    let customUA = null;

                    for (const id in FloworkState.browserViews) {
                        if (FloworkState.browserViews[id].webContents === contents) {
                            sourceId = id;
                            if (FloworkState.browserViews[id].floworkPartition) {
                                botPartition = FloworkState.browserViews[id].floworkPartition;
                            }
                            fpConfig = FloworkState.botFpConfigs[contents.id];
                            customUA = contents.getUserAgent();
                            break;
                        }
                    }

                    openScannerPopup(url, botPartition, contents, sourceId, fpConfig, customUA);
                    return { action: 'deny' };
                }
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    shell.openExternal(url);
                }
                return { action: 'deny' };
            });
        });

        function showBotMenu(id, partition, view, params) {
            const pageUrl = (params && params.pageURL) ? params.pageURL : view.webContents.getURL();
            let hostname = '';
            try { hostname = new URL(pageUrl).hostname; } catch(err) {}
            const menuItems = [];

            menuItems.push({ label: '--- DYNAMIC SETTINGS ---', type: 'separator' });

            menuItems.push({
                label: '🔇 Stealth Mute (OS Level)',
                type: 'checkbox',
                checked: view.webContents.isAudioMuted(),
                click: (menuItem) => {
                    view.webContents.setAudioMuted(menuItem.checked);
                    console.log(`[STEALTH] Bot [${id}] Stealth Mute: ${menuItem.checked}`);
                }
            });

            menuItems.push({
                label: '📉 Low Bandwidth Mode (Auto 144p)',
                type: 'checkbox',
                checked: FloworkState.botFpConfigs[view.webContents.id] ? FloworkState.botFpConfigs[view.webContents.id].bandwidthSaver : false,
                click: (menuItem) => {
                    if(FloworkState.botFpConfigs[view.webContents.id]) {
                        FloworkState.botFpConfigs[view.webContents.id].bandwidthSaver = menuItem.checked;
                        view.webContents.send('app:update-dynamic-config', FloworkState.botFpConfigs[view.webContents.id]);
                    }
                }
            });

            menuItems.push({
                label: '👻 Ghost Cursor (Auto Hover)',
                type: 'checkbox',
                checked: FloworkState.botFpConfigs[view.webContents.id] ? FloworkState.botFpConfigs[view.webContents.id].ghostCursor : false,
                click: (menuItem) => {
                    if(FloworkState.botFpConfigs[view.webContents.id]) {
                        FloworkState.botFpConfigs[view.webContents.id].ghostCursor = menuItem.checked;
                        view.webContents.send('app:update-dynamic-config', FloworkState.botFpConfigs[view.webContents.id]);
                    }
                }
            });

            menuItems.push({
                label: '💤 Human Sleep Cycle',
                type: 'checkbox',
                checked: FloworkState.botSleepStates[id] ? FloworkState.botSleepStates[id].useSleepCycle : false,
                click: (menuItem) => {
                    if (FloworkState.botSleepStates[id]) {
                        FloworkState.botSleepStates[id].useSleepCycle = menuItem.checked;
                        if (!menuItem.checked) {
                            FloworkState.botSleepStates[id].isSleeping = false;
                            if (FloworkState.botSleepStates[id].cycleTimer) clearTimeout(FloworkState.botSleepStates[id].cycleTimer);
                            console.log(`[ORGANIC MODE] 🛑 Bot [${id}] Sleep Cycle Dimatikan (FORCE WAKE UP).`);
                        } else {
                            FloworkState.botSleepStates[id].isSleeping = false;
                            if (FloworkState.botSleepStates[id].cycleTimer) clearTimeout(FloworkState.botSleepStates[id].cycleTimer);
                            console.log(`[ORGANIC MODE] 🟢 Bot [${id}] Sleep Cycle Diaktifkan Ulang.`);
                            FloworkState.botSleepStates[id].cycleTimer = setTimeout(() => FloworkState.botSleepStates[id].runCycle(id), FloworkState.botSleepStates[id].workMs);
                        }
                    }
                }
            });

            menuItems.push({ label: '------------------------', type: 'separator' });

            menuItems.push({ label: '⬅️ Back (Go to Previous Page)', click: () => {
                if (view && view.webContents.canGoBack()) {
                    view.webContents.goBack();
                }
            }});
            menuItems.push({ type: 'separator' });

            menuItems.push({ label: '🍪 Manage Session Cookies (Netscape)', click: () => {
                if (FloworkState.mainWindow) FloworkState.mainWindow.webContents.send('app:open-cookie-manager', id);
            }});
            menuItems.push({ type: 'separator' });

            menuItems.push({ label: 'ℹ️ Bot Identity Info', click: () => {
                const fpConfig = FloworkState.botFpConfigs[view.webContents.id];
                if(fpConfig) {
                    const infoMsg = `🤖 BOT IDENTITY CONFIG [${id}]\n--------------------------------\n` +
                                    `🌐 Proxy Mode: ${fpConfig.proxy}\n` +
                                    `💻 CPU Cores: ${fpConfig.cpu} Cores\n` +
                                    `🧠 RAM: ${fpConfig.ram} GB\n` +
                                    `🎨 VGA Vendor: ${fpConfig.vendor}\n` +
                                    `🖥️ VGA Renderer: ${fpConfig.renderer}\n` +
                                    `🖌️ Canvas Noise (RGB): [${fpConfig.noiseR}, ${fpConfig.noiseG}, ${fpConfig.noiseB}]`;
                    if (FloworkState.mainWindow) FloworkState.mainWindow.webContents.send('app:show-alert', infoMsg);
                }
            }});

            const customUA = view.webContents.getUserAgent();
            const fpConfig = FloworkState.botFpConfigs[view.webContents.id];

            menuItems.push({ label: '🕵️‍♂️ Live Check IP & OS (Whoer.net)', click: () => {
                openScannerPopup('https://whoer.net/', partition, view.webContents, id, fpConfig, customUA);
            }});
            menuItems.push({ label: '🛡️ Live Fingerprint Test (BrowserLeaks)', click: () => {
                openScannerPopup('https://browserleaks.com/webgl', partition, view.webContents, id, fpConfig, customUA);
            }});

            menuItems.push({ type: 'separator' });

            const extensionSubmenu = [];

            if (hostname.includes('tiktok.com')) {
                extensionSubmenu.push({ label: '🎯 Scan with TT DeepScan', click: () => {
                    view.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent('FLOWORK_TRIGGER_TT_DEEPSCAN'));`).catch(()=>{});
                    setTimeout(() => openScannerPopup('https://floworkos.com/webview/flow/tt-deepscan#openapp', partition, view.webContents, id, fpConfig, customUA), 150);
                }});
                if (hostname.includes('ads.tiktok.com') || hostname.includes('library.tiktok.com')) {
                    extensionSubmenu.push({ label: '🔥 DeepScan: TikTok Ad Radar', click: () => {
                        view.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent('FLOWORK_TRIGGER_TT_RADAR'));`).catch(()=>{});
                        setTimeout(() => openScannerPopup('https://floworkos.com/webview/flow/tt-radar#openapp', partition, view.webContents, id, fpConfig, customUA), 150);
                    }});
                }
            }
            if (hostname.includes('youtube.com')) {
                extensionSubmenu.push({ label: '🎯 Scan with YT DeepScan', click: () => {
                    view.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent('FLOWORK_TRIGGER_YT_DEEPSCAN'));`).catch(()=>{});
                    setTimeout(() => openScannerPopup('https://floworkos.com/webview/flow/yt-deepscan#openapp', partition, view.webContents, id, fpConfig, customUA), 150);
                }});
            }
            if (hostname.includes('shopee.co.id') || hostname.includes('shopee.com')) {
                extensionSubmenu.push({ label: '🛍️ Scan with Shopee DeepScan', click: () => {
                    view.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent('FLOWORK_TRIGGER_SHOPEE_DEEPSCAN'));`).catch(()=>{});
                    setTimeout(() => openScannerPopup('https://floworkos.com/webview/flow/shopee-checker#openapp', partition, view.webContents, id, fpConfig, customUA), 150);
                }});
            }
            if (hostname.includes('web.whatsapp.com')) {
                extensionSubmenu.push({ label: '🎯 Extract Group via WA Radar', click: () => {
                    view.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent('FLOWORK_TRIGGER_WA_RADAR'));`).catch(()=>{});
                    setTimeout(() => openScannerPopup('https://floworkos.com/webview/flow/wa-radar#openapp', partition, view.webContents, id, fpConfig, customUA), 150);
                }});
            }

            if (extensionSubmenu.length > 0) {
                extensionSubmenu.push({ type: 'separator' });
            }

            extensionSubmenu.push({ label: '🔎 Analyze Page SEO', click: () => {
                view.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent('FLOWORK_TRIGGER_SEO_SCAN'));`).catch(()=>{});
                setTimeout(() => openScannerPopup('https://floworkos.com/webview/flow/seo-checker#openapp', partition, view.webContents, id, fpConfig, customUA), 150);
            }});
            extensionSubmenu.push({ label: '🔥 [GOD MODE] Extract All JSON', click: () => {
                view.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent('FLOWORK_TRIGGER_GOD_MODE'));`).catch(()=>{});
                setTimeout(() => openScannerPopup('https://floworkos.com/webview/flow/god-mode-scan#openapp', partition, view.webContents, id, fpConfig, customUA), 150);
            }});

            menuItems.push({
                label: '🧩 Ekstensi & Scanner',
                submenu: extensionSubmenu
            });

            menuItems.push({ type: 'separator' });

            if (params) {
                menuItems.push({ label: '🔍 Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) });
            } else {
                menuItems.push({ label: '🔍 Open DevTools', click: () => view.webContents.openDevTools() });
            }

            menuItems.push({ label: '🔄 Reload Page', click: () => view.webContents.reload() });

            let dynamicProfiles = {};
            if (fs.existsSync(FloworkState.profileFile)) {
                try { dynamicProfiles = JSON.parse(fs.readFileSync(FloworkState.profileFile, 'utf8')); } catch(err) {}
            }
            const profileNames = Object.keys(dynamicProfiles);

            if (profileNames.length > 0) {
                menuItems.push({ type: 'separator' });

                menuItems.push({
                    label: '➕ Add to Profile...',
                    submenu: profileNames.map(name => ({
                        label: name,
                        click: () => {
                            if (FloworkState.mainWindow) FloworkState.mainWindow.webContents.send('app:add-to-profile', { id, name });
                        }
                    }))
                });

                menuItems.push({
                    label: '➖ Remove from Profile...',
                    submenu: profileNames.map(name => ({
                        label: name,
                        click: () => {
                            if (FloworkState.mainWindow) FloworkState.mainWindow.webContents.send('app:remove-from-profile', { id, name });
                        }
                    }))
                });
            }

            menuItems.push({ type: 'separator' });

            menuItems.push({ label: '❌ Close Tab (Remove from View)', click: () => {
                if (FloworkState.mainWindow && FloworkState.browserViews[id]) {
                    FloworkState.mainWindow.removeBrowserView(FloworkState.browserViews[id]);
                    FloworkState.browserViews[id].webContents.destroy();
                    delete FloworkState.browserViews[id];
                }
                if (FloworkState.activeNormalDeviceId === id) FloworkState.activeNormalDeviceId = null;

                FloworkState.gridOrder = FloworkState.gridOrder.filter(gid => gid !== id);

                if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
                if (FloworkState.mainWindow) FloworkState.mainWindow.webContents.send('app:force-remove-device', id);
            }});

            menuItems.push({ label: '🗑️ Delete This Bot & Clear Cookies', click: async () => {
                if(confirm("Delete this device and completely erase its login cookies?")) {
                    const s = session.fromPartition(partition);
                    await s.clearStorageData();
                    if (FloworkState.mainWindow && FloworkState.browserViews[id]) {
                        FloworkState.mainWindow.removeBrowserView(FloworkState.browserViews[id]);
                        FloworkState.browserViews[id].webContents.destroy();
                        delete FloworkState.browserViews[id];
                    }
                    if (FloworkState.activeNormalDeviceId === id) FloworkState.activeNormalDeviceId = null;

                    FloworkState.gridOrder = FloworkState.gridOrder.filter(gid => gid !== id);

                    if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
                    FloworkState.mainWindow.webContents.send('app:force-remove-device', id);
                }
            }});

            const menu = Menu.buildFromTemplate(menuItems);
            menu.popup();
        }

        ipcMain.handle('app:show-device-menu', (event, id) => {
            if (FloworkState.browserViews[id] && FloworkState.mainWindow) {
                const view = FloworkState.browserViews[id];
                showBotMenu(id, view.floworkPartition, view, null);
                return { success: true };
            }
            return { success: false };
        });

        ipcMain.handle('app:add-device', async (event, { id, url, partition, uaMode, useProxy, proxyAddress, useGhostCursor, useBandwidthSaver, useSleepCycle, workMins, sleepMins }) => {
            if (!FloworkState.mainWindow) return { success: false };
            const viewSession = session.fromPartition(partition);

            if (useProxy && proxyAddress) {
                await viewSession.setProxy({ proxyRules: proxyAddress, bypassRules: 'localhost' });
                console.log(`[STEALTH] Proxy Active for ${id}: ${proxyAddress}`);
            } else {
                await viewSession.setProxy({ proxyRules: 'direct://' });
            }

            try {
                if (fs.existsSync(FloworkState.EXTENSION_PATH)) {
                    const loadedExts = viewSession.getAllExtensions();
                    if (loadedExts.length === 0) await viewSession.loadExtension(FloworkState.EXTENSION_PATH, { allowFileAccess: true });
                }
            } catch (err) {}

            let customUA = uaMode === 'desktop'
                ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                : 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

            const view = new BrowserView({
                webPreferences: {
                    partition,
                    preload: pathModule.join(baseDir, 'stealth-preload.js'),
                    nodeIntegration: false,
                    contextIsolation: true,
                    nodeIntegrationInSubFrames: true,
                    sandbox: true,
                    backgroundThrottling: false
                }
            });

            view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');

            const cpuOptions = [2, 4, 8, 12];
            const ramOptions = [4, 8, 16];

            const vendorOptions = [
                'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)', 'Google Inc. (Intel)',
                'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)', 'Google Inc. (NVIDIA)',
                'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)', 'Google Inc. (AMD)'
            ];

            const rendererOptions = [
                'ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) HD Graphics 4600 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) UHD Graphics 730 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) UHD Graphics 750 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 SUPER Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 570 Series Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 5500 XT Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 5600 XT Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 6900 XT Direct3D11 vs_5_0 ps_5_0)',
                'ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0)'
            ];

            const vIdx = Math.floor(Math.random() * vendorOptions.length);

            FloworkState.botFpConfigs[view.webContents.id] = {
                cpu: cpuOptions[Math.floor(Math.random() * cpuOptions.length)],
                ram: ramOptions[Math.floor(Math.random() * ramOptions.length)],
                vendor: vendorOptions[vIdx],
                renderer: rendererOptions[vIdx],
                noiseR: Math.floor(Math.random() * 5) - 2,
                noiseG: Math.floor(Math.random() * 5) - 2,
                noiseB: Math.floor(Math.random() * 5) - 2,
                proxy: useProxy ? proxyAddress : 'Direct (No Proxy)',
                ghostCursor: useGhostCursor,
                bandwidthSaver: useBandwidthSaver
            };

            if (useBandwidthSaver) {
                view.webContents.setAudioMuted(true);
            }

            FloworkState.botSleepStates[id] = {
                isSleeping: false,
                useSleepCycle: useSleepCycle || false,
                workMs: (workMins || 45) * 60 * 1000,
                sleepMs: (sleepMins || 15) * 60 * 1000,
                cycleTimer: null,
                runCycle: function(deviceId) {
                    if (!FloworkState.botSleepStates[deviceId] || !FloworkState.botSleepStates[deviceId].useSleepCycle) return;
                    const state = FloworkState.botSleepStates[deviceId];
                    if (state.isSleeping) {
                        state.isSleeping = false;
                        console.log(`[ORGANIC MODE] 🟢 Bot [${deviceId}] BANGUN. Memulai sesi kerja ${state.workMs / 60000} menit.`);
                        state.cycleTimer = setTimeout(() => state.runCycle(deviceId), state.workMs);
                    } else {
                        state.isSleeping = true;
                        console.log(`[ORGANIC MODE] 💤 Bot [${deviceId}] TIDUR. Istirahat selama ${state.sleepMs / 60000} menit.`);
                        state.cycleTimer = setTimeout(() => state.runCycle(deviceId), state.sleepMs);
                    }
                }
            };

            if (useSleepCycle) {
                console.log(`[ORGANIC MODE] 🟢 Bot [${id}] diaktifkan dengan siklus istirahat.`);
                FloworkState.botSleepStates[id].cycleTimer = setTimeout(() => FloworkState.botSleepStates[id].runCycle(id), FloworkState.botSleepStates[id].workMs);
            }

            view.webContents.once('destroyed', () => {
                delete FloworkState.botFpConfigs[view.webContents.id];
            });

            view.floworkPartition = partition;

            view.webContents.setBackgroundThrottling(false);

            FloworkState.browserViews[id] = view;
            FloworkState.gridOrder.push(id);

            view.webContents.setUserAgent(customUA);
            view.webContents.loadURL(url);

            view.webContents.on('context-menu', (e, params) => {
                showBotMenu(id, partition, view, params);
            });

            return { success: true };
        });

        ipcMain.handle('app:close-device', (event, id) => {
            if (FloworkState.autoScrollTasks[id]) { clearTimeout(FloworkState.autoScrollTasks[id]); delete FloworkState.autoScrollTasks[id]; }

            if (FloworkState.botSleepStates[id]) {
                clearTimeout(FloworkState.botSleepStates[id].cycleTimer);
                delete FloworkState.botSleepStates[id];
            }

            if (FloworkState.mainWindow && FloworkState.browserViews[id]) {
                FloworkState.mainWindow.removeBrowserView(FloworkState.browserViews[id]);
                FloworkState.browserViews[id].webContents.destroy(); delete FloworkState.browserViews[id];
            }
            if (FloworkState.activeNormalDeviceId === id) FloworkState.activeNormalDeviceId = null;

            FloworkState.gridOrder = FloworkState.gridOrder.filter(gid => gid !== id);

            if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
            return { success: true };
        });

        ipcMain.handle('app:close-device-view', (event, id) => {
            if (FloworkState.autoScrollTasks[id]) { clearTimeout(FloworkState.autoScrollTasks[id]); delete FloworkState.autoScrollTasks[id]; }

            if (FloworkState.botSleepStates[id]) {
                clearTimeout(FloworkState.botSleepStates[id].cycleTimer);
                delete FloworkState.botSleepStates[id];
            }

            if (FloworkState.mainWindow && FloworkState.browserViews[id]) {
                FloworkState.mainWindow.removeBrowserView(FloworkState.browserViews[id]);
                FloworkState.browserViews[id].webContents.destroy();
                delete FloworkState.browserViews[id];
            }
            if (FloworkState.activeNormalDeviceId === id) FloworkState.activeNormalDeviceId = null;

            FloworkState.gridOrder = FloworkState.gridOrder.filter(gid => gid !== id);

            if (FloworkState.methods.updateViewsVisibility) FloworkState.methods.updateViewsVisibility();
            if (FloworkState.mainWindow) FloworkState.mainWindow.webContents.send('app:force-remove-device', id);
            return { success: true };
        });

        ipcMain.handle('app:navigate', (event, id, url) => {
            if (FloworkState.browserViews[id]) {
                let finalUrl = url.trim();

                if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('file://')) {
                    if (finalUrl.includes(' ') || !finalUrl.includes('.')) {
                        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl);
                    } else {
                        finalUrl = 'https://' + finalUrl;
                    }
                }

                FloworkState.browserViews[id].webContents.loadURL(finalUrl);

                if (id === FloworkState.masterSyncId) {
                    for (const fid in FloworkState.browserViews) {
                        if (fid !== FloworkState.masterSyncId && FloworkState.followerSyncStates[fid] !== false) {
                            FloworkState.browserViews[fid].webContents.loadURL(finalUrl);
                        }
                    }
                }
                return { success: true };
            }
            return { success: false };
        });

        ipcMain.handle('app:reload-extension', async (event, id) => {
            if (FloworkState.browserViews[id] && FloworkState.mainWindow) {
                const view = FloworkState.browserViews[id];
                const partition = view.floworkPartition;
                const viewSession = session.fromPartition(partition);

                try {
                    const loadedExts = viewSession.getAllExtensions();
                    for (let ext of loadedExts) {
                        viewSession.removeExtension(ext.id);
                    }
                    if (fs.existsSync(FloworkState.EXTENSION_PATH)) {
                        await viewSession.loadExtension(FloworkState.EXTENSION_PATH, { allowFileAccess: true });
                    }

                    FloworkState.mainWindow.webContents.send('app:show-alert', `🔌 Ekstensi Berhasil Di-Reload!\nSistem SPA (TikTok/Shorts) di Bot [${id}] sudah ter-refresh.`);
                    return { success: true };
                } catch(err) {
                    console.error("Gagal reload ekstensi:", err);
                    FloworkState.mainWindow.webContents.send('app:show-alert', `❌ Gagal reload ekstensi: ${err.message}`);
                    return { success: false };
                }
            }
            return { success: false };
        });

        ipcMain.handle('app:go-back', (event, id) => {
            if (FloworkState.browserViews[id] && FloworkState.browserViews[id].webContents.canGoBack()) {
                FloworkState.browserViews[id].webContents.goBack();

                if (id === FloworkState.masterSyncId) {
                    for (const fid in FloworkState.browserViews) {
                        if (fid !== FloworkState.masterSyncId && FloworkState.followerSyncStates[fid] !== false) {
                            if (FloworkState.browserViews[fid].webContents.canGoBack()) {
                                FloworkState.browserViews[fid].webContents.goBack();
                            }
                        }
                    }
                }
                return { success: true };
            }
            return { success: false };
        });

        ipcMain.handle('app:reload-device', (event, id) => {
            if (FloworkState.browserViews[id]) {
                FloworkState.browserViews[id].webContents.reload();

                if (id === FloworkState.masterSyncId) {
                    for (const fid in FloworkState.browserViews) {
                        if (fid !== FloworkState.masterSyncId && FloworkState.followerSyncStates[fid] !== false) {
                            FloworkState.browserViews[fid].webContents.reload();
                        }
                    }
                }
                return { success: true };
            }
            return { success: false };
        });

        ipcMain.handle('app:reload-all-devices', () => {
            for (const id in FloworkState.browserViews) {
                if (!FloworkState.browserViews[id].webContents.isDestroyed()) {
                    FloworkState.browserViews[id].webContents.reload();
                }
            }
            return { success: true };
        });

        ipcMain.handle('app:clear-device-data', async (event, id) => {
            if (FloworkState.browserViews[id]) {
                await FloworkState.browserViews[id].webContents.session.clearStorageData();
                return { success: true };
            }
            return { success: false };
        });
    }
};