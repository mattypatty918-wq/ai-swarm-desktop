import { app, BrowserWindow, ipcMain, clipboard, shell, screen, globalShortcut } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { exec } from 'child_process';
import { AISwarmController } from './aiSwarmController';
import { DesktopControl } from './desktopControl';
import * as fs from 'fs';
import axios from 'axios';
import { spawn } from 'child_process';

log.initialize();
log.info('AI Swarm Desktop v2.0 starting...');

let mainWindow: BrowserWindow | null = null;
let swarmController: AISwarmController;
let desktopControl: DesktopControl;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../build/icon.ico'),
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    frame: process.platform !== 'win32' ? false : true
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Register global shortcuts
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    mainWindow?.webContents.send('shortcut:screenshot');
  });
  
  globalShortcut.register('CommandOrControl+Shift+W', () => {
    mainWindow?.webContents.send('shortcut:windows');
  });

  swarmController = new AISwarmController(mainWindow);
  desktopControl = new DesktopControl();

  log.info('AI Swarm Desktop v2.0 ready');
};

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers - AI Swarm
ipcMain.handle('swarm:sendMessage', async (_, message: string, agentId?: string) => {
  return await swarmController.sendMessage(message, agentId);
});

ipcMain.handle('swarm:getAgents', async () => {
  return swarmController.getAgents();
});

ipcMain.handle('swarm:addProvider', async (_, config: any) => {
  return swarmController.addProvider(config);
});

ipcMain.handle('swarm:getProviders', async () => {
  return swarmController.getProviders();
});

ipcMain.handle('swarm:setModel', async (_, providerId: string, model: string) => {
  return swarmController.setModel(providerId, model);
});

ipcMain.handle('swarm:testProvider', async (_, config: any) => {
  return await swarmController.testProvider(config);
});

ipcMain.handle('swarm:taskDelegation', async (_, task: string, strategy: string) => {
  return await swarmController.delegateTask(task, strategy);
});

ipcMain.handle('swarm:getStats', async () => {
  return swarmController.getStats();
});

ipcMain.handle('swarm:deleteProvider', async (_, providerId: string) => {
  return swarmController.deleteProvider(providerId);
});

ipcMain.handle('swarm:getHistory', async () => {
  return swarmController.getHistory();
});

ipcMain.handle('swarm:clearHistory', async () => {
  return swarmController.clearHistory();
});

// IPC Handlers - Desktop Control
ipcMain.handle('desktop:screenshot', async (_, options?: any) => {
  return desktopControl.screenshot(options);
});

ipcMain.handle('desktop:getWindows', async () => {
  return desktopControl.getWindows();
});

ipcMain.handle('desktop:getActiveWindow', async () => {
  return desktopControl.getActiveWindow();
});

ipcMain.handle('desktop:windowAction', async (_, action: string, title?: string) => {
  return desktopControl.windowAction(action, title);
});

ipcMain.handle('desktop:click', async (_, x: number, y: number) => {
  return desktopControl.click(x, y);
});

ipcMain.handle('desktop:doubleClick', async (_, x: number, y: number) => {
  return desktopControl.doubleClick(x, y);
});

ipcMain.handle('desktop:rightClick', async (_, x: number, y: number) => {
  return desktopControl.rightClick(x, y);
});

ipcMain.handle('desktop:drag', async (_, startX: number, startY: number, endX: number, endY: number) => {
  return desktopControl.drag(startX, startY, endX, endY);
});

ipcMain.handle('desktop:type', async (_, text: string) => {
  return desktopControl.typeText(text);
});

ipcMain.handle('desktop:keyPress', async (_, key: string) => {
  return desktopControl.keyPress(key);
});

ipcMain.handle('desktop:hotKey', async (_, keys: string[]) => {
  return desktopControl.hotKey(keys);
});

ipcMain.handle('desktop:openApp', async (_, appPath: string) => {
  return desktopControl.openApp(appPath);
});

ipcMain.handle('desktop:findWindow', async (_, title: string) => {
  return desktopControl.findWindow(title);
});

ipcMain.handle('desktop:moveWindow', async (_, title: string, x: number, y: number, w?: number, h?: number) => {
  return desktopControl.moveWindow(title, x, y, w, h);
});

ipcMain.handle('shell:run', async (_, command: string) => {
  return desktopControl.runCommand(command);
});

ipcMain.handle('shell:runPowerShell', async (_, script: string) => {
  return desktopControl.runPowerShell(script);
});

// Clipboard
ipcMain.handle('clipboard:get', async () => {
  return desktopControl.getClipboard();
});

ipcMain.handle('clipboard:set', async (_, text: string) => {
  return desktopControl.setClipboard(text);
});

// App management
ipcMain.handle('app:getApiKeys', async () => {
  const storagePath = path.join(app.getPath('userData'), 'config.json');
  try {
    if (fs.existsSync(storagePath)) {
      const config = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      return config.apiKeys || {};
    }
  } catch (e) { log.error('Failed to read API keys:', e); }
  return {};
});

