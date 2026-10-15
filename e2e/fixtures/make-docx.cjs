// Generates e2e/test-doc.docx used to exercise the Word → PDF pipeline.
// Run: node e2e/fixtures/make-docx.cjs  (idempotent — skips if present)
const fs = require("node:fs");
const path = require("node:path");
const docx = require(path.join(__dirname, "..", "..", "node_modules", "docx"));

const out = path.join(__dirname, "..", "test-doc.docx");
if (fs.existsSync(out)) {
  console.log("test-doc.docx already present");
  process.exit(0);
}

(async () => {
  const doc = new docx.Document({
    creator: "Figma E2E",
    sections: [
      {
        children: [
          new docx.Paragraph({ text: "E2E Conversion Probe", heading: docx.HeadingLevel.HEADING_1 }),
          new docx.Paragraph({
            children: [new docx.TextRun("The quick brown fox jumps over the lazy dog.")],
            spacing: { after: 120 }
          }),
          new docx.Paragraph({ children: [new docx.TextRun("Second paragraph with a ZWSP marker ​here.")] })
        ]
      }
    ]
  });
  const Packer = docx.Packer;
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
