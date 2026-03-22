//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\preload.js
//#1. Dynamic Component Discovery (DCD): Hub wajib melakukan scanning file secara otomatis.
//#2. Lazy Loading: Modul hanya di-import ke RAM saat dipanggil (On-Demand).
//#3. Atomic Isolation: 1 File = 1 Fungsi dengan nama file yang identik dengan nama fungsi aslinya.
//#4. Zero Logic Mutation: Dilarang merubah alur logika, nama variabel, atau struktur if/try/loop.
//#######################################################################

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floworkDesktop', {
  clearCache: () => ipcRenderer.invoke('app:clear-cache'),
  resetApp: () => ipcRenderer.invoke('app:reset'),
  shutdownApp: () => ipcRenderer.invoke('app:shutdown'),
  sendLog: (data) => ipcRenderer.send('app:log', data),
  openLogWindow: () => ipcRenderer.invoke('app:open-log-window'),

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

  getAdbDevices: () => ipcRenderer.invoke('app:get-adb-devices'),
  startScrcpy: (serial) => ipcRenderer.invoke('app:start-scrcpy', serial),

  getTopApp: (serial) => ipcRenderer.invoke('app:get-top-app', serial),
  inspectApk: (serial, packageName) => ipcRenderer.invoke('app:inspect-apk', serial, packageName),
  startLogcat: (serial, packageName) => ipcRenderer.invoke('app:start-logcat', serial, packageName),
  onLogcatData: (callback) => ipcRenderer.on('engine:app-logcat-data', (_event, data) => callback(data)),
  pullApk: (serial, packageName) => ipcRenderer.invoke('app:pull-apk', serial, packageName),
  decompileApk: (serial, packageName, ramLimit) => ipcRenderer.invoke('app:decompile-apk', serial, packageName, ramLimit),

  onDecompileProgress: (callback) => ipcRenderer.on('engine:decompile-progress', (_event, data) => callback(data)),

  startRecording: (serial) => ipcRenderer.invoke('app:start-recording', serial),
  stopRecording: (serial) => ipcRenderer.invoke('app:stop-recording', serial),

  disassembleApktool: (serial, packageName) => ipcRenderer.invoke('app:disassemble-apktool', serial, packageName),
  rebuildApktool: (sourceFolderFolder) => ipcRenderer.invoke('app:rebuild-apktool', sourceFolderFolder),
  onApktoolProgress: (callback) => ipcRenderer.on('engine:apktool-progress', (_event, data) => callback(data)),

  startLiveYt: (serial, streamKey) => ipcRenderer.invoke('app:start-live-yt', serial, streamKey),
  stopLiveYt: (serial) => ipcRenderer.invoke('app:stop-live-yt', serial),

  selectFile: () => ipcRenderer.invoke('app:select-file'),

  // [DITAMBAHKAN KEMBALI] Jembatan buat milih folder yang sempet ilang
  selectSaveDirectory: () => ipcRenderer.invoke('app:select-save-directory'),

  adbPush: (serial, localPath, remotePath) => ipcRenderer.invoke('app:adb-push', serial, localPath, remotePath),
  adbInputText: (serial, text) => ipcRenderer.invoke('app:adb-input-text', serial, text),
  syncClipboardPcToHp: (serial) => ipcRenderer.invoke('app:sync-clipboard-pc-to-hp', serial),
  nativePaste: (serial, text) => ipcRenderer.invoke('app:native-paste', serial, text)
});