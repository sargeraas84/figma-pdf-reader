import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PdfDocument, PageSize } from "../lib/pdfjs";
import type { MatchRange } from "../lib/search";
import {
  geometryFromItem,
  hexToRgb01,
  type HighlightEdit,
  type TextContentItem,
  type TextEdit
} from "../lib/edits";
import { fontCssForEdit, ensureFontFaces } from "../lib/fonts";

interface Props {
  doc: PdfDocument;
  pageNumber: number;
  size: PageSize;
  scale: number;
  rotation: number; // viewer rotation delta (0/90/180/270)
  matchesRanges: { matchIndex: number; ranges: MatchRange[] }[];
  activeMatchIndex: number | null;
  /* edit mode */
  editMode: boolean;
  editTool: "text" | "highlight" | "redact" | "pen";
  highlightColor: string;
  penColor: string;
  penWidth: number; // stroke width in points
  textColor: string;
  textSizePt: number;
  fontFamily: string;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  fontStrike: boolean;
  pageEdits: TextEdit[];
  onCommitEdit: (edit: TextEdit) => void;
}

type EditingState =
  | { mode: "existing"; index: number; initial: string; baseLeft: number; baseTop: number; fontSizeCss: number; widthCss: number }
  | { mode: "new"; left: number; top: number }
  | null;

let editUid = 0;
const nextEditId = () => `edit-${++editUid}-${Date.now().toString(36)}`;

const textDecoration = (u: boolean, s: boolean): string =>
  [u ? "underline" : "", s ? "line-through" : ""].filter(Boolean).join(" ");

