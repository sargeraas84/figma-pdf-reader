import {
  FileOutput,
  FileEdit,
  FilePlus,
  Combine,
  LayoutList,
  MessageSquareDot,
  Sparkles,
  FileSignature,
  ScanText,
  ShieldCheck,
  Eraser,
  FileArchive,
  ClipboardCheck,
  FileCode,
  FileType2,
  Presentation,
  FileImage,
  Scissors,
  X
} from "lucide-react";

export type ToolId =
  | "export"
  | "edit"
  | "create"
  | "combine"
  | "organize"
  | "ai"
  | "summary"
  | "esign"
  | "ocr"
  | "protect"
  | "redact"
  | "compress"
  | "prepare-form"
  | "word-to-pdf"
  | "pdf-to-word"
  | "pdf-to-pptx"
  | "export-images"
  | "split";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: React.ReactNode;
  /** color accent, tailwind arbitrary text color */
  accent: string;
  /** when true the tool runs in-app today; otherwise it shows a coming-soon note */
  live?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: "export", label: "Export a PDF", icon: <FileOutput size={20} />, accent: "text-teal-600", live: true },
  { id: "edit", label: "Edit a PDF", icon: <FileEdit size={20} />, accent: "text-pink-600", live: true },
  { id: "create", label: "Create a PDF", icon: <FilePlus size={20} />, accent: "text-red-600", live: true },
  { id: "combine", label: "Combine files", icon: <Combine size={20} />, accent: "text-blue-600", live: true },
  { id: "organize", label: "Organize pages", icon: <LayoutList size={20} />, accent: "text-lime-600", live: true },
  { id: "ocr", label: "Scan & OCR", icon: <ScanText size={20} />, accent: "text-emerald-600", live: true },
  { id: "protect", label: "Protect a PDF", icon: <ShieldCheck size={20} />, accent: "text-blue-700", live: true },
  { id: "redact", label: "Redact a PDF", icon: <Eraser size={20} />, accent: "text-pink-700", live: true },
  { id: "compress", label: "Compress a PDF", icon: <FileArchive size={20} />, accent: "text-orange-600", live: true },
  { id: "prepare-form", label: "Prepare a form", icon: <ClipboardCheck size={20} />, accent: "text-cyan-700", live: true },
  { id: "word-to-pdf", label: "Documents to PDF", icon: <FileCode size={20} />, accent: "text-blue-800", live: true },
  { id: "pdf-to-word", label: "Export as document…", icon: <FileType2 size={20} />, accent: "text-indigo-800", live: true },
  { id: "pdf-to-pptx", label: "PDF to PowerPoint", icon: <Presentation size={20} />, accent: "text-orange-700", live: true },
  { id: "export-images", label: "Export pages as images", icon: <FileImage size={20} />, accent: "text-teal-700", live: true },
  { id: "split", label: "Split a PDF", icon: <Scissors size={20} />, accent: "text-rose-700", live: true },
  { id: "ai", label: "AI Assistant", icon: <MessageSquareDot size={20} />, accent: "text-violet-600" },
  { id: "summary", label: "Generative summary", icon: <Sparkles size={20} />, accent: "text-indigo-600" },
  { id: "esign", label: "Request e-signatures", icon: <FileSignature size={20} />, accent: "text-fuchsia-600" }
];

export default function ToolsPanel({
  open,
  onClose,
  onRunTool
}: {
  open: boolean;
  onClose: () => void;
  onRunTool: (id: ToolId) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="All tools">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute top-3 right-3 bottom-3 w-[320px] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-xl font-bold text-zinc-900">All tools</h2>
          <button
            aria-label="Close all tools"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <ul>
            {TOOLS.map((t) => (
              <li key={t.id}>
                <button
                  data-tool={t.id}
                  onClick={() => onRunTool(t.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-100 text-left"
                  title={t.live ? t.label : `${t.label} — coming soon`}
                >
                  <span className={`${t.accent} shrink-0`}>{t.icon}</span>
                  <span className="text-[15px] text-zinc-900">{t.label}</span>
                  {!t.live && (
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-400 border border-zinc-200 rounded px-1.5 py-0.5">
                      soon
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-zinc-200 px-5 py-2 text-[11px] text-zinc-400">
          Live tools run in-app. Documents ⇄ PDF supports Word, text, Markdown, HTML, CSV and RTF.
        </div>
      </div>
    </div>
  );
}
