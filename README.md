# Figma Reader

A full-featured desktop PDF reader built with **Electron + pdf.js + React + Tailwind**, styled after classic "Pro" PDF readers: a merged tabbed title bar, a main toolbar, and a thumbnails/bookmarks sidebar.

## Run it

```bash
npm install
npm run dev        # dev server hot-reload + Electron
```

Or run the production build:

```bash
npm run build
npm start          # or: npm run preview (build + run)
```

Typecheck:

```bash
npm run typecheck
```

Package installers (macOS dmg / Windows NSIS):

```bash
npm run package:mac
npm run package:win
```

## Features

- **Tabbed documents** — open several PDFs in tabs; drag & drop any PDF onto the window; OS "open with" on macOS.
- **Viewing** — continuous scroll, lazy page rendering, crisp devicePixelRatio canvases, dark shell UI.
- **Sidebar** — page thumbnails (lazily rendered) and PDF bookmarks/outlines (click to navigate).
- **Search** — full-document search with in-page highlight, next/previous match (`Enter` / `Shift+Enter`).
- **Zoom** — fit width, fit page, preset steps, custom zoom (Ctrl/⌘ +, –, 0).
- **Rotation** — rotate the whole document in 90° steps.
- **Print** — renders the full document off-screen, then opens the native print dialog.
- **Night mode** — inverts page content for comfortable reading (Ctrl/⌘⇧D).
- **Protected PDFs** — password prompt, including retry on wrong password.
- **Recents** — recent-file list persisted locally.
- **Keyboard & menu** — native application menu with accelerators (open, print, find, zoom, fit modes, sidebar, night mode).

