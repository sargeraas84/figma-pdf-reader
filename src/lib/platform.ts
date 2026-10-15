// Web-platform adapter.
//
// The renderer talks to the desktop through window.readerBridge (Electron
// IPC over a context bridge). In a plain browser (the web/PWA build served
// by any static host, Android tablet Chrome, Capacitor WebView) there is no
// Electron: this module installs a browser fallbackbridge BEFORE App renders.
//
// What works natively in the browser:
//   open/save via <input type=file> + Blob downloads (instead of native
//   dialogs), same localStorage annotation model, fonts via HTTP, print via
//   window.print.
// What is intentionally unavailable in the web build (the desktop app still
// covers them): Word→PDF hidden-window conversion, main-process OCR engine,
// native window controls.
//
// Image export collects pages and hands back ONE .zip download (mobile
// browsers have no directory picker and serial anchor downloads get blocked).

interface SaveTargetState {
  saveName: string | null;
}

const state: SaveTargetState = { saveName: null };
const pendingImages = new Map<string, { name: string; bytes: Uint8Array }[]>();
let imageZipTimer: number | null = null;

function browserFilePicker(accept: string, multiple = false): Promise<{ name: string; buf: ArrayBuffer }[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (multiple) input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      document.body.removeChild(input);
      Promise.all(
        files.map(async (f) => ({ name: f.name, buf: await f.arrayBuffer() }))
      ).then(resolve);
    });
    // clicking without a user gesture is blocked; the API is only called
    // from button handlers so the synthetic click keeps user activation
    input.click();
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 2000);
}

async function fetchFontBytes(file: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`./fonts/${encodeURIComponent(file)}`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function flushImagesAsZip(dir: string) {
  const files = pendingImages.get(dir);
  if (!files || !files.length) return;
  pendingImages.delete(dir);
  const jszipMod = await import("jszip");
  const zip = new jszipMod.default();
  for (const f of files) zip.file(f.name, f.bytes);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "exported-page-images.zip");
}

async function webWriteImageFile(dir: string, fileName: string, bytes: Uint8Array) {
  const list = pendingImages.get(dir) ?? [];
  list.push({ name: fileName, bytes });
  pendingImages.set(dir, list);
  // debounce: zip once the export loop has stopped writing (sequential waits)
  if (imageZipTimer !== null) window.clearTimeout(imageZipTimer);
  imageZipTimer = window.setTimeout(() => {
    imageZipTimer = null;
    void flushImagesAsZip(dir);
  }, 900);
  return { ok: true as const };
}

const noop = () => {};

export function installWebBridgeIfNeeded(): void {
  if (window.readerBridge) return; // running inside Electron — real bridge present

  const bridge = {
    openPdfDialog: async () => {
      const [f] = await browserFilePicker(".pdf,application/pdf");
      return f ? { path: null as unknown as string, name: f.name, buf: f.buf } : null;
    },
    openMultiPdfDialog: async () => {
      const files = await browserFilePicker(".pdf,application/pdf", true);
      return files.map((f) => ({ path: null as unknown as string, name: f.name, buf: f.buf }));
    },
    getWorkerSource: async () => null, // served over http — asset worker URL is fine
    readPdfPath: async () => null, // no absolute-path opens in a browser
    readFontFile: fetchFontBytes,
    ocrRecognize: async () => ({ ok: false, error: "OCR is not available in the web build — use the desktop app" }),
    saveEdits: async () => ({ ok: true }), // web persists annotations in localStorage only
    loadEdits: async () => null,
    writeToPath: async () => ({ ok: false, error: "Unsupported in web build" }),
    savePdfDialog: async (defaultName: string) => {
      // no native dialog: remember the name and use it for the download
      state.saveName = typeof defaultName === "string" && defaultName ? defaultName : "document.pdf";
      return state.saveName as unknown as string;
    },
    writePdfFile: async (_path: string, bytes: Uint8Array) => {
      if (!state.saveName) return { ok: false, error: "Pick a save name first" };
      const name = state.saveName;
      state.saveName = null;
      downloadBlob(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), name);
      return { ok: true as const };
    },
    getPlatform: async () => (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent) ? "android-web" : "web"),
    getPendingPdfPath: async () => null,
    confirmExit: async () => {},
    quitApp: async () => {},
    print: async () => {
      window.print();
    },
    pickWordDoc: async () => {
      const [f] = await browserFilePicker(".docx,.doc");
      return f ? { path: null as unknown as string, name: f.name, buf: f.buf } : null;
    },
    wordToPdf: async () => ({ ok: false, error: "Word to PDF is not available in the web build — use the desktop app" }),
    pickImagesDir: async () => "web-downloads", // virtual target; results arrive as one zip download
    registerImagesDir: async () => ({ ok: true as const }),
    writeImageFile: (dir: string, fileName: string, bytes: Uint8Array) => webWriteImageFile(dir, fileName, bytes),
    winControls: {
      close: noop,
      minimize: noop,
      toggleMaximize: noop,
      isMaximized: async () => false
    },
    onMenuAction: () => noop, // no native menu in a browser
    onOpenFromOs: () => noop
  };
  window.readerBridge = bridge;
}
