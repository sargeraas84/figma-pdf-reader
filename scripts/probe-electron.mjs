import { _electron } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "test-fixture.pdf");
const app = await _electron.launch({ args: [".", fixture], cwd: path.dirname(fixture), timeout: 60000 });
const win = await app.firstWindow();
await new Promise((r) => setTimeout(r, 8000));
const info = await win.evaluate(() => ({
  textLayers: document.querySelectorAll(".textLayer").length,
  spans: document.querySelectorAll(".textLayer span").length,
  canvases: document.querySelectorAll("canvas").length,
  hasEdit: !!document.querySelector('button[aria-label="Edit text"]'),
  rects: [...document.querySelectorAll(".textLayer span")]
    .slice(0, 3)
    .map((s) => { const r = s.getBoundingClientRect(); return [r.width, r.height]; })
}));
console.log(JSON.stringify(info, null, 2));

await win.locator('button[aria-label="Edit text"]').click();
await new Promise((r) => setTimeout(r, 3000));
const ready = await win.evaluate(() =>
  [...document.querySelectorAll('[data-page]')].map((p) => ({
    page: p.dataset.page,
    editReady: JSON.stringify(p.dataset.editReady ?? null),
    inDom: document.contains(p)
  }))
);
console.log("after edit mode →", JSON.stringify(ready, null, 2));
await app.close();