- **Text editing** — pencil tool (Ctrl/⌘E): click a text run to rewrite it, click empty space to insert text; white-out + retyped overlays; **Save (Ctrl/⌘S)** bakes edits into real PDF bytes via pdf-lib (respecting original baseline/size/color geometry).
- **Highlighter tool** — switch to the highlighter, then select text on the page or **single-click a line** to highlight it whole (like the commercial PDF suite's tool); colored boxes (default yellow, adjustable in the toolbar) render live and are baked into the saved PDF as translucent rectangles.
- **Annotations sidebar** — a third sidebar tab lists every pending highlight and text edit per page with click-to-jump navigation and a clear-all button; it auto-opens when the first annotation lands. Rows have selection checkboxes with a batch bar: **Delete (n)** removes the selected annotations, **Move here** relocates them to the current page.
- **Annotation persistence** — pending annotations are saved per document (localStorage plus a durable main-process JSON store under `userData/pending-edits/`, so they survive hard kills where the browser store never flushed) and restored when the file is reopened; they are cleared once you save the PDF (they live in the file then).
- **Page organizing (drag-to-reorder)** — thumbnails can be dragged to a new position; the visual order, page numbers, pending annotations and current page all remap instantly, and **Save** bakes the new page order into the PDF bytes (pdf-lib `copyPages`/`removePage` before applying edits).
- **All tools panel** — a toolbar wrench opens an "All tools" drawer (Export, Edit, Create, Combine, Organize pages, AI Assistant, Generative summary, e-signatures, Scan & OCR, Protect, Redact, Compress, Prepare a form). Live tools run in-app; AI/summary/e-signature/OCR still show a "soon" badge (they need a cloud service).
- **Redact a PDF** — the redact tool drag-marks opaque knockout rectangles on any page (like the highlighter's rect flow); committed areas render as solid black boxes immediately, are listed in the Annotations sidebar, and are baked as fully opaque black fills on save so the covered content is unreadable in most viewers.
- **Protect a PDF** — sets an open password on the active tab (applied on the next save); the saved bytes are AES-encrypted via the `@cantoo/pdf-lib` fork and verify with the password in standard viewers.
- **Compress a PDF** — toggles a lossless shrink applied on save: metadata strip + object-stream re-write (reports the size delta as a toast).
- **Create a PDF** — builds a fresh 3-page blank lined A4 document in a new tab you can type into with the text tool and save.
- **Combine files** — multi-select PDFs in the open dialog; they merge (in picked order) into one combined document tab.
- **Prepare a form** — creates a form-template tab (labelled Name/Organization/Notes field boxes) you can type into with the text tool and save.
- **Word to PDF** — pick a `.docx` and it renders in a hidden Chromium window via `docx-preview` (fonts, headers/footers, page sizes honored) and prints to a real PDF with Chromium's print engine; the result opens as a normal PDF tab for review and saving. Fully local — no external binaries, no network.
- **PDF to Word** — exports the open PDF to a `.docx`: text is extracted per page with pdf.js, lines are reconstructed from baseline geometry and merged into paragraphs (a page-top centered large line becomes a Heading), and the `docx` package writes a real OOXML file with page breaks preserved. Text-faithful conversion — not a pixel-perfect layout clone.
- **PDF to PowerPoint** — one slide per page: the page renders to PNG (2x) into a 16:9 slide and the page's text goes into speaker notes, written with `pptxgenjs`.
- **Export pages as images** — modal picks format (PNG/JPG), resolution (72/144/216 dpi) and a page range; pages render in the renderer and are written through a folder-picker-guarded IPC channel (`images:pick-dir` + `images:write`, same whitelist pattern as `file:write`).
- **Split a PDF** — pick a page range; pdf-lib copies those pages into a brand-new document tab (the inverse of Combine files).
- **Pen tool** — draw freehand strokes with a color + width picker; strokes persist per document like other annotations (localStorage + durable file store), render as live SVG polylines, are listed in the Annotations sidebar, and bake into the saved PDF as round-cap line segments.
- **Editor fonts** — Helvetica, Times, Courier (built-in base-14) plus bundled **free (SIL OFL)** families: Roboto, Open Sans, Lato, Inter, Oswald, Merriweather — with bold, italic, **underline** and **strikethrough** toggles (underline/strike strokes are drawn with real font-metric widths on save). Live preview registers real `@font-face` fonts; saved PDFs embed the bundled fonts **subset**. Oswald lacks an italic face, so italic is synthesised with a 12° skew. Underline and strikethrough strokes use the font's own underline/StrikeOut metrics (OS/2 table for bundled TTFs, AFM-derived constants for the base-14 fonts). `scripts/copy-fonts.mjs` copies the TTFs from `@expo-google-fonts` packages into `public/fonts/`; the IPC channel `font:read` loads them through a whitelist validated against the shipped manifest.

## Testing

- `npm run test:e2e` — Playwright Electron E2E: launches the real app and covers the editor ([editor.e2e.spec.ts](e2e/editor.e2e.spec.ts)), highlight save + persistence round-trip ([highlight.e2e.spec.ts](e2e/highlight.e2e.spec.ts)), thumbnail drag-reorder with saved page order ([reorder.e2e.spec.ts](e2e/reorder.e2e.spec.ts)), the All tools panel ([tools.e2e.spec.ts](e2e/tools.e2e.spec.ts)), the redact/create/combine/protect tools ([tools-redact.e2e.spec.ts](e2e/tools-redact.e2e.spec.ts)), Word ⇄ PDF conversions ([convert.e2e.spec.ts](e2e/convert.e2e.spec.ts)), the PPTX/image/split/pen tools ([newtools.e2e.spec.ts](e2e/newtools.e2e.spec.ts)) and viewer basics ([view.e2e.spec.ts](e2e/view.e2e.spec.ts)). Saves use a test hook (`PDF_READER_E2E_SAVE_PATH` skips the native dialog) and every run gets an isolated profile (`PDF_READER_E2E_USER_DATA`) so automation never reads your real pending-annotation store, then verifies output PDF bytes.
- `npm run test:save` — headless save-pipeline check: bundles `src/lib` with esbuild and verifies the generated PDF embeds the bundled fonts, draws the underline/strike strokes, bakes redaction fills (SMOKE_REDACT_OK), round-trips password encryption (SMOKE_PROTECT_OK), merging (SMOKE_COMBINE_OK) and compression (SMOKE_COMPRESS_OK).

## Architecture

```
electron/main.cjs      main process: window, dialogs, file reading IPC, menus
electron/preload.cjs   context-isolated bridge (window.readerBridge)
src/lib/pdfjs.ts       pdf.js worker setup, page-size/outline helpers
src/lib/search.ts      full-text search producing per-item match ranges
src/components/        TabBar, Toolbar, Sidebar, DocumentView, PageView, …
src/App.tsx            tab state, loading flow, search/zoom/print orchestration
```

- Rendering: `pdfjs-dist` renders each page to a `<canvas>` (DPR-aware); a pdf.js `TextLayer` sits on top for selectable text and search highlight positioning.
- Large documents stay fast: pages/thumbnails render only when near the viewport (IntersectionObserver).
- Print: pages are rendered into a hidden print root, then `window.print()` prints them via dedicated `@media print` CSS.
- File data never touches disk twice: buffers are read in the main process and passed over IPC; drag-dropped files are read directly in the renderer.

## Notes & limits

- Bundle/name: "Figma Reader" is a name chosen for this project chosen for this project; it is not affiliated with any commercial product.
- Advanced features (annotation/editing/OCR/conversion/e-signature) are possible follow-ups on this same architecture.
- Redaction covers content with opaque black fills (render-level knockout); true content-stream rewriting is a possible follow-up.
## Android tablets & the web build (PWA)

The renderer is pure browser code talking to the desktop through one bridge (`window.readerBridge`), so the same UI runs on Android tablets (and any browser) from a static build:

- `npm run build:web` produces `dist/` — serve it over HTTPS and install it from Chrome on the tablet (PWA install prompt via [public/manifest.webmanifest](public/manifest.webmanifest), standalone display, app icons). `npm run serve:web` previews the build locally.
- [src/lib/platform.ts](src/lib/platform.ts) installs a browser **fallback bridge** at boot when Electron's preload is absent: file open/save use `<input type=file>` + Blob downloads (`savePdfDialog` + `writePdfFile` pair remains intact), fonts load over HTTP, windows controls/menu are no-ops, and **Export pages as images** collects the pages and hands back a single `.zip` download (mobile browsers have no directory picker and block serial downloads).
- Form-fill, text edit, highlight, redact, pen, split, PDF→Word/PPTX and Word→PDF-via-file-picker all work in the web build. Not available in a browser by design: the hidden-window Word→PDF converter, main-process OCR, and custom window controls — the desktop app covers those.
- Touch tuning (`@media (pointer: coarse)` in [src/styles.css](src/styles.css)): 40px+ hit targets, static edit-target outlines (no hover dependency), disabled double-tap zoom.
- Verified in a real browser: app mounts with the fallback bridge, PDF loads and renders with the real pdf.js worker (CSP `worker-src 'self' blob:` fix), save produces a named `.pdf` download.
- A packaged-store APK **is** available: the same `dist/` is wrapped with [Capacitor](../capacitor.config.json) (`webDir: dist`, `com.figma.reader.web`, https scheme). Build it with `npx cap sync android && cd android && ./gradlew assembleDebug` (needs JDK 21 + Android SDK — locally in `.tooling/`). Output: `android/app/build/outputs/apk/debug/app-debug.apk`, copied to `release/Figma-web-<version>-debug.apk`. Debug-signed → sideloadable but needs "install unknown apps" permission. All web assets, fonts and PWA icons are verified inside the APK.
- The live hosted copy is deployed as a Sites project (`Figma PDF Reader`, preview env): https://site-a74be38b49a24ea58c4ed7240321e4f3.freebuff.page — verified deployed; note that some managed networks (e.g. corporate Cloudflare Gateway) block that domain locally, so test on mobile data or a normal Wi-Fi.

## Packaging & installers

Build installers with `npm run package:win` / `npm run package:mac` (or `electron-builder --win|--mac --arch`, arch = `x64` / `arm64`).
Artifacts land in `release/`: Windows gets a NSIS installer plus a portable exe (`Figma-Setup-<version>-<arch>.exe`, `Figma-Portable-…exe`), macOS gets a DMG and zip per arch. The OCR model (`resources/tessdata`) is bundled via `extraResources`, so Scan & OCR works in the installed app with no network.

### Code signing

The build signs with whatever credentials you provide — nothing is hard-baked:

- **macOS:** electron-builder searches the keychain for a `Developer ID Application` identity. If you have one (requires the paid Apple Developer Program), the build is Developer-ID-signed automatically; add notarization credentials (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, or the `APPLE_API_KEY*` set) to also staple a notarization ticket. With **no** identity installed, the current default build exits ad-hoc-signed (`Signature=adhoc`) and launches fine locally — but Gatekeeper still blocks first open of a *downloaded* copy until the user right-click → Open or approves in Privacy & Security. To build with no signature at all, set `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- **Windows:** set `WIN_CSC_LINK=<path to .pfx>` and `WIN_CSC_KEY_PASSWORD=<pfx password>` (shared fallbacks: `CSC_LINK` / `CSC_KEY_PASSWORD`) to Authenticode-sign the NSIS/portable exes with a CA-issued OV/EV certificate. A self-signed cert satisfies completeness but **not** SmartScreen reputation — Microsoft docs treat it like unsigned. `forceCodeSigning` is `false`, so unsigned builds won't fail.
- Without any credentials everything still builds; artifacts are unsigned/ad-hoc as noted in this section.
