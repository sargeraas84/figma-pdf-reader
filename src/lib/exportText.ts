// Export the open PDF's text in plain-text formats: .txt, .md, .html.
// Uses the same pdf.js text extraction as PDF → Word; layouts are flattened
// to paragraphs with page breaks preserved (as page markers / <hr> / newpage).

import type { PdfDocument } from "./pdfjs";

export type TextExportFormat = "txt" | "md" | "html";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function pageText(pdf: PdfDocument, n: number): Promise<string> {
  const page = await pdf.getPage(n);
  const content = await page.getTextContent();
  const lines: string[] = [];
  let cur = "";
  let curY: number | null = null;
  for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
    if (typeof item.str !== "string" || !Array.isArray(item.transform)) continue;
    const y = item.transform[5];
    if (curY !== null && Math.abs(y - curY) > 2.5) {
      if (cur.trim()) lines.push(cur.trim());
      cur = "";
    }
    cur += item.str;
    curY = y;
  }
  if (cur.trim()) lines.push(cur.trim());
  page.cleanup();
  return lines.join("\n");
}

export async function exportPdfToTextFormat(pdf: PdfDocument, format: TextExportFormat): Promise<Blob> {
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    pages.push(await pageText(pdf, n));
  }

  if (format === "txt") {
    const body = pages
      .map((p, i) => (pages.length > 1 ? `— Page ${i + 1} —\n${p}` : p))
      .join("\n\n");
    return new Blob([body], { type: "text/plain;charset=utf-8" });
  }

  if (format === "md") {
    const body = pages
      .map((p, i) => (pages.length > 1 ? `## Page ${i + 1}\n\n${p}` : p))
      .join("\n\n---\n\n");
    return new Blob([body], { type: "text/markdown;charset=utf-8" });
  }

  // html
  const body = pages
    .map((p) => p.split("\n").map((l) => `<p>${esc(l)}</p>`).join("\n"))
    .join("\n<hr>\n");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Exported PDF text</title>
<style>body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}hr{border:0;border-top:1px solid #ddd;margin:32px 0}</style>
</head>
<body>
${body}
</body>
</html>`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
}
