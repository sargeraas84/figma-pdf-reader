import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const fixturePath = path.join(__dirname, "..", "test-fixture.pdf");

async function launch() {
  const app = await electron.launch({
    args: [".", fixturePath],
    cwd: path.join(__dirname, ".."),
    timeout: 120_000
  });
  const win = await app.firstWindow();
  await win.waitForSelector(".textLayer span", { timeout: 90_000 });
  return { app, win };
}

test.describe("viewer behavior", () => {
  let app: ElectronApplication;
  let win: Page;

  test.beforeEach(async () => {
    ({ app, win } = await launch());
  });

  test.afterEach(async () => {
    await app.close().catch(() => {});
  });

  test("search finds matches and Enter steps through them", async () => {
    await win.getByRole("button", { name: /Search document/ }).click();
    const input = win.locator('input[placeholder="Search document…"]');
    await input.fill("banana");

    // status shows "active / total" once the search completes
    const status = win.getByText(/^\d+ \/ \d+$/);
    await status.waitFor({ timeout: 20_000 });
    const total = await status.textContent();
    expect(total).toMatch(/^1 \/ [2-9]$/);

    await input.press("Enter"); // next match
    await expect(status).toHaveText(/2 \/ /);
    await input.press("Shift+Enter"); // previous match
    await expect(status).toHaveText(/1 \/ /);
  });

  test("zoom controls and fit modes switch the zoom label", async () => {
    const zoomSelect = win.locator('select[aria-label="Zoom"]');
    await expect
      .poll(() => zoomSelect.evaluate((el: HTMLSelectElement) => el.value), { timeout: 10_000 })
      .toBe("Fit width");

    await win.getByRole("button", { name: "Zoom in" }).click();
    await expect
      .poll(() => zoomSelect.evaluate((el: HTMLSelectElement) => el.value), { timeout: 10_000 })
      .toMatch(/%$/);
    const afterZoomIn = await zoomSelect.evaluate((el: HTMLSelectElement) => el.value);
    expect(afterZoomIn).toBe("100%");

    await win.getByRole("button", { name: "Zoom in" }).click();
    expect(await zoomSelect.evaluate((el: HTMLSelectElement) => el.value)).toBe("110%");

    await win.getByRole("button", { name: "Zoom out" }).click();
    expect(await zoomSelect.evaluate((el: HTMLSelectElement) => el.value)).toBe("100%");

    const before = await win.locator('[data-page="1"]').evaluate((el) => el.getBoundingClientRect().width);
    await zoomSelect.selectOption("Fit page");
    await expect
      .poll(() => zoomSelect.evaluate((el: HTMLSelectElement) => el.value), { timeout: 10_000 })
      .toBe("Fit page");
    const after = await win.locator('[data-page="1"]').evaluate((el) => el.getBoundingClientRect().width);
    expect(after).toBeLessThanOrEqual(before); // fit page must not exceed fit width footprint
  });

  test("new tab and re-opening the same file stays in one tab per path", async () => {
    await win.getByRole("button", { name: "New tab" }).click();
    // a new tab shows its loading overlay (empty state only appears with zero tabs)
    await expect(win.getByText("Loading…", { exact: true })).toBeVisible();
    const tabs = win.getByRole("tab");
    await expect(tabs).toHaveCount(2);

    // switch back to the document tab
    await win.getByRole("tab").first().click();
    await expect(win.locator(".textLayer").first()).toBeVisible();

    // second tab from re-opening the same path must focus existing tab instead
    const buf = fs.readFileSync(fixturePath).toString("base64");
    await win.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([new Blob([bytes])], "test-fixture.pdf", { type: "application/pdf" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
    }, buf);
    await expect(win.getByRole("tab")).toHaveCount(2); // no third tab
  });
});
