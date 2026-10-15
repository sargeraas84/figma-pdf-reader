// Export open-PDF pages as PNG/JPG images into a folder picked by the user.
// Rendering happens right in the renderer (same pdf.js pipeline as pages
// themselves); file writes go through the guarded images:write IPC channel.

import type { PdfDocument } from "./pdfjs";

export interface ExportImagesOptions {
  format: "png" | "jpg";
  /** CSS scale multiplier for the page render (1 = 72dpi, 2 ≈ 144dpi, 3 ≈ 216dpi) */
  quality: 1 | 2 | 3;
  /** 1-based source page numbers to export */
  pages: number[];
}

export interface ExportImagesResult {
  dir: string;
  count: number;
  failed: string[];
}

export async function exportPagesAsImages(
  pdf: PdfDocument,
  baseName: string,
  opts: ExportImagesOptions,
  onProgress?: (done: number, total: number) => void
): Promise<ExportImagesResult> {
  const dir = await window.readerBridge.pickImagesDir();
  if (!dir) throw new Error("canceled");
  await window.readerBridge.registerImagesDir(dir);

  const failed: string[] = [];
  let done = 0;
  for (const pageNum of opts.pages) {
    try {
      const p = await pdf.getPage(pageNum);
      const rot = p.rotate ?? 0;
      const viewport = p.getViewport({ scale: opts.quality, rotation: rot });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;

      const type = opts.format === "png" ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, opts.format === "jpg" ? 0.92 : undefined));
      if (!blob) throw new Error("toBlob returned null");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const safeName = baseName.replace(/\.pdf$/i, "").replace(/[^\w-]+/g, "_") || "page";
      const fileName = `${safeName}-page-${String(pageNum).padStart(3, "0")}.${opts.format}`;
      const res = await window.readerBridge.writeImageFile(dir, fileName, bytes);
      if (!res.ok) failed.push(`page ${pageNum}: ${res.error ?? "write failed"}`);
      p.cleanup();
    } catch (err) {
      failed.push(`page ${pageNum}: ${(err as Error).message}`);
    }
    done++;
    onProgress?.(done, opts.pages.length);
  }
  return { dir, count: opts.pages.length - failed.length, failed };
}
