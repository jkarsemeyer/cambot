// Bridges the app page to the desktop: version info and the CAMBOT Camera sender.
// The camera DLL is called directly through koffi, so frames never pass through the main process.

const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("cambot:info");
let fn = null;
let cam = null;

function loadCamera() {
  if (fn) return true;
  try {
    const koffi = require("koffi");
    const lib = koffi.load(info.dllPath);
    fn = {
      create: lib.func("void* __cdecl scCreateCamera(int width, int height, float framerate)"),
      remove: lib.func("void __cdecl scDeleteCamera(void* camera)"),
      send: lib.func("void __cdecl scSendFrame(void* camera, const uint8_t* image)"),
      connected: lib.func("bool __cdecl scIsConnected(void* camera)"),
    };
    return true;
  } catch (e) {
    console.error("Could not load the CAMBOT Camera library", e);
    return false;
  }
}

contextBridge.exposeInMainWorld("cambot", {
  isDesktop: true,
  autoStart: true,
  version: info.version,
  updates: {
    onState: fn => ipcRenderer.on("update:state", (_e, s) => fn(s)),
    check: () => ipcRenderer.invoke("update:check"),
    install: () => ipcRenderer.invoke("update:install"),
  },
  camera: {
    status: () => ipcRenderer.invoke("camera:status"),
    install: () => ipcRenderer.invoke("camera:install"),
    // framerate 0: frames go out as soon as they're sent, so the page never waits on the camera
    start: (width, height) => {
      if (cam) return true;
      if (!loadCamera()) return false;
      cam = fn.create(width, height, 0);
      return !!cam;
    },
    send: bytes => { if (cam) fn.send(cam, bytes); },
    isConnected: () => !!cam && fn.connected(cam),
    stop: () => { if (cam) { fn.remove(cam); cam = null; } },
  },
});

window.addEventListener("beforeunload", () => { if (cam && fn) { fn.remove(cam); cam = null; } });
