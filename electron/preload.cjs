const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readerBridge", {
  openPdfDialog: () => ipcRenderer.invoke("file:open-dialog"),
  openMultiPdfDialog: () => ipcRenderer.invoke("file:open-multi-dialog"),
  getWorkerSource: () => ipcRenderer.invoke("worker:get"),
  readPdfPath: (p) => ipcRenderer.invoke("file:read", p),
  readFontFile: (file) => ipcRenderer.invoke("font:read", file),
  ocrRecognize: (imageBytes) => ipcRenderer.invoke("ocr:recognize", imageBytes),
  saveEdits: (identity, payload) => ipcRenderer.invoke("edits:save", identity, payload),
  loadEdits: (identity) => ipcRenderer.invoke("edits:load", identity),
  savePdfDialog: (defaultName) => ipcRenderer.invoke("file:save-dialog", defaultName),
  writePdfFile: (path, bytes) => ipcRenderer.invoke("file:write", path, bytes),
  getPlatform: () => ipcRenderer.invoke("app:platform"),
  getPendingPdfPath: () => ipcRenderer.invoke("app:pending-pdf"),
  confirmExit: () => ipcRenderer.invoke("app:confirm-exit"),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  print: () => ipcRenderer.invoke("win:print-browser"),
  pickWordDoc: () => ipcRenderer.invoke("word:pick"),
  wordToPdf: (bytes) => ipcRenderer.invoke("word:to-pdf", bytes),
  pickImagesDir: () => ipcRenderer.invoke("images:pick-dir"),
  registerImagesDir: (dir) => ipcRenderer.invoke("images:pick-dir-register", dir),
  writeImageFile: (dir, fileName, bytes) => ipcRenderer.invoke("images:write", dir, fileName, bytes),
  winControls: {
    close: () => ipcRenderer.invoke("win:close"),
    minimize: () => ipcRenderer.invoke("win:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("win:toggle-maximize"),
    isMaximized: () => ipcRenderer.invoke("win:is-maximized")
  },
  onMenuAction: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on("menu:action", fn);
    return () => ipcRenderer.removeListener("menu:action", fn);
  },
  onOpenFromOs: (cb) => {
    const fn = (_e, filePath) => cb(filePath);
    ipcRenderer.on("file:open-from-os", fn);
    return () => ipcRenderer.removeListener("file:open-from-os", fn);
  }
});
