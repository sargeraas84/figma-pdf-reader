import { useEffect, useState } from "react";
import { Minus, Plus, Square, X } from "lucide-react";

export interface TabInfo {
  id: string;
  name: string;
}

interface Props {
  tabs: TabInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export default function TabBar({ tabs, activeId, onSelect, onClose, onNew }: Props) {
  const [platform, setPlatform] = useState<string>("darwin");
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.readerBridge.getPlatform().then(setPlatform).catch(() => {});
  }, []);
  useEffect(() => {
    window.readerBridge.winControls
      .isMaximized()
      .then((v) => {
        setMaximized(!!v);
      })
      .catch(() => {});
  }, [tabs.length]);

  const isMac = platform === "darwin";
  // Windows/Linux desktop draw custom window controls; the web build (and any
  // WebView) has no OS window chrome to control, so hide them there.
  const showWinControls = !isMac && platform !== "web" && platform !== "android-web";
  const isWeb = platform === "web" || platform === "android-web";

  return (
    <div
      className={`flex items-center bg-zinc-900 border-b border-zinc-800 select-none ${
        isMac ? "pl-[76px]" : isWeb ? "" : "pl-2"
      }`}
    >
      <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(t.id);
              }}
              className={`group flex items-center gap-2 max-w-[210px] shrink-0 cursor-default rounded-t-md px-3 -mb-px border-b-2 transition-colors no-drag ${
                active
                  ? "bg-zinc-800 border-zinc-800 text-white"
                  : "border-transparent text-zinc-400 hover:bg-zinc-800/60"
              }` }
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <span className="truncate py-1.5 text-[13px]" title={t.name}>
                {t.name || "Untitled"}
              </span>
              <button
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-zinc-400 hover:text-white p-0.5 rounded"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        <button
          aria-label="New tab"
          onClick={onNew}
          title="New tab (⌘T)"
          className="ml-1 p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded shrink-0 no-drag"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Plus size={15} />
        </button>
      </div>

      {showWinControls && (
        <div
          className="flex items-center no-drag"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            aria-label="Minimize"
            title="Minimize"
            onClick={() => window.readerBridge.winControls.minimize()}
            className="h-10 w-11 flex items-center justify-center text-zinc-300 hover:bg-zinc-800"
          >
            <Minus size={14} />
          </button>
          <button
            aria-label={maximized ? "Restore" : "Maximize"}
            title={maximized ? "Restore" : "Maximize"}
            onClick={async () => {
              await window.readerBridge.winControls.toggleMaximize();
              window.readerBridge.winControls
                .isMaximized()
                .then((v) => setMaximized(!!v))
                .catch(() => {});
            }}
            className="h-10 w-11 flex items-center justify-center text-zinc-300 hover:bg-zinc-800"
          >
            <Square size={12} />
          </button>
          <button
            aria-label="Close"
            title="Close"
            onClick={() => window.readerBridge.winControls.close()}
            className="h-10 w-11 flex items-center justify-center text-zinc-300 hover:bg-[#ff6b6b] hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
