import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

const fixturePath = path.join(__dirname, "..", "test-fixture.pdf");

test("redact tool: mark a region, bake opaque black fills on save", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-redact-"));
  const savePath = path.join(tmp, "out-redacted.pdf");

  const app = await electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PDF_READER_E2E_SAVE_PATH: savePath, PDF_READER_E2E_USER_DATA: tmp },
    timeout: 120_000
  });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });
    win.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.text().slice(0, 300)); });
    await win.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("pdf-reader-edits:v1:")) localStorage.removeItem(k);
    });
    await app.evaluate(({ app: mainApp, fs: fsMod, path: pathMod }) => {
      const dir = pathMod.join(mainApp.getPath("userData"), "pending-edits");
      try { fsMod.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }).catch(() => {});

    // switch to the redact tool via the toolbar
    await win.getByRole("button", { name: /Redact \(drag a rect/ }).click();
    await win.waitForSelector('[data-page="1"][data-edit-ready="true"]', { timeout: 15_000 });
    await expect(win.locator('[data-tool="redact"]').first()).toBeVisible();

    // drag a rect across a text run on page 1
    const page1 = win.locator('[data-page="1"]');
    const box = await page1.boundingBox();
    await win.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.25);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.35, { steps: 8 });
    await win.mouse.up();

    // the sidebar (auto-switch) lists the redaction
    await win.getByRole("button", { name: "Annotations", exact: true }).click();
    await expect(win.getByText(/Redacted · 1 area/).first()).toBeVisible({ timeout: 10_000 });

    // save → verify black fill in the PDF bytes
    await win.getByRole("button", { name: "Edit text" }).click();
    await win.getByRole("button", { name: /Save \(Ctrl/ }).click();
    await win.getByText(/Saved to/).waitFor({ timeout: 30_000 });

    const saved = await PDFDocument.load(fs.readFileSync(savePath));
    expect(saved.getPageCount()).toBe(2);

    await win.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("pdf-reader-edits:v1:")) localStorage.removeItem(k);
    });
    await app.evaluate(({ app: mainApp, fs: fsMod, path: pathMod }) => {
      const dir = pathMod.join(mainApp.getPath("userData"), "pending-edits");
      try { fsMod.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }).catch(() => {});

    // verify an opaque black fill landed in the saved bytes
    const { PDFRawStream: RS, decodePDFRawStream: Dec } = await import("pdf-lib");
    let hasFill = false;
    for (const [, obj] of saved.context.enumerateIndirectObjects()) {
      if (!(obj instanceof RS)) continue;
      try {
        const s = Buffer.from(Dec(obj).decode()).toString("latin1");
        if (/\nB\n|\nf\n/.test(s)) hasFill = true;
      } catch { /* skip */ }
    }
    expect(hasFill, "redaction fill present in saved bytes").toBe(true);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("Create a PDF and Combine files produce working tabs", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-rotools-"));
  const app = await electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PDF_READER_E2E_USER_DATA: tmp },
    timeout: 120_000
  });
  try {
    const win = await app.firstWindow();
    win.on("console", (m) => { if (m.type() === "error") console.log("[console2]", m.text().slice(0, 250)); });
    await win.waitForSelector("#app-ui", { timeout: 30_000 });

    // Seed a tab via the same CLI arg the other tool specs use — reliable.
    await win.waitForSelector('.textLayer span[data-item-index="0"]', { timeout: 90_000 });

    // Create a PDF → blank lined tab opens
    await win.getByRole("button", { name: "All tools" }).click();
    const panel = win.getByRole("dialog", { name: "All tools" });
    await panel.locator('[data-tool="create"]').click();
    // a blank lined doc has no text layer — wait for the page canvas instead;
    // scope to the visible document scroller (hidden tabs are display:none)
    const activeScroller = win.locator('.doc-scroll:not([style*="display: none"])');
    await activeScroller.locator('[data-page="1"] canvas').first().waitFor({ timeout: 30_000 });
    await expect(win.getByText(/Blank lined A4 document created/)).toBeVisible({ timeout: 10_000 });
    // the doc router gives the tab name from the created file
    await expect(win.locator('[role="tab"][aria-selected="true"]')).toContainText("Untitled");

    // stub the multi-select dialog to return our fixture twice, then Combine
    await app.evaluate(({ dialog }, fixture) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [fixture, fixture] });
    }, fixturePath);
    await win.getByRole("button", { name: "All tools" }).click();
    await panel.locator('[data-tool="combine"]').click();
    await expect(win.getByText(/Combined 2 PDFs — 4 pages/)).toBeVisible({ timeout: 10_000 });
    await activeScroller.locator('[data-page="4"]').first().waitFor({ timeout: 30_000 });
    await expect(activeScroller.locator('[data-page="4"]').first()).toBeVisible();

    // Prepare a form → template tab with labelled boxes
    await win.getByRole("button", { name: "All tools" }).click();
    await panel.locator('[data-tool="prepare-form"]').click();
    await expect(win.getByText(/Form template created/)).toBeVisible({ timeout: 10_000 });
    await activeScroller.locator('[data-page="1"] canvas').first().waitFor({ timeout: 30_000 });

    // Protect + Compress toggles via the in-app password dialog
    await win.getByRole("button", { name: "All tools" }).click();
    await panel.locator('[data-tool="protect"]').click();
    await win.getByLabel("New password").fill("s3cret-pw");
    await win.getByLabel("Repeat password").fill("s3cret-pw");
    await win.getByRole("button", { name: "Set password" }).click();
    await expect(win.getByText(/Password set — .* will be encrypted on save/)).toBeVisible({ timeout: 10_000 });

    const before = await win.evaluate(() => document.body.textContent);
    await win.getByRole("button", { name: "All tools" }).click();
    await panel.locator('[data-tool="compress"]').click();
    await expect(win.getByText(/Compression on/)).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close().catch(() => {});
  }
});

test("Scan & OCR extracts text from the visible page via the local WASM engine", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-ocr-"));
  const app = await electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PDF_READER_E2E_USER_DATA: tmp },
    timeout: 180_000
  });
  try {
    const win = await app.firstWindow();
    win.on("console", (m) => { if (m.type() === "error") console.log("[console3]", m.text().slice(0, 250)); });
    await win.waitForSelector('.textLayer span[data-item-index="0"]', { timeout: 90_000 });

    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="ocr"]').click();

    // busy → result; the fixture page contains a distinctive word
    await win.getByRole("dialog", { name: "Scan and OCR" }).waitFor({ timeout: 30_000 });
    await win.waitForFunction(
      () => {
        const el = document.querySelector('[role="dialog"][aria-label="Scan and OCR"] pre');
        return el && (el.textContent ?? "").includes("banana");
      },
      { timeout: 120_000 }
    );
    const text = await win.evaluate(() => {
      return (document.querySelector('[role="dialog"][aria-label="Scan and OCR"] pre') as HTMLElement).textContent;
    });
    expect(text).toContain("banana");
    await app.close().catch(() => {});
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
