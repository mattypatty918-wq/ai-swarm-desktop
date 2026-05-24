import { screen, clipboard, shell, nativeImage, desktopCapturer } from 'electron';
import { exec, spawn } from 'child_process';
import log from 'electron-log';

export class DesktopControl {
  private lastScreenshot?: string;

  constructor() {
    log.info('DesktopControl v2.0 initialized');
  }

  async screenshot(options?: { region?: { x: number; y: number; w: number; h: number } }): Promise<{ success: boolean; data?: string; width?: number; height?: number; error?: string }> {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const scaleFactor = primaryDisplay.scaleFactor;
      
      const sources = await desktopCapturer.getSources({ 
        types: ['screen'], 
        thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor } 
      });
      
      if (sources.length === 0) return { success: false, error: 'No screens found' };
      
      const image = sources[0].thumbnail;
      const dataUrl = image.toDataURL();
      this.lastScreenshot = dataUrl;
      
      // If region specified, crop it (we return full for now, frontend can crop)
      return { success: true, data: dataUrl, width: image.getSize().width, height: image.getSize().height };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getWindows(): Promise<{ success: boolean; windows?: any[]; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const psScript = `
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            using System.Text;
            public class Win32 {
                [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
                [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
                [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
                [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
                [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
                public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
            }
"@
            $windows = @()
            $callback = {
                param($hwnd, $_) 
                if ([Win32]::IsWindowVisible($hwnd)) {
                    $len = [Win32]::GetWindowTextLength($hwnd)
                    if ($len -gt 0) {
                        $sb = New-Object System.Text.StringBuilder($len + 1)
                        [Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
                        $title = $sb.ToString()
                        $pid = 0
                        [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
                        if ($title -and $pid -gt 0) {
                            try {
                                $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                                if ($proc) {
                                    $global:windows += [PSCustomObject]@{
                                        hwnd = $hwnd.ToInt64()
                                        title = $title
                                        process = $proc.ProcessName
                                        pid = $pid
                                    }
                                }
                            } catch {}
                        }
                    }
                }
                return $true
            }
            $global:windows = @()
            [Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
            $windows | Select-Object -First 50 | ConvertTo-Json -Compress
          `;
          
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
            if (error) resolve({ success: false, error: error.message });
            try {
              const data = stdout.trim();
              if (!data || data === 'null') resolve({ success: true, windows: [] });
              const parsed = JSON.parse(data);
              const windows = (Array.isArray(parsed) ? parsed : [parsed]).filter((w: any) => w && w.title);
              resolve({ success: true, windows: windows.map((w: any) => ({ id: w.hwnd, title: w.title, process: w.process, pid: w.pid })) });
            } catch { resolve({ success: true, windows: [] }); }
          });
        });
      }
      return { success: true, windows: [] };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async getActiveWindow(): Promise<{ success: boolean; window?: any; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$len = [Win32]::GetWindowTextLength($hwnd)
$sb = New-Object System.Text.StringBuilder($len + 1)
[Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
$pid = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
@{
    title = $sb.ToString()
    process = if($proc){$proc.ProcessName}else{'unknown'}
    hwnd = $hwnd.ToInt64()
    pid = $pid
} | ConvertTo-Json -Compress
`;
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (error, stdout) => {
            if (error) resolve({ success: false, error: error.message });
            try {
              const data = JSON.parse(stdout.trim());
              resolve({ success: true, window: data });
            } catch { resolve({ success: false, error: 'Parse error' }); }
          });
        });
      }
      return { success: false, error: 'Not implemented for this platform' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async windowAction(action: string, title?: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32' && title) {
        let cmd = '';
        switch (action) {
          case 'minimize': 
            cmd = `powershell -Command "Add-Type -TypeDefinition @'using System;using System.Runtime.InteropServices;public class Win{public const int SW_MINIMIZE=6;[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr h,int c);}'@;$p=Get-Process -Name '${title}' -ErrorAction SilentlyContinue;if($p){[Win]::ShowWindow($p.MainWindowHandle,[Win]::SW_MINIMIZE)}"`;
            break;
          case 'maximize': 
            cmd = `powershell -Command "Add-Type -TypeDefinition @'using System;using System.Runtime.InteropServices;public class Win{public const int SW_MAXIMIZE=3;[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr h,int c);}'@;$p=Get-Process -Name '${title}' -ErrorAction SilentlyContinue;if($p){[Win]::ShowWindow($p.MainWindowHandle,[Win]::SW_MAXIMIZE)}"`;
            break;
          case 'close': 
            cmd = `Stop-Process -Name '${title}' -Force -ErrorAction SilentlyContinue`;
            break;
          case 'restore': 
            cmd = `powershell -Command "Add-Type -TypeDefinition @'using System;using System.Runtime.InteropServices;public class Win{public const int SW_RESTORE=9;[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr h,int c);}'@;$p=Get-Process -Name '${title}' -ErrorAction SilentlyContinue;if($p){[Win]::ShowWindow($p.MainWindowHandle,[Win]::SW_RESTORE)}"`;
            break;
          case 'focus': 
            cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command \"Add-Type @\"using System;using System.Runtime.InteropServices;public class Win32{[DllImport(\\\\\"user32.dll\\\\\")]public static extern bool SetForegroundWindow(IntPtr hWnd);}\"@;$p=Get-Process -Name '${title}' -ErrorAction SilentlyContinue;if($p){[Win32]::SetForegroundWindow($p.MainWindowHandle)}\"`;
            break;
        }
        if (cmd) return new Promise((resolve) => { exec(cmd, (error) => resolve({ success: !error, error: error?.message })); });
      }
      return { success: false, error: 'Action not supported' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async click(x: number, y: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const script = `
Add-Type System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(${x}, ${y})
Start-Sleep -Milliseconds 50
[System.Windows.Forms.SendKeys]::SendWait("{LEFTCLICK}")
`;
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -File - <<'PSEOF'\n${script}\nPSEOF`, (error) => {
            resolve({ success: !error, error: error?.message });
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async doubleClick(x: number, y: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const script = `
Add-Type System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(${x}, ${y})
Start-Sleep -Milliseconds 50
[System.Windows.Forms.SendKeys]::SendWait("{LEFTCLICK}{LEFTCLICK}")
`;
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -File - <<'PSEOF'\n${script}\nPSEOF`, (error) => {
            resolve({ success: !error, error: error?.message });
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async rightClick(x: number, y: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const script = `
Add-Type System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(${x}, ${y})
Start-Sleep -Milliseconds 50
[System.Windows.Forms.SendKeys]::SendWait("{RIGHTCLICK}")
`;
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -File - <<'PSEOF'\n${script}\nPSEOF`, (error) => {
            resolve({ success: !error, error: error?.message });
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async drag(startX: number, startY: number, endX: number, endY: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const script = `
Add-Type System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(${startX}, ${startY})
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("{LEFTDOWN}")
Start-Sleep -Milliseconds 100
for($i=0;$i -lt 50;$i++) {
    $x = [int](${startX} + (${endX}-${startX}) * $i / 50)
    $y = [int](${startY} + (${endY}-${startY}) * $i / 50)
    [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new($x, $y)
    Start-Sleep -Milliseconds 10
}
Start-Sleep -Milliseconds 50
[System.Windows.Forms.SendKeys]::SendWait("{LEFTUP}")
`;
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -File - <<'PSEOF'\n${script}\nPSEOF`, (error) => {
            resolve({ success: !error, error: error?.message });
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async typeText(text: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          // Use base64 encoding to prevent PowerShell injection via special characters
          const script = `Add-Type System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')`;
          const encoded = Buffer.from(script, 'utf16le').toString('base64');
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, (error) => {
            resolve({ success: !error, error: error?.message });
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async keyPress(key: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const keyMap: any = {
            'enter': '{ENTER}', 'tab': '{TAB}', 'escape': '{ESC}', 'esc': '{ESC}',
            'backspace': '{BACKSPACE}', 'delete': '{DELETE}', 'del': '{DELETE}',
            'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
            'home': '{HOME}', 'end': '{END}', 'pageup': '{PGUP}', 'pagedown': '{PGDN}',
            'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
            'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
            'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
          };
          const mappedKey = keyMap[key.toLowerCase()] || key;
          const script = `Add-Type System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${mappedKey}')`;
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`, (error) => {
            resolve({ success: !error, error: error?.message });
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async hotKey(keys: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        const keyCombo = keys.map(k => {
          const upper = k.toUpperCase();
          if (upper === 'CTRL' || upper === 'CONTROL') return '^';
          if (upper === 'ALT') return '%';
          if (upper === 'SHIFT') return '+';
          if (upper === 'WIN') return '^%';
          return `{${upper}}`;
        }).join('');
        // Validate: only allow alphanumeric and special SendWait chars to prevent injection
        if (!/^[^{}]*[^{}*{}]*$/.test(keyCombo)) {
          return { success: false, error: 'Invalid hotkey combination' };
        }
        return new Promise((resolve) => {
          const script = `Add-Type System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keyCombo}')`;
          const encoded = Buffer.from(script, 'utf16le').toString('base64');
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, (error) => {
            resolve({ success: !error, error: error?.message });
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async openApp(appPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      await shell.openPath(appPath);
      return { success: true };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async findWindow(title: string): Promise<{ success: boolean; window?: any; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFind {
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$hwnd = [WinFind]::FindWindow([NullString]::Value, '${title}')
if ($hwnd -ne [IntPtr]::Zero) {
    [WinFind]::SetForegroundWindow($hwnd) | Out-Null
    @{ found = $true; hwnd = $hwnd.ToInt64() } | ConvertTo-Json -Compress
} else {
    @{ found = $false } | ConvertTo-Json -Compress
}
`;
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (error, stdout) => {
            if (error) resolve({ success: false, error: error.message });
            try {
              const data = JSON.parse(stdout.trim());
              resolve({ success: true, window: data });
            } catch { resolve({ success: false, error: 'Parse error' }); }
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async moveWindow(title: string, x: number, y: number, w?: number, h?: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        let sizeStr = w && h ? `, ${w}, ${h}` : '';
        const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMove {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$p = Get-Process -Name '${title}' -ErrorAction SilentlyContinue
if ($p) { [WinMove]::MoveWindow($p.MainWindowHandle, ${x}, ${y}${sizeStr}, $true) }
`;
        return new Promise((resolve) => {
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (error) => {
            resolve({ success: !error, error: error?.message });
          });
        });
      }
      return { success: false, error: 'Not implemented' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async runCommand(command: string): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
    return new Promise((resolve) => {
      exec(command, { maxBuffer: 1024 * 1024 }, (error: Error | null, stdout: string, stderr: string) => {
        resolve({ success: !error, stdout, stderr, error: error?.message });
      });
    });
  }

  async runPowerShell(script: string): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
    return new Promise((resolve) => {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { maxBuffer: 1024 * 1024, timeout: 120000 }, (error, stdout, stderr) => {
        resolve({ success: !error, stdout, stderr, error: error?.message });
      });
    });
  }

  getClipboard() { 
    return { 
      text: clipboard.readText(), 
      image: clipboard.readImage().isEmpty() ? null : clipboard.readImage().toDataURL() 
    }; 
  }
  
  setClipboard(text: string) { 
    clipboard.writeText(text); 
    return true; 
  }
}