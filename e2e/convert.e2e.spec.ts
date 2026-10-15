import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";

const fixturePath = path.join(__dirname, "..", "test-fixture.pdf");
const docxFixture = path.join(__dirname, "test-doc.docx");

test.beforeAll(() => {
  execFileSync("node", [path.join(__dirname, "fixtures", "make-docx.cjs")], { cwd: path.join(__dirname, "..") });
  expect(fs.existsSync(docxFixture), "docx fixture generated").toBe(true);
});

test("Word to PDF: picked .docx is rendered in a hidden window and opens as a PDF tab", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-w2p-"));
  const app = await electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PDF_READER_E2E_USER_DATA: tmp },
    timeout: 120_000
  });
  try {
    const win = await app.firstWindow();
    win.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text().slice(0, 250)); });
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });

    // stub the Word file picker to return our generated fixture
    await app.evaluate(({ dialog }, docxPath) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths: [docxPath] });
    }, docxFixture);

    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="word-to-pdf"]').click();

    // converted buffer opens as a new PDF tab with the .pdf name
    await expect(win.getByText(/Converted in /)).toBeVisible({ timeout: 120_000 });
    await expect(win.locator('[role="tab"][aria-selected="true"]')).toContainText(".pdf", { timeout: 30_000 });

    // the new tab loads through the normal PDF pipeline
    await win.waitForSelector('.doc-scroll:not([style*="display: none"]) [data-page="1"] canvas', { timeout: 60_000 });
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("PDF to Word: open pdf exports a .docx with extracted text", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-p2w-"));
  const savePath = path.join(tmp, "out.docx");

  const app = await electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PDF_READER_E2E_USER_DATA: tmp,
      // reuse the save-path hook; file:write accepts any path from our dialog
      PDF_READER_E2E_SAVE_PATH: savePath
    },
    timeout: 120_000
  });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".textLayer span", { timeout: 90_000 });
    await win.getByRole("button", { name: "All tools" }).click();
    await win.getByRole("dialog", { name: "All tools" }).locator('[data-tool="pdf-to-word"]').click();
    // the format chooser opens; Word (.docx) is the default selection
    await win.getByRole("dialog", { name: "Export the PDF as" }).waitFor({ timeout: 10_000 });
    await win.getByTestId("doc-format-go").click();

    await expect(win.getByText(/Saved Word document/)).toBeVisible({ timeout: 60_000 });

    // the saved .docx must be a valid OOXML zip containing the page-1 text
    const buf = fs.readFileSync(savePath);
    expect(buf.length).toBeGreaterThan(500);
    // a .docx is a zip: check PK header + the word/document.xml part
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    const JSZip: typeof import("jszip") = require("jszip");
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("banana"); // fixture page text
    // page break between the two fixture pages
    expect((xml.match(/w:br w:type="page"/g) || []).length).toBeLessThanOrEqual(2);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
