import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import {
  FileText,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  PanelLeft,
  Palette,
  Wrench,
  Search,
  ChevronLeft,
  ChevronRight,
  MousePointer2,
  Pencil,
  Type,
  PenTool,
  Calendar,
  CheckSquare,
  Highlighter,
  Square,
  Check,
  ImageDown,
  Eye,
  Files,
  Image as ImageIcon,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { BUILTIN_THEMES, applyThemeToRoot, type ThemeDefinition } from "./lib/themes";
import {
  getCapabilities,
  getCliFile,
  getOmarchyTheme,
  pickPdfFile,
  saveBytesToDisk,
  type SystemCapabilities,
} from "./lib/tauriBridge";
import {
  bakeAnnotations,
  extractPages,
  imagesToPdf,
  rebuildPages,
  renderPageToImageBytes,
  type PageAnnotation,
  type PageOp,
} from "./lib/pdfOps";
import { PdfPageView, type EditorTool } from "./components/PdfPageView";
import { ThumbnailSidebar } from "./components/ThumbnailSidebar";
import { SignatureModal } from "./components/SignatureModal";
import { ToolsModal, type StudioTab } from "./components/ToolsModal";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type ReadingFilter = "normal" | "dark" | "sepia" | "contrast";

const READING_FILTERS: { id: ReadingFilter; label: string }[] = [
  { id: "normal", label: "Original" },
  { id: "dark", label: "Dark Ink" },
  { id: "sepia", label: "Sepia" },
  { id: "contrast", label: "High Contrast" },
];

export default function App() {
  // Themes
  const [omarchyTheme, setOmarchyTheme] = useState<ThemeDefinition | null>(null);
  const [themeId, setThemeId] = useState<string>(
    () => localStorage.getItem("omaviewer_theme") || "midnight"
  );
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  // Capabilities
  const [capabilities, setCapabilities] = useState<SystemCapabilities>({
    has_gs: false,
    has_qpdf: false,
    has_tesseract: false,
    has_pdftoppm: false,
    tesseract_langs: [],
    platform: "linux",
  });

  // Document state + Undo/Redo stack
  const [fileName, setFileName] = useState<string>("");
  const [history, setHistory] = useState<Uint8Array[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const currentPdfBytes = historyIdx >= 0 ? history[historyIdx] : null;

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>("normal");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());

  // Editor & annotations
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [annotations, setAnnotations] = useState<PageAnnotation[]>([]);
  const [pendingSignatureUrl, setPendingSignatureUrl] = useState<string | null>(null);
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState<StudioTab>("merge");
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [searchCursor, setSearchCursor] = useState(0);

  // Toast
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const allThemes = useMemo(
    () => (omarchyTheme ? [omarchyTheme, ...BUILTIN_THEMES] : BUILTIN_THEMES),
    [omarchyTheme]
  );

  // Init capabilities, Omarchy theme, CLI file
  useEffect(() => {
    getCapabilities().then(setCapabilities).catch(() => {});
    getOmarchyTheme().then((t) => {
      if (t) {
        setOmarchyTheme(t);
        if (!localStorage.getItem("omaviewer_theme")) {
          setThemeId("omarchy");
        }
      }
    });
    getCliFile().then((file) => {
      if (file) {
        pushPdfVersion(file.data, file.name);
      }
    });
  }, []);

  // Apply selected theme
  useEffect(() => {
    const found = allThemes.find((t) => t.id === themeId) || BUILTIN_THEMES[0];
    applyThemeToRoot(found);
    localStorage.setItem("omaviewer_theme", found.id);
  }, [themeId, allThemes]);

  // Listen to OS prefers-color-scheme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!localStorage.getItem("omaviewer_theme")) {
        setThemeId(mq.matches ? "midnight" : "paper");
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const pushPdfVersion = useCallback((bytes: Uint8Array, name?: string) => {
    if (name !== undefined) setFileName(name);
    setHistory((prev) => {
      const sliced = prev.slice(0, historyIdx + 1);
      const next = [...sliced, bytes].slice(-15);
      setHistoryIdx(next.length - 1);
      return next;
    });
    setAnnotations([]);
    setSelectedPages(new Set());
  }, [historyIdx]);

  // Parse current PDF bytes with PDF.js
  useEffect(() => {
    if (!currentPdfBytes) {
      setPdfDoc(null);
      setNumPages(0);
      return;
    }
    let cancelled = false;
    const copy = new Uint8Array(currentPdfBytes);
    const task = pdfjsLib.getDocument({ data: copy });
    task.promise
      .then((doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage((p) => Math.min(Math.max(1, p), doc.numPages));
      })
      .catch((err) => {
        if (!cancelled) showToast(`Could not open PDF: ${String(err)}`, true);
      });

    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [currentPdfBytes, showToast]);

  const handleOpen = async () => {
    const file = await pickPdfFile();
    if (!file) return;
    setCurrentPage(1);
    setHistory([file.data]);
    setHistoryIdx(0);
    setFileName(file.name);
    setAnnotations([]);
    setSelectedPages(new Set());
    showToast(`Opened ${file.name}`);
  };

  const handleBakeAnnotations = async (): Promise<Uint8Array | null> => {
    if (!currentPdfBytes) return null;
    if (annotations.length === 0) return currentPdfBytes;
    const baked = await bakeAnnotations(currentPdfBytes, annotations, pdfDoc);
    pushPdfVersion(baked);
    showToast("Applied edits & permanent redactions to PDF!");
    return baked;
  };

  const handleSave = async () => {
    if (!currentPdfBytes) return;
    try {
      const toSave = annotations.length > 0 ? await handleBakeAnnotations() : currentPdfBytes;
      if (!toSave) return;
      const saved = await saveBytesToDisk(toSave, fileName || "document.pdf");
      if (saved) showToast(`Saved to ${saved}`);
    } catch (e) {
      showToast(`Save failed: ${String(e)}`, true);
    }
  };

  const handleExportCurrentPagePng = async () => {
    if (!pdfDoc) return;
    try {
      const pngBytes = await renderPageToImageBytes(pdfDoc, currentPage, "png", 2.0);
      const base = (fileName || "document").replace(/\.pdf$/i, "");
      const saved = await saveBytesToDisk(
        pngBytes,
        `${base}-page-${currentPage}.png`,
        "png",
        "image/png"
      );
      if (saved) showToast(`Exported page ${currentPage} as PNG!`);
    } catch (e) {
      showToast(`Export failed: ${String(e)}`, true);
    }
  };

  // Page organizer handlers
  const applyPageOps = async (ops: PageOp[], msg: string) => {
    if (!currentPdfBytes) return;
    try {
      const updated = await rebuildPages(currentPdfBytes, ops);
      pushPdfVersion(updated);
      showToast(msg);
    } catch (e) {
      showToast(`Page operation failed: ${String(e)}`, true);
    }
  };

  const handleRotatePage = (pageIdx: number, delta: number) => {
    const ops: PageOp[] = Array.from({ length: numPages }, (_, i) => ({
      sourceIndex: i,
      rotationDelta: i === pageIdx ? delta : 0,
    }));
    applyPageOps(ops, `Rotated page ${pageIdx + 1} by ${delta}°`);
  };

  const handleDeletePage = (pageIdx: number) => {
    if (numPages <= 1) return;
    const ops: PageOp[] = Array.from({ length: numPages }, (_, i) => ({
      sourceIndex: i,
      rotationDelta: 0,
    })).filter((op) => op.sourceIndex !== pageIdx);
    applyPageOps(ops, `Deleted page ${pageIdx + 1}`);
  };

  const handleDuplicatePage = (pageIdx: number) => {
    const ops: PageOp[] = [];
    for (let i = 0; i < numPages; i++) {
      ops.push({ sourceIndex: i, rotationDelta: 0 });
      if (i === pageIdx) ops.push({ sourceIndex: i, rotationDelta: 0 });
    }
    applyPageOps(ops, `Duplicated page ${pageIdx + 1}`);
  };

  const handleReorderPages = (fromIdx: number, toIdx: number) => {
    const ops: PageOp[] = Array.from({ length: numPages }, (_, i) => ({
      sourceIndex: i,
      rotationDelta: 0,
    }));
    const [moved] = ops.splice(fromIdx, 1);
    ops.splice(toIdx, 0, moved);
    applyPageOps(ops, `Moved page ${fromIdx + 1} → ${toIdx + 1}`);
    setCurrentPage(toIdx + 1);
  };

  const handleExtractSelected = async () => {
    if (!currentPdfBytes || selectedPages.size === 0) return;
    const indices = Array.from(selectedPages)
      .sort((a, b) => a - b)
      .map((p) => p - 1);
    try {
      const extracted = await extractPages(currentPdfBytes, indices);
      const base = (fileName || "document").replace(/\.pdf$/i, "");
      const saved = await saveBytesToDisk(extracted, `${base}-extracted.pdf`);
      if (saved) showToast(`Extracted ${indices.length} pages!`);
    } catch (e) {
      showToast(`Extract failed: ${String(e)}`, true);
    }
  };

  // Text search across pages
  const runSearch = async (query: string) => {
    setSearchQuery(query);
    if (!pdfDoc || !query.trim()) {
      setSearchMatches([]);
      return;
    }
    const q = query.toLowerCase();
    const hits: number[] = [];
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const tc = await page.getTextContent();
      const text = tc.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .toLowerCase();
      if (text.includes(q)) hits.push(p);
    }
    setSearchMatches(hits);
    setSearchCursor(0);
    if (hits.length > 0) setCurrentPage(hits[0]);
  };

  // Drag & Drop files onto window
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const pdf = files.find((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdf) {
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      setCurrentPage(1);
      setHistory([bytes]);
      setHistoryIdx(0);
      setFileName(pdf.name);
      setAnnotations([]);
      showToast(`Opened ${pdf.name}`);
      return;
    }

    const imgs = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    if (imgs.length > 0) {
      const payloads = await Promise.all(
        imgs.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))
      );
      const pdfBytes = await imagesToPdf(payloads);
      setCurrentPage(1);
      setHistory([pdfBytes]);
      setHistoryIdx(0);
      setFileName("dropped-images.pdf");
      setAnnotations([]);
      showToast(`Converted ${imgs.length} image(s) to PDF!`);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpen();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (historyIdx > 0) {
          e.preventDefault();
          setHistoryIdx((i) => Math.max(0, i - 1));
        }
      } else if (e.key === "ArrowRight" && document.activeElement?.tagName !== "INPUT") {
        setCurrentPage((p) => Math.min(numPages || 1, p + 1));
      } else if (e.key === "ArrowLeft" && document.activeElement?.tagName !== "INPUT") {
        setCurrentPage((p) => Math.max(1, p - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cycleReadingFilter = () => {
    const idx = READING_FILTERS.findIndex((f) => f.id === readingFilter);
    const next = READING_FILTERS[(idx + 1) % READING_FILTERS.length];
    setReadingFilter(next.id);
    showToast(`Reading mode: ${next.label}`);
  };

  const openStudio = (tab: StudioTab) => {
    setToolsTab(tab);
    setToolsModalOpen(true);
  };

  return (
    <div
      className="h-full flex flex-col relative"
      style={{ background: "var(--bg)", color: "var(--text)" }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={handleDrop}
    >
      {/* TOP BAR */}
      <header
        className="h-13 px-2.5 sm:px-4 border-b flex items-center justify-between gap-2 shrink-0 z-20"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          {pdfDoc && (
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              title="Toggle pages sidebar"
              className="p-2 rounded-lg cursor-pointer transition-colors"
              style={{
                background: sidebarOpen ? "var(--surface-hover)" : "transparent",
              }}
            >
              <PanelLeft size={18} />
            </button>
          )}

          <div className="flex items-center gap-2 shrink-0">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shadow-sm"
              style={{ background: "var(--accent)", color: "var(--accent-text)" }}
            >
              OV
            </div>
            <span className="font-bold text-sm tracking-tight hidden sm:inline">OmaViewer</span>
          </div>

          {fileName && (
            <span
              className="text-xs px-2.5 py-1 rounded-md truncate max-w-[140px] sm:max-w-[240px]"
              style={{ background: "var(--surface-alt)", color: "var(--text-muted)" }}
              title={fileName}
            >
              {fileName}
            </span>
          )}
        </div>

        {/* Center zoom & page controls */}
        {pdfDoc && (
          <div className="hidden md:flex items-center gap-1.5">
            <button
              type="button"
              disabled={historyIdx <= 0}
              onClick={() => setHistoryIdx((i) => Math.max(0, i - 1))}
              title="Undo (Ctrl+Z)"
              className="p-1.5 rounded-lg disabled:opacity-35 cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
            >
              <Undo2 size={15} />
            </button>
            <button
              type="button"
              disabled={historyIdx >= history.length - 1}
              onClick={() => setHistoryIdx((i) => Math.min(history.length - 1, i + 1))}
              title="Redo"
              className="p-1.5 rounded-lg disabled:opacity-35 cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
            >
              <Redo2 size={15} />
            </button>

            <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />

            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
              title="Zoom out"
              className="p-1.5 rounded-lg cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
            >
              <ZoomOut size={15} />
            </button>
            <span className="text-xs font-mono w-11 text-center">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))}
              title="Zoom in"
              className="p-1.5 rounded-lg cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
            >
              <ZoomIn size={15} />
            </button>

            <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />

            <button
              type="button"
              onClick={cycleReadingFilter}
              title="Reading filter (Original / Dark Ink / Sepia / Contrast)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
            >
              <Eye size={14} />
              {READING_FILTERS.find((f) => f.id === readingFilter)?.label}
            </button>
          </div>
        )}

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleOpen}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Open PDF (Ctrl+O)"
          >
            <FolderOpen size={15} />
            <span className="hidden sm:inline">Open</span>
          </button>

          {pdfDoc && (
            <>
              <button
                type="button"
                onClick={() => setSearchOpen((v) => !v)}
                className="p-1.5 rounded-lg cursor-pointer"
                style={{
                  background: searchOpen ? "var(--accent)" : "var(--surface-alt)",
                  color: searchOpen ? "var(--accent-text)" : "var(--text)",
                }}
                title="Search text (Ctrl+F)"
              >
                <Search size={15} />
              </button>

              <button
                type="button"
                onClick={handleExportCurrentPagePng}
                className="p-1.5 rounded-lg cursor-pointer hidden sm:inline-flex"
                style={{ background: "var(--surface-alt)" }}
                title="Export current page as PNG"
              >
                <ImageDown size={15} />
              </button>

              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                style={{ background: "var(--accent)", color: "var(--accent-text)" }}
                title="Save PDF (Ctrl+S)"
              >
                <Save size={15} />
                <span className="hidden sm:inline">Save</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => openStudio(pdfDoc ? "compress" : "merge")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="PDF Studio Tools (Merge, Compress, OCR, Security, Metadata)"
          >
            <Wrench size={15} />
            <span className="hidden lg:inline">Tools</span>
          </button>

          {/* Theme dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowThemeMenu((v) => !v)}
              className="p-1.5 rounded-lg cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
              title="Switch Theme"
              aria-label="Switch Theme"
            >
              <Palette size={16} />
            </button>
            {showThemeMenu && (
              <div
                className="absolute right-0 mt-2 w-52 rounded-xl border shadow-2xl p-1.5 z-50"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div
                  className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  Themes
                </div>
                {allThemes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setThemeId(t.id);
                      setShowThemeMenu(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer"
                    style={{
                      background: themeId === t.id ? "var(--surface-hover)" : "transparent",
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full border"
                        style={{ background: t.accent, borderColor: t.border }}
                      />
                      {t.name}
                    </span>
                    {themeId === t.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* EDITOR / ANNOTATION SUB-TOOLBAR */}
      {pdfDoc && (
        <div
          className="px-3 py-1.5 border-b flex items-center justify-between gap-2 overflow-x-auto oma-scroll shrink-0"
          style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-1">
            {[
              { id: "select", label: "Select", icon: <MousePointer2 size={14} /> },
              { id: "edit-text", label: "Edit Text", icon: <Pencil size={14} /> },
              { id: "text", label: "Add Text", icon: <Type size={14} /> },
              { id: "signature", label: "Sign", icon: <PenTool size={14} /> },
              { id: "date", label: "Date", icon: <Calendar size={14} /> },
              { id: "check", label: "Check", icon: <CheckSquare size={14} /> },
              { id: "highlight", label: "Highlight", icon: <Highlighter size={14} /> },
              { id: "redact", label: "True Redact", icon: <Square size={14} fill="currentColor" /> },
            ].map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  setActiveTool(tool.id as EditorTool);
                  if (tool.id === "signature" && !pendingSignatureUrl) {
                    setSigModalOpen(true);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 cursor-pointer transition-colors"
                style={{
                  background: activeTool === tool.id ? "var(--accent)" : "transparent",
                  color: activeTool === tool.id ? "var(--accent-text)" : "var(--text)",
                }}
              >
                {tool.icon} {tool.label}
              </button>
            ))}

            {activeTool === "signature" && (
              <button
                type="button"
                onClick={() => setSigModalOpen(true)}
                className="ml-1 px-2.5 py-1 rounded-lg text-xs font-medium border cursor-pointer shrink-0"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                {pendingSignatureUrl ? "Change Signature" : "Draw Signature"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {annotations.length > 0 && (
              <button
                type="button"
                onClick={handleBakeAnnotations}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer"
              >
                <Check size={14} /> Apply {annotations.length} Edit{annotations.length > 1 ? "s" : ""}
              </button>
            )}

            <div className="flex items-center gap-1 text-xs">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded disabled:opacity-35 cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="font-mono px-1">
                {currentPage} / {numPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                className="p-1 rounded disabled:opacity-35 cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEARCH BAR */}
      {searchOpen && pdfDoc && (
        <div
          className="px-4 py-2 border-b flex items-center gap-2 shrink-0"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <Search size={15} style={{ color: "var(--text-muted)" }} />
          <input
            autoFocus
            type="search"
            value={searchQuery}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search text in document..."
            className="flex-1 bg-transparent text-sm border-none outline-none"
          />
          {searchQuery && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {searchMatches.length > 0
                ? `${searchCursor + 1} / ${searchMatches.length} pages`
                : "No matches"}
            </span>
          )}
          {searchMatches.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const next = (searchCursor + 1) % searchMatches.length;
                setSearchCursor(next);
                setCurrentPage(searchMatches[next]);
              }}
              className="px-2 py-1 rounded text-xs cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
            >
              Next Match
            </button>
          )}
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            className="p-1 rounded cursor-pointer"
            aria-label="Close search"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* MAIN BODY */}
      <div className="flex-1 flex min-h-0 relative">
        {pdfDoc && sidebarOpen && (
          <ThumbnailSidebar
            pdfDoc={pdfDoc}
            numPages={numPages}
            currentPage={currentPage}
            selectedPages={selectedPages}
            onSelectPage={setCurrentPage}
            onToggleSelect={(pageNum) => {
              setSelectedPages((prev) => {
                const next = new Set(prev);
                if (next.has(pageNum)) next.delete(pageNum);
                else next.add(pageNum);
                return next;
              });
            }}
            onRotatePage={handleRotatePage}
            onDeletePage={handleDeletePage}
            onDuplicatePage={handleDuplicatePage}
            onReorderPages={handleReorderPages}
            onExtractSelected={handleExtractSelected}
          />
        )}

        <main className="flex-1 overflow-auto oma-scroll oma-stage-bg flex items-start justify-center p-4 sm:p-8">
          {pdfDoc ? (
            <PdfPageView
              pdfDoc={pdfDoc}
              pageNumber={currentPage}
              scale={scale}
              readingFilter={readingFilter}
              activeTool={activeTool}
              pendingSignatureUrl={pendingSignatureUrl}
              annotations={annotations}
              onAddAnnotation={(ann) => setAnnotations((prev) => [...prev, ann])}
              onUpdateAnnotation={(id, patch) =>
                setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
              }
              onDeleteAnnotation={(id) =>
                setAnnotations((prev) => prev.filter((a) => a.id !== id))
              }
              onRequestSignature={() => setSigModalOpen(true)}
            />
          ) : (
            /* WELCOME STUDIO DROPZONE */
            <div className="my-auto max-w-2xl w-full text-center space-y-6 py-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                <ShieldCheck size={14} style={{ color: "var(--accent)" }} />
                100% Offline • Zero Telemetry • Open Source (FOSS)
              </div>

              <div>
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight m-0">
                  OmaViewer PDF Studio
                </h1>
                <p className="text-sm sm:text-base mt-2 max-w-lg mx-auto" style={{ color: "var(--text-muted)" }}>
                  Sign, redact, merge, split, compress, OCR, and organize PDFs effortlessly — right on
                  your device.
                </p>
              </div>

              <div
                onClick={handleOpen}
                className="p-8 sm:p-10 rounded-2xl border-2 border-dashed cursor-pointer transition-all hover:scale-[1.01]"
                style={{
                  background: "var(--surface)",
                  borderColor: "var(--accent)",
                }}
              >
                <FileText size={40} className="mx-auto mb-3" style={{ color: "var(--accent)" }} />
                <div className="text-base font-semibold">Drop a PDF or images here</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  or click to browse files on your computer
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                {[
                  {
                    icon: <Files size={18} style={{ color: "var(--accent)" }} />,
                    title: "Merge PDFs",
                    desc: "Combine multiple documents in any order",
                    action: () => openStudio("merge"),
                  },
                  {
                    icon: <ImageIcon size={18} style={{ color: "var(--accent)" }} />,
                    title: "Images → PDF",
                    desc: "Turn phone scans & photos into a PDF",
                    action: () => openStudio("images"),
                  },
                  {
                    icon: <Sparkles size={18} style={{ color: "var(--accent)" }} />,
                    title: "True Redact & Sign",
                    desc: "Permanently scrub text & add signatures",
                    action: handleOpen,
                  },
                ].map((card) => (
                  <button
                    key={card.title}
                    type="button"
                    onClick={card.action}
                    className="p-4 rounded-xl border text-left transition-colors cursor-pointer"
                    style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                  >
                    <div className="mb-2">{card.icon}</div>
                    <div className="text-sm font-semibold">{card.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {card.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MOBILE / COMPACT BOTTOM BAR */}
      {pdfDoc && (
        <nav
          className="md:hidden h-12 px-3 border-t flex items-center justify-around shrink-0"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
            className="p-2"
            aria-label="Zoom out"
          >
            <ZoomOut size={18} />
          </button>
          <button type="button" onClick={cycleReadingFilter} className="p-2" aria-label="Reading filter">
            <Eye size={18} />
          </button>
          <button
            type="button"
            onClick={() => setSigModalOpen(true)}
            className="p-2"
            aria-label="Sign"
          >
            <PenTool size={18} />
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))}
            className="p-2"
            aria-label="Zoom in"
          >
            <ZoomIn size={18} />
          </button>
        </nav>
      )}

      {/* DRAG OVERLAY */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-blue-600/25 backdrop-blur-xs border-4 border-dashed border-blue-400 flex items-center justify-center pointer-events-none">
          <div
            className="px-6 py-4 rounded-2xl shadow-2xl text-base font-semibold"
            style={{ background: "var(--surface)" }}
          >
            Drop PDF or Images to open in OmaViewer
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-16 md:bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-2xl border text-xs font-medium"
          style={{
            background: toast.isError ? "#991b1b" : "var(--surface)",
            borderColor: toast.isError ? "#ef4444" : "var(--accent)",
            color: toast.isError ? "#ffffff" : "var(--text)",
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* MODALS */}
      <SignatureModal
        open={sigModalOpen}
        onClose={() => setSigModalOpen(false)}
        onSelectSignature={(url) => {
          setPendingSignatureUrl(url);
          setActiveTool("signature");
          showToast("Signature ready — click anywhere on the page to place it!");
        }}
      />

      <ToolsModal
        open={toolsModalOpen}
        initialTab={toolsTab}
        onClose={() => setToolsModalOpen(false)}
        currentPdfBytes={currentPdfBytes}
        currentFileName={fileName}
        capabilities={capabilities}
        onLoadNewPdf={(bytes, name, msg) => {
          setCurrentPage(1);
          pushPdfVersion(bytes, name);
          showToast(msg);
        }}
        onToast={showToast}
      />
    </div>
  );
}
