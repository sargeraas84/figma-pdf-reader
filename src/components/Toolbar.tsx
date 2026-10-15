import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Moon,
  PanelLeft,
  PencilLine,
  PenTool,
  Printer,
  RotateCw,
  Save,
  Search,
  SquareSlash,
  Strikethrough,
  Sun,
  Underline,
  Undo2,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type { SearchState } from "./TabBarTypes";
import { FONT_CHOICES, findFontChoice } from "../lib/fonts";

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export type ZoomMode = "fit-width" | "fit-page" | "custom";

function ToolbarButton({
  children,
  label,
  onClick,
  active,
  disabled
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`p-1.5 rounded-md transition-colors ${
        active ? "bg-zinc-700 text-white" : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
      } disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}

interface Props {
  zoomMode: ZoomMode;
  zoomValue: number;
  page: number;
  numPages: number;
  nightMode: boolean;
  sidebarOpen: boolean;
  searchOpen: boolean;
  search: SearchState | null;
  onPrevPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomSelect: (mode: ZoomMode, value?: number) => void;
  onRotate: () => void;
  onToggleNight: () => void;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onSearchQuery: (q: string) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  onPrint: () => void;
  /* text editing */
  editMode: boolean;
  canUndo: boolean;
  onToggleEdit: () => void;
  onUndo: () => void;
  onSave: () => void;
  textColor: string;
  onTextColor: (c: string) => void;
  textSizePt: number;
  onTextSizePt: (pt: number) => void;
  editFontFamily: string;
  onEditFontFamily: (id: string) => void;
  editTextBold: boolean;
  onEditTextBold: (b: boolean) => void;
  editTextItalic: boolean;
  onEditTextItalic: (b: boolean) => void;
  editTextUnderline: boolean;
  onEditTextUnderline: (b: boolean) => void;
  editTextStrike: boolean;
  onEditTextStrike: (b: boolean) => void;
  editTool: "text" | "highlight" | "redact" | "pen";
  onEditTool: (tool: "text" | "highlight" | "redact" | "pen") => void;
  highlightColor: string;
  onHighlightColor: (c: string) => void;
  penColor?: string;
  onPenColor?: (c: string) => void;
  penWidth?: number;
  onPenWidth?: (w: number) => void;
  /* tools panel */
  toolsOpen: boolean;
  onToggleTools: () => void;
}

const zoomIcon = <span className="text-[15px] font-semibold px-0.5">–</span>;

function searchStatusText(s: SearchState | null): string {
  if (!s) return "";
  if (s.searching) return "searching…";
  if (!s.query.trim()) return "";
  if (s.matches.length === 0) return "no matches";
  return `${s.active + 1} / ${s.matches.length}`;
}

export default function Toolbar(p: Props) {
  // on macOS the window uses hiddenInset: the traffic lights sit over the
  // toolbar row, so keep a left gutter clear of them (tabbar does the same)
  const [platform, setPlatform] = useState<string>(
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "darwin" : "other"
  );
  useEffect(() => {
    window.readerBridge.getPlatform().then(setPlatform).catch(() => {});
  }, []);
  const isMac = platform === "darwin";

  const zoomLabel =
    p.zoomMode === "custom"
      ? `${Math.round(p.zoomValue * 100)}%`
      : p.zoomMode === "fit-width"
        ? "Fit width"
        : "Fit page";

  const stepZoom = (dir: 1 | -1) => {
    if (p.zoomMode !== "custom") {
      p.onZoomSelect("custom", 1);
      return;
    }
    const cur = p.zoomValue;
    if (dir === 1) {
      const next = ZOOM_STEPS.find((z) => z > cur + 0.001);
      p.onZoomSelect("custom", next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    } else {
      let candidate = ZOOM_STEPS[0];
      for (const z of ZOOM_STEPS) if (z < cur - 0.001) candidate = z;
      p.onZoomSelect("custom", candidate);
    }
  };

  return (
    <div
      className={`flex items-center gap-1 pr-2.5 bg-zinc-900/95 border-b border-zinc-800 text-[13px] select-none ${
        isMac ? "pl-[76px]" : "px-2.5"
      }`}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <ToolbarButton label="Toggle sidebar" onClick={p.onToggleSidebar} active={p.sidebarOpen}>
        <PanelLeft size={17} />
      </ToolbarButton>
      <ToolbarButton label="Previous page" onClick={p.onPrevPage} disabled={p.page <= 1}>
        <ChevronLeft size={17} />
      </ToolbarButton>
      <input
        aria-label="Go to page"
        title="Current page — type a number and press Enter"
        className="w-12 text-center bg-zinc-800 border border-zinc-700 rounded-md py-0.5 text-zinc-200 focus:border-zinc-500 outline-none"
        value={p.page}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= 1) p.onGoToPage(n);
        }}
      />
      <span className="text-zinc-500">/ {p.numPages}</span>
      <ToolbarButton label="Next page" onClick={p.onNextPage} disabled={p.page >= p.numPages}>
        <ChevronRight size={17} />
      </ToolbarButton>

      <div className="w-px h-5 bg-zinc-800 mx-1" />

      {p.searchOpen ? (
        <div className="flex items-center gap-1.5 bg-zinc-800 rounded-md px-2 py-0.5">
          <Search size={14} className="text-zinc-400" />
          <input
            autoFocus
            placeholder="Search document…"
            className="bg-transparent outline-none text-zinc-100 w-56 placeholder:text-zinc-500"
            value={p.search?.query ?? ""}
            onChange={(e) => p.onSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) p.onPrevMatch();
                else p.onNextMatch();
              } else if (e.key === "Escape") {
                p.onCloseSearch();
              }
            }}
          />
          <span className="text-[11px] text-zinc-500 whitespace-nowrap">{searchStatusText(p.search)}</span>
          <button className="text-zinc-400 hover:text-white" onClick={p.onCloseSearch} aria-label="Close search">
            <X size={14} />
          </button>
        </div>
      ) : (
        <ToolbarButton label="Search document (Ctrl/⌘F)" onClick={p.onOpenSearch}>
          <Search size={17} />
        </ToolbarButton>
      )}

      <div className="w-px h-5 bg-zinc-800 mx-1" />

      <ToolbarButton label="Zoom out" onClick={() => stepZoom(-1)}>
        {zoomIcon}
      </ToolbarButton>
      <select
        aria-label="Zoom"
        className="bg-zinc-800 border border-zinc-700 rounded-md py-0.5 text-zinc-200 cursor-pointer outline-none pr-1.5 pl-1.5"
        value={zoomLabel}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "Fit width") p.onZoomSelect("fit-width");
          else if (v === "Fit page") p.onZoomSelect("fit-page");
          else p.onZoomSelect("custom", parseInt(v, 10) / 100);
        }}
      >
        {["Fit width", "Fit page", ...ZOOM_STEPS.map((z) => `${Math.round(z * 100)}%`)].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ToolbarButton label="Zoom in" onClick={() => stepZoom(1)}>
        <span className="text-[15px] font-semibold px-0.5">+</span>
      </ToolbarButton>

      <div className="w-px h-5 bg-zinc-800 mx-1" />
      <ToolbarButton label="Rotate clockwise" onClick={p.onRotate}>
        <RotateCw size={16} />
      </ToolbarButton>

      <div className="w-px h-5 bg-zinc-800 mx-1" />
      <ToolbarButton
        label="Edit text"
        onClick={p.onToggleEdit}
        active={p.editMode && p.editTool === "text"}
      >
        <PencilLine size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Highlight text (select text while active)"
        active={p.editMode && p.editTool === "highlight"}
        onClick={() => p.onEditTool(p.editTool === "highlight" ? "text" : "highlight")}
      >
        <Highlighter size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Redact (drag a rect to black out content)"
        active={p.editMode && p.editTool === "redact"}
        onClick={() => p.onEditTool(p.editTool === "redact" ? "text" : "redact")}
      >
        <SquareSlash size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Pen (draw freehand strokes)"
        active={p.editMode && p.editTool === "pen"}
        onClick={() => p.onEditTool(p.editTool === "pen" ? "text" : "pen")}
      >
        <PenTool size={16} />
      </ToolbarButton>
      {p.editMode && (
        <>
          <select
            aria-label="Font"
            title="Font (free, open-licensed families are embedded on save)"
            className="bg-zinc-800 border border-zinc-700 rounded-md py-0.5 text-zinc-200 cursor-pointer outline-none pr-1.5 pl-1.5 max-w-32"
            value={p.editFontFamily}
            onChange={(e) => p.onEditFontFamily(e.target.value)}
          >
            {FONT_CHOICES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <ToolbarButton
            label="Bold"
            active={p.editTextBold}
            onClick={() => p.onEditTextBold(!p.editTextBold)}
          >
            <span className="font-bold w-3.5">B</span>
          </ToolbarButton>
          <ToolbarButton
            label={findFontChoice(p.editFontFamily).italicSupported ? "Italic" : "Italic not available for this font"}
            disabled={!findFontChoice(p.editFontFamily).italicSupported}
            active={p.editTextItalic}
            onClick={() => p.onEditTextItalic(!p.editTextItalic)}
          >
            <span className="italic w-3.5">I</span>
          </ToolbarButton>
          <ToolbarButton
            label="Underline"
            active={p.editTextUnderline}
            onClick={() => p.onEditTextUnderline(!p.editTextUnderline)}
          >
            <Underline size={15} />
          </ToolbarButton>
          <ToolbarButton
            label="Strikethrough"
            active={p.editTextStrike}
            onClick={() => p.onEditTextStrike(!p.editTextStrike)}
          >
            <Strikethrough size={15} />
          </ToolbarButton>
          <label
            title={p.editTool === "highlight" ? "Highlight color" : p.editTool === "pen" ? "Pen color" : "Text color"}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-zinc-800 cursor-pointer"
          >
            <input
              type="color"
              value={
                p.editTool === "highlight"
                  ? p.highlightColor
                  : p.editTool === "pen"
                    ? p.penColor
                    : p.textColor
              }
              onChange={(e) =>
                p.editTool === "highlight"
                  ? p.onHighlightColor(e.target.value)
                  : p.editTool === "pen"
                    ? p.onPenColor!(e.target.value)
                    : p.onTextColor(e.target.value)
              }
              className="w-3.5 h-3.5 p-0 border-0 bg-transparent cursor-pointer appearance-none"
              aria-label={p.editTool === "highlight" ? "Highlight color" : p.editTool === "pen" ? "Pen color" : "Text color"}
            />
          </label>
          {p.editTool === "pen" && (
            <input
              type="number"
              min={1}
              max={24}
              value={p.penWidth ?? 2}
              onChange={(e) =>
                p.onPenWidth!(Math.max(1, Math.min(24, parseInt(e.target.value, 10) || 2)))
              }
              title="Pen width (points)"
              aria-label="Pen width in points"
              className="w-12 text-center bg-zinc-800 border border-zinc-700 rounded-md py-0.5 text-zinc-200 outline-none"
            />
          )}
          <input
            type="number"
            min={4}
            max={96}
            value={p.textSizePt}
            onChange={(e) => p.onTextSizePt(Math.max(4, Math.min(96, parseInt(e.target.value, 10) || 12)))}
            title="New text size (points)"
            aria-label="New text size in points"
            className="w-12 text-center bg-zinc-800 border border-zinc-700 rounded-md py-0.5 text-zinc-200 outline-none"
          />
          <ToolbarButton label="Undo last edit" onClick={p.onUndo} disabled={!p.canUndo}>
            <Undo2 size={15} />
          </ToolbarButton>
        </>
      )}

      <div className="flex-1" />

      <ToolbarButton label={p.nightMode ? "Day mode" : "Night mode"} onClick={p.onToggleNight} active={p.nightMode}>
        {p.nightMode ? <Sun size={16} /> : <Moon size={16} />}
      </ToolbarButton>
      <ToolbarButton label="Save (Ctrl/⌘S)" onClick={p.onSave}>
        <Save size={16} />
      </ToolbarButton>
      <ToolbarButton label="Print (Ctrl/⌘P)" onClick={p.onPrint}>
        <Printer size={16} />
      </ToolbarButton>
      <ToolbarButton label="All tools" active={p.toolsOpen} onClick={p.onToggleTools}>
        <Wrench size={16} />
      </ToolbarButton>
    </div>
  );
}
