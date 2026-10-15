import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
  decodePDFRawStream
} from "pdf-lib";

const fixturePath = path.join(__dirname, "..", "test-fixture.pdf");

async function decodedStreams(doc: PDFDocument): Promise<string[]> {
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    try {
      out.push(Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1"));
    } catch {
      /* images etc. */
    }
  }
  return out;
}

test("edit text with a bundled font, save, verify the output PDF", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-e2e-"));
  const savePath = path.join(tmp, "out.pdf");

  const app = await electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PDF_READER_E2E_SAVE_PATH: savePath, PDF_READER_E2E_USER_DATA: tmp },
    timeout: 120_000
  });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });

    // enter edit mode, pick a bundled OFL font, enable underline
    await win.getByRole("button", { name: "Edit text" }).click();
    await win.locator('select[aria-label="Font"]').selectOption("lato");
    await win.getByRole("button", { name: "Underline" }).click();

    // deterministic signal: page 1 items are loaded and aligned with textDivs
    await win.waitForSelector('[data-page="1"][data-edit-ready="true"]', { timeout: 15_000 });
    const span = win.locator(".textLayer span").filter({ hasText: "Mississippi" }).first();
    await span.click({ force: true });
    const box = win.locator("[data-edit-box]");
    await box.waitFor({ state: "visible", timeout: 15_000 });

    // replace the whole run with typed text
    await box.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await box.pressSequentially("Hello E2E Lato!");

    // commit via blur — toggle edit mode (commit fires on blur, then mode exits)
    await win.getByRole("button", { name: "Edit text" }).click();

    // save (E2E hook skips the native dialog)
    await win.getByRole("button", { name: /Save \(Ctrl/ }).click();
    await win.getByText(/Saved to/).waitFor({ timeout: 30_000 });

    // ---------- verify the saved bytes ----------
    const file = fs.readFileSync(savePath);
    expect(file.length).toBeGreaterThan(1000);
    const doc = await PDFDocument.load(file);

    // 1. bundled OFL font is embedded (subset name contains "Lato")
    const fontNames = new Set<string>();
    let ttfStreams = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFDict ? obj : obj?.dict;
      if (!dict?.lookup) continue;
      const type = dict.lookup(PDFName.of("Type"));
      if (!type || String(type) !== "/Font") continue;
      const bf = dict.lookup(PDFName.of("BaseFont"));
      if (bf) fontNames.add(String(bf).replace(/^\//, ""));
      const desc = dict.lookup(PDFName.of("FontDescriptor"));
      if (desc instanceof PDFDict && desc.lookup(PDFName.of("FontFile2"))) ttfStreams++;
    }
    const names = [...fontNames];
    expect(names.some((n) => /Lato/i.test(n)), `Lato embedded, got: ${names}`).toBe(true);
    expect(ttfStreams).toBeGreaterThanOrEqual(1);

    // 2. the edited page's content stream uses the Lato font and draws text
    const streams = await decodedStreams(doc);
    const edited = streams.find((s) => /\/Lato-[^ \n]+ \d+ Tf/.test(s) && /Tj/.test(s));
    expect(edited, "content stream with Lato text-drawing op").toBeTruthy();

    // 3. the underline stroke was drawn (path move + stroke op)
    const totalPages = doc.getPageCount();
    const allStreams = streams.filter((s) => /\bTj\b|\bET\b/.test(s));
    const strokeOps = allStreams.reduce(
      (n, s) => n + (s.match(/(?:^|[\s\n])S(?=$|[\s\n])/g) ?? []).length,
      0
    );
    expect(strokeOps, "underline stroke drawn on save").toBeGreaterThanOrEqual(1);
    void totalPages;

    // 4. original document text is preserved (not overwritten)
    expect(streams.some((s) => s.includes("banana"))).toBe(true);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
