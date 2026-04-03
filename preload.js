//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\preload.js
//#1. Dynamic Component Discovery (DCD): Hub wajib melakukan scanning file secara otomatis.
//#2. Lazy Loading: Modul hanya di-import ke RAM saat dipanggil (On-Demand).
//#3. Atomic Isolation: 1 File = 1 Fungsi dengan nama file yang identik dengan nama fungsi aslinya.
//#4. Zero Logic Mutation: Dilarang merubah alur logika, nama variabel, atau struktur if/try/loop.
//#######################################################################

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  clearCache: () => ipcRenderer.invoke('app:clear-cache'),
  resetApp: () => ipcRenderer.invoke('app:reset'),
  shutdownApp: () => ipcRenderer.invoke('app:shutdown'),
  sendLog: (data) => ipcRenderer.send('app:log', data),
  openLogWindow: () => ipcRenderer.invoke('app:open-log-window'),
  openAiBuilder: () => ipcRenderer.invoke('app:open-ai-builder'),

  initFlowork: () => ipcRenderer.invoke('app:init-flowork'),
  switchToGrid: () => ipcRenderer.invoke('app:switch-to-grid'),
  switchToNormal: (id) => ipcRenderer.invoke('app:switch-to-normal', id),

  closeDevice: (id) => ipcRenderer.invoke('app:close-device', id),
  closeDeviceView: (id) => ipcRenderer.invoke('app:close-device-view', id),

  addDevice: (data) => ipcRenderer.invoke('app:add-device', data),

  toggleModal: (isOpen) => ipcRenderer.invoke('app:toggle-modal', isOpen),

  autoScrollAll: (data) => ipcRenderer.invoke('app:auto-scroll-all', data),
  stopScrollAll: () => ipcRenderer.invoke('app:stop-scroll-all'),

  startAutoRefresh: (interval) => ipcRenderer.invoke('app:start-auto-refresh', interval),
  stopAutoRefresh: () => ipcRenderer.invoke('app:stop-auto-refresh'),

  toggleRecordMode: (mode) => ipcRenderer.invoke('app:toggle-record-mode', mode),
  clearBypassDb: () => ipcRenderer.invoke('app:clear-bypass-db'),
  onRecordFinished: (callback) => ipcRenderer.on('app:record-finished', () => callback()),

  openExternalUrl: (url) => ipcRenderer.invoke('app:open-external', url),

  importCookies: (id, cookieString) => ipcRenderer.invoke('app:import-cookies', id, cookieString),
  exportCookies: (id) => ipcRenderer.invoke('app:export-cookies', id),
  onOpenCookieManager: (callback) => ipcRenderer.on('app:open-cookie-manager', (_event, id) => callback(id)),

  goBack: (id) => ipcRenderer.invoke('app:go-back', id),
  reloadDevice: (id) => ipcRenderer.invoke('app:reload-device', id),

  navigate: (id, url) => ipcRenderer.invoke('app:navigate', id, url),

  reloadAllDevices: () => ipcRenderer.invoke('app:reload-all-devices'),
  toggleSidebarMargin: (isOpen) => ipcRenderer.invoke('app:toggle-sidebar-margin', isOpen),

  clearDeviceData: (id) => ipcRenderer.invoke('app:clear-device-data', id),
  scrollGrid: (offsetY) => ipcRenderer.invoke('app:scroll-grid', offsetY),

  saveProfiles: (data) => ipcRenderer.invoke('app:save-profiles', data),
  loadProfiles: () => ipcRenderer.invoke('app:load-profiles'),

  showDeviceMenu: (id) => ipcRenderer.invoke('app:show-device-menu', id),

  reloadExtension: (id) => ipcRenderer.invoke('app:reload-extension', id),

  setSyncRole: (id, role) => ipcRenderer.invoke('app:set-sync-role', id, role),

  onShowAlert: (callback) => ipcRenderer.on('app:show-alert', (_event, msg) => callback(msg)),

  onForceRemoveDevice: (callback) => ipcRenderer.on('app:force-remove-device', (_event, id) => callback(id)),
  onAddToProfile: (callback) => ipcRenderer.on('app:add-to-profile', (_event, data) => callback(data)),
  onRemoveFromProfile: (callback) => ipcRenderer.on('app:remove-from-profile', (_event, data) => callback(data)),

  onUpdateGridUI: (callback) => ipcRenderer.on('app:update-grid-ui', (_event, data, mode) => callback(data, mode)),
  swapDevices: (id1, id2) => ipcRenderer.invoke('app:swap-devices', id1, id2),

  onForceMode: (callback) => ipcRenderer.on('app:force-mode', (_event, mode) => callback(mode)),

  // [AI BROWSER BRIDGE] — Console logs & browser control for AI Mother
  aiGetConsoleLogs: (deviceId) => ipcRenderer.invoke('app:ai-get-console-logs', deviceId),
  aiBrowserNavigate: (deviceId, url) => ipcRenderer.invoke('app:ai-browser-navigate', deviceId, url),
  aiBrowserExec: (deviceId, script) => ipcRenderer.invoke('app:ai-browser-exec', deviceId, script),
  aiBrowserCapture: (deviceId) => ipcRenderer.invoke('app:ai-browser-capture', deviceId),
  aiBrowserGetUrl: (deviceId) => ipcRenderer.invoke('app:ai-browser-get-url', deviceId),

  // [BROWSER AUTOMATION] — Full browser control for AI scraping/automation
  aiBrowserGetCookies: (deviceId, filter) => ipcRenderer.invoke('app:ai-browser-get-cookies', deviceId, filter),
  aiBrowserSetCookie: (deviceId, cookie) => ipcRenderer.invoke('app:ai-browser-set-cookie', deviceId, cookie),
  aiBrowserDeleteCookie: (deviceId, url, name) => ipcRenderer.invoke('app:ai-browser-delete-cookie', deviceId, url, name),
  aiBrowserScrape: (deviceId, options) => ipcRenderer.invoke('app:ai-browser-scrape', deviceId, options),
  aiBrowserSetUA: (deviceId, ua) => ipcRenderer.invoke('app:ai-browser-set-ua', deviceId, ua),
  aiBrowserStorage: (deviceId, options) => ipcRenderer.invoke('app:ai-browser-storage', deviceId, options),
  aiBrowserLifecycle: (deviceId, action) => ipcRenderer.invoke('app:ai-browser-lifecycle', deviceId, action),
  aiBrowserSetHeaders: (deviceId, headers) => ipcRenderer.invoke('app:ai-browser-set-headers', deviceId, headers),

  // [MULTI-APP TAB SYSTEM] — Open/close app tabs as BrowserViews
  openAppTab: (appId, appName, appUrl) => ipcRenderer.invoke('app:open-app-tab', appId, appName, appUrl),
  closeAppTab: (appId) => ipcRenderer.invoke('app:close-app-tab', appId),
  switchAppTab: (appId) => ipcRenderer.invoke('app:switch-app-tab', appId),
  reloadAppTab: (appId) => ipcRenderer.invoke('app:reload-app-tab', appId),
  onAppTabOpened: (callback) => ipcRenderer.on('app:tab-opened', (_event, tabId, tabName) => callback(tabId, tabName)),
  onAppTabClosed: (callback) => ipcRenderer.on('app:tab-closed', (_event, tabId) => callback(tabId)),

  // [NAV WEBVIEW] — Navigate mainFloworkView to a webview URL
  navigateFlowork: (url) => ipcRenderer.invoke('app:navigate-flowork', url),

  // [DASHBOARD] — System Metrics, Local AI, Logs, Navigation
  getSystemMetrics: () => ipcRenderer.invoke('system:get-metrics'),
  updateBounds: (bounds) => ipcRenderer.send('app:update-bounds', bounds),
  localAiChat: (prompt, opts) => ipcRenderer.invoke('local-ai:chat', prompt, opts),
  localAiStatus: () => ipcRenderer.invoke('local-ai:status'),
  localAiLoadModel: (path) => ipcRenderer.invoke('local-ai:load-model', path),
  localAiListModels: () => ipcRenderer.invoke('local-ai:list-models'),
  navigateTo: (target) => ipcRenderer.invoke('app:dashboard-navigate', target),
  onEngineLog: (callback) => ipcRenderer.on('engine:log', (_event, data) => callback(data)),
  onDashboardAction: (callback) => ipcRenderer.on('app:dashboard-action', (_event, action) => callback(action)),
  onOpenTabRequest: (callback) => ipcRenderer.on('app:open-tab-request', (_event, tabId, tabName, tabUrl) => callback(tabId, tabName, tabUrl)),

  // [TUTORIAL] — Fetch YouTube playlist RSS via Node.js (bypass CORS)
  fetchTutorials: () => ipcRenderer.invoke('app:fetch-tutorials'),
};

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('floworkDesktop', api);
    } catch(e) {}
} else {
    window.floworkDesktop = api;
    window.originalNodeRequire = require;
    window.require = require;
}