ipcMain.handle('app:saveApiKey', async (_, key, value) => {
  const storagePath = path.join(app.getPath('userData'), 'config.json');
  try {
    let config: Record<string, any> = {};
    if (fs.existsSync(storagePath)) {
      config = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    }
    config.apiKeys = config.apiKeys || {};
    config.apiKeys[key] = value;
    fs.writeFileSync(storagePath, JSON.stringify(config, null, 2));
    log.info(`API key saved: ${key}`);
    return { success: true };
  } catch (e) {
    log.error('Failed to save API key:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('app:deleteApiKey', async (_, key) => {
  const storagePath = path.join(app.getPath('userData'), 'config.json');
  try {
    if (fs.existsSync(storagePath)) {
      const config = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      if (config.apiKeys) delete config.apiKeys[key];
      fs.writeFileSync(storagePath, JSON.stringify(config, null, 2));
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('app:getOllamaStatus', async () => {
  return new Promise((resolve) => {
    exec('powershell -Command "Get-Process ollama -ErrorAction SilentlyContinue | Select-Object Name,Id,StartTime"', (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve({ running: false });
      } else {
        resolve({ running: true, info: stdout.trim() });
      }
    });
  });
});

ipcMain.handle('app:installOllama', async () => {
  return new Promise((resolve) => {
    const script = `
      $installer = "$env:TEMP\\ollama-setup.exe"
      $url = "https://ollama.ai/install/ollama-setup.exe"
      Write-Host "Downloading Ollama..."
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $url -OutFile $installer
      Write-Host "Installing Ollama..."
      Start-Process -FilePath $installer -ArgumentList "/S" -Wait
      Write-Host "Done"
    `;
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"').replace(/\\n/g, ' ')}"`, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        log.error('Ollama install failed:', error);
        resolve({ success: false, error: (error as Error).message });
      } else {
        log.info('Ollama installed successfully');
        resolve({ success: true });
      }
    });
  });
});

ipcMain.handle('app:openDataFolder', async () => {
  shell.openPath(app.getPath('userData'));
  return true;
});

// Auto-Update System
async function checkForUpdates() {
  try {
    const response = await fetch('https://mattypattysapps.zo.space/api/ai-swarm-updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        currentVersion: app.getVersion() || '1.0.0',
        platform: process.platform,
        arch: process.arch
      })
    });
    const data = await response.json();
    return data;
  } catch (e) {
    log.error('Update check failed:', e);
    return { hasUpdate: false };
  }
}

// Restore Point System - Cloud backup before updates
ipcMain.handle('restore:create', async () => {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const backupPath = path.join(backupDir, `backup-${Date.now()}.json`);
    
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, backupPath);
      
      // Sync to cloud
      await axios.post('https://mattypattysapps.zo.space/api/restore-points', {
        appId: 'ai-swarm-desktop',
        version: app.getVersion(),
        filename: `backup-${Date.now()}.json`,
        changelog: `Auto-backup before update attempt`,
        isCritical: false
      });
      
      return { success: true, localPath: backupPath };
    }
    return { success: false, error: 'No config to backup' };
  } catch (e) {
    log.error('Backup creation failed:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('restore:list', async () => {
  try {
    const response = await fetch('https://mattypattysapps.zo.space/api/restore-points?app=ai-swarm-desktop');
    const data = await response.json();
    return data;
  } catch (e) {
    log.error('Failed to list restore points:', e);
    return { restorePoints: [] };
  }
});

ipcMain.handle('restore:download', async (_, id: string, url: string) => {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    
    const filePath = path.join(backupDir, `${id}.json`);
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(filePath, Buffer.from(response.data));
    
    return { success: true, path: filePath };
  } catch (e) {
    log.error('Failed to download restore point:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('restore:apply', async (_, filePath: string) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    
    // Create backup of current before restore
    if (fs.existsSync(configPath)) {
      const emergencyBackup = configPath + '.emergency';
      fs.copyFileSync(configPath, emergencyBackup);
    }
    
    // Apply restore
    fs.copyFileSync(filePath, configPath);
    
    return { success: true, message: 'Restore applied. Restart app to take effect.' };
  } catch (e) {
    log.error('Failed to apply restore:', e);
    return { success: false, error: (e as Error).message };
  }
});

async function downloadAndInstall(updateUrl: string, version: string, checksum: string) {
  return new Promise((resolve, reject) => {
    const { dialog } = require('electron');
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Version ${version} is available. Download and install now?`,
      buttons: ['Download', 'Later']
    }).then(({ response }: { response: number }) => {
      if (response === 0) {
        const updatePath = path.join(app.getPath('userData'), 'updates');
        if (!fs.existsSync(updatePath)) fs.mkdirSync(updatePath, { recursive: true });
        const filePath = path.join(updatePath, `ai-swarm-${version}.exe`);
        
        // Download update
        axios.get(updateUrl, { responseType: 'arraybuffer' }).then(res => {
          fs.writeFileSync(filePath, Buffer.from(res.data));
          log.info(`Update downloaded to ${filePath}`);
          
          // Install on next restart
          const pendingPath = path.join(app.getPath('userData'), 'update-pending');
          fs.writeFileSync(pendingPath, JSON.stringify({ version, filePath }));
          
          dialog.showMessageBox({
            type: 'info',
            title: 'Update Ready',
            message: 'Update will be installed on restart. Restart now?',
            buttons: ['Restart', 'Later']
          }).then(({ response: r2 }: { response: number }) => {
            if (r2 === 0) {
              app.relaunch();
              app.exit();
            }
          });
        }).catch(reject);
      }
      resolve(false);
    });
  });
}

function checkPendingUpdate() {
  const pendingPath = path.join(app.getPath('userData'), 'update-pending');
  if (fs.existsSync(pendingPath)) {
    try {
      const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
      if (fs.existsSync(pending.filePath)) {
        log.info(`Installing pending update: ${pending.version}`);
        spawn(pending.filePath, ['/S'], { detached: true });
        app.exit();
      }
    } catch (e) {
      log.error('Failed to install pending update:', e);
    }
  }
}

// App info
ipcMain.handle('app:version', async () => {
  return app.getVersion();
});

ipcMain.handle('app:checkUpdates', async () => {
  return await checkForUpdates();
});

ipcMain.handle('app:openExternal', async (_, url: string) => {
  shell.openExternal(url);
  return true;
});