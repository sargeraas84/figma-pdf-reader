// PDF → Word (.docx) conversion, fully in the renderer.
// Strategy: extract each page's text runs via pdf.js (already used app-wide),
// reconstruct lines from baseline geometry, merge small-gap lines into
// paragraphs, then emit them into a real .docx with the `docx` package.
// Fidelity note: this is a text-faithful conversion (like Word's own
// "best available" mode) — not a pixel-perfect layout clone.

import type { PdfDocument } from "./pdfjs";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  convertMillimetersToTwip
} from "docx";

interface Line {
  text: string;
  y: number; // baseline, PDF coords (y grows upward)
  x0: number;
  x1: number;
  height: number; // average glyph height ≈ font size
}

interface Para {
  lines: Line[];
  avgHeight: number;
  heading: boolean;
}

interface RawItem {
  str?: string;
  transform?: number[];
  height?: number;
}

/** Group pdf.js text items on one page into lines by baseline proximity. */
function itemsToLines(items: RawItem[]): Line[] {
  interface Item {
    str: string;
    x: number;
    y: number;
    h: number;
  }
  const parsed: Item[] = [];
  for (const it of items) {
    if (!it || typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
    if (!it.str.trim()) continue;
    const tr = it.transform;
    parsed.push({ str: it.str, x: tr[4], y: tr[5], h: it.height ?? (Math.abs(tr[3]) || 10) });
  }
  // top→bottom, then left→right within a baseline band
  parsed.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
  const lines: Line[] = [];
  let cur: Item[] = [];
  let curY: number | null = null;
  const flush = () => {
    if (!cur.length) return;
    const x0 = Math.min(...cur.map((c) => c.x));
    // x1 estimate: glyph advance ≈ 0.5 em per char (good enough for indent math)
    const x1 = Math.max(...cur.map((c) => c.x + c.str.length * c.h * 0.5));
    lines.push({
      text: cur.map((c) => c.str).join("").replace(/\s+/g, " ").trim(),
      y: cur.reduce((s, c) => s + c.y, 0) / cur.length,
      x0,
      x1,
      height: cur.reduce((s, c) => s + c.h, 0) / cur.length
    });
    cur = [];
  };
  for (const it of parsed) {
    if (curY === null || Math.abs(it.y - curY) <= Math.max(2.5, it.h * 0.35)) {
      cur.push(it);
      curY = it.y;
    } else {
      flush();
      cur = [it];
      curY = it.y;
    }
  }
  flush();
  return lines.filter((l) => l.text);
}

/** Merge lines into paragraphs: small vertical gap + same indent = same para. */
function linesToParas(lines: Line[], pageWidth: number): Para[] {
  const paras: Para[] = [];
  let cur: Line[] = [];
  const flush = () => {
    if (!cur.length) return;
    const x0 = Math.min(...cur.map((l) => l.x0));
    const x1 = Math.max(...cur.map((l) => l.x1));
    const avgHeight = cur.reduce((s, l) => s + l.height, 0) / cur.length;
    const maxHeight = Math.max(...cur.map((l) => l.height));
    const first = cur[0];
    // short, large-ish, first text on the page near the center → title
    const centeredish = Math.abs((first.x0 + x1) / 2 - pageWidth / 2) < pageWidth * 0.18;
    paras.push({
      lines: cur,
      avgHeight,
      heading: cur.length === 1 && maxHeight >= 16 && centeredish && cur[0].y > pageWidth // y > width ≈ upper half for portrait pages
    });
    cur = [];
  };
  for (const line of lines) {
    if (!cur.length) {
      cur = [line];
      continue;
    }
    const prev = cur[cur.length - 1];
    const vGap = prev.y - line.y; // positive = below previous line
    const sameIndent = Math.abs(line.x0 - prev.x0) < Math.max(14, line.height * 1.5);
    if (vGap > line.height * 1.6 || !sameIndent) {
      flush();
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  flush();
  return paras;
}

export interface PdfToWordResult {
  blob: Blob;
  pageCount: number;
  paragraphs: number;
}

/** Extract text from every page and build a .docx Blob. */
export async function pdfToWord(
  pdf: PdfDocument,
  onProgress?: (done: number, total: number) => void
): Promise<PdfToWordResult> {
  const docx = await import("docx");
  const bodyChildren: Paragraph[] = [];
  let paragraphs = 0;

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const lines = itemsToLines(content.items as RawItem[]);
    const paras = linesToParas(lines, viewport.width);

    if (n > 1 && paras.length) {
      bodyChildren.push(new docx.Paragraph({ children: [], pageBreakBefore: true }));
    }
    for (const p of paras) {
      const text = p.lines.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      paragraphs++;
      if (p.heading) {
        bodyChildren.push(new docx.Paragraph({ text, heading: HeadingLevel.HEADING_1 }));
      } else {
        // glyph height ≈ font size; clamp to a sane 9–22pt range
        const sizePt = Math.min(22, Math.max(9, Math.round(p.avgHeight * 1.15)));
        bodyChildren.push(
          new docx.Paragraph({
            children: [new docx.TextRun({ text, size: sizePt * 2 })], // size = half-points
            spacing: { after: 120 }
          })
        );
      }
    }
    page.cleanup();
    onProgress?.(n, pdf.numPages);
  }

  // A4 page geometry, 1" margins
  const document = new docx.Document({
    creator: "Figma PDF Reader",
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(210),
              height: convertMillimetersToTwip(297)
            },
            margin: {
              top: convertMillimetersToTwip(25.4),
              bottom: convertMillimetersToTwip(25.4),
              left: convertMillimetersToTwip(25.4),
              right: convertMillimetersToTwip(25.4)
            }
          }
        },
        children: bodyChildren
      }
    ]
  });

  const blob = await Packer.toBlob(document);
  return { blob, pageCount: pdf.numPages, paragraphs };
}
