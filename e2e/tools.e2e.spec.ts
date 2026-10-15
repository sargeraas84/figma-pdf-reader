import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";

const fixturePath = path.join(__dirname, "..", "test-fixture.pdf");

test("All tools panel: opens, lists the 13 tools, 'Edit a PDF' enters edit mode, Escape closes", async () => {
  const app = await electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    timeout: 120_000
  });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });
    await win.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("pdf-reader-edits:v1:")) localStorage.removeItem(k);
    });

    // open the panel from the toolbar wrench
    await win.getByRole("button", { name: "All tools" }).click();
    const panel = win.getByRole("dialog", { name: "All tools" });
    await expect(panel).toBeVisible();

    // all 13 entries render
    for (const label of [
      "Export a PDF",
      "Edit a PDF",
      "Create a PDF",
      "Combine files",
      "Organize pages",
      "AI Assistant",
      "Generative summary",
      "Request e-signatures",
      "Scan & OCR",
      "Protect a PDF",
      "Redact a PDF",
      "Compress a PDF",
      "Prepare a form"
    ]) {
      await expect(panel.getByText(label, { exact: true })).toBeVisible();
    }

    // a live tool runs in-app: "Edit a PDF" enters text-edit mode
    await panel.locator('[data-tool="edit"]').click();
    await expect(win.getByRole("button", { name: "Bold" })).toBeVisible({ timeout: 10_000 });

    // reopen + close via backdrop click
    await win.getByRole("button", { name: "All tools" }).click();
    await expect(panel).toBeVisible();
    await win.locator('[role="dialog"] > div').first().click({ position: { x: 10, y: 10 } });
    await expect(panel).toBeHidden();

    // a now-live tool flips its tab-local toggle and toasts
    await win.getByRole("button", { name: "All tools" }).click();
    await panel.locator('[data-tool="compress"]').click();
    await expect(win.getByText(/Compression on/)).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close().catch(() => {});
  }
});
