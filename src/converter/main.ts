// Hidden-window converter for Word → PDF.
// The main process loads this page (converter.html), injects the .docx bytes,
// docx-preview renders them into DOM sections, and we report back over the
// convBridge preload so main knows when to printToPDF().
//
// Message contract:
//   main → renderer: { type: "convert", data: ArrayBuffer }
//   renderer → main: { type: "ready" } | { type: "done" } | { type: "error", message }

import { renderAsync } from "docx-preview";

declare global {
  interface Window {
    convBridge: {
      onMessage(cb: (msg: { type: string; data?: ArrayBuffer | Uint8Array }) => void): () => void;
      send(detail: unknown): void;
    };
  }
}

function report(type: "ready" | "done" | "error", message?: string) {
  window.convBridge.send(JSON.stringify({ type, message }));
}

async function run(input: ArrayBuffer | Uint8Array) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const container = document.createElement("div");
  container.id = "docx-root";
  document.body.appendChild(container);
  await renderAsync(data, container, undefined, {
    // docx-preview honors each section's page size, margins and headers/footers
    // from the document itself; options below only affect defaults it can't read
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    useBase64URL: true
  });
  report("done");
}

window.convBridge.onMessage((msg) => {
  if (msg?.type !== "convert" || !(msg.data instanceof ArrayBuffer || msg.data instanceof Uint8Array)) return;
  run(msg.data).catch((err: Error) => report("error", err?.message || String(err)));
});

report("ready"); // scripts loaded — ready to accept convert messages
