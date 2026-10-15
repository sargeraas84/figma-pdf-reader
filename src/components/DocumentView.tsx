import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PdfDocument, PageSize } from "../lib/pdfjs";
import type { Match } from "../lib/search";
import type { TextEdit } from "../lib/edits";
import PageView from "./PageView";
import type { ZoomMode } from "./Toolbar";

interface Props {
  doc: PdfDocument | null;
  numPages: number;
  sizes: PageSize[];
  /** visual layout; slot s (1-based) shows source page order[s-1]. Undefined = identity. */
  pageOrder?: number[];
  page: number;
  rotation: number;
  zoomMode: ZoomMode;
  zoomValue: number;
  hidden: boolean;
  matches: Match[]; // from search, ordered; m.page is a SOURCE page number
  activeMatch: number; // index into matches
  onVisiblePageChange: (page: number) => void;
  printing: boolean;
  onPrintingDone: () => void;
  /* edit mode */
  editMode: boolean;
  editTool: "text" | "highlight" | "redact" | "pen";
  editHighlightColor: string;
  editPenColor: string;
  editPenWidth: number;
  editTextColor: string;
  editTextSizePt: number;
  editFontFamily: string;
  editTextBold: boolean;
  editTextItalic: boolean;
  editTextUnderline: boolean;
  editTextStrike: boolean;
  edits: TextEdit[]; // e.page is a SLOT (visual position), kept remapped by App
  onCommitEdit: (edit: TextEdit) => void;
}

