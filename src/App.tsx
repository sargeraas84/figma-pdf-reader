import { useCallback, useEffect, useRef, useState } from "react";

// injected by vite (see vite.config.ts define) — matches package.json version
declare const APP_VERSION: string;

import * as pdfjsLib from "pdfjs-dist";
import { destToPageNumber, readOutline, type OutlineNode, type PageSize, type PdfDocument } from "./lib/pdfjs";
import { searchDocument, type Match } from "./lib/search";
import { buildModifiedPdf, type FontByteLoader, type TextEdit } from "./lib/edits";
import { DEFAULT_FONT_FAMILY, ensureFontFacesForEdits } from "./lib/fonts";
import TabBar from "./components/TabBar";
import Toolbar, { type ZoomMode } from "./components/Toolbar";
import type { SearchState } from "./components/TabBarTypes";
import Sidebar from "./components/Sidebar";
import DocumentView from "./components/DocumentView";
import EmptyState from "./components/EmptyState";
import PasswordModal from "./components/PasswordModal";
import OcrModal from "./components/OcrModal";
import ToolsPanel, { type ToolId } from "./components/ToolsPanel";
import { SplitModal, ExportImagesModal } from "./components/ExportModals";
import { pdfToWord } from "./lib/pdfToWord";
import { pdfToPptx } from "./lib/pdfToPptx";
import { exportPagesAsImages } from "./lib/exportImages";

/* ---------------- pending-annotation persistence ---------------- */

function docEditKey(t: { path: string | null; name: string; originalBytes: Uint8Array | null }): string {
  const identity = t.path ? `path:${t.path}` : `name:${t.name}#${t.originalBytes?.byteLength ?? 0}`;
  return `pdf-reader-edits:v1:${identity}`;
}

