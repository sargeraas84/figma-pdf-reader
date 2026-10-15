import * as pdfjsLib from "pdfjs-dist";
// Vite-friendly worker wiring: worker code is bundled as an asset URL.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjsLib.PDFDocumentProxy;
export type PdfPage = pdfjsLib.PDFPageProxy;

export interface PageSize {
  width: number; // CSS px at scale 1
  height: number;
  rotate: number; // intrinsic page rotation, degrees
}

export function pageSizeOf(page: PdfPage): PageSize {
  const v = page.getViewport({ scale: 1 });
  return { width: v.width, height: v.height, rotate: page.rotate ?? 0 };
}

const sizeCaches = new WeakMap<object, Map<number, PageSize>>();

export async function pageSizeFor(doc: PdfDocument, pageNumber: number): Promise<PageSize> {
  let cache = sizeCaches.get(doc);
  if (!cache) {
    cache = new Map();
    sizeCaches.set(doc, cache);
  }
  const cached = cache.get(pageNumber);
  if (cached) return cached;
  const page = await doc.getPage(pageNumber);
  const size = pageSizeOf(page);
  cache.set(pageNumber, size);
  return size;
}

export interface OutlineNode {
  title: string;
  dest: unknown;
  children: OutlineNode[];
}

export async function readOutline(doc: PdfDocument): Promise<OutlineNode[]> {
  const raw = (await doc.getOutline()) as unknown as any[] | null;
  if (!raw) return [];
  const convert = (items: any[]): OutlineNode[] =>
    items.map((it) => ({
      title: String(it.title ?? ""),
      dest: it.dest ?? null,
      children: it.items ? convert(it.items) : []
    }));
  return convert(raw);
}

/** Resolve a PDF destination (ref or named) to a 1-based page number, or null. */
export async function destToPageNumber(doc: PdfDocument, dest: unknown): Promise<number | null> {
  try {
    let explicitDest: unknown = dest;
    if (typeof dest === "string") {
      explicitDest = await doc.getDestination(dest);
    }
    if (!Array.isArray(explicitDest) || explicitDest.length === 0) return null;
    const ref = explicitDest[0];
    if (ref == null || typeof ref === "number") return null;
    const pageIndex = await doc.getPageIndex(ref as never);
    return pageIndex + 1;
  } catch {
    return null;
  }
}
