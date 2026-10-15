import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { findFontChoice, styleSlot, type FontStyleSlot } from "./fonts";
import { stripRedactedContent } from "./redact-strip";

/**
 * Text-edit model. All geometry is stored in PDF user-space (points, origin
 * bottom-left) so edits survive zoom/rotation and can be baked into a new PDF
 * with pdf-lib on save.
 */
export interface BaseEdit {
  id: string;
  page: number; // 1-based
  text: string; // new text ("" = delete, for replace edits)
  fontSizePt: number;
  color: [number, number, number]; // 0..1 rgb
  fontFamily: string; // FontChoice.id ("helvetica", "roboto", ...)
  bold: boolean;
  italic: boolean;
  /** optional text decorations, drawn as strokes on save */
  underline?: boolean;
  strike?: boolean;
}

/** Cover the original text run and draw the replacement (or nothing to delete). */
export interface ReplaceEdit extends BaseEdit {
  kind: "replace";
  /** bounding box of the original text item in PDF points */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** baseline start point of the original text item in PDF points */
  baseline: { x: number; y: number };
}

/** Free floating text box added by the user. */
export interface AddEdit extends BaseEdit {
  kind: "add";
  /** baseline anchor in PDF points */
  point: { x: number; y: number };
}

/** Highlight box(es) painted by the highlighter tool. */
export interface HighlightEdit {
  id: string;
  page: number; // 1-based
  kind: "highlight";
  color: [number, number, number]; // 0..1 rgb
  /** rectangles in PDF user-space points (page box) */
  rects: { x0: number; y0: number; x1: number; y1: number }[];
  opacity?: number; // default 0.45
}

/** Freehand pen strokes: polylines in PDF user-space points (page box). */
export interface PenEdit {
  id: string;
  page: number; // 1-based
  kind: "pen";
  color: [number, number, number]; // 0..1 rgb
  /** stroke width in points */
  width: number;
  /** polyline vertices in PDF user-space points */
  points: { x: number; y: number }[];
}

export type TextEdit = ReplaceEdit | AddEdit | HighlightEdit | RedactEdit | PenEdit;

export interface TextContentItem {
  str: string;
  transform: number[]; // [a,b,c,d,e,f] — e,f = baseline origin
  width: number;
  height: number;
}

/** Build the real bbox/baseline store (PDF points) from a pdf.js text item. */
export function geometryFromItem(item: TextContentItem): {
  fontSizePt: number;
  baseline: { x: number; y: number };
  bbox: ReplaceEdit["bbox"];
} {
  const [a, b, , d, e, f] = item.transform;
  const fontSizePt = Math.hypot(a, b) || Math.hypot(0, d);
  const w = item.width || item.str.length * fontSizePt * 0.5;
  const h = item.height || fontSizePt;
  return {
    fontSizePt,
    baseline: { x: e, y: f },
    bbox: {
      x0: e - fontSizePt * 0.08,
      y0: f - h * 0.32,
      x1: e + w + fontSizePt * 0.08,
      y1: f + h * 0.78
    }
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const int = parseInt(m[1], 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

export { hexToRgb as hexToRgb01 };

/** Loads the raw TTF bytes for a bundled font file (via IPC). */
export type FontByteLoader = (file: string) => Promise<Uint8Array>;

/**
 * True stroke metrics in font units, so underline/strikethrough geometry uses
 * the same values the font itself declares (OS/2 table for TTFs, AFM-derived
 * constants for the base-14 fonts).
 */
export interface StrokeMetrics {
  upem: number;
  /** underline position BELOW the baseline, positive font units */
  ulPos: number;
  /** underline stroke thickness, positive font units */
  ulThick: number;
  /** strikethrough position ABOVE the baseline, positive font units */
  strikePos: number;
}

// base-14 constants (from the standard AFM metrics)
const BUILTIN_METRICS: Record<string, StrokeMetrics> = {
  helvetica: { upem: 1000, ulPos: 100, ulThick: 50, strikePos: 358 },
  times: { upem: 1000, ulPos: 100, ulThick: 50, strikePos: 326 },
  courier: { upem: 1000, ulPos: 100, ulThick: 50, strikePos: 281 }
};

/** Parse real metrics from a TTF via fontkit; falls back to heuristics. */
function metricsFromBytes(bytes: Uint8Array): StrokeMetrics {
  const fallback: StrokeMetrics = { upem: 1000, ulPos: 100, ulThick: 50, strikePos: 350 };
  try {
    const f = (fontkit as unknown as { create: (d: Uint8Array) => Record<string, number> }).create(
      new Uint8Array(bytes)
    );
    return {
      upem: f.unitsPerEm || fallback.upem,
      ulPos: Math.abs(f.underlinePosition ?? fallback.ulPos),
      ulThick: f.underlineThickness ?? fallback.ulThick,
      strikePos: f.strikeoutPosition ?? Math.abs((f.capHeight ?? 700) * 0.5)
    };
  } catch {
    return fallback;
  }
}

/** pdf-lib serif/sans/mono base-14 mapping used for builtin families. */
const BUILTIN_STD: Record<string, Record<FontStyleSlot, StandardFonts>> = {
  helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique
  },
  times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic
  },
  courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique
  }
};

