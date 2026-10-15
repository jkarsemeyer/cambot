// CAMBOT desktop app (Electron main process).
// Serves the app folder at cambot://app/, grants camera/mic access, and manages the CAMBOT Camera driver.

const { app, BrowserWindow, protocol, session, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const CAMERA_CLSID = "{2434DF04-7539-4593-AFBC-7CC342C9A679}"; // must match native/softcam/GUID.txt
const APP_DIR = path.join(__dirname, "..", "app");
const CAMERA_DLL = app.isPackaged
  ? path.join(process.resourcesPath, "camera", "cambot_camera.dll")
  : path.join(__dirname, "..", "native", "build", "cambot_camera.dll");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm",
  ".task": "application/octet-stream", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "cambot", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Keep drawing and sending frames while the window is behind the call app or minimised.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    protocol.handle("cambot", async request => {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/" || rel === "") rel = "/index.html";
      const file = path.normalize(path.join(APP_DIR, rel));
      if (!file.startsWith(APP_DIR)) return new Response("Not found", { status: 404 });
      try {
        const data = await fs.promises.readFile(file);
        return new Response(data, { headers: { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });

    const allowed = new Set(["media", "audioCapture", "videoCapture", "speaker-selection", "clipboard-sanitized-write", "fullscreen"]);
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm)));
    session.defaultSession.setPermissionCheckHandler((wc, perm) => allowed.has(perm));

    win = new BrowserWindow({
      width: 1440, height: 900, minWidth: 900, minHeight: 600,
      backgroundColor: "#06080c", title: "CAMBOT", autoHideMenuBar: true,
      icon: path.join(__dirname, "..", "build", "icon.png"),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // the preload loads the camera DLL
        backgroundThrottling: false,
      },
    });
    win.loadURL("cambot://app/index.html");
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
    if (app.isPackaged) startUpdates(() => win);
    win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("cambot://")) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  });

  app.on("window-all-closed", () => app.quit());
}

/* ---------------------------------------------------------------- updates
   Checks the public cambot-releases repo at start-up and every 2 hours. A new version
   downloads quietly in the background; the panel then offers "Restart to update".
   If you don't restart, it installs the next time CAMBOT closes. */
function startUpdates(getWin) {
  const tell = (state, detail) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send("update:state", { state, detail }); };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => tell("checking"));
  autoUpdater.on("update-available", i => tell("downloading", i.version));
  autoUpdater.on("update-not-available", () => tell("current", app.getVersion()));
  autoUpdater.on("download-progress", p => tell("downloading", `${Math.round(p.percent)}%`));
  autoUpdater.on("update-downloaded", i => tell("ready", i.version));
  autoUpdater.on("error", e => tell("error", e ? (e.message || String(e)).split("\n")[0] : "unknown"));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 2 * 60 * 60 * 1000);
  ipcMain.handle("update:check", check);
}
ipcMain.handle("update:install", () => autoUpdater.quitAndInstall(false, true));

/* ---------------------------------------------------------------- IPC */
ipcMain.on("cambot:info", e => {
  e.returnValue = { version: app.getVersion(), dllPath: CAMERA_DLL, packaged: app.isPackaged };
});

function run(cmd, args) {
  return new Promise(resolve => execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") })));
}

async function cameraStatus() {
  if (process.platform !== "win32") return { installed: false, detail: "Windows only" };
  if (!fs.existsSync(CAMERA_DLL)) return { installed: false, detail: "camera file missing. Reinstall CAMBOT" };
  const { err, stdout } = await run("reg", ["query", `HKCR\\CLSID\\${CAMERA_CLSID}\\InprocServer32`, "/ve"]);
  if (err) return { installed: false, detail: "not installed yet" };
  const m = stdout.match(/REG_\w+\s+(.+)\s*$/m);
  const registered = m ? m[1].trim() : "";
  if (path.normalize(registered).toLowerCase() !== path.normalize(CAMERA_DLL).toLowerCase()) {
    return { installed: false, detail: "installed from a different folder. Click Install to fix" };
  }
  return { installed: true, path: registered };
}

ipcMain.handle("camera:status", cameraStatus);

// Registers the camera with Windows. Shows one administrator prompt.
ipcMain.handle("camera:install", async () => {
  if (process.platform !== "win32") return { ok: false, detail: "Windows only" };
  const regsvr = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "regsvr32.exe");
  const ps = `Start-Process -FilePath '${regsvr}' -ArgumentList '/s','"${CAMERA_DLL.replace(/'/g, "''")}"' -Verb RunAs -Wait`;
  const { err, stderr } = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  if (err) return { ok: false, detail: /canceled|cancelled/i.test(stderr) ? "Windows approval was cancelled" : (stderr.trim() || err.message) };
  const st = await cameraStatus();
  return { ok: st.installed, detail: st.detail };
});
