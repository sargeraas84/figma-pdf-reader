import fs from "node:fs";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { stripRedactedContent } from "../src/lib/redact-strip.ts";
const doc = await PDFDocument.load(fs.readFileSync("test-fixture.pdf"));
const n = stripRedactedContent(doc, [{ page: 1, kind: "redact", rects: [{ x0: 60, y0: 690, x1: 300, y1: 720 }] }]);
console.log("dropped:", n);
for (const [, obj] of doc.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  try {
    const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    console.log("=== stream:", s.slice(0, 400));
  } catch {}
}
const out = await doc.save();
console.log("saved bytes:", out.length);