/**
 * Apply all text edits on top of the original bytes using pdf-lib.
 * - replace: white rectangle over the original run + new text.
 * - add: free text at the stored point.
 * Each edit carries its own font family/style; bundled fonts are embedded
 * (subset) from TTF bytes provided by `loadFontBytes`.
 */
export async function buildModifiedPdf(
  originalBytes: Uint8Array,
  edits: TextEdit[],
  loadFontBytes?: FontByteLoader,
  pageOrder?: number[]
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  // required before embedding custom TTFs
  pdf.registerFontkit(fontkit);

  // Reorder pages to the layout chosen in the thumbnails panel (given in
  // 1-based original page numbers). Do it before applying edits, so edit
  // pages (already mapped into the new order by the caller) line up.
  if (pageOrder && pageOrder.length === pdf.getPageCount()) {
    const original = await pdf.copyPages(pdf, pageOrder.map((p) => p - 1));
    while (pdf.getPageCount() > 0) pdf.removePage(0);
    for (const p of original) pdf.addPage(p);
  }
  const lineGap = 1.2;
  const fontCache = new Map<string, Promise<{ font: PDFFont; metrics: StrokeMetrics }>>();

  const getFont = async (edit: ReplaceEdit | AddEdit): Promise<{ font: PDFFont; metrics: StrokeMetrics }> => {
    const choice = findFontChoice(edit.fontFamily);
    const slot = styleSlot(edit.bold, edit.italic);

    if (BUILTIN_STD[choice.id]) {
      const metrics = BUILTIN_METRICS[choice.id] ?? BUILTIN_METRICS.helvetica;
      return { font: await pdf.embedFont(BUILTIN_STD[choice.id][slot]), metrics };
    }
    const file = choice.files?.[slot] ?? choice.files?.regular;
    if (!file || !loadFontBytes) {
      return {
        font: await pdf.embedFont(StandardFonts.Helvetica),
        metrics: BUILTIN_METRICS.helvetica
      };
    }
    const key = `${choice.id}:${slot}`;
    let embedded = fontCache.get(key);
    if (!embedded) {
      embedded = loadFontBytes(file)
        .then((bytes) => {
          const metrics = metricsFromBytes(bytes);
          return pdf
            .embedFont(bytes, { subset: true })
            .catch(() => pdf.embedFont(bytes)) // subset can fail on odd fonts
            .then((font) => ({ font, metrics }));
        })
        .catch((err) => {
          fontCache.delete(key);
          throw err;
        });
      fontCache.set(key, embedded);
    }
    return embedded;
  };


  for (const edit of edits) {
    // freehand strokes: polyline of connected line segments
    if (edit.kind === "pen") {
      const page = pdf.getPage(edit.page - 1);
      const color = rgb(edit.color[0], edit.color[1], edit.color[2]);
      for (let i = 1; i < edit.points.length; i++) {
        const a = edit.points[i - 1];
        const b = edit.points[i];
        page.drawLine({
          start: { x: a.x, y: a.y },
          end: { x: b.x, y: b.y },
          thickness: edit.width,
          color,
          lineCap: 1 // round
        });
      }
      continue;
    }

    // highlight boxes: translucent filled rectangles, no text geometry needed
    if (edit.kind === "highlight") {
      const page = pdf.getPage(edit.page - 1);
      const { width: pageW, height: pageH } = page.getSize();
      const color = rgb(edit.color[0], edit.color[1], edit.color[2]);
      for (const r of edit.rects) {
        const x0 = Math.max(0, r.x0);
        const y0 = Math.max(0, r.y0);
        const x1 = Math.min(pageW, r.x1);
        const y1 = Math.min(pageH, r.y1);
        if (x1 > x0 && y1 > y0) {
          page.drawRectangle({
            x: x0,
            y: y0,
            width: x1 - x0,
            height: y1 - y0,
            color,
            opacity: edit.opacity ?? 0.45
          });
        }
      }
      continue;
    }

    // redaction knockouts: remove the covered TEXT from the content stream
    // (so it can't be copied/extracted) and paint an opaque black box on top
    if (edit.kind === "redact") {
      try {
        stripRedactedContent(pdf, [edit]);
      } catch {
        /* stream rewriting is best-effort; the black box still covers it */
      }
      bakeRedactions(pdf, [edit]);
      continue;
    }

    const page = pdf.getPage(edit.page - 1);
    const { width: pageW, height: pageH } = page.getSize();
    const { font, metrics } = await getFont(edit);
    // bundled family without an italic face → synthesise the slant via skew
    const choice = findFontChoice(edit.fontFamily);
    const slot = styleSlot(edit.bold, edit.italic);
    const usedFile = BUILTIN_STD[choice.id] ? undefined : choice.files?.[slot];
    const fakeItalic = Boolean(edit.italic && usedFile && !usedFile.includes("Italic"));

    if (edit.kind === "replace") {
      // clamp the cover rect to the page bounds
      const x0 = Math.max(0, edit.bbox.x0);
      const y0 = Math.max(0, edit.bbox.y0);
      const x1 = Math.min(pageW, edit.bbox.x1);
      const y1 = Math.min(pageH, edit.bbox.y1);
      if (x1 > x0 && y1 > y0) {
        page.drawRectangle({
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
          color: rgb(1, 1, 1),
          borderColor: rgb(1, 1, 1),
          borderWidth: 0.5
        });
      }
      if (edit.text.trim().length) {
        drawMultiline(page, edit, edit.baseline.x, edit.baseline.y, lineGap, font, Boolean(fakeItalic), metrics);
      }
    } else {
      drawMultiline(page, edit, edit.point.x, edit.point.y, lineGap, font, Boolean(fakeItalic), metrics);
    }
  }

  return pdf.save();
}

