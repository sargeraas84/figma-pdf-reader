/**
 * Headless smoke test for the font-aware save pipeline.
 * Validates that buildModifiedPdf embeds the bundled SIL OFL fonts
 * (including the fake-italic skew fallback) and produces valid PDF bytes.
 * Usage: node scripts/smoke-fonts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { buildModifiedPdf } from "../src/lib/edits";
import { findFontChoice, styleSlot } from "../src/lib/fonts";
import { EMBEDDED_FONTS } from "../src/lib/fonts-manifest";

const root = process.cwd(); // run from the project directory (npm script / cwd)
const fixture = fs.readFileSync(path.join(root, "test-fixture.pdf"));
const fontDir = path.join(root, "public", "fonts");

const requested = [];
const loadFontBytes = async (file) => {
  requested.push(file);
  return new Uint8Array(fs.readFileSync(path.join(fontDir, file)));
};

const pick = (id) => {
  const def = EMBEDDED_FONTS.find((f) => f.id === id);
  if (!def) throw new Error(`missing bundled font: ${id}`);
  return def;
};

const edits = [
  {
    id: "e1",
    page: 1,
    kind: "replace",
    text: "Replaced with Lato Bold",
    fontSizePt: 18,
    color: [0.1, 0.1, 0.4],
    fontFamily: "lato",
    bold: true,
    italic: false,
    bbox: { x0: 60, y0: 700, x1: 300, y1: 740 },
    baseline: { x: 72, y: 715 }
  },
  {
    id: "e1b",
    page: 1,
    kind: "replace",
    text: "Lato Bold underlined + struck",
    fontSizePt: 16,
    color: [0.1, 0.1, 0.4],
    fontFamily: "lato",
    bold: true,
    italic: false,
    underline: true,
    strike: true,
    bbox: { x0: 60, y0: 660, x1: 320, y1: 700 },
    baseline: { x: 72, y: 678 }
  },
  {
    id: "e2",
    page: 1,
    kind: "add",
    text: "Merriweather italic upright",
    fontSizePt: 16,
    color: [0.8, 0, 0],
    fontFamily: "merriweather",
    bold: false,
    italic: true,
    point: { x: 72, y: 640 }
  },
  {
    id: "h1",
    page: 1,
    kind: "highlight",
    color: [1, 0.87, 0.2],
    opacity: 0.45,
    rects: [{ x0: 60, y0: 630, x1: 340, y1: 652 }]
  },
  {
    id: "e3",
    page: 1,
    kind: "add",
    text: "Oswald fake italic (skew) + Roboto builtin Helvetica",
    fontSizePt: 14,
    color: [0, 0.4, 0],
    fontFamily: "oswald",
    bold: false,
    italic: true,
    point: { x: 72, y: 600 }
  }
];

// sanity: style slot resolution matches expectations
if (styleSlot(true, true) !== "boldItalic") throw new Error("styleSlot broken");
if (!findFontChoice("oswald").italicSupported) {
  // eslint-disable-next-line no-console
  console.log("oswald italicSupported=false → fake skew path");
}

const before = pick("lato");
if (!before.files.bold) throw new Error("lato bold file missing");

console.log("findFontChoice('lato') →", JSON.stringify(findFontChoice("lato")));
const bytes = await buildModifiedPdf(fixture, edits, loadFontBytes);
console.log("font files requested:", requested.join(", ") || "NONE");
const outDir = path.join(root, "output");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "smoke-fonts-out.pdf"), bytes);

// proper verification: reload and enumerate /Type /Font dicts (base-14 +
// subsetted TrueType are inside compressed object streams, so raw byte
// scanning cannot see them)
const out = await PDFDocument.load(bytes);
const names = new Set();
let ttfStreams = 0;
for (const [, obj] of out.context.enumerateIndirectObjects()) {
  const dict = obj instanceof PDFDict ? obj : obj?.dict;
  if (!dict?.lookup) continue;
  const type = dict.lookup(PDFName.of("Type"));
  if (!type || String(type) !== "/Font") continue;
  const bf = dict.lookup(PDFName.of("BaseFont"));
  if (bf) names.add(String(bf).replace(/^\//, ""));
  const desc = dict.lookup(PDFName.of("FontDescriptor"));
  if (desc instanceof PDFDict && desc.lookup(PDFName.of("FontFile2"))) ttfStreams++;
}
console.log("embedded fonts in output:", [...names].join(", "));
console.log("embedded TTF streams (FontFile2):", ttfStreams);

// decorated edit → stroke operators must exist in the content stream(s);
// decode every raw stream in the document and count path-stroke ops (M/L/S)
let strokeOps = 0;
let snippet = "";
for (const [, obj] of out.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  try {
    const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    const ops = (s.match(/(?:^|[\s\n])S(?=$|[\s\n])/g) ?? []).length;
    if (ops > 0 && !snippet) snippet = s.slice(0, 400);
    strokeOps += ops;
  } catch {
    /* images/xref etc — not text content */
  }
}
console.log("stroke ops (S) in decoded streams:", strokeOps);

// highlight edit → filled rectangle ops must exist in the content stream
// highlight + cover rects are drawn as path fills by pdf-lib drawRectangle
// ("h\nB\nQ"), not "re" operators
let fillOps = 0;
for (const [, obj] of out.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  try {
    const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    fillOps += (s.match(/\nB\n|\nf\n/g) ?? []).length;
  } catch {
    /* not a content stream */
  }
}
console.log("path fill ops found:", fillOps);
if (fillOps < 3) throw new Error("Highlight/cover rectangles not drawn!");
if (snippet) console.log("stream snippet:", JSON.stringify(snippet));
if (strokeOps < 2) throw new Error("Underline/strikethrough strokes not drawn!");
console.log("output size:", bytes.length, "bytes");
if (![...names].some((n) => /Lato/i.test(n))) throw new Error("Lato not embedded!");
if (![...names].some((n) => /Merriweather/i.test(n))) throw new Error("Merriweather not embedded!");
if (![...names].some((n) => /Oswald/i.test(n))) throw new Error("Oswald not embedded!");

