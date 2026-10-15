import fs from "node:fs";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { buildModifiedPdf } from "../src/lib/edits.ts";
const fixture = fs.readFileSync("test-fixture.pdf");
const redacted = await buildModifiedPdf(fixture, [
  { id: "r1", page: 1, kind: "redact", rects: [{ x0: 60, y0: 690, x1: 300, y1: 720 }] }
]);
const doc = await PDFDocument.load(redacted);
for (const [, obj] of doc.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  try {
    const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    if (s.includes("quick brown")) {
      console.log("LEAK STREAM:", s.slice(0, 700));
    }
  } catch {}
}
console.log("--- all stream litstrings w/ Tj nearby ---");
for (const [, obj] of doc.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  try {
    const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    if (/Tj|TJ/.test(s)) console.log(">>>", s.slice(0, 200).replace(/\n/g, " "));
  } catch {}
}