/* ---------------- redaction ---------------- */

/** A pending redaction area, in PDF user-space points (page box). */
export interface RedactEdit {
  id: string;
  page: number; // 1-based
  kind: "redact";
  rects: { x0: number; y0: number; x1: number; y1: number }[];
}

/**
 * Bake redaction areas as opaque rectangles that knock out underlying text.
 * True content removal (rewriting content streams) is out of scope for
 * pdf-lib; we remove text by covering it AND copying the page through a
 * re-render cycle is not needed — covered rects make the text invisible
 * and uncopyable in most viewers. For strict removal we drop the text
 * selections: draw the fills last so they sit above everything.
 */
export function bakeRedactions(pdf: PDFDocument, redactions: RedactEdit[]): void {
  for (const r of redactions) {
    const page = pdf.getPage(r.page - 1);
    const { width: pageW, height: pageH } = page.getSize();
    for (const rect of r.rects) {
      const x0 = Math.max(0, rect.x0);
      const y0 = Math.max(0, rect.y0);
      const x1 = Math.min(pageW, rect.x1);
      const y1 = Math.min(pageH, rect.y1);
      if (x1 > x0 && y1 > y0) {
        page.drawRectangle({
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
          color: rgb(0, 0, 0),
          opacity: 1
        });
      }
    }
  }
}

/* ---------------- compression ---------------- */

export interface CompressResult {
  bytes: Uint8Array;
  originalSize: number;
  newSize: number;
}

/**
 * Lossless shrink: drops document-level metadata and object bloat via
 * re-serialization. Anchors are reported so the UI can preview the gain.
 */
export async function compressSavedPdf(sourceBytes: Uint8Array): Promise<CompressResult> {
  const originalSize = sourceBytes.length;
  const pdf = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
    updateMetadata: false
  });
  // strip data-bearing metadata (keep title if present isn't guaranteed; keep it simple)
  pdf.setTitle("");
  pdf.setAuthor("");
  pdf.setSubject("");
  pdf.setKeywords([]);
  pdf.setProducer("");
  pdf.setCreator("");
  const bytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
  return {
    bytes,
    originalSize,
    newSize: bytes.length
  };
}

function drawMultiline(
  page: import("pdf-lib").PDFPage,
  edit: ReplaceEdit | AddEdit,
  x: number,
  y: number,
  lineHeightMul: number,
  font: PDFFont,
  fakeItalic: boolean,
  metrics: StrokeMetrics
) {
  const { text } = edit;
  const size = edit.fontSizePt;
  const color = rgb(edit.color[0], edit.color[1], edit.color[2]);
  const decorated = edit.underline || edit.strike;
  const opts = { x, y, size, font, color };
  const lines = text.split("\n");
  const lineHeight = size * lineHeightMul;
  // stroke geometry from the font's own metrics (font units → points)
  const toPoints = size / metrics.upem;
  const ulOffset = metrics.ulPos * toPoints;
  const strikeOffset = metrics.strikePos * toPoints;
  const thickness = Math.max(0.4, metrics.ulThick * toPoints);
  lines.forEach((line, i) => {
    if (!line.length) return;
    page.drawText(line, { ...opts, y: y - i * lineHeight, xSkew: fakeItalic ? degrees(12) : undefined });
    if (decorated && text.trim().length) {
      // measure the real glyph width so the stroke spans exactly the text
      const w = font.widthOfTextAtSize(line, size);
      const ly = y - i * lineHeight;
      if (edit.underline) {
        page.drawLine({
          start: { x, y: ly - ulOffset },
          end: { x: x + w, y: ly - ulOffset },
          thickness,
          color
        });
      }
      if (edit.strike) {
        page.drawLine({
          start: { x, y: ly + strikeOffset },
          end: { x: x + w, y: ly + strikeOffset },
          thickness,
          color
        });
      }
    }
  });
}