export default function DocumentView(p: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const printRootRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const [containerW, setContainerW] = useState(800);
  const [containerH, setContainerH] = useState(600);
  const lastScrolledPage = useRef(0);

  // measure the container for fit modes
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerW(el.clientWidth);
      setContainerH(el.clientHeight);
    });
    ro.observe(el);
    setContainerW(el.clientWidth);
    setContainerH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // visual layout: slot -> source page
  const order: number[] = useMemo(
    () => (p.pageOrder && p.pageOrder.length === p.numPages ? p.pageOrder : Array.from({ length: p.numPages }, (_, i) => i + 1)),
    [p.pageOrder, p.numPages]
  );
  /** slot (1-based visual position) -> source page (1-based in the file) */
  const slotToSource = useCallback((slot: number) => order[slot - 1] ?? slot, [order]);
  /** source page -> slot; falls back to the source page itself */
  const sourceToSlot = useCallback(
    (source: number) => {
      const idx = order.indexOf(source);
      return idx >= 0 ? idx + 1 : source;
    },
    [order]
  );

  const rotation = p.rotation;
  const oddRot = ((rotation % 360) + 360) % 360 === 90 || ((rotation % 360) + 360) % 360 === 270;

  // fit modes size to the first VISIBLE page of the current layout
  const pageCountForFit = p.sizes[slotToSource(1) - 1] ?? p.sizes[0];
  const effScale = useMemo(() => {
    if (!pageCountForFit) return 1;
    const w1 = oddRot ? pageCountForFit.height : pageCountForFit.width;
    const h1 = oddRot ? pageCountForFit.width : pageCountForFit.height;
    let s: number;
    if (p.zoomMode === "custom") s = p.zoomValue;
    else if (p.zoomMode === "fit-width")
      s = Math.max(0.05, Math.min(8, (containerW - 32) / w1));
    else s = Math.max(0.05, Math.min(8, Math.min((containerW - 32) / w1, (containerH - 32) / h1)));
    return s;
  }, [p.zoomMode, p.zoomValue, containerW, containerH, oddRot, pageCountForFit]);

  /* ---- scroll to page when `page` prop changes externally ---- */
  // `page` is a slot (visual position)
  useEffect(() => {
    if (p.hidden) return;
    if (lastScrolledPage.current === p.page) return;
    lastScrolledPage.current = p.page;
    const el = pageEls.current.get(p.page);
    const sc = scrollerRef.current;
    if (el && sc) {
      sc.scrollTo({ top: el.offsetTop - 12, behavior: "auto" });
    }
  }, [p.page, p.hidden, effScale, rotation]);

  /* ---- track visible page on scroll ---- */
  const handleScroll = useCallback(() => {
    const sc = scrollerRef.current;
    if (!sc || p.hidden) return;
    let current = 1; // slot number
    for (let slot = 1; slot <= p.numPages; slot++) {
      const el = pageEls.current.get(slot);
      if (!el) continue;
      if (el.offsetTop - sc.scrollTop <= sc.clientHeight * 0.35) current = slot;
      else break;
    }
    if (current !== p.page) p.onVisiblePageChange(current);
  }, [p.hidden, p.numPages, p.page, p.onVisiblePageChange]);

  /* ---- scroll to active match ---- */
  // matches carry SOURCE pages; scroll to the slot that shows that source
  useEffect(() => {
    if (p.hidden || !p.matches.length) return;
    const m = p.matches[p.activeMatch];
    if (!m) return;
    const slot = sourceToSlot(m.page);
    const el = pageEls.current.get(slot);
    const sc = scrollerRef.current;
    if (el && sc && lastScrolledPage.current !== slot) {
      lastScrolledPage.current = slot;
      sc.scrollTo({ top: el.offsetTop - 12 });
    } else if (el && sc) {
      // same page: keep current scroll (highlight overlay will show it)
    }
  }, [p.activeMatch, p.matches, p.hidden, sourceToSlot]);

  /* ---- print pipeline: render all pages into a hidden print root, in VISUAL order ---- */
  const printDoc = p.doc;
  useEffect(() => {
    if (!p.printing || !printDoc) return;
    let cancelled = false;
    (async () => {
      const root = printRootRef.current;
      if (!root) return;
      root.textContent = "";
      const doc = printDoc;
      const dpr = 1;
      for (let slot = 1; slot <= p.numPages; slot++) {
        if (cancelled) return;
        const source = slotToSource(slot);
        const page = await doc.getPage(source);
        if (cancelled) return;
        const rot = (((p.sizes[source - 1]?.rotate ?? 0) + rotation) % 360 + 360) % 360;
        const base = page.getViewport({ scale: 1, rotation: rot });
        const scale = Math.max(0.4, Math.min(4, (containerW - 32) / base.width));
        const viewport = page.getViewport({ scale, rotation: rot });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        root.appendChild(canvas);
      }
      if (!cancelled) {
        window.print();
        p.onPrintingDone();
      }
    })().catch((e) => {
      console.error("Print render failed", e);
      p.onPrintingDone();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.printing]);

  if (!p.doc) return null;
  const doc = p.doc;

  // search matches are keyed by SOURCE page; collect them per source page
  const sourceMatches = new Map<number, { matchIndex: number; ranges: { item: number; from: number; to: number }[] }[]>();
  p.matches.forEach((m, i) => {
    const list = sourceMatches.get(m.page) ?? [];
    list.push({ matchIndex: i, ranges: m.ranges });
    sourceMatches.set(m.page, list);
  });

  return (
    <>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="doc-scroll flex-1 overflow-auto bg-zinc-950"
        style={{ display: p.hidden ? "none" : undefined }}
        tabIndex={0}
      >
        <div className="flex flex-col items-center gap-3 py-6 min-h-max">
          {Array.from({ length: p.numPages }, (_, i) => i + 1).map((slot) => {
            const source = slotToSource(slot);
            const s = p.sizes[source - 1] ?? p.sizes[0] ?? { width: 612, height: 792, rotate: 0 };
            const odd = oddRot;
            const w = odd ? s.height * effScale : s.width * effScale;
            const h = odd ? s.width * effScale : s.height * effScale;
            const m = sourceMatches.get(source);
            return (
              <div
                key={slot}
                ref={(el) => {
                  if (el) pageEls.current.set(slot, el);
                  else pageEls.current.delete(slot);
                }}
                style={{ width: Math.ceil(w), height: Math.ceil(h) }}
              >
                <PageView
                  doc={doc}
                  pageNumber={source}
                  size={s}
                  scale={effScale}
                  rotation={rotation}
                  matchesRanges={m ?? []}
                  activeMatchIndex={p.matches.length ? p.activeMatch : null}
                  editMode={p.editMode}
                  editTool={p.editTool}
                  highlightColor={p.editHighlightColor}
                  penColor={p.editPenColor}
                  penWidth={p.editPenWidth}
                  textColor={p.editTextColor}
                  textSizePt={p.editTextSizePt}
                  fontFamily={p.editFontFamily}
                  fontBold={p.editTextBold}
                  fontItalic={p.editTextItalic}
                  fontUnderline={p.editTextUnderline}
                  fontStrike={p.editTextStrike}
                  pageEdits={p.edits.filter((e) => e.page === slot)}
                  onCommitEdit={p.onCommitEdit}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div ref={printRootRef} className="print-root no-print" />
    </>
  );
}