function loadStoredEdits(pathString: string | null, name: string, byteLength: number): TextEdit[] {
  const identity = pathString ? `path:${pathString}` : `name:${name}#${byteLength}`;
  try {
    const raw = localStorage.getItem(`pdf-reader-edits:v1:${identity}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { edits?: unknown };
    if (!Array.isArray(parsed.edits)) return [];
    return (parsed.edits as TextEdit[]).filter(
      (e) => e && typeof e === "object" && e.id && e.page >= 1 && (e.kind === "replace" || e.kind === "add" || e.kind === "highlight" || e.kind === "redact" || e.kind === "pen")
    );
  } catch {
    return [];
  }
}

interface Tab {
  id: string;
  name: string;
  path: string | null;
  status: "loading" | "password" | "error" | "ready";
  errMsg?: string;
  pdf: PdfDocument | null;
  passwordCb: ((pw: string) => void) | null;
  wrongPassword: boolean;
  numPages: number;
  page: number;
  sizes: PageSize[];
  rotation: number;
  zoomMode: ZoomMode;
  zoomValue: number;
  outline: OutlineNode[];
  pageOrder: number[];
  search: SearchState | null;
  searchMatches: Match[];
  /* text editing */
  originalBytes: Uint8Array | null;
  edits: TextEdit[];
  editMode: boolean;
  editTool: "text" | "highlight" | "redact" | "pen";
  savePassword: string | null; // user password for Protect a PDF (session only)
  compressOnSave: boolean; // Compress tool: shrink output on save
  editTextColor: string;
  editTextSizePt: number;
  editHighlightColor: string;
  editPenColor: string;
  editPenWidth: number;
  editFontFamily: string;
  editTextBold: boolean;
  editTextItalic: boolean;
  editTextUnderline: boolean;
  editTextStrike: boolean;
}

const makeTab = (name: string, path: string | null): Tab => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name,
  path,
  status: "loading",
  pdf: null,
  passwordCb: null,
  wrongPassword: false,
  numPages: 0,
  page: 1,
  sizes: [],
  rotation: 0,
  zoomMode: "fit-width",
  zoomValue: 1,
  outline: [],
  pageOrder: [],
  search: null,
  searchMatches: [],
  originalBytes: null,
  edits: [],
  editMode: false,
  savePassword: null,
  compressOnSave: false,
  editTool: "text",
  editTextColor: "#111111",
  editHighlightColor: "#ffe600",
  editPenColor: "#e11d48",
  editPenWidth: 2,
  editTextSizePt: 12,
  editFontFamily: DEFAULT_FONT_FAMILY,
  editTextBold: false,
  editTextItalic: false,
  editTextUnderline: false,
  editTextStrike: false
});

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [nightMode, setNightMode] = useState(() => localStorage.getItem("pdf-reader-night") === "1");
  const [searchOpen, setSearchOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [printing, setPrinting] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Protect-a-PDF dialog state (null = closed)
  const [protectModal, setProtectModal] = useState<{ name: string } | null>(null);
  // Scan & OCR dialog state
  const [ocr, setOcr] = useState<{ name: string; page: number; busy: boolean; text: string | null } | null>(null);
  // Split tool dialog state (page range extraction)
  const [splitModal, setSplitModal] = useState<{ name: string; numPages: number } | null>(null);
  // Export-as-images dialog state
  const [exportImages, setExportImages] = useState<{ name: string; numPages: number } | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const loadingTasks = useRef(new Map<string, pdfjsLib.PDFDocumentLoadingTask>());
  const openingPaths = useRef(new Set<string>());

  const active = tabs.find((t) => t.id === activeId) ?? null;

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => {
    setTabs((list) =>
      list.map((t) => {
        if (t.id !== id) return t;
        const d = typeof patch === "function" ? patch(t) : patch;
        return { ...t, ...d };
      })
    );
  }, []);

  const pushRecent = useCallback((path: string, name: string) => {
    try {
      const raw = localStorage.getItem("pdf-reader-recents");
      const list: { path: string; name: string }[] = raw ? JSON.parse(raw) : [];
      const next = [{ path, name }, ...list.filter((r) => r.path !== path)].slice(0, 10);
      localStorage.setItem("pdf-reader-recents", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  /* ---------------- open / load ---------------- */

  const loadPdf = useCallback(
    (tabId: string, name: string, path: string | null, data: Uint8Array | null) => {
      if (!data) {
        updateTab(tabId, { status: "error", errMsg: "Empty file" });
        return;
      }
      const originalBytes = new Uint8Array(data);
      const task = pdfjsLib.getDocument({ data: originalBytes.slice() });
      loadingTasks.current.set(tabId, task);
      task.onPassword = (updateCallback: (p: string) => void, reason: number) => {
        updateTab(tabId, {
          status: "password",
          wrongPassword: reason === 2 /* PasswordReasons.INCORRECT_PASSWORD */,
          passwordCb: (pw: string) => updateCallback(pw)
        });
      };
      task.promise
        .then(async (doc) => {
          // page sizes for layout; sequential batches keep memory sane
          const numPages = doc.numPages;
          const sizes: PageSize[] = [];
          for (let n = 1; n <= numPages; n++) {
            const page = await doc.getPage(n);
            const v = page.getViewport({ scale: 1 });
            sizes.push({ width: v.width, height: v.height, rotate: page.rotate ?? 0 });
          }
          const outline = await readOutline(doc);
          // pending annotations: prefer the durable file store (survives hard
          // kills where LevelDB never flushed), fall back to localStorage
          const identity = path ? `path:${path}` : `name:${name}#${originalBytes.byteLength}`;
          let restored = loadStoredEdits(path, name, originalBytes.byteLength);
          if (!restored.length) {
            const filePayload = (await window.readerBridge.loadEdits(identity)) as { edits?: TextEdit[] } | null;
            if (filePayload && Array.isArray(filePayload.edits)) {
              restored = (filePayload.edits as TextEdit[]).filter(
                (e) => e && typeof e === "object" && e.id && e.page >= 1 && (e.kind === "replace" || e.kind === "add" || e.kind === "highlight" || e.kind === "redact" || e.kind === "pen")
              );
            }
          }
          updateTab(tabId, {
            status: "ready",
            pdf: doc,
            numPages,
            sizes,
            outline,
            pageOrder: Array.from({ length: numPages }, (_, i) => i + 1),
            page: 1,
            zoomMode: "fit-width",
            rotation: 0,
            search: null,
            searchMatches: [],
            originalBytes,
            // restore pending annotations for this document from the last session
            edits: restored
          });
          if (path) pushRecent(path, name);
        })
        .catch((err: unknown) => {
          const e = err as { name?: string; message?: string };
          if (e?.name === "PasswordException") return; // waiting for user password
          loadingTasks.current.delete(tabId);
          updateTab(tabId, {
            status: "error",
            errMsg: e?.name === "InvalidPDFException" ? "This file is not a valid PDF." : e?.message || "Failed to load PDF"
          });
        })
        .finally(() => {
          if (path) openingPaths.current.delete(path);
        });
    },
    [pushRecent, updateTab]
  );

  /** Open an in-memory PDF in a new tab (Create / Combine / form tools). */
  const openBufferTab = useCallback(
    (name: string, path: string | null, bytes: Uint8Array, _origin: string) => {
      const tab = makeTab(name, path);
      setTabs((list) => [...list, tab]);
      setActiveId(tab.id);
      loadPdf(tab.id, name, path, bytes);
      return tab.id;
    },
    [loadPdf]
  );

  const openFile = useCallback(
    async (obj: { path: string; name: string; buf: unknown } | null) => {
      if (!obj) return;
      const path = obj.path;
      // focus existing tab with the same path
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      // dedupe concurrent opens of the same path (pending query + OS event racy)
      if (path) {
        if (openingPaths.current.has(path)) return;
        openingPaths.current.add(path);
      }
      const tab = makeTab(obj.name, path);
      setTabs((list) => [...list, tab]);
      setActiveId(tab.id);
      loadPdf(tab.id, obj.name, path, new Uint8Array(obj.buf as ArrayBuffer));
    },
    [loadPdf]
  );

  const openDialog = useCallback(async () => {
    const obj = await window.readerBridge.openPdfDialog();
    await openFile(obj);
  }, [openFile]);

  const openPath = useCallback(
    async (path: string) => {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const obj = await window.readerBridge.readPdfPath(path);
      if (!obj) toast("Could not read file");
      else await openFile(obj);
    },
    [openFile, toast]
  );

  // auto-open a PDF passed via the command line / OS open-file event.
  // The renderer asks the main process for a pending path once on mount —
  // an open-file IPC event alone can race React's listener registration.
  useEffect(() => {
    void (async () => {
      const pending = await window.readerBridge.getPendingPdfPath();
      if (pending) void openPath(pending);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- tabs ---------------- */

  const closeTab = useCallback((id: string) => {
    const task = loadingTasks.current.get(id);
    task?.destroy().catch(() => {});
    loadingTasks.current.delete(id);
    const doc = tabsRef.current.find((t) => t.id === id)?.pdf;
    try {
      doc?.destroy();
    } catch {
      /* noop */
    }
    setTabs((list) => {
      const next = list.filter((t) => t.id !== id);
      if (id === activeIdRef.current) {
        setActiveId(next.length ? next[0].id : null);
      }
      return next;
    });
  }, []);

  const newTab = useCallback(() => {
    // New tab opens the empty welcome view, from which any PDF can be opened.
    const tab = makeTab("New tab", null);
    setTabs((list) => [...list, tab]);
    setActiveId(tab.id);
  }, []);

  /* keep active id valid */
  useEffect(() => {
    if (tabs.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!tabs.some((t) => t.id === activeId)) setActiveId(tabs[0].id);
  }, [tabs, activeId]);

  /* ---------------- navigation / view ---------------- */

  const goToPage = useCallback(
    (page: number) => {
      if (!active || page < 1) return;
      updateTab(active.id, { page: Math.min(page, active.numPages || page) });
    },
    [active, updateTab]
  );

  const setZoom = useCallback(
    (mode: ZoomMode, value?: number) => {
      if (!active) return;
      updateTab(active.id, { zoomMode: mode, zoomValue: value ?? active.zoomValue });
    },
    [active, updateTab]
  );

  const rotate = useCallback(() => {
    if (!active) return;
    updateTab(active.id, { rotation: (active.rotation + 90) % 360 });
  }, [active, updateTab]);

  const toggleNight = useCallback(() => {
    setNightMode((n) => {
      localStorage.setItem("pdf-reader-night", n ? "0" : "1");
      return !n;
    });
  }, []);

  /* ---------------- search ---------------- */

  const runSearch = useCallback(
    async (tabId: string, query: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      const doc = tab?.pdf;
      if (!doc) return;
      updateTab(tabId, { search: { query, matches: [], active: 0, searching: true } });
      try {
        const result = await searchDocument(doc, query, (pagesDone) => {
          setSearchProgress(tabId, pagesDone, doc.numPages);
        });
        const t = tabsRef.current.find((x) => x.id === tabId);
        if (!t || t.search?.query !== query) return; // stale
        const matches: Match[] = result.matches.map((m) => ({ page: m.page, ranges: m.ranges }));
        updateTab(tabId, {
          search: {
            query,
            matches: matches.map((m) => ({ page: m.page })),
            active: 0,
            searching: false
          },
          searchMatches: matches
        });
        if (matches.length) {
          updateTab(tabId, { page: matches[0].page });
        }
      } catch {
        updateTab(tabId, { search: { query, matches: [], active: 0, searching: false } });
      }
    },
    [updateTab]
  );

  const setSearchProgress = useCallback(
    (tabId: string, done: number, total: number) => {
      updateTab(tabId, (t) => ({
        search: t.search ? { ...t.search, matches: t.search.matches, searching: true } : null
      }));
      // progress shown via searching flag only; avoid rerenders per page
      void done;
      void total;
    },
    [updateTab]
  );

  const setSearchQuery = useCallback(
    (q: string) => {
      if (!active) return;
      const tabId = active.id;
      updateTab(tabId, { search: { query: q, matches: [], active: 0, searching: false }, searchMatches: [] });
      window.clearTimeout((setSearchQuery as unknown as { timer?: number }).timer);
      (setSearchQuery as unknown as { timer?: number }).timer = window.setTimeout(() => {
        if (q.trim()) void runSearch(tabId, q);
      }, 300);
    },
    [active, runSearch, updateTab]
  );

  const stepMatch = useCallback(
    (dir: 1 | -1) => {
      if (!active || !active.searchMatches.length) return;
      const n = active.searchMatches.length;
      const cur = active.search?.active ?? 0;
      const next = ((cur + dir) % n + n) % n;
      updateTab(active.id, {
        search: active.search ? { ...active.search, active: next } : null,
        page: active.searchMatches[next].page
      });
    },
    [active, updateTab]
  );

  /* ---------------- print ---------------- */

  const doPrint = useCallback(() => {
    if (!active || active.status !== "ready") {
      toast("Open a PDF first");
      return;
    }
    setPrinting(true);
  }, [active, toast]);

  /* ---------------- text editing ---------------- */

  const toggleEdit = useCallback(() => {
    if (!active || active.status !== "ready") {
      toast("Open a PDF to edit text");
      return;
    }
    updateTab(active.id, { editMode: !active.editMode });
  }, [active, toast, updateTab]);

  const setEditTool = useCallback(
    (tool: "text" | "highlight" | "redact" | "pen") => {
      if (!active || active.status !== "ready") {
        toast("Open a PDF first");
        return;
      }
      // enabling the highlighter/redacter also enters edit mode;
      // switching back to text keeps edit mode as-is
      updateTab(active.id, {
        editTool: tool,
        editMode: tool === "text" ? active.editMode : true
      });
    },
    [active, toast, updateTab]
  );

  const commitEdit = useCallback(
    (edit: TextEdit) => {
      if (!active) return;
      updateTab(active.id, (t) => ({ edits: [...t.edits, edit] }));
    },
    [active, updateTab]
  );

  const undoEdit = useCallback(() => {
    if (!active?.edits.length) return;
    updateTab(active.id, (t) => ({ edits: t.edits.slice(0, -1) }));
  }, [active, updateTab]);

  // preload @font-face previews for the selected + used families while editing
  useEffect(() => {
    if (!active?.editMode) return;
    void ensureFontFacesForEdits(
      active.edits.filter((e): e is Exclude<typeof e, Extract<typeof e, { kind: "highlight" | "redact" | "pen" }>> => e.kind !== "highlight" && e.kind !== "redact" && e.kind !== "pen"),
      active.editFontFamily
    );
  }, [active?.editMode, active?.editFontFamily, active?.edits]);

  // cached font-byte loader for the save pipeline (IPC whitelist-guarded)
  const fontByteCache = useRef(new Map<string, Promise<Uint8Array>>());
  const loadFontBytes: FontByteLoader = useCallback(async (file: string) => {
    const cached = fontByteCache.current.get(file);
    if (cached) return cached;
    const p = (async () => {
      const bytes = await window.readerBridge.readFontFile(file);
      if (!bytes) throw new Error(`Font file not available: ${file}`);
      return bytes;
    })();
    fontByteCache.current.set(file, p);
    return p;
  }, []);

  const doSave = useCallback(async () => {
    const tab = active;
    if (!tab || tab.status !== "ready" || !tab.originalBytes) {
      toast("Open a PDF first");
      return;
    }
    try {
      const path = await window.readerBridge.savePdfDialog(tab.name || "document.pdf");
      if (!path) return;
      const defaultedOrder = tab.pageOrder.length === tab.numPages ? tab.pageOrder : undefined;
      let bytes = await buildModifiedPdf(tab.originalBytes, tab.edits, loadFontBytes, defaultedOrder);
      // Protect a PDF: encrypt the final bytes with an AES-256 user password
      if (tab.savePassword) {
        const { PDFDocument: Enc } = await import("@cantoo/pdf-lib");
        const enc = await Enc.load(bytes, { ignoreEncryption: true });
        enc.encrypt({ userPassword: tab.savePassword, ownerPassword: tab.savePassword });
        bytes = await enc.save();
      }
      // Compress a PDF: lossless metadata strip + object-stream re-write
      if (tab.compressOnSave) {
        const { compressSavedPdf } = await import("./lib/edits");
        const before = bytes.length;
        bytes = (await compressSavedPdf(bytes)).bytes;
        toast(bytes.length < before ? `Compressed: ${(bytes.length / 1024).toFixed(0)} KB` : "Already compact");
      }
      const res = await window.readerBridge.writePdfFile(path, bytes);
      if (res.ok) {
        // annotations are now baked into the saved file — drop the pending set
        updateTab(tab.id, { edits: [] });
        toast(`Saved to ${path.split("/").pop()}${tab.savePassword ? " (password-protected)" : ""}`);
      }
      else toast(`Save failed: ${res.error ?? "unknown error"}`);
    } catch (err) {
      console.error(err);
      toast(`Save failed: ${(err as Error).message}`);
    }
  }, [active, toast, loadFontBytes]);

  // mirror pending annotations for every open document:
  // 1. localStorage (fast in-session cache)
  // 2. main-process JSON file (durable across hard kills — LevelDB may not flush)
  useEffect(() => {
    for (const t of tabs) {
      if (!t.originalBytes) continue;
      const identity = t.path ? `path:${t.path}` : `name:${t.name}#${t.originalBytes.byteLength}`;
      try {
        if (t.edits.length) {
          localStorage.setItem(
            docEditKey(t),
            JSON.stringify({ v: 1, name: t.name, path: t.path, count: t.edits.length, edits: t.edits })
          );
        } else {
          localStorage.removeItem(docEditKey(t));
        }
      } catch {
        /* storage full / unavailable — persistence is best-effort */
      }
      void window.readerBridge.saveEdits(
        identity,
        t.edits.length ? { edits: t.edits } : null
      );
    }
  }, [tabs]);

  /* ---------------- tools panel ---------------- */

  /* ---------------- Scan & OCR (local WASM engine via the main process) ---------------- */

  const runOcr = useCallback(async () => {
    const tab = active;
    if (!tab || tab.status !== "ready" || !tab.pdf) {
      toast("Open a PDF first");
      return;
    }
    const page = tab.page;
    setOcr({ name: tab.name, page, busy: true, text: null });
    try {
      // render the current page to a PNG at 2x for accurate recognition
      const pdfPage = await tab.pdf.getPage(page);
      const rot = (((tab.sizes[page - 1]?.rotate ?? 0) + tab.rotation) % 360 + 360) % 360;
      const base = pdfPage.getViewport({ scale: 1, rotation: rot });
      const scale = Math.min(4, Math.max(1, 2));
      const viewport = pdfPage.getViewport({ scale, rotation: rot });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("Could not rasterise the page");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await window.readerBridge.ocrRecognize(bytes);
      if (!res.ok) throw new Error(res.error || "OCR failed");
      setOcr((o) => (o ? { ...o, busy: false, text: res.text ?? "" } : o));
    } catch (err) {
      setOcr(null);
      toast(`OCR failed: ${(err as Error).message}`);
    }
  }, [active, toast]);

  /* ---------------- create / combine / form tools ---------------- */

  // Build a blank A4 PDF in-memory with the given page size (points)
  const makeBlankPages = useCallback((pages: number, w: number, h: number, lined: boolean) => {
    // pdf-lib is imported lazily — it's already a dependency used by edits.ts
    return import("pdf-lib").then(async ({ PDFDocument, rgb }) => {
      const doc = await PDFDocument.create();
      for (let i = 0; i < pages; i++) {
        const page = doc.addPage([w, h]);
        if (lined) {
          for (let y = 72; y < h - 72; y += 28) {
            page.drawLine({
              start: { x: 64, y },
              end: { x: w - 64, y },
              thickness: 0.6,
              color: rgb(0.82, 0.84, 0.88)
            });
          }
        }
      }
      return doc.save();
    });
  }, []);

  const createBlankPdf = useCallback(async () => {
    const bytes = await makeBlankPages(3, 595.28, 841.89, true); // A4, 3 lined pages
    await openBufferTab("Untitled form document.pdf", null, bytes, "blank");
    toast("Blank lined A4 document created — edit or save it");
  }, [makeBlankPages, openBufferTab, toast]);

  const createFormTemplate = useCallback(async () => {
    // A4 page with labelled rectangles a user can type into after export?
    // pdf-lib can't create AcroForm fields from scratch, so we stamp a
    // visual form layout (labelled boxes) + leave the doc in edit mode so
    // labels can be typed over the boxes.
    const { PDFDocument: PLib, rgb } = await import("pdf-lib");
    const doc = await PLib.create();
    for (let p = 0; p < 1; p++) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText("Form — Name:", { x: 64, y: 792, size: 12, color: rgb(0.1, 0.1, 0.2) });
      page.drawRectangle({ x: 170, y: 788, width: 360, height: 22, borderColor: rgb(0.4, 0.45, 0.55), borderWidth: 0.8 });
      page.drawText("Form — Organization:", { x: 64, y: 762, size: 12, color: rgb(0.1, 0.1, 0.2) });
      page.drawRectangle({ x: 200, y: 758, width: 330, height: 22, borderColor: rgb(0.4, 0.45, 0.55), borderWidth: 0.8 });
      page.drawText("Form — Notes:", { x: 64, y: 730, size: 12, color: rgb(0.1, 0.1, 0.2) });
      for (let y = 706; y > 120; y -= 26) {
        page.drawRectangle({ x: 64, y: y - 20, width: 466, height: 22, borderColor: rgb(0.55, 0.6, 0.68), borderWidth: 0.5 });
      }
    }
    const bytes = await doc.save();
    await openBufferTab("Form template.pdf", null, bytes, "form");
    toast("Form template created — type into the boxes with Edit text");
  }, [openBufferTab, toast]);

  /* ---------------- Word ⇄ PDF conversion ---------------- */

  const convertWordToPdf = useCallback(async () => {
    const picked = await window.readerBridge.pickWordDoc();
    if (!picked) return;
    toast(`Converting ${picked.name}…`);
    try {
      const bytes = new Uint8Array(picked.buf as ArrayBuffer);
      const res = await window.readerBridge.wordToPdf(bytes);
      if (!res.ok || !res.bytes) throw new Error(res.error || "Conversion failed");
      const name = picked.name.replace(/\.docx?$/i, "") + ".pdf";
      await openBufferTab(name, null, res.bytes, "word-to-pdf");
      toast(`Converted in ${((res.ms ?? 0) / 1000).toFixed(1)}s — review and Save`);
    } catch (err) {
      console.error(err);
      toast(`Word to PDF failed: ${(err as Error).message}`);
    }
  }, [openBufferTab, toast]);

  const convertPdfToWord = useCallback(async () => {
    const tab = active;
    if (!tab || tab.status !== "ready" || !tab.pdf) {
      toast("Open a PDF first");
      return;
    }
    toast("Converting to Word…");
    try {
      const res = await pdfToWord(tab.pdf);
      const name = tab.name.replace(/\.pdf$/i, "") + ".docx";
      const path = await window.readerBridge.savePdfDialog(name);
      if (!path) return;
      const buf = new Uint8Array(await res.blob.arrayBuffer());
      const writeRes = await window.readerBridge.writePdfFile(path, buf);
      if (!writeRes.ok) throw new Error(writeRes.error || "Write failed");
      toast(`Saved Word document: ${paragraphsLabel(res.paragraphs)} from ${res.pageCount} page${res.pageCount === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast(`PDF to Word failed: ${(err as Error).message}`);
    }
  }, [active, toast]);

  function paragraphsLabel(n: number): string {
    return `${n} paragraph${n === 1 ? "" : "s"}`;
  }

  /* ---------------- PDF → PowerPoint ---------------- */

  const convertPdfToPptx = useCallback(async () => {
    const tab = active;
    if (!tab || tab.status !== "ready" || !tab.pdf) {
      toast("Open a PDF first");
      return;
    }
    toast("Converting to PowerPoint…");
    try {
      const res = await pdfToPptx(tab.pdf);
      const name = tab.name.replace(/\.pdf$/i, "") + ".pptx";
      const path = await window.readerBridge.savePdfDialog(name);
      if (!path) return;
      const buf = new Uint8Array(await res.blob.arrayBuffer());
      const writeRes = await window.readerBridge.writePdfFile(path, buf);
      if (!writeRes.ok) throw new Error(writeRes.error || "Write failed");
      toast(`Saved PowerPoint: ${res.pageCount} slide${res.pageCount === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast(`PDF to PowerPoint failed: ${(err as Error).message}`);
    }
  }, [active, toast]);

  /* ---------------- Export pages as images ---------------- */

  const doExportImages = useCallback(
    async (opts: { format: "png" | "jpg"; quality: 1 | 2 | 3; from: number; to: number }) => {
      const tab = active;
      if (!tab || tab.status !== "ready" || !tab.pdf || !exportImages) return;
      const from = Math.max(1, Math.min(opts.from, opts.to, tab.numPages));
      const to = Math.min(Math.max(from, opts.to), tab.numPages);
      const pages: number[] = [];
      for (let n = from; n <= to; n++) pages.push(n);
      setExportImages(null);
      toast(`Exporting ${pages.length} page${pages.length === 1 ? "" : "s"} as ${opts.format.toUpperCase()}…`);
      try {
        const res = await exportPagesAsImages(tab.pdf, tab.name, { format: opts.format, quality: opts.quality, pages });
        if (res.failed.length) {
          toast(`Exported ${res.count}/${pages.length} — failures: ${res.failed.slice(0, 2).join("; ")}`);
        } else {
          toast(`Exported ${res.count} image${res.count === 1 ? "" : "s"} to ${res.dir.split("/").pop()}`);
        }
      } catch (err) {
        if ((err as Error).message !== "canceled") {
          console.error(err);
          toast(`Image export failed: ${(err as Error).message}`);
        }
      }
    },
    [active, exportImages, toast]
  );

  /* ---------------- Split: extract a page range into a new tab ---------------- */

  const doSplit = useCallback(
    async (from: number, to: number) => {
      const tab = active;
      if (!tab || tab.status !== "ready" || !tab.originalBytes || !splitModal) return;
      const fromP = Math.max(1, Math.min(from, to, tab.numPages));
      const toP = Math.min(Math.max(fromP, to), tab.numPages);
      setSplitModal(null);
      try {
        const { PDFDocument: PL } = await import("pdf-lib");
        const src = await PL.load(tab.originalBytes, { ignoreEncryption: true });
        const out = await PL.create();
        const indices: number[] = [];
        for (let n = fromP - 1; n <= toP - 1; n++) indices.push(n);
        const copied = await out.copyPages(src, indices);
        for (const cp of copied) out.addPage(cp);
        const bytes = await out.save();
        await openBufferTab(`${tab.name.replace(/\.pdf$/i, "")} p${fromP}-${toP}.pdf`, null, bytes, "split");
        toast(`Extracted pages ${fromP}–${toP} into a new tab`);
      } catch (err) {
        console.error(err);
        toast(`Split failed: ${(err as Error).message}`);
      }
    },
    [active, splitModal, openBufferTab, toast]
  );

  const combinePdfs = useCallback(async () => {
    const picked = await window.readerBridge.openMultiPdfDialog();
    if (!picked.length) return;
    try {
      const { PDFDocument: PL } = await import("pdf-lib");
      const out = await PL.create();
      let pages = 0;
      for (const p of picked) {
        const src = await PL.load(new Uint8Array(p.buf as ArrayBuffer), { ignoreEncryption: true });
        const copied = await out.copyPages(src, src.getPageIndices());
        for (const cp of copied) {
          out.addPage(cp);
          pages++;
        }
      }
      const bytes = await out.save();
      const name = `Combined ${picked.length} files.pdf`;
      await openBufferTab(name, null, bytes, "combined");
      toast(`Combined ${picked.length} PDFs — ${pages} pages`);
    } catch (err) {
      console.error(err);
      toast(`Combine failed: ${(err as Error).message}`);
    }
  }, [openBufferTab, toast]);

  const runTool = useCallback(
    (id: ToolId) => {
      setToolsOpen(false);
      if (!active || active.status !== "ready") {
        // word-to-pdf only needs a file picker, not an open PDF
        if (id !== "create" && id !== "combine" && id !== "word-to-pdf") toast("Open a PDF first");
        return;
      }
      switch (id) {
        // Export a PDF = Save As (the existing baked-out pipeline)
        case "export":
          void doSave();
          break;
        // Edit a PDF = enter text-edit mode
        case "edit":
          toggleEdit();
          break;
        // Organize pages = open thumbnails, where pages can be drag-reordered
        case "organize":
          setSidebarOpen(true);
          toast("Drag thumbnails to reorder pages — order is applied on save");
          break;
        // Create a PDF = a fresh blank multi-page document tab
        case "create":
          void createBlankPdf();
          break;
        // Combine files = merge picked PDFs (in picked order) into one tab
        case "combine":
          void combinePdfs();
          break;
        // Prepare a form = new blank doc pre-stamped with labelled field boxes
        case "prepare-form":
          void createFormTemplate();
          break;
        // Word → PDF: pick a .docx, render in a hidden window, print to PDF
        case "word-to-pdf":
          void convertWordToPdf();
          break;
        // PDF → Word: extract text from the open PDF into a .docx
        case "pdf-to-word":
          void convertPdfToWord();
          break;
        // PDF → PowerPoint: each page becomes a slide (image + notes)
        case "pdf-to-pptx":
          void convertPdfToPptx();
          break;
        // Export pages as PNG/JPG images into a folder
        case "export-images":
          setExportImages({ name: active.name, numPages: active.numPages });
          break;
        // Split: extract a page range into a new document tab
        case "split":
          setSplitModal({ name: active.name, numPages: active.numPages });
          break;
        // Protect a PDF = set/remove the save password via the in-app dialog
        case "protect":
          setProtectModal({ name: active.name });
          break;
        // Compress a PDF = toggle lossless shrink applied on next save
        case "compress":
          updateTab(active.id, (t) => ({ compressOnSave: !t.compressOnSave }));
          toast(active.compressOnSave ? "Compression off" : "Compression on — saves will be shrunk losslessly");
          break;
        case "ocr":
          void runOcr();
          break;
        case "ai":
        case "summary":
        case "esign":
          toast("This tool needs a cloud service and is coming soon");
          break;
        default:
          toast("This tool is coming soon");
      }
    },
    [active, doSave, toggleEdit, toast, updateTab, createBlankPdf, combinePdfs, createFormTemplate, runOcr, convertWordToPdf, convertPdfToWord, convertPdfToPptx]
  );

  /* ---------------- annotations ---------------- */

  const clearAnnotations = useCallback(() => {
    if (!active?.edits.length) return;
    updateTab(active.id, { edits: [] });
    toast("Annotations cleared");
  }, [active, toast, updateTab]);

  const deleteSelected = useCallback(
    (ids: string[]) => {
      if (!active || !ids.length) return;
      updateTab(active.id, (t) => ({ edits: t.edits.filter((e) => !ids.includes(e.id)) }));
      toast(`Deleted ${ids.length} annotation${ids.length === 1 ? "" : "s"}`);
    },
    [active, toast, updateTab]
  );

  const moveSelected = useCallback(
    (ids: string[], page: number) => {
      if (!active || !ids.length) return;
      updateTab(active.id, (t) => ({
        edits: t.edits.map((e) => (ids.includes(e.id) ? { ...e, page } : e))
      }));
      toast(`Moved ${ids.length} annotation${ids.length === 1 ? "" : "s"} to page ${page}`);
    },
    [active, toast, updateTab]
  );

  const reorderPages = useCallback(
    (from: number, to: number) => {
      if (!active || !active.numPages) return;
      const n = active.numPages;
      if (from < 1 || from > n || to < 0 || to > n || from === to) return;
      // `to` is an insertion slot in the CURRENT layout. Removing the dragged
      // page first shifts later pages left, so a slot >= from means "after it".
      const target = to > from ? to - 1 : to;
      if (target === from - 1) return; // dropped back where it started
      updateTab(active.id, (t) => {
        const prevOrder = t.pageOrder.length === t.numPages ? t.pageOrder : Array.from({ length: t.numPages }, (_, i) => i + 1);
        // `from`/`target` are positions in the CURRENT visual layout
        const order = [...prevOrder];
        const [moved] = order.splice(from - 1, 1);
        order.splice(target, 0, moved);
        // remap edit pages + current page through the order we just applied:
        // edit on original page p now sits at position order.indexOf(p)
        const slotOf = (orig: number) => order.indexOf(orig) + 1;
        return {
          pageOrder: order,
          sizes: order.map((p) => t.sizes[p - 1]),
          edits: t.edits.map((e) => ({ ...e, page: slotOf(prevOrder[e.page - 1]) })),
          page: slotOf(prevOrder[t.page - 1])
        };
      });
      toast(`Page ${from} moved to position ${target + 1}`);
    },
    [active, toast, updateTab]
  );

  const navigateDest = useCallback(
    async (dest: unknown) => {
      if (!active || !active.pdf) return;
      const page = await destToPageNumber(active.pdf, dest);
      if (page) updateTab(active.id, { page });
      else toast("Could not resolve bookmark");
    },
    [active, toast, updateTab]
  );

  /* ---------------- keyboard & events ---------------- */

  useEffect(() => {
    const offMenu = window.readerBridge.onMenuAction(({ action }) => {
      switch (action) {
        case "open": void openDialog(); break;
        case "find": setSearchOpen(true); break;
        case "print": doPrint(); break;
        case "save": void doSave(); break;
        case "edit-text": toggleEdit(); break;
        case "prev-page": goToPage((active?.page ?? 1) - 1); break;
        case "next-page": goToPage((active?.page ?? 1) + 1); break;
        case "zoom-in": setZoom("custom", Math.min(4, (active?.zoomMode === "custom" ? active.zoomValue : 1) * 1.125)); break;
        case "zoom-out": setZoom("custom", Math.max(0.1, (active?.zoomMode === "custom" ? active.zoomValue : 1) / 1.125)); break;
        case "zoom-reset": setZoom("custom", 1); break;
        case "fit-width": setZoom("fit-width"); break;
        case "fit-page": setZoom("fit-page"); break;
        case "night-mode": toggleNight(); break;
        case "toggle-sidebar": setSidebarOpen((s) => !s); break;
        case "select-all": document.execCommand("selectAll"); break;
        case "about": toast(`Figma v${APP_VERSION} — built with Electron & pdf.js`); break;
      }
    });
    const offOs = window.readerBridge.onOpenFromOs((filePath) => void openPath(filePath));
    return () => {
      offMenu();
      offOs();
    };
  }, [openDialog, openPath, doPrint, doSave, toggleEdit, goToPage, setZoom, toggleNight, toast, active?.zoomMode, active?.zoomValue, active?.page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F3") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        if (active?.editMode) updateTab(active.id, { editMode: false });
      } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && (e.ctrlKey || e.metaKey) && searchOpen) {
        e.preventDefault();
        stepMatch(e.key === "ArrowUp" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active?.page, goToPage, searchOpen, stepMatch]);

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!/\.pdf$/i.test(file.name)) {
        toast("Only PDF files are supported");
        return;
      }
      void file.arrayBuffer().then((buf) => {
        const existing = tabsRef.current.find((t) => t.name === file.name);
        if (existing) {
          setActiveId(existing.id);
          return;
        }
        const tab = makeTab(file.name, null);
        setTabs((list) => [...list, tab]);
        setActiveId(tab.id);
        loadPdf(tab.id, file.name, null, new Uint8Array(buf));
      });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [loadPdf, toast]);

  /* ------------- confirm quit ------------- */
  useEffect(() => {
    const onQuit = () => void window.readerBridge.confirmExit();
    window.addEventListener("beforeunload", onQuit);
    void onQuit;
    return () => window.removeEventListener("beforeunload", onQuit);
  }, []);

  const docSearchProps = active
    ? {
        search: active.search,
        onSearchQuery: setSearchQuery,
        onNextMatch: () => stepMatch(1),
        onPrevMatch: () => stepMatch(-1)
      }
    : null;

  return (
    <div id="app-ui" className={`flex flex-col h-screen bg-zinc-950 ${nightMode ? "" : ""}`}>
      <TabBar
        tabs={tabs.map((t) => ({ id: t.id, name: t.status === "loading" ? `${t.name} — loading…` : t.name }))}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={newTab}
      />

      {tabs.length === 0 ? (
        <EmptyState onOpenDialog={() => void openDialog()} onOpenPath={(p) => void openPath(p)} />
      ) : (
        <>
          {active && (
            <Toolbar
              zoomMode={active.zoomMode}
              zoomValue={active.zoomValue}
              page={active.page}
              numPages={active.numPages}
              nightMode={nightMode}
              sidebarOpen={sidebarOpen}
              searchOpen={searchOpen}
              onPrevPage={() => goToPage(active.page - 1)}
              onNextPage={() => goToPage(active.page + 1)}
              onGoToPage={goToPage}
              onZoomIn={() => setZoom("custom", Math.min(4, (active.zoomMode === "custom" ? active.zoomValue : 1) * 1.125))}
              onZoomOut={() => setZoom("custom", Math.max(0.1, (active.zoomMode === "custom" ? active.zoomValue : 1) / 1.125))}
              onZoomSelect={setZoom}
              onRotate={rotate}
              onToggleNight={toggleNight}
              onToggleSidebar={() => setSidebarOpen((s) => !s)}
              onOpenSearch={() => setSearchOpen(true)}
              onCloseSearch={() => {
                setSearchOpen(false);
              }}
              {...docSearchProps!}
              onPrint={doPrint}
              editMode={active.editMode}
              canUndo={active.edits.length > 0}
              onToggleEdit={toggleEdit}
              onUndo={undoEdit}
              onSave={() => void doSave()}
              textColor={active.editTextColor}
              onTextColor={(c) => updateTab(active.id, { editTextColor: c })}
              textSizePt={active.editTextSizePt}
              onTextSizePt={(pt) => updateTab(active.id, { editTextSizePt: pt })}
              editFontFamily={active.editFontFamily}
              onEditFontFamily={(id) => updateTab(active.id, { editFontFamily: id })}
              editTextBold={active.editTextBold}
              onEditTextBold={(b) => updateTab(active.id, { editTextBold: b })}
              editTextItalic={active.editTextItalic}
              onEditTextItalic={(b) => updateTab(active.id, { editTextItalic: b })}
              editTextUnderline={active.editTextUnderline}
              onEditTextUnderline={(b) => updateTab(active.id, { editTextUnderline: b })}
              editTextStrike={active.editTextStrike}
              onEditTextStrike={(b) => updateTab(active.id, { editTextStrike: b })}
              editTool={active.editTool}
              onEditTool={setEditTool}
              highlightColor={active.editHighlightColor}
              onHighlightColor={(c) => updateTab(active.id, { editHighlightColor: c })}
              penColor={active.editPenColor}
              onPenColor={(c) => updateTab(active.id, { editPenColor: c })}
              penWidth={active.editPenWidth}
              onPenWidth={(w) => updateTab(active.id, { editPenWidth: w })}
              toolsOpen={toolsOpen}
              onToggleTools={() => setToolsOpen((s) => !s)}
            />
          )}

          <div className={`flex flex-1 min-h-0 ${nightMode ? "night" : ""}`}>
            <Sidebar
              open={sidebarOpen}
              tab={active && active.status === "ready" ? active : null}
              onNavigateDest={(dest) => void navigateDest(dest)}
              onJumpToPage={goToPage}
              onClearAnnotations={clearAnnotations}
              onDeleteSelected={deleteSelected}
              onMoveSelected={moveSelected}
              onReorderPages={reorderPages}
            />
            <div className="flex-1 min-w-0 flex relative">
              {tabs.map((t) => (
                <DocumentView
                  key={t.id}
                  doc={t.pdf}
                  numPages={t.numPages}
                  sizes={t.sizes}
                  page={t.page}
                  pageOrder={t.pageOrder.length === t.numPages ? t.pageOrder : undefined}
                  rotation={t.rotation}
                  zoomMode={t.zoomMode}
                  zoomValue={t.zoomValue}
                  hidden={t.id !== activeId}
                  matches={t.searchMatches}
                  activeMatch={t.search?.active ?? -1}
                  onVisiblePageChange={(page) => updateTab(t.id, { page })}
                  printing={printing && t.id === activeId}
                  onPrintingDone={() => setPrinting(false)}
                  editMode={t.editMode}
                  editTool={t.editTool}
                  editHighlightColor={t.editHighlightColor}
                  editPenColor={t.editPenColor}
                  editPenWidth={t.editPenWidth}
                  editTextColor={t.editTextColor}
                  editTextSizePt={t.editTextSizePt}
                  editFontFamily={t.editFontFamily}
                  editTextBold={t.editTextBold}
                  editTextItalic={t.editTextItalic}
                  editTextUnderline={t.editTextUnderline}
                  editTextStrike={t.editTextStrike}
                  edits={t.edits}
                  onCommitEdit={commitEdit}
                />
              ))}

              {/* status overlays inside document area */}
              {active?.status === "loading" && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-sm">Loading…</div>
              )}
              {active?.status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm px-6 text-center">
                  {active.errMsg}
                </div>
              )}
              {active && active.status === "password" && (
                <PasswordModal
                  name={active.name}
                  wrong={active.wrongPassword}
                  onSubmit={(pw) => {
                    updateTab(active.id, { status: "loading", wrongPassword: false });
                    active.passwordCb?.(pw);
                  }}
                  onCancel={closeTab.bind(null, active.id)}
                />
              )}
              {protectModal && active && (
                <PasswordModal
                  mode="protect"
                  name={protectModal.name}
                  wrong={false}
                  onSubmit={(pw) => {
                    setProtectModal(null);
                    if (!pw.trim()) {
                      updateTab(active.id, { savePassword: null });
                      toast("Protection removed — will save unencrypted");
                    } else {
                      updateTab(active.id, { savePassword: pw });
                      toast(`Password set — ${active.name} will be encrypted on save`);
                    }
                  }}
                  onCancel={() => setProtectModal(null)}
                />
              )}
              {ocr && (
                <OcrModal
                  name={ocr.name}
                  page={ocr.page}
                  busy={ocr.busy}
                  text={ocr.text}
                  onClose={() => setOcr(null)}
                />
              )}
              {splitModal && (
                <SplitModal
                  name={splitModal.name}
                  numPages={splitModal.numPages}
                  onSplit={(f, t) => void doSplit(f, t)}
                  onClose={() => setSplitModal(null)}
                />
              )}
              {exportImages && (
                <ExportImagesModal
                  name={exportImages.name}
                  numPages={exportImages.numPages}
                  onExport={(o) => void doExportImages(o)}
                  onClose={() => setExportImages(null)}
                />
              )}
            </div>
          </div>
        </>
      )}

      <ToolsPanel open={toolsOpen} onClose={() => setToolsOpen(false)} onRunTool={runTool} />

      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className="bg-zinc-800 border border-zinc-700 text-zinc-100 text-[13px] px-4 py-2 rounded-lg shadow-xl">
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
