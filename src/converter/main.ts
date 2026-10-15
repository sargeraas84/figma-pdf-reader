// Hidden-window document converter for → PDF.
// The main process loads this page (converter.html), injects the file bytes,
// we render them into DOM (docx-preview for .docx; plain HTML for text 
// formats: .txt/.md wrapped in <pre>/<rendered markdown>, .html parsed, .csv
// tabulated, .rtf stripped) and report back over the convBridge preload so
// main knows when to printToPDF().
//
// Message contract:
//   main → renderer: { type: "convert", data: ArrayBuffer, sourceType: "docx"|"txt"|"md"|"html"|"csv"|"rtf" }
//   renderer → main: { type: "ready" } | { type: "done" } | { type: "error", message }
//
// Minimal markdown rendering — headings, bold/italic/code, lists, links, hr.
// Enough for common docs; no full CommonMark compliance by design (kept local,
// dependency-free). For richer fidelity, export from the source app.

import { renderAsync } from "docx-preview";

export interface ConvertMsg {
  type: "convert";
  data?: ArrayBuffer | Uint8Array;
  sourceType?: string;
}

declare global {
  interface Window {
    convBridge: {
      onMessage(cb: (msg: { type: string; data?: ArrayBuffer | Uint8Array }) => void): () => void;
      send(detail: unknown): void;
    };
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function mdInline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*(?![*])/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(md: string): string {
  const out: string[] = [];
  let inList: "ul" | "ol" | null = null;
  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
  let inCode = false;
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (/^```/.test(line)) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { closeList(); out.push("<pre style=\"border:1px solid #ddd;padding:10px;border-radius:6px;overflow:auto;\"><code>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(esc(rawLine)); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); continue; }
    if (/^(---+|===+|\*\*\*+)\s*$/.test(line)) { closeList(); out.push("<hr>"); continue; }
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ul) { if (inList !== "ul") { closeList(); out.push("<ul>"); inList = "ul"; } out.push(`<li>${mdInline(ul[1])}</li>`); continue; }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) { if (inList !== "ol") { closeList(); out.push("<ol>"); inList = "ol"; } out.push(`<li>${mdInline(ol[1])}</li>`); continue; }
    if (/^>\s?/.test(line)) { closeList(); out.push(`<blockquote style="border-left:4px solid #e0e0e0;margin:8px 0;padding-left:12px;color:#444;">${mdInline(line.replace(/^>\s?/, ""))}</blockquote>`); continue; }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out.push(`<p>${mdInline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

function csvToHtml(text: string): string {
  const table = text.split(/\r?\n/).filter((r) => r.trim().length).slice(0, 400)
    .map((row) => {
      const cells: string[] = [];
      let cur = ""; let inQ = false;
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === '"') { if (inQ && row[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
        else if (c === ',' && !inQ) { cells.push(cur); cur = ""; }
        else cur += c;
      }
      cells.push(cur);
      return `<tr>${cells.map((c) => `<td style="padding:4px 10px;border:1px solid #ddd;">${esc(c.trim())}</td>`).join("")}</tr>`;
    })
    .join("\n");
  return `<table style="border-collapse:collapse;font-family:sans-serif;font-size:11pt;margin:20px auto;">${table}</table>`;
}

function rtfToPlaintext(rtf: string): string {
  return rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\{\\\*?[^{}]*\}/g, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .trim();
}

async function renderSourceDoc(bytes: Uint8Array, type: string, container: HTMLDivElement) {
  if (type === "docx") {
    await renderAsync(bytes.buffer as ArrayBuffer, container, undefined, {
      inWrapper: true, ignoreWidth: false, ignoreHeight: false,
      breakPages: true, renderHeaders: true, renderFooters: true, useBase64URL: true
    });
    return;
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let html: string;
  if (type === "md") html = markdownToHtml(text);
  else if (type === "csv") html = csvToHtml(text);
  else if (type === "html") html = text.replace(/<!(doctype|DOCTYPE)[^>]*>/, "");
  else if (type === "rtf") html = `<pre style="font-family:serif;font-size:12pt;white-space:pre-wrap;font-family:Georgia,serif;font-size:11pt;white-space:pre-wrap;">${esc(rtfToPlaintext(text))}</pre>`;
  else html = `<pre style="font-family:sans-serif;font-size:11pt;white-space:pre-wrap;">${esc(text)}</pre>`;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  container.innerHTML = bodyMatch ? bodyMatch[1] : html;
}

function report(type: "ready" | "done" | "error", message?: string) {
  window.convBridge.send(JSON.stringify({ type, message }));
}

/** Byte sniffing: never trust type labels alone. Word .docx files are ZIP
 * archives (PK\x03\x04); legacy .doc starts with D0 CF 11 E0 (OLE). Anything
 * else labelled docx gets rendered as plain text instead of exploding with a
 * JSZip "not a zip file" error. */
function sniffSourceType(bytes: Uint8Array, declared: string): string {
  if (bytes.length >= 4) {
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    if (declared === "docx") return isZip || isOle ? "docx" : "txt";
    if (isZip) return "docx";
    if (isOle) return "docx";
  }
  if (declared && declared !== "docx") return declared;
  // no useful declaration or magic: guess from content
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 800));
  if (/^\{\\rtf/.test(head)) return "rtf";
  if (/^\s*</.test(head)) return "html";
  if (/^#{1,6}\s|^-\s|\n#{1,6}\s/.test(head)) return "md";
  return declared || "txt";
}

async function run(input: ArrayBuffer | Uint8Array, declaredType: string) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const sourceType = sniffSourceType(data, declaredType);
  const prev = document.getElementById("docx-root");
  if (prev) prev.remove();
  const container = document.createElement("div");
  container.id = "docx-root";
  document.body.appendChild(container);
  try {
    await renderSourceDoc(data, sourceType, container);
  } catch (err) {
    const msg = `${(err as Error)?.message || String(err)} [decided=${sourceType} declared=${declaredType} first=${Array.from(data.slice(0, 2)).join(",")}]`;
    report("error", msg);
    return;
  }
  report("done");
}

window.convBridge.onMessage((msg) => {
  if (msg?.type !== "convert" || !(msg.data instanceof ArrayBuffer || msg.data instanceof Uint8Array)) return;
  const sourceType = typeof (msg as ConvertMsg).sourceType === "string" ? (msg as ConvertMsg).sourceType! : "docx";
  run(msg.data, sourceType).catch((err: Error) => report("error", err?.message || String(err)));
});

report("ready"); // scripts loaded — ready to accept convert messages
