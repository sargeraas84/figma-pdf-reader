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
