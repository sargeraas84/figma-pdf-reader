import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, GripVertical, Highlighter, Image, Move, PenLine, Trash2, X } from "lucide-react";
import type { OutlineNode, PdfDocument, PageSize } from "../lib/pdfjs";
import type { TextEdit } from "../lib/edits";

/* ---------------- Thumbnails ---------------- */

function Thumb({
  doc,
  pageNumber,
  size,
  active,
  onClick,
  dragHandlers
}: {
  doc: PdfDocument;
  pageNumber: number;
  size: PageSize;
  active: boolean;
  onClick: () => void;
  dragHandlers: Record<string, (e: React.DragEvent) => void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { root: el.closest(".sidebar-scroll"), rootMargin: "400px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const rotation = ((size.rotate + 360) % 360) as number;
      const base = page.getViewport({ scale: 1, rotation });
      const width = 128;
      const scale = width / base.width;
      const viewport = page.getViewport({ scale, rotation });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, doc, pageNumber, size]);

  const h = Math.round((128 / size.width) * size.height);
  return (
    <div
      ref={ref}
      onClick={onClick}
      {...dragHandlers}
      draggable
      className={`group relative flex flex-col items-center gap-1 p-1.5 rounded-lg border cursor-pointer ${
        active ? "border-red-500 bg-zinc-800" : "border-zinc-800 hover:border-zinc-600"
      }`}
    >
      <div className="bg-white page-shadow" style={{ width: 128, height: h }}>
        <canvas ref={canvasRef} className="block" />
      </div>
      <div className="flex items-center gap-1">
        <GripVertical size={12} className="text-zinc-500 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className={`text-[11px] ${active ? "text-[#ff8e53]" : "text-zinc-500"}`}>{pageNumber}</span>
      </div>
    </div>
  );
}

/* ---------------- Outline ---------------- */

function OutlineTree({
  nodes,
  onNavigate,
  depth = 0
}: {
  nodes: OutlineNode[];
  onNavigate: (dest: unknown) => void;
  depth?: number;
}) {
  if (!nodes.length) return null;
  return (
    <ul className={depth === 0 ? "space-y-0.5" : "ml-3 border-l border-zinc-800 pl-1.5"}>
      {nodes.map((n, i) => (
        <li key={`${depth}-${i}`}>
          <button
            onClick={() => onNavigate(n.dest)}
            className="w-full text-left text-[12px] text-zinc-300 hover:text-white hover:bg-zinc-800 rounded px-2 py-1 truncate"
            title={n.title}
          >
            {n.title || "Untitled"}
          </button>
          {n.children?.length ? <OutlineTree nodes={n.children} onNavigate={onNavigate} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Sidebar ---------------- */

export default function Sidebar({
  open,
  tab,
  onNavigateDest,
  onJumpToPage,
  onClearAnnotations,
  onDeleteSelected,
  onMoveSelected,
  onReorderPages
}: {
  open: boolean;
  tab: {
    pdf?: PdfDocument | null;
    numPages: number;
    page: number;
    sizes: PageSize[];
    outline: OutlineNode[];
    edits?: TextEdit[];
    pageOrder?: number[];
  } | null;
  onNavigateDest: (dest: unknown) => void;
  onJumpToPage: (page: number) => void;
  onClearAnnotations?: () => void;
  onDeleteSelected?: (ids: string[]) => void;
  onMoveSelected?: (ids: string[], page: number) => void;
  onReorderPages?: (from: number, to: number) => void;
}) {
  const [view, setView] = useState<"thumbs" | "outline" | "annotations">("thumbs");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const editCount = tab?.edits?.length ?? 0;
  // jump the user straight to the annotations list when the first one lands
  const prevEditCount = useRef(editCount);
  useEffect(() => {
    if (prevEditCount.current === 0 && editCount > 0) setView("annotations");
    prevEditCount.current = editCount;
  }, [editCount]);
  // drop stale ids when annotations list shrinks
  useEffect(() => {
    if (!selected.size) return;
    const valid = new Set((tab?.edits ?? []).map((e) => e.id));
    const next = new Set([...selected].filter((id) => valid.has(id)));
    if (next.size !== selected.size) setSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCount]);
  const [dragPage, setDragPage] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // latest dragover slot, readable synchronously inside onDrop
  const dropIndexRef = useRef<number | null>(null);
  if (!open || !tab) return null;

  const slotFromEvent = (e: React.DragEvent, count: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(count, Math.round((e.clientY - rect.top) / (rect.height / count))));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside
      className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col min-h-0"
      aria-label="Document sidebar"
    >
      <div className="flex border-b border-zinc-800 shrink-0">
        <button
          onClick={() => setView("thumbs")}
          aria-label="Thumbnails"
          title="Thumbnails"
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 text-[12px] whitespace-nowrap overflow-hidden ${
            view === "thumbs" ? "text-white border-b-2 border-red-500" : "text-zinc-400 hover:text-white"
          }`}
        >
          <Image size={14} className="shrink-0" />
          <span className="hidden xl:inline">Thumbnails</span>
          <span className="xl:hidden">Pages</span>
        </button>
        <button
          onClick={() => setView("outline")}
          aria-label="Bookmarks"
          title="Bookmarks / outline"
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 text-[12px] whitespace-nowrap overflow-hidden ${
            view === "outline" ? "text-white border-b-2 border-red-500" : "text-zinc-400 hover:text-white"
          }`}
        >
          <Bookmark size={14} className="shrink-0" />
          <span className="hidden xl:inline">Bookmarks</span>
        </button>
        <button
          onClick={() => setView("annotations")}
          aria-label="Annotations"
          title="Annotations"
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 text-[12px] whitespace-nowrap overflow-hidden ${
            view === "annotations" ? "text-white border-b-2 border-red-500" : "text-zinc-400 hover:text-white"
          }`}
        >
          <Highlighter size={14} className="shrink-0" />
          <span className="min-w-0 truncate">Annotations</span>
        </button>
      </div>

      <div className="sidebar-scroll flex-1 overflow-y-auto p-2">
        {view === "thumbs" ? (
          <div
            className="flex flex-col gap-1.5"
            onDragOver={(e) => {
              // accept only our own thumbnail payload; other drags (files etc.) pass through
              if (!e.dataTransfer.types.includes("text/page-reorder")) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              dropIndexRef.current = slotFromEvent(e, tab.sizes.length);
              setDropIndex(dropIndexRef.current);
            }}
            onDrop={(e) => {
              e.preventDefault();
              // stateless on purpose: dragPage/dropIndex state can lag React's
              // flush, so derive both from the event + the dragover ref
              const from = Number(e.dataTransfer.getData("text/page-reorder"));
              const slot = dropIndexRef.current;
              setDragPage(null);
              setDropIndex(null);
              if (Number.isInteger(from) && slot != null && onReorderPages && from !== slot) {
                onReorderPages(from, slot);
              }
            }}
          >
            {tab.sizes.map((s, i) => (
              <div
                key={i}
                data-thumb-row={i + 1}
                data-dragging={dragPage === i + 1 ? "" : undefined}
              >
                <Thumb
                  key={i}
                  doc={tab.pdf!}
                  size={s}
                  /* position i shows the source page at pageOrder[i];
                     render page numbers/data-page track the visual slot, the
                     payload is the source page so canvas always redraws */
                  pageNumber={tab.pageOrder?.[i] ?? i + 1}
                  active={tab.page === i + 1}
                  onClick={() => onJumpToPage(i + 1)}
                  dragHandlers={{
                    onDragStart: (e) => {
                      e.dataTransfer.setData("text/page-reorder", String(i + 1));
                      e.dataTransfer.effectAllowed = "move";
                      setDragPage(i + 1);
                    },
                    onDragEnd: () => {
                      setDragPage(null);
                      setDropIndex(null);
                      dropIndexRef.current = null;
                    }
                  }}
                />
                {dropIndex === i && dragPage != null && dragPage !== i + 1 && (
                  <div className="h-0.5 bg-[#ff6b6b] rounded" />
                )}
              </div>
            ))}
            {dropIndex === tab.sizes.length && dragPage != null && dragPage !== tab.sizes.length && (
              <div className="h-0.5 bg-[#ff6b6b] rounded" />
            )}
          </div>
        ) : view === "outline" ? (
          tab.outline.length ? (
            <OutlineTree nodes={tab.outline} onNavigate={onNavigateDest} />
          ) : (
            <p className="text-[12px] text-zinc-500 px-2 py-4">This PDF has no bookmarks.</p>
          )
        ) : tab.edits?.length ? (
          <div>
            <div className="flex items-center justify-between px-2 pb-1.5">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">Pending annotations</span>
              <button
                aria-label="Clear annotations"
                title="Remove all annotations"
                onClick={onClearAnnotations}
                className="text-zinc-500 hover:text-[#ff8e53]"
              >
                <Trash2 size={13} />
              </button>
            </div>
            {selected.size > 0 && (
              <div
                className="flex items-center gap-1.5 px-2 py-1.5 mb-1.5 border-y border-zinc-700 bg-zinc-800/60"
                aria-label="Batch operations"                >
                <button
                  onClick={() => onDeleteSelected?.([...selected])}
                  title={`Delete ${selected.size} annotation${selected.size === 1 ? "" : "s"}`}
                  className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-[#ff8e53] bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5"
                >
                  <Trash2 size={11} /> Delete ({selected.size})
                </button>
                <button
                  onClick={() => onMoveSelected?.([...selected], tab.page)}
                  title={`Move ${selected.size} annotation${selected.size === 1 ? "" : "s"} to page ${tab.page}`}
                  className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5"
                >
                  <Move size={11} /> Move here
                </button>
                <button
                  aria-label="Clear selection"
                  title="Clear selection"
                  onClick={() => setSelected(new Set())}
                  className="ml-auto text-zinc-500 hover:text-white"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <ul className="space-y-0.5">
              {[...tab.edits]
                .sort((a, b) => a.page - b.page)
                .map((e) => {
                  const isSelected = selected.has(e.id);
                  return (
                  <li key={e.id}>
                    <div
                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded ${
                        isSelected ? "bg-zinc-700/70" : "hover:bg-zinc-800"
                      }`}
                    >
                      <button
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`Select annotation on page ${e.page}`}
                        onClick={() => toggleSelect(e.id)}
                        className={`w-3.5 h-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
                          isSelected ? "bg-[#ff6b6b] border-[#ff6b6b] text-white" : "border-zinc-600 text-transparent hover:border-zinc-400"
                        }`}
                      >
                        <Check size={10} />
                      </button>
                      <button
                        onClick={() => onJumpToPage(e.page)}
                        title={`Jump to page ${e.page}`}
                        className="flex-1 min-w-0 text-left flex items-center gap-2 py-0.5 text-[12px] text-zinc-300 hover:text-white"
                      >
                      <span className="text-zinc-500 tabular-nums w-6 shrink-0 text-right">{e.page}</span>
                      {e.kind === "highlight" ? (
                        <>
                          <span
                            className="w-2.5 h-2.5 rounded-sm border border-black/30 shrink-0"
                            style={{ background: `rgb(${e.color.map((c) => Math.round(c * 255)).join(",")})` }}
                          />
                          <span className="truncate">
                            Highlight · {e.rects.length} {e.rects.length === 1 ? "box" : "boxes"}
                          </span>
                        </>
                      ) : e.kind === "redact" ? (
                        <>
                          <span className="w-2.5 h-2.5 rounded-sm bg-black border border-zinc-500 shrink-0" />
                          <span className="truncate">
                            Redacted · {e.rects.length} {e.rects.length === 1 ? "area" : "areas"}
                          </span>
                        </>
                      ) : e.kind === "pen" ? (
                        <>
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0"
                            style={{ background: `rgb(${e.color.map((c) => Math.round(c * 255)).join(",")})` }}
                          />
                          <span className="truncate">
                            Pen stroke · {e.points.length} pts
                          </span>
                        </>
                      ) : (
                        <>
                          <PenLine size={12} className="shrink-0 text-zinc-500" />
                          <span className="truncate">
                            {e.text.trim() ? `“${e.text.trim()}”` : "(text removed)"}
                          </span>
                        </>
                      )}
                      </button>
                    </div>
                  </li>
                  );
                })}
            </ul>
          </div>
        ) : (
          <p className="text-[12px] text-zinc-500 px-2 py-4">
            No annotations yet — select text with the highlighter or edit text runs.
          </p>
        )}
      </div>
    </aside>
  );
}
