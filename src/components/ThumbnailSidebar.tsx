import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { RotateCw, Trash2, Copy, FileOutput, GripVertical } from "lucide-react";

interface ThumbnailSidebarProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  numPages: number;
  currentPage: number;
  selectedPages: Set<number>;
  onSelectPage: (pageNum: number) => void;
  onToggleSelect: (pageNum: number) => void;
  onRotatePage: (pageIdx: number, delta: number) => void;
  onDeletePage: (pageIdx: number) => void;
  onDuplicatePage: (pageIdx: number) => void;
  onReorderPages: (fromIdx: number, toIdx: number) => void;
  onExtractSelected: () => void;
}

const PageThumb: React.FC<{
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
}> = ({ pdfDoc, pageNumber }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 0.24 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch {
        // ignore cancelled render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-auto rounded bg-white shadow-sm block pointer-events-none"
    />
  );
};

export const ThumbnailSidebar: React.FC<ThumbnailSidebarProps> = ({
  pdfDoc,
  numPages,
  currentPage,
  selectedPages,
  onSelectPage,
  onToggleSelect,
  onRotatePage,
  onDeletePage,
  onDuplicatePage,
  onReorderPages,
  onExtractSelected,
}) => {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  return (
    <aside
      className="w-56 shrink-0 border-r flex flex-col h-full select-none"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div
        className="px-3 py-2.5 border-b flex items-center justify-between gap-2"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
          Pages ({numPages})
        </span>
        {selectedPages.size > 0 && (
          <button
            type="button"
            onClick={onExtractSelected}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer"
            style={{ background: "var(--accent)", color: "var(--accent-text)" }}
            title="Extract selected pages as new PDF"
          >
            <FileOutput size={12} /> Extract ({selectedPages.size})
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto oma-scroll p-2.5 space-y-2.5">
        {Array.from({ length: numPages }, (_, idx) => {
          const pageNum = idx + 1;
          const isCurrent = pageNum === currentPage;
          const isSelected = selectedPages.has(pageNum);

          return (
            <div
              key={pageNum}
              draggable
              onDragStart={() => setDragFrom(idx)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(idx);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => {
                if (dragFrom !== null && dragFrom !== idx) {
                  onReorderPages(dragFrom, idx);
                }
                setDragFrom(null);
                setDragOver(null);
              }}
              onClick={() => onSelectPage(pageNum)}
              className="group relative rounded-xl p-2 border transition-all cursor-pointer"
              style={{
                background: isCurrent ? "var(--surface-hover)" : "var(--surface-alt)",
                borderColor:
                  dragOver === idx
                    ? "var(--accent)"
                    : isCurrent
                    ? "var(--accent)"
                    : "var(--border)",
              }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <GripVertical size={12} style={{ color: "var(--text-muted)" }} />
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelect(pageNum)}
                    aria-label={`Select page ${pageNum}`}
                    className="cursor-pointer"
                  />
                  <span className="text-[11px] font-semibold">{pageNum}</span>
                </div>

                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                  <button
                    type="button"
                    title="Rotate 90°"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRotatePage(idx, 90);
                    }}
                    className="p-1 rounded hover:bg-black/20 cursor-pointer"
                  >
                    <RotateCw size={12} />
                  </button>
                  <button
                    type="button"
                    title="Duplicate page"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicatePage(idx);
                    }}
                    className="p-1 rounded hover:bg-black/20 cursor-pointer"
                  >
                    <Copy size={12} />
                  </button>
                  {numPages > 1 && (
                    <button
                      type="button"
                      title="Delete page"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePage(idx);
                      }}
                      className="p-1 rounded text-red-400 hover:bg-black/20 cursor-pointer"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              <PageThumb pdfDoc={pdfDoc} pageNumber={pageNum} />
            </div>
          );
        })}
      </div>
    </aside>
  );
};
