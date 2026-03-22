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

const isPackaged = app.isPackaged;
const portablePath = isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'FloworkData')
    : path.join(__dirname, 'FloworkData');

if (!fs.existsSync(portablePath)) {
    fs.mkdirSync(portablePath, { recursive: true });
}
app.setPath('userData', portablePath);

const profileFile = path.join(portablePath, 'profiles.json');

const gotTheLock = app.requestSingleInstanceLock();

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
      try { bypassDatabase = JSON.parse(fs.readFileSync(bypassMemoryFile, 'utf8')); } catch(err) {}
  }

  let masterSyncId = null;
  let followerSyncStates = {};

  const TARGET_URL = 'https://floworkos.com/webview/store';

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

    logWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); logWindow.hide(); }});
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
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js'), webSecurity: false }
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
      { label: 'View Terminal Logs', click: () => {
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
      }},
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
    try {
      if (fs.existsSync(EXTENSION_PATH)) await session.defaultSession.loadExtension(EXTENSION_PATH, { allowFileAccess: true });
    } catch (error) {}

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
          `).catch(()=>{});
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

  const originalLog = console.log; const originalError = console.error; const originalWarn = console.warn; const originalInfo = console.info;

  function sendToLogViewer(type, originalFn, args) {
      const textMsg = args.join(' ');
      if (textMsg.includes('ExtensionLoadWarning')) return;

      try { originalFn.apply(console, args); } catch (e) {}
      const logEntry = { text: textMsg, type: type, time: new Date().toLocaleTimeString() };

      if (logWindow && !logWindow.isDestroyed()) logWindow.webContents.send('engine:receive-log', logEntry);
      else logBuffer.push(logEntry);
  }

  console.log = function(...args) { sendToLogViewer('engine', originalLog, args); };
  console.error = function(...args) { sendToLogViewer('error', originalError, args); };
  console.warn = function(...args) { sendToLogViewer('warn', originalWarn, args); };
  console.info = function(...args) { sendToLogViewer('engine', originalInfo, args); };

  ipcMain.on('app:log', (event, data) => {
    const type = data.type || 'INFO';
    let msg = data.isEngineLog ? data.message : `[Web UI] [${type}] ${data.message}`;
    if (!data.isEngineLog) { try { originalLog(msg); } catch (e) {} }
    const logEntry = { text: msg, type: type.toLowerCase(), time: new Date().toLocaleTimeString() };
    if (logWindow && !logWindow.isDestroyed()) logWindow.webContents.send('engine:receive-log', logEntry);
    else logBuffer.push(logEntry);
  });

  const { dialog } = require('electron');
  global.confirm = function(message) {
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