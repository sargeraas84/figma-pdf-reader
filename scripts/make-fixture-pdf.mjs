/**
 * Dev fixture: generate a small 2-page PDF with real text so search,
 * text layers and thumbnails can be smoke-tested.
 * Usage: node scripts/make-fixture-pdf.mjs <output.pdf>
 */
import fs from "node:fs";

const out = process.argv[2] ?? "test-fixture.pdf";

function pageContent(lines) {
  const parts = lines
    .map((l, i) => {
      const esc = l.replaceAll("(", "\\(").replaceAll(")", "\\)");
      return (i === 0 ? "" : "0 -30 Td ") + `(${esc}) Tj`;
    })
    .join(" ");
  return `BT /F1 18 Tf 72 720 Td ${parts} ET`;
}

const page1 = pageContent([
  "Figma Reader fixture document",
  "The quick brown fox jumps over the lazy dog.",
  "Search for the word banana on this page.",
  "Eleven characters: Mississippi."
]);
const page2 = pageContent([
  "Page two of the fixture document.",
  "Another occurrence of banana lives here.",
  "Rotations, zoom and thumbnails should all work."
]);

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>`,
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>`,
  `<< /Length ${page1.length} >>\nstream\n${page1}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${page2.length} >>\nstream\n${page2}\nendstream`
];

let pdf = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefOffset = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) {
  pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

fs.writeFileSync(out, pdf, "latin1");
console.log(`Wrote ${out} (${pdf.length} bytes)`);
