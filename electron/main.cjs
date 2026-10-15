const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const fs = require("fs");
const path = require("path");

// E2E isolation: point userData at a throwaway dir BEFORE the app module
// reads it, so automation never reads a user's durable pending-edit store
// (restored ZWSP text boxes from manual testing used to fail saves).
if (process.env.PDF_READER_E2E_USER_DATA && !app.isPackaged) {
  try {
    fs.mkdirSync(process.env.PDF_READER_E2E_USER_DATA, { recursive: true });
    app.setPath("userData", process.env.PDF_READER_E2E_USER_DATA);
  } catch {
    /* fall back to the default profile */
  }
}

let win = null;
let isQuitting = false;
let mainMenu;
let lastSaveTarget = null;
let pendingPdf = null;

function sendMenuAction(action, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("menu:action", { action, ...payload });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 540,
    show: false,
    title: "Figma",
    titleBarStyle:
      process.platform === "darwin"
        ? "hiddenInset"
        : "hidden", // custom controls in the tab bar on Windows/Linux
    trafficLightPosition: process.platform === "darwin" ? { x: 12, y: 9 } : undefined,
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // support `electron . somefile.pdf` (and packaged argv) → open on load.
  // Sent through IPC on did-finish-load AND kept as a pending path that the
  // renderer queries on mount — the event and React's listener registration
  // race each other, so the query makes the auto-open reliable.
  const pdfArg = process.argv.slice(1).find((a) => typeof a === "string" && /\.pdf$/i.test(a) && fs.existsSync(a));
  // Solo pending query: sending it via IPC on did-finish-load too would race
  // the renderer's mount-time consumption and could open the same file twice.
  if (pdfArg) {
    pendingPdf = pdfArg;
  }
}

function readPdfFile(filePath) {
  const data = fs.readFileSync(filePath);
  const buf = data instanceof Uint8Array ? Uint8Array.from(data) : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return { path: filePath, name: path.basename(filePath), buf };
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: "About Figma", click: () => sendMenuAction("about") },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" }
            ]
          }
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open PDF...",
          accelerator: "CmdOrCtrl+O",
          click: () => sendMenuAction("open")
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => sendMenuAction("save")
        },
        { type: "separator" },
        {
          label: "Print",
          accelerator: "CmdOrCtrl+P",
          click: () => sendMenuAction("print")
        },
        ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }])
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" },
        { label: "Select All", accelerator: "CmdOrCtrl+A", click: () => sendMenuAction("select-all") },
        { type: "separator" },
        { label: "Find", accelerator: "CmdOrCtrl+F", click: () => sendMenuAction("find") },
        { label: "Edit Text", accelerator: "CmdOrCtrl+E", click: () => sendMenuAction("edit-text") }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Previous Page", accelerator: "CmdOrCtrl+Left", click: () => sendMenuAction("prev-page") },
        { label: "Next Page", accelerator: "CmdOrCtrl+Right", click: () => sendMenuAction("next-page") },
        { type: "separator" },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => sendMenuAction("zoom-in") },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => sendMenuAction("zoom-out") },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => sendMenuAction("zoom-reset") },
        {
          label: "Fit Width",
          accelerator: "Shift+CmdOrCtrl+W",
          click: () => sendMenuAction("fit-width")
        },
        {
          label: "Fit Page",
          accelerator: "Shift+CmdOrCtrl+P",
          click: () => sendMenuAction("fit-page")
        },
        { type: "separator" },
        {
          label: "Toggle Night Mode",
          accelerator: "CmdOrCtrl+Shift+D",
          click: () => sendMenuAction("night-mode")
        },
        {
          label: "Toggle Sidebar",
          accelerator: "CmdOrCtrl+B",
          click: () => sendMenuAction("toggle-sidebar")
        },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        ...(isMac ? [{ role: "zoom" }] : []),
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : []),
        { role: isMac ? "close" : "quit", label: isMac ? "Close" : "Quit" }
      ]
    }
  ];
  mainMenu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(mainMenu);
}

// security: lock down new web contents from inside the page
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:") && !url.startsWith("http://localhost")) e.preventDefault();
  });
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => { isQuitting = true; });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ---------------- IPC ---------------- */

