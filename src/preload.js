const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // AI Swarm
  sendMessage: (msg, agentId) => ipcRenderer.invoke('swarm:sendMessage', msg, agentId),
  getAgents: () => ipcRenderer.invoke('swarm:getAgents'),
  addProvider: (config) => ipcRenderer.invoke('swarm:addProvider', config),
  getProviders: () => ipcRenderer.invoke('swarm:getProviders'),
  setModel: (providerId, model) => ipcRenderer.invoke('swarm:setModel', providerId, model),
  testProvider: (config) => ipcRenderer.invoke('swarm:testProvider', config),
  taskDelegation: (task, strategy) => ipcRenderer.invoke('swarm:taskDelegation', task, strategy),
  getStats: () => ipcRenderer.invoke('swarm:getStats'),
  deleteProvider: (id) => ipcRenderer.invoke('swarm:deleteProvider', id),
  getHistory: () => ipcRenderer.invoke('swarm:getHistory'),
  clearHistory: () => ipcRenderer.invoke('swarm:clearHistory'),
  
  // Desktop Control
  screenshot: (options) => ipcRenderer.invoke('desktop:screenshot', options),
  getWindows: () => ipcRenderer.invoke('desktop:getWindows'),
  getActiveWindow: () => ipcRenderer.invoke('desktop:getActiveWindow'),
  windowAction: (action, title) => ipcRenderer.invoke('desktop:windowAction', action, title),
  click: (x, y) => ipcRenderer.invoke('desktop:click', x, y),
  doubleClick: (x, y) => ipcRenderer.invoke('desktop:doubleClick', x, y),
  rightClick: (x, y) => ipcRenderer.invoke('desktop:rightClick', x, y),
  drag: (startX, startY, endX, endY) => ipcRenderer.invoke('desktop:drag', startX, startY, endX, endY),
  type: (text) => ipcRenderer.invoke('desktop:type', text),
  keyPress: (key) => ipcRenderer.invoke('desktop:keyPress', key),
  hotKey: (keys) => ipcRenderer.invoke('desktop:hotKey', keys),
  openApp: (path) => ipcRenderer.invoke('desktop:openApp', path),
  findWindow: (title) => ipcRenderer.invoke('desktop:findWindow', title),
  moveWindow: (title, x, y, w, h) => ipcRenderer.invoke('desktop:moveWindow', title, x, y, w, h),
  
  // Shell
  runCommand: (cmd) => ipcRenderer.invoke('shell:run', cmd),
  runPowerShell: (script) => ipcRenderer.invoke('shell:runPowerShell', script),
  
  // Clipboard
  getClipboard: () => ipcRenderer.invoke('clipboard:get'),
  setClipboard: (text) => ipcRenderer.invoke('clipboard:set', text),
  
  // App
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getApiKeys: () => ipcRenderer.invoke('app:getApiKeys'),
  saveApiKey: (key, value) => ipcRenderer.invoke('app:saveApiKey', key, value),
  deleteApiKey: (key) => ipcRenderer.invoke('app:deleteApiKey', key),
  getOllamaStatus: () => ipcRenderer.invoke('app:getOllamaStatus'),
  installOllama: () => ipcRenderer.invoke('app:installOllama'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  
  // Shortcuts
  onShortcut: (callback) => ipcRenderer.on('shortcut:screenshot', () => callback()),
  onShortcutWindows: (callback) => ipcRenderer.on('shortcut:windows', () => callback())
});