export default function PageView({
  doc,
  pageNumber,
  size,
  scale,
  rotation,
  matchesRanges,
  activeMatchIndex,
  editMode,
  editTool,
  highlightColor,
  penColor,
  penWidth,
  textColor,
  textSizePt,
  fontFamily,
  fontBold,
  fontItalic,
  fontUnderline,
  fontStrike,
  pageEdits,
  onCommitEdit
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const editLayerRef = useRef<HTMLDivElement>(null);
  const editBoxRef = useRef<HTMLDivElement>(null);
  const textDivs = useRef<HTMLElement[]>([]);
  const viewportRef = useRef<pdfjsLib.PageViewport | null>(null);
  const itemsRef = useRef<TextContentItem[] | null>(null);
  const editingRef = useRef<EditingState>(null);
  const [visible, setVisible] = useState(false);
  const [textReady, setTextReady] = useState(0); // increments on text layer re-render
  const [viewportVersion, setViewportVersion] = useState(0);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [editing, setEditing] = useState<EditingState>(null);
  editingRef.current = editing;

  const oddRot = ((rotation % 360) + 360) % 360 === 90 || ((rotation % 360) + 360) % 360 === 270;
  const w = oddRot ? size.height * scale : size.width * scale;
  const h = oddRot ? size.width * scale : size.height * scale;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { root: el.closest(".doc-scroll"), rootMargin: "1200px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // canvas + text layer render
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const rot = (((size.rotate + rotation) % 360) + 360) % 360;
      const viewport = page.getViewport({ scale, rotation: rot });
      viewportRef.current = viewport;
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      });
      await renderTask.promise;
      // text layer
      const tl = textLayerRef.current;
      if (!tl || cancelled) return;
      tl.textContent = "";
      textDivs.current = [];
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: tl,
        viewport
      });
      await textLayer.render();
      textDivs.current = textLayer.textDivs as HTMLElement[];
      textDivs.current.forEach((d, i) => {
        d.dataset.itemIndex = String(i);
      });
      if (!cancelled) {
        setTextReady((n) => n + 1);
        setViewportVersion((n) => n + 1);
      }
    })().catch((err: unknown) => {
      if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "RenderingCancelledException") return;
      console.error("Page render failed", pageNumber, err);
    });
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [doc, pageNumber, scale, rotation, visible]);

  // fetch text content items lazily when entering edit mode on this page
  useEffect(() => {
    if (!editMode || itemsRef.current) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const content = (await page.getTextContent()) as {
        items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>;
      };
      if (cancelled) return;
      itemsRef.current = content.items.filter(
        (it): it is TextContentItem =>
          // keep ALL string items (even empty ones): pdf.js creates a textDiv
          // for every string item, so indexes must align 1:1 with textDivs.
          typeof it.str === "string" &&
          Array.isArray(it.transform) &&
          it.transform.length >= 6
      );
      setItemsVersion((n) => n + 1);
      // deterministic signal for E2E/automation: items are loaded & aligned
      const el = containerRef.current;
      if (el && !cancelled) el.dataset.editReady = "true";
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [editMode, doc, pageNumber]);

  // clear the ready flag when leaving edit mode
  useEffect(() => {
    if (editMode) return;
    const el = containerRef.current;
    if (el) delete el.dataset.editReady;
  }, [editMode]);

  // load the live-preview @font-face for the selected family (builtin = no-op)
  useEffect(() => {
    if (!editMode) return;
    void ensureFontFaces(fontFamily);
  }, [editMode, fontFamily]);

  /* --------- click handling in edit mode --------- */
  const handlePageClick = (e: React.MouseEvent) => {
    if (!editMode || editingRef.current) return;
    // only the text tool places edit boxes; highlight/redact own the mouse
    if (editTool !== "text") return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-edit-box]") || target.closest("[data-cover]")) return;
    const base = containerRef.current?.getBoundingClientRect();
    if (!base || !viewportRef.current) return;

    const span = target.tagName === "SPAN" && target.parentElement?.classList.contains("textLayer") ? target : null;
    if (span && itemsRef.current) {
      const idx = parseInt(span.dataset.itemIndex ?? "-1", 10);
      const item = itemsRef.current[Number.isNaN(idx) ? -1 : idx];
      if (idx >= 0 && item) {
        const rect = span.getBoundingClientRect();
        const geo = geometryFromItem(item);
        const fontSizeCss = geo.fontSizePt * scale;
        setEditing({
          mode: "existing",
          index: idx,
          initial: item.str,
          baseLeft: rect.left - base.left,
          baseTop: rect.top - base.top,
          fontSizeCss,
          widthCss: Math.max(24, rect.width)
        });
        e.preventDefault();
        return;
      }
    }
    // empty area → start a new text box at the click point
    const left = e.clientX - base.left;
    const top = e.clientY - base.top;
    setEditing({ mode: "new", left, top });
    e.preventDefault();
  };

  const commitEditing = () => {
    const st = editingRef.current;
    const box = editBoxRef.current;
    const viewport = viewportRef.current;
    if (!st || !box || !viewport) {
      setEditing(null);
      return;
    }
    const value = (box.innerText ?? "").replace(/\n+$/, "");
    if (st.mode === "existing") {
      const item = itemsRef.current?.[st.index];
      if (item && value.trim() !== item.str.trim() && item.str.trim().length > 0) {
        const geo = geometryFromItem(item);
        onCommitEdit({
          id: nextEditId(),
          page: pageNumber,
          kind: "replace",
          text: value,
          fontSizePt: geo.fontSizePt,
          color: hexToRgb01(textColor),
          fontFamily,
          bold: fontBold,
          italic: fontItalic,
          underline: fontUnderline,
          strike: fontStrike,
          bbox: geo.bbox,
          baseline: geo.baseline
        });
      }
    } else {
      if (value.trim().length > 0) {
        const anchor = viewport.convertToPdfPoint(st.left, st.top + textSizePt * scale * 0.85);
        onCommitEdit({
          id: nextEditId(),
          page: pageNumber,
          kind: "add",
          text: value,
          fontSizePt: textSizePt,
          color: hexToRgb01(textColor),
          fontFamily,
          bold: fontBold,
          italic: fontItalic,
          underline: fontUnderline,
          strike: fontStrike,
          point: { x: anchor[0], y: anchor[1] }
        });
      }
    }
    setEditing(null);
  };

  /* --------- highlight tool: text selection → highlight edit --------- */
  interface DomRectLike {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  const rectsToEdit = (domRects: DomRectLike[], base: DOMRect): HighlightEdit | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rects: HighlightEdit["rects"] = [];
    for (const r of domRects) {
      const left = Math.max(0, r.left - base.left);
      const right = Math.min(base.width, r.right - base.left);
      const top = Math.max(0, r.top - base.top);
      const bottom = Math.min(base.height, r.bottom - base.top);
      if (right - left < 2 || bottom - top < 2) continue;
      const p1 = viewport.convertToPdfPoint(left, top);
      const p2 = viewport.convertToPdfPoint(right, bottom);
      rects.push({
        x0: Math.min(p1[0], p2[0]),
        y0: Math.min(p1[1], p2[1]),
        x1: Math.max(p1[0], p2[0]),
        y1: Math.max(p1[1], p2[1])
      });
    }
    if (!rects.length) return null;
    return {
      id: nextEditId(),
      page: pageNumber,
      kind: "highlight",
      color: hexToRgb01(highlightColor),
      rects
    };
  };

  /** group the clicked span's row into contiguous line-rects (like PDF
   * Reader Pro's highlight tool) */
  const collectLineRects = (span: HTMLElement): DomRectLike[] => {
    const sRect = span.getBoundingClientRect();
    const bandTop = sRect.top + sRect.height * 0.1;
    const bandBottom = sRect.bottom - sRect.height * 0.1;
    const candidates: DomRectLike[] = [];
    for (const d of textDivs.current) {
      if (!d.firstChild) continue;
      const r = d.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.top < bandBottom && r.bottom > bandTop) {
        candidates.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
    }
    candidates.sort((a, b) => a.left - b.left);
    // merge horizontally-adjacent runs into single rects
    const merged: DomRectLike[] = [];
    for (const r of candidates) {
      const last = merged[merged.length - 1];
      if (last && r.left - last.right < Math.max(6, (r.bottom - r.top) * 1.2)) {
        last.right = Math.max(last.right, r.right);
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else {
        merged.push({ ...r });
      }
    }
    return merged;
  };

  const commitHighlight = (edit: HighlightEdit) => {
    window.getSelection()?.removeAllRanges();
    onCommitEdit(edit);
  };

  const commitRects = (rects: HighlightEdit["rects"]) => {
    window.getSelection()?.removeAllRanges();
    onCommitEdit({
      id: nextEditId(),
      page: pageNumber,
      kind: "highlight",
      color: hexToRgb01(highlightColor),
      rects
    });
  };

  /**
   * Column-safe line computation from text-item geometry (PDF points).
   * Items on the clicked row (same baseline band) are clustered by x-gaps;
   * the cluster containing the clicked item becomes ONE highlight rect, so a
   * two-column layout never merges across the gutter.
   */
  const collectClusterFromItems = (clickedIdx: number): HighlightEdit["rects"] | null => {
    const items = itemsRef.current;
    if (!items || !items[clickedIdx]) return null;
    const clicked = geometryFromItem(items[clickedIdx]);
    const bandTol = Math.max(4, clicked.fontSizePt * 0.6);

    interface RowItem {
      idx: number;
      x0: number;
      x1: number;
      y0: number;
      y1: number;
    }
    const row: RowItem[] = [];
    items.forEach((it, idx) => {
      if (typeof it.str !== "string" || !it.str.length) return;
      const geo = geometryFromItem(it);
      if (Math.abs(geo.baseline.y - clicked.baseline.y) > bandTol) return;
      const w = it.width || it.str.length * geo.fontSizePt * 0.5;
      row.push({
        idx,
        x0: geo.baseline.x - geo.fontSizePt * 0.08,
        x1: geo.baseline.x + w + geo.fontSizePt * 0.08,
        y0: Math.max(0, geo.bbox.y0),
        y1: geo.bbox.y1
      });
    });
    if (!row.length) return null;

    row.sort((a, b) => a.x0 - b.x0);
    const gapThreshold = Math.max(clicked.fontSizePt * 3, 24);
    const clusters: RowItem[][] = [];
    for (const cand of row) {
      const last = clusters[clusters.length - 1];
      if (!last) {
        clusters.push([cand]);
        continue;
      }
      const prev = last[last.length - 1];
      if (cand.x0 - prev.x1 <= gapThreshold) last.push(cand);
      else clusters.push([cand]);
    }

    const cluster =
      clusters.find((c) => c.some((r) => r.idx === clickedIdx)) ??
      clusters.find((c) => {
        const x0 = Math.min(...c.map((r) => r.x0));
        const x1 = Math.max(...c.map((r) => r.x1));
        return clicked.baseline.x >= x0 && clicked.baseline.x <= x1;
      });
    if (!cluster) return null;

    return [
      {
        x0: Math.min(...cluster.map((r) => r.x0)),
        y0: Math.min(...cluster.map((r) => r.y0)),
        x1: Math.max(...cluster.map((r) => r.x1)),
        y1: Math.max(...cluster.map((r) => r.y1))
      }
    ];
  };

  /* --------- pen tool: freehand stroke → PenEdit --------- */
  const penActive = useRef(false);
  const penPointsCss = useRef<{ left: number; top: number }[]>([]);
  const [penPreview, setPenPreview] = useState<{ left: number; top: number }[] | null>(null);

  const handlePenDown = (e: React.MouseEvent) => {
    if (!editMode || editTool !== "pen") return;
    e.preventDefault();
    const base = containerRef.current?.getBoundingClientRect();
    if (!base) return;
    penActive.current = true;
    penPointsCss.current = [
      { left: e.clientX - base.left, top: e.clientY - base.top }
    ];
    setPenPreview([...penPointsCss.current]);
  };
  const handlePenMove = (e: React.MouseEvent) => {
    if (!penActive.current) return;
    const base = containerRef.current?.getBoundingClientRect();
    if (!base) return;
    const pt = { left: e.clientX - base.left, top: e.clientY - base.top };
    penPointsCss.current.push(pt);
    setPenPreview([...penPointsCss.current]);
  };
  const handlePenUp = () => {
    if (!penActive.current) return;
    penActive.current = false;
    const pts = penPointsCss.current;
    penPointsCss.current = [];
    setPenPreview(null);
    const viewport = viewportRef.current;
    if (!viewport || pts.length === 0) return;
    // single click → a dot: duplicate the point so one segment still draws
    const src = pts.length === 1 ? [pts[0], { ...pts[0], left: pts[0].left + 0.01 }] : pts;
    const pdfPts = src.map((p) => {
      const v = viewport.convertToPdfPoint(p.left, p.top);
      return { x: v[0], y: v[1] };
    });
    onCommitEdit({
      id: nextEditId(),
      page: pageNumber,
      kind: "pen",
      color: hexToRgb01(penColor),
      width: penWidth,
      points: pdfPts
    });
  };

  /* --------- redact tool: drag a rect → opaque knockout --------- */
  const redactStart = useRef<{ x: number; y: number } | null>(null);
  const [redactPreview, setRedactPreview] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const handleRedactDown = (e: React.MouseEvent) => {
    if (!editMode || editTool !== "redact") return;
    e.preventDefault();
    const base = containerRef.current?.getBoundingClientRect();
    if (!base) return;
    redactStart.current = { x: e.clientX - base.left, y: e.clientY - base.top };
    setRedactPreview(null);
  };
  const handleRedactMove = (e: React.MouseEvent) => {
    if (!redactStart.current) return;
    const base = containerRef.current?.getBoundingClientRect();
    if (!base) return;
    const left = Math.min(redactStart.current.x, e.clientX - base.left);
    const top = Math.min(redactStart.current.y, e.clientY - base.top);
    const width = Math.abs(e.clientX - base.left - redactStart.current.x);
    const height = Math.abs(e.clientY - base.top - redactStart.current.y);
    setRedactPreview({ left, top, width, height });
  };
  const handleRedactUp = () => {
    const start = redactStart.current;
    const prev = redactPreview;
    redactStart.current = null;
    setRedactPreview(null);
    if (!start || !prev) return;
    const viewport = viewportRef.current;
    if (!viewport || prev.width < 4 || prev.height < 4) return;
    const p0 = viewport.convertToPdfPoint(prev.left, prev.top + prev.height);
    const p1 = viewport.convertToPdfPoint(prev.left + prev.width, prev.top);
    onCommitEdit({
      id: nextEditId(),
      page: pageNumber,
      kind: "redact",
      rects: [
        {
          x0: Math.min(p0[0], p1[0]),
          y0: Math.min(p0[1], p1[1]),
          x1: Math.max(p0[0], p1[0]),
          y1: Math.max(p0[1], p1[1])
        }
      ]
    });
  };

  const handleHighlightSelection = (e: React.MouseEvent) => {
    if (!editMode || editTool !== "highlight" || editingRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();
    const sel = window.getSelection();

    // plain click (collapsed selection) → highlight the whole line like the
    // commercial PDF suite's highlighter. Preferred path: cluster text items
    // by x-extents in PDF space, so multi-column layouts never merge across
    // the column gutter. DOM band grouping stays as fallback.
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      const target = e.target as HTMLElement;
      const span = target.closest?.(".textLayer span") as HTMLElement | null;
      if (!span) return;
      const idx = parseInt(span.dataset.itemIndex ?? "-1", 10);
      const itemRects = idx >= 0 ? collectClusterFromItems(idx) : null;
      const rects = itemRects ?? rectsToEdit(collectLineRects(span), base)?.rects ?? null;
      if (!rects?.length) return;
      commitRects(rects);
      e.preventDefault();
      return;
    }

    if (!container.contains(sel.anchorNode)) return;
    const list = sel.getRangeAt(0).getClientRects();
    const domRects: DomRectLike[] = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      domRects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    const edit = rectsToEdit(domRects, base);
    if (!edit) {
      window.getSelection()?.removeAllRanges();
      return;
    }
    commitHighlight(edit);
    e.preventDefault();
  };

  /* --------- draw committed edit overlays --------- */
  useEffect(() => {
    const layer = editLayerRef.current;
    const viewport = viewportRef.current;
    if (!layer || !viewport) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    const scaleCss = scale;
    // highlight boxes first (they sit under everything else)
    for (const edit of pageEdits) {
      if (edit.kind !== "highlight") continue;
      const rgbCss = edit.color.map((c) => Math.round(c * 255)).join(",");
      const alpha = edit.opacity ?? 0.45;
      for (const r of edit.rects) {
        const p0 = viewport.convertToViewportPoint(r.x0, r.y1);
        const p1 = viewport.convertToViewportPoint(r.x1, r.y0);
        const div = document.createElement("div");
        Object.assign(div.style, {
          position: "absolute",
          left: `${Math.min(p0[0], p1[0])}px`,
          top: `${Math.min(p0[1], p1[1])}px`,
          width: `${Math.max(2, Math.abs(p1[0] - p0[0]))}px`,
          height: `${Math.max(2, Math.abs(p1[1] - p0[1]))}px`,
          background: `rgba(${rgbCss},${alpha})`,
          pointerEvents: "none"
        });
        layer.appendChild(div);
      }
    }

    for (const edit of pageEdits) {
      if (edit.kind !== "pen") continue;
      // committed strokes: SVG polyline over the page, same width/color as save
      const ptsAttr = edit.points
        .map((p) => {
          const v = viewport.convertToViewportPoint(p.x, p.y);
          return `${v[0]},${v[1]}`;
        })
        .join(" ");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      Object.assign(svg.style, {
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible"
      });
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      poly.setAttribute("points", ptsAttr);
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", `rgb(${edit.color.map((c) => Math.round(c * 255)).join(",")})`);
      poly.setAttribute("stroke-width", String(edit.width * scale));
      poly.setAttribute("stroke-linecap", "round");
      poly.setAttribute("stroke-linejoin", "round");
      svg.appendChild(poly);
      layer.appendChild(svg);
    }

    for (const edit of pageEdits) {
      if (edit.kind !== "redact") continue;
      // committed redaction: solid black box (exactly how it will save)
      for (const r of edit.rects) {
        const p0 = viewport.convertToViewportPoint(r.x0, r.y1);
        const p1 = viewport.convertToViewportPoint(r.x1, r.y0);
        const div = document.createElement("div");
        Object.assign(div.style, {
          position: "absolute",
          left: `${Math.min(p0[0], p1[0])}px`,
          top: `${Math.min(p0[1], p1[1])}px`,
          width: `${Math.max(2, Math.abs(p1[0] - p0[0]))}px`,
          height: `${Math.max(2, Math.abs(p1[1] - p0[1]))}px`,
          background: "#000",
          pointerEvents: "none"
        });
        layer.appendChild(div);
      }
    }

    for (const edit of pageEdits) {
      if (edit.kind !== "replace") continue;
      // cover rect over the original run
      const p0 = viewport.convertToViewportPoint(edit.bbox.x0, edit.bbox.y1);
      const p1 = viewport.convertToViewportPoint(edit.bbox.x1, edit.bbox.y0);
      const left = Math.min(p0[0], p1[0]);
      const top = Math.min(p0[1], p1[1]);
      const width = Math.abs(p1[0] - p0[0]);
      const height = Math.abs(p1[1] - p0[1]);
      const cover = document.createElement("div");
      cover.dataset.cover = "1";
      Object.assign(cover.style, {
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(2, width)}px`,
        height: `${Math.max(2, height)}px`,
        background: "#fff"
      });
      layer.appendChild(cover);

      if (edit.text.trim().length) {
        // replacement text drawn from the same baseline
        const bp = viewport.convertToViewportPoint(edit.baseline.x, edit.baseline.y);
        const lines = edit.text.split("\n");
        const fontCss = edit.fontSizePt * scaleCss;
        const textDiv = document.createElement("div");
        Object.assign(textDiv.style, {
          position: "absolute",
          left: `${bp[0]}px`,
          top: `${bp[1] - fontCss * 0.78}px`,
          font: fontCssForEdit({
            fontFamily: edit.fontFamily,
            bold: edit.bold,
            italic: edit.italic,
            fontSizePx: fontCss,
            lineGap: 1.25
          }),
          textDecoration: textDecoration(Boolean(edit.underline), Boolean(edit.strike)),
          color: `rgb(${edit.color.map((c) => Math.round(c * 255)).join(",")})`,
          whiteSpace: "pre",
          pointerEvents: "none",
          transformOrigin: "0 0"
        });
        textDiv.textContent = lines.join("\n");
        layer.appendChild(textDiv);
      } else {
        // deletion marker (faint outline) so users can undo precisely
        const marker = document.createElement("div");
        marker.textContent = " ";
        Object.assign(marker.style, {
          position: "absolute",
          left: `${left}px`,
          top: `${top}px`,
          width: `${Math.max(2, width)}px`,
          height: `${Math.max(2, height)}px`,
          boxShadow: "inset 0 0 0 1px rgba(59,130,246,0.25)",
          pointerEvents: "none"
        });
        layer.appendChild(marker);
      }
    }
  }, [pageEdits, viewportVersion, scale, rotation, editing]);

  // absolute-positioned add-edit overlays
  useEffect(() => {
    const layer = editLayerRef.current;
    const viewport = viewportRef.current;
    if (!layer || !viewport) return;
    const fontCssBase = (pt: number) => pt * scale;
    for (const edit of pageEdits) {
      if (edit.kind !== "add") continue;
      const bp = viewport.convertToViewportPoint(edit.point.x, edit.point.y);
      const div = document.createElement("div");
      const fontCss = fontCssBase(edit.fontSizePt);
      Object.assign(div.style, {
        position: "absolute",
        left: `${bp[0]}px`,
        top: `${bp[1] - fontCss * 0.78}px`,
        font: fontCssForEdit({
          fontFamily: edit.fontFamily,
          bold: edit.bold,
          italic: edit.italic,
          fontSizePx: fontCss,
          lineGap: 1.25
        }),
        textDecoration: textDecoration(Boolean(edit.underline), Boolean(edit.strike)),
        color: `rgb(${edit.color.map((c) => Math.round(c * 255)).join(",")})`,
        whiteSpace: "pre",
        pointerEvents: "none",
        outline: "1px dashed rgba(59,130,246,0.35)",
        outlineOffset: "2px",
        padding: "0 1px"
      });
      div.textContent = edit.text;
      layer.appendChild(div);
    }
  }, [pageEdits, viewportVersion, scale, rotation]);

  /* --------- search highlights --------- */
  useEffect(() => {
    const hl = highlightRef.current;
    if (!hl) return;
    while (hl.firstChild) hl.removeChild(hl.firstChild);
    if (!matchesRanges.length || !textReady) return;

    const base = hl.getBoundingClientRect();
    for (const m of matchesRanges) {
      for (const r of m.ranges) {
        const div = textDivs.current[r.item];
        if (!div || !div.firstChild) continue;
        const range = document.createRange();
        try {
          range.setStart(div.firstChild, Math.min(r.from, (div.firstChild as Text).data?.length ?? r.from));
          range.setEnd(div.firstChild, Math.min(r.to, (div.firstChild as Text).data?.length ?? r.to));
        } catch {
          continue;
        }
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          const rect = rects[i];
          if (rect.width < 0.5 && rect.height < 0.5) continue;
          const el = document.createElement("div");
          el.className = "hl" + (m.matchIndex === activeMatchIndex ? " hl-active" : "");
          el.style.left = `${rect.left - base.left}px`;
          el.style.top = `${rect.top - base.top}px`;
          el.style.width = `${rect.width}px`;
          el.style.height = `${rect.height}px`;
          hl.appendChild(el);
        }
      }
    }
  }, [matchesRanges, activeMatchIndex, textReady, scale, rotation]);

  return (
    <div
      ref={containerRef}
      data-page={pageNumber}
      className={`relative page-shadow bg-white ${editMode ? "edit-mode" : ""}`}
      style={{
        width: Math.ceil(w),
        height: Math.ceil(h),
        // pdf.js TextLayer styles use calc(var(--scale-factor) * Npx) —
        // this must be set or edit boxes and highlights mis-size.
        ...({ "--scale-factor": scale } as unknown as React.CSSProperties)
      }}
      onClick={handlePageClick}
      onMouseUp={handleHighlightSelection}
      onMouseDown={editMode && editTool === "redact" ? handleRedactDown : editMode && editTool === "pen" ? handlePenDown : undefined}
      onMouseMove={editMode && editTool === "redact" ? handleRedactMove : editMode && editTool === "pen" ? handlePenMove : undefined}
      onMouseLeave={editMode && editTool === "redact" ? handleRedactUp : editMode && editTool === "pen" ? handlePenUp : undefined}
      data-tool={editMode ? editTool : undefined}
    >
      <canvas ref={canvasRef} className="page-canvas block absolute inset-0" />
      {/* white-out + inserted text overlays (under the text layer) */}
      <div ref={editLayerRef} className="absolute inset-0 overflow-hidden" style={{ zIndex: 1 }} />
      {/* search highlight (under text layer, above covers) */}
      <div className="highlightLayer" ref={highlightRef} style={{ zIndex: 2 }} />
      <div className="textLayer" ref={textLayerRef} style={{ zIndex: 3 }} />

      {/* pen preview while drawing */}
      {penPreview && penPreview.length > 0 && (
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 4,
            overflow: "visible"
          }}
        >
          <polyline
            points={penPreview.map((p) => `${p.left},${p.top}`).join(" ")}
            fill="none"
            stroke={penColor}
            strokeWidth={penWidth * scale}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* redact preview while dragging */}
      {redactPreview && (
        <div
          style={{
            position: "absolute",
            left: redactPreview.left,
            top: redactPreview.top,
            width: redactPreview.width,
            height: redactPreview.height,
            background: "rgba(0,0,0,0.75)",
            outline: "1px solid rgba(0,0,0,0.9)",
            zIndex: 4,
            pointerEvents: "none"
          }}
        />
      )}

      {/* live editing box */}
      {editing && (
        <div
          ref={editBoxRef}
          data-edit-box="1"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          className="absolute outline-none rounded-sm"
          style={{
            left: editing.mode === "existing" ? editing.baseLeft : editing.left,
            top: editing.mode === "existing" ? editing.baseTop : editing.top,
            minWidth: editing.mode === "existing" ? Math.max(24, editing.widthCss) : 40,
            minHeight: `${(editing.mode === "existing" ? editing.fontSizeCss : textSizePt * scale) + 4}px`,
            background: "#fff",
            border: "1px solid rgba(59,130,246,0.9)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            color: textColor,
            font: fontCssForEdit({
              fontFamily,
              bold: fontBold,
              italic: fontItalic,
              fontSizePx: editing.mode === "existing" ? editing.fontSizeCss : textSizePt * scale,
              lineGap: 1.25
            }),
            textDecoration: textDecoration(fontUnderline, fontStrike),
            whiteSpace: "pre-wrap",
            padding: "1px 2px",
            zIndex: 5,
            cursor: "text"
          }}
          onBlur={commitEditing}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(null);
            } else if (e.key === "Enter" && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
              /* allow newline via Shift only in new boxes; fall through otherwise */
            }
            e.stopPropagation();
          }}
        >
          {editing.mode === "existing" ? editing.initial : "\u200b"}
        </div>
      )}

      {/* focus the freshly mounted editor */}
      {editing && <AutoFocusEditor onReady={() => editBoxRef.current?.focus()} />}
    </div>
  );
}

function AutoFocusEditor({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    const t = setTimeout(onReady, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
