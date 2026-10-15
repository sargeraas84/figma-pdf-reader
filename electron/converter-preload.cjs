// Preload for the hidden Word→PDF converter window. Minimal bridge only.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("convBridge", {
  onMessage: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on("conv-msg", fn);
    return () => ipcRenderer.removeListener("conv-msg", fn);
  },
  send: (detail) => ipcRenderer.send("conv-event", detail)
});
