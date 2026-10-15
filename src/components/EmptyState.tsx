import { useEffect, useState } from "react";
import { FileText, FolderOpen, X } from "lucide-react";

interface Recent {
  path: string;
  name: string;
}

export default function EmptyState({ onOpenDialog, onOpenPath }: { onOpenDialog: () => void; onOpenPath: (path: string) => void }) {
  const [recents, setRecents] = useState<Recent[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pdf-reader-recents");
      if (raw) setRecents(JSON.parse(raw) as Recent[]);
    } catch {
      /* ignore */
    }
  }, []);

  const removeRecent = (path: string) => {
    const next = recents.filter((r) => r.path !== path);
    setRecents(next);
    localStorage.setItem("pdf-reader-recents", JSON.stringify(next));
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-zinc-950">
      <div className="w-[420px] flex flex-col items-center text-center">
        <div
          className="w-40 h-40 rounded-3xl mb-6 flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(51,65,85,0.6)"
          }}
        >
          {/* prism emblem from the logo: cyan left split, coral right split + L base, dashed light ray */}
          <svg width="64" height="72" viewBox="0 0 128 140" fill="none" aria-hidden>
            <defs>
              <linearGradient id="esCoral" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#FF6B6B" />
                <stop offset="1" stopColor="#FF8E53" />
              </linearGradient>
            </defs>
            <path d="M 60 10 L 10 90 L 60 90 Z" fill="#38BDF8" opacity={0.85} />
            <path d="M 60 10 L 110 90 L 60 90 Z" fill="url(#esCoral)" />
            <path d="M 10 90 L 110 90 L 110 115 C 110 120.52 105.52 125 100 125 L 25 125 C 16.72 125 10 118.28 10 110 Z" fill="url(#esCoral)" />
            <line x1="60" y1="10" x2="60" y2="140" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" opacity={0.7} strokeDasharray="6 6" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-white mb-2">Figma</h1>
        <p className="text-sm text-zinc-400 mb-6">Open a PDF to get started — or drop one anywhere in the window.</p>
        <button
          onClick={onOpenDialog}
          className="flex items-center gap-2 text-white font-medium px-5 py-2.5 rounded-lg transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)" }}
        >
          <FolderOpen size={16} /> Open PDF…
          <span className="text-xs opacity-60 font-normal">⌘O</span>
        </button>

        {recents.length > 0 && (
          <div className="mt-8 w-full text-left">
            <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2 px-1">Recent files</p>
            <ul className="space-y-0.5">
              {recents.slice(0, 6).map((r) => (
                <li key={r.path} className="group flex items-center gap-2 rounded-md hover:bg-zinc-800/70 px-2">
                  <FileText size={14} className="text-zinc-500 shrink-0" />
                  <button
                    onClick={() => onOpenPath(r.path)}
                    className="flex-1 min-w-0 text-left text-[13px] text-zinc-300 hover:text-white truncate py-1.5"
                    title={r.path}
                  >
                    {r.name}
                  </button>
                  <button
                    onClick={() => removeRecent(r.path)}
                    aria-label="Remove from recents"
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
