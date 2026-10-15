// PDF → PowerPoint (.pptx) conversion, fully in the renderer.
// Each page becomes one slide: the page is rendered to PNG at 2x (readable
// thumbnails that look exactly like the PDF) and the page's extracted text is
// attached as speaker notes so slide content is searchable/editable.

import type { PdfDocument } from "./pdfjs";
import PptxGenJS from "pptxgenjs";

export interface PdfToPptxResult {
  blob: Blob;
  pageCount: number;
}

/**
 * Render every page to a PNG and build a .pptx with one slide per page.
 * The slide size matches the PDF page aspect: pptxgenjs default is 10×5.625in
 * (16:9); we keep it and letterbox the page image centered.
 */
export async function pdfToPptx(
  pdf: PdfDocument,
  onProgress?: (done: number, total: number) => void
): Promise<PdfToPptxResult> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // 16:9 slide; fit the page inside with margins, preserving aspect
    const slideW = 10;
    const slideH = 5.625;
    const margin = 0.2;
    const availW = slideW - margin * 2;
    const availH = slideH - margin * 2;
    const fit = Math.min(availW / (base.width / 72), availH / (base.height / 72));
    const imgW = (base.width / 72) * fit;
    const imgH = (base.height / 72) * fit;
    const x = (slideW - imgW) / 2;
    const y = (slideH - imgH) / 2;

    // render at 2x for readable slide thumbnails
    const scale = Math.min(4, Math.max(1.5, 2));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;

    const dataUrl = canvas.toDataURL("image/png");

    // extract text for speaker notes
    const content = await page.getTextContent();
    const notes = content.items
      .map((it) => (typeof (it as { str?: string }).str === "string" ? (it as { str: string }).str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const slide = pptx.addSlide();
    slide.addImage({ data: dataUrl, x, y, w: imgW, h: imgH });
    if (notes) slide.addNotes(notes);

    page.cleanup();
    onProgress?.(n, pdf.numPages);
  }

  const blob = await pptx.write({ outputType: "blob" }) as Blob;
  return { blob, pageCount: pdf.numPages };
}
