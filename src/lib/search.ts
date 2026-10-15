import type { PdfDocument } from "./pdfjs";

export interface MatchRange {
  /** index into the page's text items */
  item: number;
  /** start/end offsets inside that item's string */
  from: number;
  to: number;
}

export interface Match {
  page: number;
  ranges: MatchRange[];
}

export interface SearchResult {
  query: string;
  matches: Match[]; // ordered
  pagesSearched: number;
  truncated: boolean;
}

const MAX_MATCHES = 500;
const MAX_PAGES = 500;

function fold(text: string): string {
  return text.toLowerCase();
}

/**
 * Search `query` case-insensitively across a PDF's text content.
 * Matches are found within each text item (a run of glyphs on one line),
 * which covers the vast majority of real word and phrase queries.
 */
export async function searchDocument(
  doc: PdfDocument,
  query: string,
  onProgress?: (pagesDone: number) => void
): Promise<SearchResult> {
  const result: SearchResult = {
    query,
    matches: [],
    pagesSearched: 0,
    truncated: false
  };
  if (!query.trim()) return result;

  const needle = fold(query.trim());
  const numPages = Math.min(doc.numPages, MAX_PAGES);
  result.truncated = numPages < doc.numPages;

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const content = (await page.getTextContent()) as {
      items: Array<{ str?: string | undefined }>;
    };
    const items: string[] = [];
    for (const it of content.items) {
      items.push(typeof it.str === "string" ? it.str : "");
    }

    outer: for (let i = 0; i < items.length; i++) {
      const hay = fold(items[i]);
      if (!hay) continue;
      let idx = hay.indexOf(needle);
      while (idx !== -1) {
        result.matches.push({
          page: p,
          ranges: [{ item: i, from: idx, to: idx + needle.length }]
        });
        if (result.matches.length >= MAX_MATCHES) {
          result.truncated = true;
          break outer;
        }
        idx = hay.indexOf(needle, idx + needle.length);
      }
    }

    result.pagesSearched = p;
    onProgress?.(p);
    // yield so the UI stays responsive on long searches
    await new Promise((r) => setTimeout(r, 0));
  }
  return result;
}