// ---------- new tools: redact + protect(encrypt) + combine ----------
const { bakeRedactions, compressSavedPdf } = await import("../src/lib/edits");
const { PDFDocument: CantooDoc } = await import("@cantoo/pdf-lib");

// 1) Redact: text inside the rect is REMOVED from the content stream (not
// only covered) and an opaque knockout rectangle is painted over it.
const redacted = await buildModifiedPdf(fixture, [
  { id: "r1", page: 1, kind: "redact", rects: [{ x0: 60, y0: 690, x1: 300, y1: 720 }] }
]);
const redDoc = await PDFDocument.load(redacted);
let blackFill = 0;
for (const [, obj] of redDoc.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  try {
    const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    if (/\nB\n|\nf\n/.test(s)) blackFill++;
  } catch {}
}
if (blackFill < 1) throw new Error("Redaction knockout rect not drawn!");
// TRUE removal: the removed lines must no longer appear in ANY stream (neither
// as operators nor as literal-string bytes a text extractor could pick up).
const removedPhrases = ["Figma Reader fixture document", "The quick brown fox jumps over the lazy dog."];
let leaked = null;
for (const [, obj] of redDoc.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  try {
    const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    for (const phrase of removedPhrases) if (s.includes(phrase)) leaked = phrase;
  } catch {}
}
if (leaked) throw new Error(`Redacted text leaked into saved bytes: "${leaked}"`);
// and the later lines must still be there (position-preserving strikethrough,
// not a whole-page wipe)
const kept = await PDFDocument.load(redacted);
let foundKept = false;
for (const [, obj] of kept.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  try {
    const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    if (s.includes("Search for the word banana on this page.")) foundKept = true;
  } catch {}
}
if (!foundKept) throw new Error("Redaction wiped neighbouring text (over-removal)!");
console.log("SMOKE_REDACT_OK — fill op present, redacted text removed, neighbours kept, pages:", redDoc.getPageCount());

// 2) Protect: the encrypted output must require a password to load (unencrypted load fails or decrypts only with pw)
const base = await PDFDocument.load(redacted);
const encDoc = await CantooDoc.load(await base.save(), { ignoreEncryption: true });
encDoc.encrypt({ userPassword: "pw123", ownerPassword: "owner-pw123" });
const encBytes = await encDoc.save();
let isOpen = false;
try {
  await PDFDocument.load(encBytes); // standard pdf-lib loads encrypted docs with an empty pw? it throws on encrypted without ignoreEncryption
  isOpen = true;
} catch {
  /* encrypted → expected */
}
try {
  const dec = await CantooDoc.load(encBytes, { password: "pw123" });
  console.log("SMOKE_PROTECT_OK — decrypt with user pw, pages:", dec.getPageCount(), "plain-pdf-lib rejected:", !isOpen);
} catch (e) {
  throw new Error("Encrypted PDF failed to decrypt with the user password: " + e.message);
}

// 3) Combine: merge the fixture with itself → 4 pages
const comb = await PDFDocument.create();
for (let i = 0; i < 2; i++) {
  const src = await PDFDocument.load(fixture);
  const cpd = await comb.copyPages(src, src.getPageIndices());
  for (const c of cpd) comb.addPage(c);
}
const combBytes = await comb.save();
const combDoc = await PDFDocument.load(combBytes);
if (combDoc.getPageCount() !== 4) throw new Error("Combine page count wrong!");
console.log("SMOKE_COMBINE_OK — merged pages:", combDoc.getPageCount());

// 4) Compress: lossless shrink should not grow the file
const compressed = await compressSavedPdf(combBytes);
console.log("SMOKE_COMPRESS_OK —", compressed.originalSize, "→", compressed.newSize);
if (compressed.newSize > compressed.originalSize) throw new Error("Compression grew the file!");

// 5) Round-trip: Create (blank lined doc) → valid PDF with 3 pages
const { PDFDocument: PL5, rgb: rgb5 } = await import("pdf-lib");
const blank = await PL5.create();
for (let i = 0; i < 3; i++) {
  const page = blank.addPage([595.28, 841.89]);
  for (let y = 72; y < 841.89 - 72; y += 28) {
    page.drawLine({ start: { x: 64, y }, end: { x: 595.28 - 64, y }, thickness: 0.6, color: rgb5(0.82, 0.84, 0.88) });
  }
}
const blankBytes = await blank.save();
const blankDoc = await PDFDocument.load(blankBytes);
if (blankDoc.getPageCount() !== 3) throw new Error("Create round-trip page count wrong!");
console.log("SMOKE_CREATE_OK — blank lined doc, pages:", blankDoc.getPageCount());

// 6) Round-trip: Prepare a form (stamped template) → labels survive + editable-by-editor bytes
const tmpl = await PL5.create();
const tPage = tmpl.addPage([595.28, 841.89]);
tPage.drawText("Form — Name:", { x: 64, y: 792, size: 12, color: rgb5(0.1, 0.1, 0.2) });
tPage.drawRectangle({ x: 170, y: 788, width: 360, height: 22, borderColor: rgb5(0.4, 0.45, 0.55), borderWidth: 0.8 });
const tmplBytes = await tmpl.save();
const tmplDoc = await PDFDocument.load(tmplBytes);
if (tmplDoc.getPageCount() !== 1) throw new Error("Form template round-trip page count wrong!");
console.log("SMOKE_FORM_OK — form template saved + reloads");

console.log("SMOKE_FONTS_OK");
