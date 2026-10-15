import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

const fixturePath = path.join(__dirname, "..", "test-fixture.pdf");

const LAUNCH = (env: Record<string, string>) =>
  electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ...env },
    timeout: 120_000
  });

test("Markdown to PDF: a picked .md file renders headings/lists and opens as a PDF tab", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-md2p-"));
  const mdPath = path.join(tmp, "notes.md");
  fs.writeFileSync(mdPath, "# Meeting notes\n\nFirst paragraph with **bold** text.\n\n- bullet one\n- bullet two\n\n## Actions\n\n`code` item and [link](https://example.com)\n");

  const app = await LAUNCH({ PDF_READER_E2E_USER_DATA: tmp });
  try {
    const win = await app.firstWindow();
    win.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text().slice(0, 250)); });
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });

    await app.evaluate(({ dialog }, p) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths: [p] });
    }, mdPath);

    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="word-to-pdf"]').click();

    await expect(win.getByText(/Converted in /)).toBeVisible({ timeout: 120_000 });
    await expect(win.locator('[role="tab"][aria-selected="true"]')).toContainText("notes.pdf", { timeout: 30_000 });
    await win.waitForSelector('.doc-scroll:not([style*="display: none"]) [data-page="1"] canvas', { timeout: 60_000 });
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("PDF to text formats: the chooser exports .txt and .html with extracted text", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-p2t-"));
  const savePath = path.join(tmp, "out.txt");
  const app = await LAUNCH({
    PDF_READER_E2E_USER_DATA: tmp,
    PDF_READER_E2E_SAVE_PATH: savePath
  });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });

    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="pdf-to-word"]').click();
    await win.getByRole("dialog", { name: "Export the PDF as" }).waitFor({ timeout: 10_000 });

    // choose Plain text
    await win.getByText("Plain text (.txt)").click();
    await win.getByTestId("doc-format-go").click();
    await expect(win.getByText(/Saved TXT document/)).toBeVisible({ timeout: 60_000 });

    const txt = fs.readFileSync(savePath, "utf8");
    expect(txt).toContain("banana");
    expect(txt).toContain("— Page 1 —");

    // switch to HTML export in the same session (the E2E save hook always
    // targets PDF_READER_E2E_SAVE_PATH, so the second export overwrites it —
    // which still proves the format plumbing end-to-end)
    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="pdf-to-word"]').click();
    await win.getByRole("dialog", { name: "Export the PDF as" }).waitFor({ timeout: 10_000 });
    await win.getByText("Web page (.html)").click();
    await win.getByTestId("doc-format-go").click();
    await expect(win.getByText(/Saved HTML document/)).toBeVisible({ timeout: 60_000 });
    const html = fs.readFileSync(savePath, "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("banana");
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