ipcMain.handle("app:platform", () => process.platform);

ipcMain.handle("app:confirm-exit", () => {
  isQuitting = true;
  // graceful close (not win.destroy()) so Chromium flushes localStorage to disk
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle("app:quit", () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle("app:pending-pdf", () => {
  const p = pendingPdf;
  pendingPdf = null;
  return p;
});

/* ---------------- Scan & OCR (local WASM tesseract, no network) ---------------- */

let ocrWorkerPromise = null;
function tessdataDir() {
  // packaged: extraResources copy (Resources/tessdata, app.asar.unpacked/resources/tessdata)
  // dev: the repo's resources folder
  if (app.isPackaged) {
    const candidates = [
      path.join(process.resourcesPath, "tessdata"),
      path.join(__dirname, "../../resources/tessdata"),
      path.join(__dirname, "../resources/tessdata")
    ];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, "eng.traineddata.gz"))) return dir;
    }
    return candidates[0];
  }
  return path.join(__dirname, "../resources/tessdata");
}
function getOcrWorker() {
  if (!ocrWorkerPromise) {
    // lazy require so startup and non-OCR paths never pay the cost
    let createWorker;
    try {
      ({ createWorker } = require("tesseract.js"));
    } catch (err) {
      ocrWorkerPromise = null;
      return Promise.reject(new Error("OCR engine not available: " + err.message));
    }
    const cachePath = path.join(process.env.PDF_READER_E2E_USER_DATA || app.getPath("userData"), "tesseract-cache");
    fs.mkdirSync(cachePath, { recursive: true });
    ocrWorkerPromise = createWorker("eng", 1, {
      langPath: tessdataDir(), // local eng.traineddata.gz — never a CDN
      cachePath,
      logger: () => {} // keep the main-process stdout quiet
    }).catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}
ipcMain.handle("ocr:recognize", async (_e, imageBytes) => {
  if (!(imageBytes instanceof Uint8Array) || imageBytes.length < 8) {
    return { ok: false, error: "no image data" };
  }
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(Buffer.from(imageBytes));
    return { ok: true, text: data.text };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("file:open-dialog", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Open PDF",
    properties: ["openFile"],
    filters: [
      { name: "PDF Document", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return readPdfFile(res.filePaths[0]);
});

ipcMain.handle("file:read", (_e, filePath) => {
  if (typeof filePath !== "string") return null;
  return readPdfFile(filePath);
});

/* ---------------- Word ⇄ PDF conversion ---------------- */

// Pick a .docx / .doc file for Word → PDF (returns {path,name,buf} or null)
ipcMain.handle("word:pick", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Convert Word to PDF",
    properties: ["openFile"],
    filters: [
      { name: "Word Document", extensions: ["docx", "doc"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return readPdfFile(res.filePaths[0]);
});

// Word → PDF pipeline: a hidden Chromium window renders the .docx with
// docx-preview (bundled converter.html page) and Chromium's own print engine
// prints the rendered DOM to a real PDF — good fidelity, no external binaries.
let converterWin = null;
let converterReadyResolve = null;
let converterReadyPromise = null;
let convResultResolve = null; // in-flight conversion completion

ipcMain.on("conv-event", (_e, detail) => {
  let msg;
  try { msg = typeof detail === "string" ? JSON.parse(detail) : detail; } catch { return; }
  if (msg?.type === "ready" && converterReadyResolve) {
    const r = converterReadyResolve;
    converterReadyResolve = null;
    r();
  } else if (msg?.type === "done" && convResultResolve) {
    const r = convResultResolve;
    convResultResolve = null;
    r(null);
  } else if (msg?.type === "error" && convResultResolve) {
    const r = convResultResolve;
    convResultResolve = null;
    r(new Error(msg.message || "Converter failed"));
  }
});

function getConverterWindow() {
  if (converterWin && !converterWin.isDestroyed()) return converterWin;
  converterWin = new BrowserWindow({
    width: 1240, // wide enough for US Letter content pages at 96dpi CSS px
    height: 1600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "converter-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  converterWin.on("closed", () => { converterWin = null; });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const page = devUrl ? `${devUrl}/converter.html` : path.join(__dirname, "../dist/converter.html");
  if (devUrl) converterWin.loadURL(page);
  else converterWin.loadFile(page);
  converterWin.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) console.log("[converter]", String(message).slice(0, 300));
  });
  // the page pings "ready" once its module scripts have loaded
  converterReadyPromise = new Promise((resolve) => { converterReadyResolve = resolve; });
  return converterWin;
}

ipcMain.handle("word:to-pdf", async (_e, bytesIn) => {
  if (!(bytesIn instanceof Uint8Array) || bytesIn.length < 8) {
    return { ok: false, error: "Invalid Word document" };
  }
  const t0 = Date.now();
  try {
    const firstOpen = !converterWin || converterWin.isDestroyed();
    const cw = getConverterWindow();
    if (firstOpen) {
      // wait for the page's own ready ping (or bail out after 12 s)
      await Promise.race([
        converterReadyPromise,
        new Promise((r) => setTimeout(r, 12_000))
      ]);
      converterReadyPromise = null;
    }
    await new Promise((resolve, reject) => {
      convResultResolve = (err) => (err ? reject(err) : resolve());
      cw.webContents.send("conv-msg", { type: "convert", data: bytesIn });
      setTimeout(() => {
        if (convResultResolve) {
          convResultResolve = null;
          reject(new Error("Conversion timed out"));
        }
      }, 60_000);
    });
    // Chromium print engine: default page size is US Letter; margins in inches
    const pdfBytes = await cw.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    });
    return { ok: true, bytes: new Uint8Array(pdfBytes), ms: Date.now() - t0 };
  } catch (err) {
    // a failed render can leave broken state; drop the window so the next
    // attempt starts from a fresh load
    if (converterWin && !converterWin.isDestroyed()) converterWin.destroy();
    converterWin = null;
    converterReadyResolve = null;
    return { ok: false, error: err?.message || String(err) };
  }
});

/* ---------------- Export pages as images ---------------- */

// Pick a destination folder for Batch page-image export (returns path or null)
ipcMain.handle("images:pick-dir", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Choose a folder for the exported page images",
    properties: ["openDirectory", "createDirectory"]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

// Write one page-image file. dir must come from images:pick-dir in this
// session (same guard pattern as file:write).
let lastImagesDir = null;
ipcMain.handle("images:pick-dir-register", (_e, dir) => {
  if (typeof dir === "string" && dir) lastImagesDir = dir;
  return { ok: true };
});
ipcMain.handle("images:write", async (_e, dir, fileName, bytes) => {
  if (typeof dir !== "string" || dir !== lastImagesDir) return { ok: false, error: "Unauthorized path" };
  if (typeof fileName !== "string" || /[\\/]/.test(fileName) || fileName.includes("..")) {
    return { ok: false, error: "Invalid file name" };
  }
  if (!(bytes instanceof Uint8Array)) return { ok: false, error: "Invalid payload" };
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, fileName), Buffer.from(bytes));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Pick multiple PDFs at once for Combine files → returns an array of {path,name,buf}
ipcMain.handle("file:open-multi-dialog", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Select PDFs to combine",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "PDF Document", extensions: ["pdf"] }]
  });
  if (res.canceled || !res.filePaths.length) return [];
  return res.filePaths.map((p) => readPdfFile(p));
});

ipcMain.handle("file:save-dialog", async (_e, defaultName) => {
  // E2E hook: skip the native dialog and save straight to a fixed path
  // (the save-path guard in file:write below still applies)
  if (process.env.PDF_READER_E2E_SAVE_PATH) {
    lastSaveTarget = process.env.PDF_READER_E2E_SAVE_PATH;
    return lastSaveTarget;
  }
  const res = await dialog.showSaveDialog(win, {
    title: "Save PDF",
    defaultPath: path.join(app.getPath("documents"), typeof defaultName === "string" && defaultName ? defaultName : "document.pdf"),
    filters: [{ name: "PDF Document", extensions: ["pdf"] }]
  });
  if (res.canceled || !res.filePath) return null;
  lastSaveTarget = res.filePath;
  return res.filePath;
});

ipcMain.handle("file:write", async (_e, filePath, bytes) => {
  // only allow writing to a path that came from our own save dialog
  if (typeof filePath !== "string" || filePath !== lastSaveTarget) {
    return { ok: false, error: "Unauthorized path" };
  }
  if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) {
    return { ok: false, error: "Invalid payload" };
  }
  try {
    await fs.promises.writeFile(filePath, Buffer.from(bytes));
    lastSaveTarget = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("win:close", () => win?.close());

// Durable pending-annotation store: localStorage alone can be lost when the
// app is killed before Chromium flushes its LevelDB, so every edit batch is
// mirrored to a JSON file on disk and restored on the next launch.
const editsDir = () => path.join(app.getPath("userData"), "pending-edits");
const editsFileFor = (identity) => {
  // identity is filesystem-safe (only \w, :, /, ., -, #); hash to a flat name
  const crypto = require("crypto");
  const h = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return path.join(editsDir(), `${h}.json`);
};
ipcMain.handle("edits:save", async (_e, identity, payload) => {
  if (typeof identity !== "string" || !identity) return { ok: false };
  try {
    const dir = editsDir();
    fs.mkdirSync(dir, { recursive: true });
    if (!payload) {
      fs.promises.unlink(editsFileFor(identity)).catch(() => {});
    } else {
      await fs.promises.writeFile(editsFileFor(identity), JSON.stringify({ identity, payload }));
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
});
ipcMain.handle("edits:load", (_e, identity) => {
  if (typeof identity !== "string" || !identity) return null;
  try {
    const raw = fs.readFileSync(editsFileFor(identity), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.identity !== identity) return null;
    return parsed.payload ?? null;
  } catch {
    return null;
  }
});

ipcMain.handle("win:minimize", () => {
  win?.minimize();
  return win?.isMinimized() ?? false;
});
ipcMain.handle("win:toggle-maximize", () => {
  if (!win) return { maximized: false };
  if (win.isMaximized()) { win.unmaximize(); return { maximized: false }; }
  win.maximize(); return { maximized: true };
});
ipcMain.handle("win:is-maximized", () => win?.isMaximized() ?? false);

ipcMain.handle("worker:get", () => {
  // Chromium forbids creating workers from file:// origins, so the renderer
  // asks for the bundled pdf.js worker source and wraps it in a blob URL.
  const assetsDir = path.join(__dirname, "../dist/assets");
  try {
    const file = fs
      .readdirSync(assetsDir)
      .find((f) => /^pdf\.worker.*\.mjs$/.test(f));
    if (file) return fs.readFileSync(path.join(assetsDir, file), "utf8");
  } catch {
    /* fallthrough */
  }
  return null;
});

// Load a bundled (SIL OFL) editor font's TTF bytes for pdf-lib embedding.
// The requested file is validated against the shipped fonts manifest, so the
// renderer can never read arbitrary files from disk through this channel.
ipcMain.handle("font:read", (_e, fileName) => {
  if (typeof fileName !== "string" || /[\\/]/.test(fileName) || fileName.includes("..")) {
    return null;
  }
  const candidates = app.isPackaged
    ? [path.join(__dirname, "../dist/fonts")]
    : [path.join(__dirname, "../public/fonts"), path.join(__dirname, "../dist/fonts")];
  if (/\.ttf$/i.test(fileName)) {
    for (const dir of candidates) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
        const allowed = new Set(manifest.flatMap((f) => Object.values(f.files)));
        if (!allowed.has(fileName)) return null;
        return new Uint8Array(fs.readFileSync(path.join(dir, fileName)));
      } catch {
        /* try next candidate */
      }
    }
  }
  return null;
});

ipcMain.handle("win:print-browser", () => {
  if (win && !win.isDestroyed()) win.webContents.print({});
});

// forward OS open-file events (double-click a PDF on the app icon)
app.on("open-file", (e, filePath) => {
  e.preventDefault();
  if (app.isReady() && win) win.webContents.send("file:open-from-os", filePath);
});
