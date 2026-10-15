import { useState } from "react";
import { X } from "lucide-react";

/* ---------------- Split: page-range extraction ---------------- */

export function SplitModal({
  name,
  numPages,
  onSplit,
  onClose
}: {
  name: string;
  numPages: number;
  onSplit: (from: number, to: number) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState(String(Math.min(2, numPages)));
  const ok = () => onSplit(parseInt(from, 10) || 1, parseInt(to, 10) || 1);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Split pages">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[380px] p-5 text-zinc-900">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold">Split pages</h3>
            <p className="text-[12px] text-zinc-500 truncate max-w-[260px]">{name}</p>
          </div>
          <button aria-label="Close split dialog" onClick={onClose} className="p-1 rounded hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <label htmlFor="split-from">Pages</label>
          <input
            id="split-from"
            data-testid="split-from"
            type="number"
            min={1}
            max={numPages}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-16 border border-zinc-300 rounded px-2 py-1"
          />
          <span>to</span>
          <input
            id="split-to"
            data-testid="split-to"
            type="number"
            min={1}
            max={numPages}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-16 border border-zinc-300 rounded px-2 py-1"
          />
          <span className="text-zinc-400">of {numPages}</span>
        </div>
        <button
          onClick={ok}
          className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white text-[13px] font-medium rounded-md py-2"
        >
          Extract to a new document
        </button>
      </div>
    </div>
  );
}

/* ---------------- Export document (PDF → docx/txt/md/html) ---------------- */

export function ExportDocModal({
  name,
  onExport,
  onClose
}: {
  name: string;
  onExport: (format: "docx" | "txt" | "md" | "html") => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<"docx" | "txt" | "md" | "html">("docx");
  const opts: { id: "docx" | "txt" | "md" | "html"; label: string; desc: string }[] = [
    { id: "docx", label: "Word (.docx)", desc: "True paragraphs, headings and page breaks — editable in Word/Docs" },
    { id: "txt", label: "Plain text (.txt)", desc: "Raw text with page markers — universal" },
    { id: "md", label: "Markdown (.md)", desc: "Page sections separated by horizontal rules" },
    { id: "html", label: "Web page (.html)", desc: "Styled HTML, printable and openable anywhere" }
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Export the PDF as a document">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[420px] p-5 text-zinc-900">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold">Export this PDF as…</h3>
            <p className="text-[12px] text-zinc-500 truncate max-w-[290px]">{name}</p>
          </div>
          <button aria-label="Close export dialog" onClick={onClose} className="p-1 rounded hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2">
          {opts.map((o) => (
            <label
              key={o.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                format === o.id ? "border-indigo-500 bg-indigo-50" : "border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              <input
                type="radio"
                name="doc-format"
                className="mt-1"
                checked={format === o.id}
                onChange={() => setFormat(o.id)}
              />
              <span>
                <span className="block text-[13.5px] font-semibold">{o.label}</span>
                <span className="block text-[12px] text-zinc-500">{o.desc}</span>
              </span>
            </label>
          ))}
        </div>
        <button
          data-testid="doc-format-go"
          onClick={() => onExport(format)}
          className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-medium rounded-md py-2"
        >
          Export as {format.toUpperCase()}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Export pages as images ---------------- */

export function ExportImagesModal({
  name,
  numPages,
  onExport,
  onClose
}: {
  name: string;
  numPages: number;
  onExport: (opts: { format: "png" | "jpg"; quality: 1 | 2 | 3; from: number; to: number }) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<"png" | "jpg">("png");
  const [quality, setQuality] = useState<1 | 2 | 3>(2);
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState(String(numPages));
  const ok = () =>
    onExport({ format, quality, from: parseInt(from, 10) || 1, to: parseInt(to, 10) || 1 });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Export pages as images">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[400px] p-5 text-zinc-900">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold">Export pages as images</h3>
            <p className="text-[12px] text-zinc-500 truncate max-w-[280px]">{name}</p>
          </div>
          <button aria-label="Close export dialog" onClick={onClose} className="p-1 rounded hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center gap-3">
            <span className="text-zinc-500">Format</span>
            <label className="flex items-center gap-1">
              <input type="radio" name="img-format" checked={format === "png"} onChange={() => setFormat("png")} />
              PNG (lossless)
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="img-format" checked={format === "jpg"} onChange={() => setFormat("jpg")} />
              JPG (smaller)
            </label>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="img-quality" className="text-zinc-500">
              Resolution
            </label>
            <select
              id="img-quality"
              data-testid="img-quality"
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value, 10) as 1 | 2 | 3)}
              className="border border-zinc-300 rounded px-2 py-1"
            >
              <option value={1}>72 dpi (screen)</option>
              <option value={2}>144 dpi (2x)</option>
              <option value={3}>216 dpi (3x)</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Pages</span>
            <input
              data-testid="img-from"
              type="number"
              min={1}
              max={numPages}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-16 border border-zinc-300 rounded px-2 py-1"
            />
            <span>to</span>
            <input
              data-testid="img-to"
              type="number"
              min={1}
              max={numPages}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-16 border border-zinc-300 rounded px-2 py-1"
            />
            <span className="text-zinc-400">of {numPages}</span>
          </div>
        </div>
        <button
          onClick={ok}
          className="mt-4 w-full bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-medium rounded-md py-2"
        >
          Choose folder & export
        </button>
      </div>
    </div>
  );
}
