import { useEffect, useRef, useState } from "react";
import { ScanText, Copy, X, LoaderCircle } from "lucide-react";

export default function OcrModal({
  name,
  page,
  busy,
  text,
  onClose
}: {
  name: string;
  page: number;
  busy: boolean;
  text: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!busy && text) textRef.current?.scrollTo({ top: 0 });
  }, [busy, text]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[560px] max-h-[80vh] shadow-2xl flex flex-col"
        role="dialog"
        aria-label="Scan and OCR"
      >
        <div className="flex items-center gap-2 mb-2 text-white">
          <ScanText size={16} className="text-emerald-400" />
          <h2 className="font-semibold">Scan &amp; OCR — {name}</h2>
          <button
            aria-label="Close OCR"
            onClick={onClose}
            className="ml-auto p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-[12px] text-zinc-500 mb-3">
          Recognising page {page} locally (offline WASM engine, no cloud).
        </p>
        {busy ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-zinc-400 text-sm py-10">
            <LoaderCircle size={18} className="animate-spin" /> Recognising text…
          </div>
        ) : (
          <>
            <pre
              ref={textRef}
              className="flex-1 overflow-auto whitespace-pre-wrap bg-zinc-950 border border-zinc-800 rounded-md p-3 text-[13px] text-zinc-200 max-h-[50vh] mb-3"
            >
              {text && text.trim() ? text : "(no text found on this page)"}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  if (text) {
                    void navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
                disabled={!text?.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                <Copy size={13} /> {copied ? "Copied!" : "Copy text"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
