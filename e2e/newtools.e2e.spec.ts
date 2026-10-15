import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { PDFRawStream, decodePDFRawStream } from "pdf-lib";

const fixturePath = path.join(__dirname, "..", "test-fixture.pdf");

const LAUNCH = (env: Record<string, string>) =>
  electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ...env },
    timeout: 120_000
  });

test("PDF to PowerPoint: one slide per page with notes, saved as valid .pptx", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-pptx-"));
  const savePath = path.join(tmp, "out.pptx");
  const app = await LAUNCH({ PDF_READER_E2E_USER_DATA: tmp, PDF_READER_E2E_SAVE_PATH: savePath });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });
    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="pdf-to-pptx"]').click();
    await expect(win.getByText(/Saved PowerPoint/)).toBeVisible({ timeout: 90_000 });

    const buf = fs.readFileSync(savePath);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK"); // OOXML zip
    const JSZip: typeof import("jszip") = require("jszip");
    const zip = await JSZip.loadAsync(buf);
    const slideCount = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
    expect(slideCount).toBe(2); // fixture has 2 pages
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("pic"); // the page image embedding
    const notes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    expect(notes).toContain("banana"); // fixture text landed in speaker notes
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("Export pages as images: modal picks folder + range, PNGs written via guarded IPC", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-img-"));
  const outDir = path.join(tmp, "pages");
  const app = await LAUNCH({ PDF_READER_E2E_USER_DATA: tmp });
  try {
    const win = await app.firstWindow();
    win.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text().slice(0, 250)); });
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });

    // stub the folder picker
    await app.evaluate(({ dialog }, dir) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths: [dir] });
    }, outDir);

    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="export-images"]').click();
    await win.getByRole("dialog", { name: "Export pages as images" }).waitFor({ timeout: 10_000 });
    // default = pages 1..2, PNG, 2x
    await win.getByRole("button", { name: "Choose folder & export" }).click();
    await expect(win.getByText(/Exported 2 images/)).toBeVisible({ timeout: 60_000 });

    const files = fs.readdirSync(outDir);
    expect(files.length).toBe(2);
    expect(files.filter((f) => f.endsWith(".png")).length).toBe(2);
    // PNG magic
    for (const f of files) {
      const head = fs.readFileSync(path.join(outDir, f)).subarray(0, 4);
      expect(head.toString("hex")).toBe("89504e47");
    }
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("Split: page range extracts into a new tab with the chosen pages only", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-split-"));
  const app = await LAUNCH({ PDF_READER_E2E_USER_DATA: tmp });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });

    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="split"]').click();
    await win.getByRole("dialog", { name: "Split pages" }).waitFor({ timeout: 10_000 });
    await win.getByTestId("split-from").fill("1");
    await win.getByTestId("split-to").fill("1");
    await win.getByRole("button", { name: "Extract to a new document" }).click();

    await expect(win.getByText(/Extracted pages 1–1 into a new tab/)).toBeVisible({ timeout: 30_000 });
    // the new tab shows page 1 of the split doc (pipeline loads it as a PDF)
    await win.waitForSelector('.doc-scroll:not([style*="display: none"]) [data-page="1"] canvas', { timeout: 60_000 });
    // only 1 page in the new tab: no page-2 element in the ACTIVE scroller
    // (other hidden tabs may legitimately contain one)
    const activeScroller = win.locator('.doc-scroll:not([style*="display: none"])');
    await expect(activeScroller.locator('[data-page="2"]')).toHaveCount(0);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("Pen tool: drag a stroke, sidebar lists it, save bakes a line into PDF bytes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-pen-"));
  const savePath = path.join(tmp, "out-pen.pdf");
  const app = await LAUNCH({ PDF_READER_E2E_USER_DATA: tmp, PDF_READER_E2E_SAVE_PATH: savePath });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });
    win.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text().slice(0, 250)); });
    localStorageCleanup(win);

    // activate the pen tool
    await win.getByRole("button", { name: /Pen \(draw freehand/ }).click();
    await win.waitForSelector('[data-page="1"][data-tool="pen"]', { timeout: 15_000 });

    // draw an S-curve with the mouse
    const page1 = win.locator('[data-page="1"]');
    const box = await page1.boundingBox();
    await win.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await win.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await win.mouse.move(
        box.x + box.width * (0.2 + 0.05 * i),
        box.y + box.height * (0.3 + 0.02 * Math.sin(i)),
        { steps: 2 }
      );
    }
    await win.mouse.up();

    // sidebar lists the stroke
    await win.getByRole("button", { name: "Annotations", exact: true }).click();
    await expect(win.getByText(/Pen stroke · /).first()).toBeVisible({ timeout: 10_000 });

    // save → a line-drawing operator with a non-zero stroke lands in the PDF
    await win.getByRole("button", { name: /Save \(/ }).click();
    await win.getByText(/Saved to/).waitFor({ timeout: 30_000 });
    const doc = await PDFDocument.load(fs.readFileSync(savePath));
    expect(doc.getPageCount()).toBe(2);
    let hasStroke = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      try {
        const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
        if (/\bS\b|\bS\b/.test(s) && /\bw\b/.test(s)) hasStroke = true;
      } catch { /* skip */ }
    }
    expect(hasStroke, "pen stroke line operator present").toBe(true);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function localStorageCleanup(win: import("@playwright/test").Page) {
  return win.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("pdf-reader-edits:v1:")) localStorage.removeItem(k);
  });
}
