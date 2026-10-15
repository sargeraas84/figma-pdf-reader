import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";

const fixturePath = path.join(__dirname, "..", "test-fixture.pdf");

test("click a line in highlight mode, sidebar shows it, save bakes it, restore after relaunch", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-hl-"));
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
    // start from a clean annotation store (leftovers from previous runs)
    await win.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("pdf-reader-edits:v1:")) localStorage.removeItem(k);
    });

    // switch to the highlighter (also enters edit mode)
    await win.getByRole("button", { name: /Highlight text/ }).click();
    await win.waitForSelector('[data-page="1"][data-edit-ready="true"]', { timeout: 15_000 });

    // single click on a text run → the whole line gets highlighted
    await win.locator(".textLayer span").filter({ hasText: "Mississippi" }).first().click();

    // live overlay shows a translucent highlight
    const hasOverlay = await win.evaluate(() =>
      [...document.querySelectorAll('[data-page="1"] div')].some(
        (d) => d instanceof HTMLElement && d.style.background.startsWith("rgba(255")
      )
    );
    expect(hasOverlay, "live highlight overlay present").toBe(true);

    // annotations sidebar mode auto-opened and lists the highlight
    const row = win.getByRole("button", { name: /Highlight · 1 box/ }).first();
    await row.waitFor({ timeout: 10_000 });

    // leave edit mode, save — annotations must be baked into the PDF
    await win.getByRole("button", { name: "Edit text" }).click();
    await win.getByRole("button", { name: /Save \(Ctrl/ }).click();
    await win.getByText(/Saved to/).waitFor({ timeout: 30_000 });

    const saved = await PDFDocument.load(fs.readFileSync(savePath));
    let fillOps = 0;
    for (const [, obj] of saved.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      try {
        const s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
        fillOps += (s.match(/\nB\n|\nf\n/g) ?? []).length;
      } catch {
        /* not a content stream */
      }
    }
    expect(fillOps, "highlight rectangle baked on save").toBeGreaterThanOrEqual(1);

    // after saving, pending annotations are dropped from the app state
    await expect(win.getByText(/No annotations yet/)).toBeVisible();

    await app.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 500));

    // relaunch the same document → the annotation was cleared post-save, so the
    // sidebar shows the empty hint again (persistence round-trip asserted
    // below via a fresh unsaved edit instead)
    const app2 = await electron.launch({
      args: [".", fixturePath],
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, PDF_READER_E2E_USER_DATA: tmp },
      timeout: 120_000
    });
    try {
      const win2 = await app2.firstWindow();
      await win2.waitForSelector(".textLayer span", { timeout: 90_000 });

      // make a fresh highlight WITHOUT saving, then check persistence
      await win2.getByRole("button", { name: /Highlight text/ }).click();
      await win2.waitForSelector('[data-page="1"][data-edit-ready="true"]', { timeout: 15_000 });
      await win2.locator(".textLayer span").filter({ hasText: "banana" }).first().click();
      await expect(win2.getByText(/Highlight · \d+/)).toBeVisible();

      await app2.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));

      // relaunch again → the unsaved highlight is restored from the store and
      // listed in the annotations sidebar without entering edit mode
      const app3 = await electron.launch({
        args: [".", fixturePath],
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, PDF_READER_E2E_USER_DATA: tmp },
        timeout: 120_000
      });
      try {
        const win3 = await app3.firstWindow();
        await win3.waitForSelector(".textLayer span", { timeout: 90_000 });
        // restored highlight lives in the Annotations tab (sidebar opens on Thumbs by default)
        await win3.getByRole("button", { name: "Annotations", exact: true }).click();
        await expect(win3.getByText(/Highlight · \d+ box/)).toBeVisible();
        const hasRestored = await win3.evaluate(() =>
          [...document.querySelectorAll('[data-page="1"] div')].some(
            (d) => d instanceof HTMLElement && d.style.background.startsWith("rgba(255")
          )
        );
        expect(hasRestored, "highlight overlay restored after relaunch").toBe(true);

        // batch flow: select the restored annotation, delete it via the bar
        await win3.getByRole("checkbox", { name: /Select annotation/ }).click();
        await win3.getByRole("button", { name: /Delete \(1\)/ }).click();
        await expect(win3.getByText(/No annotations yet/)).toBeVisible({ timeout: 10_000 });

        // clean the store so later runs start fresh
        await win3.evaluate(() => {
          for (const k of Object.keys(localStorage)) if (k.startsWith("pdf-reader-edits:v1:")) localStorage.removeItem(k);
        });
      } finally {
        await app3.close().catch(() => {});
      }
    } finally {
      await app2.close().catch(() => {});
    }
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
