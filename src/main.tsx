import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { installWebBridgeIfNeeded } from "./lib/platform";

// plain browser (web build / PWA / Android WebView): no Electron preload,
// so install the browser fallback bridge before anything touches it
installWebBridgeIfNeeded();

async function bootstrap(): Promise<void> {
  if (window.location.protocol === "file:" && window.readerBridge?.getWorkerSource) {
    // Over file:// Chromium refuses to instantiate workers, so wrap the
    // pdf.js worker source in a blob URL (allowed by our CSP: worker-src blob:).
    const source = await window.readerBridge.getWorkerSource();
    if (source) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" })
      );
    }
  } else {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  }

  const root = document.getElementById("root");
  if (!root) throw new Error("#root missing");
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
