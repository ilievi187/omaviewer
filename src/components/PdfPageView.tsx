import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { X, Pencil, Highlighter, Square, Minus, Plus, Bold, Italic } from "lucide-react";
import {
  resolveFontFamily,
  type AnnotationKind,
  type PageAnnotation,
  type TextFontStyle,
} from "../lib/pdfOps";

export type EditorTool =
  | "select"
  | "edit-text"
  | "text"
  | "signature"
  | "check"
  | "date"
  | "highlight"
  | "redact";

interface DetectedTextStyle {
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontItalic: boolean;
  fontStyle: TextFontStyle;
  pdfFontName?: string;
  hasExplicitWeight?: boolean;
}

interface SelectionPopup extends DetectedTextStyle {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function detectFontStyle(fontFamily: string): TextFontStyle {
  const lower = fontFamily.toLowerCase();
  if (lower.includes("mono") || lower.includes("courier") || lower.includes("consolas")) {
    return "mono";
  }
  if (
    (lower.includes("serif") && !lower.includes("sans-serif") && !lower.includes("sans")) ||
    lower.includes("times") ||
    lower.includes("georgia") ||
    lower.includes("garamond") ||
    lower.includes("cambria") ||
    lower.includes("palatino") ||
    lower.includes("minion")
  ) {
    return "serif";
  }
  return "sans";
}

function detectBoldFromFontName(name: string): "normal" | "bold" {
  return /(bold|black|heavy|semibold|demi|extrabold|medi|[-_,]b\b|bd\b)/i.test(name)
    ? "bold"
    : "normal";
}

function detectItalicFromFontName(name: string): boolean {
  return /(italic|oblique|slanted|[-_,]it\b|[-_,]i\b)/i.test(name);
}

function rgbToHex(r: number, g: number, b: number): string {
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function sampleCanvasColors(
  canvas: HTMLCanvasElement | null,
  normX: number,
  normY: number,
  normW: number,
  normH: number
): { bgColor: string; fgColor: string; inkRatio: number } {
  if (!canvas) return { bgColor: "#ffffff", fgColor: "#111827", inkRatio: 0.15 };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { bgColor: "#ffffff", fgColor: "#111827", inkRatio: 0.15 };

  // 1. Sample 4 outer corners around the text box for background color
  const cornerPoints = [
    [normX * canvas.width - 3, normY * canvas.height - 3],
    [(normX + normW) * canvas.width + 3, normY * canvas.height - 3],
    [normX * canvas.width - 3, (normY + normH) * canvas.height + 3],
    [(normX + normW) * canvas.width + 3, (normY + normH) * canvas.height + 3],
  ];

  let bgR = 255,
    bgG = 255,
    bgB = 255;
  let bestLum = -1;

  for (const [px, py] of cornerPoints) {
    const sx = Math.max(0, Math.min(canvas.width - 1, Math.round(px)));
    const sy = Math.max(0, Math.min(canvas.height - 1, Math.round(py)));
    try {
      const p = ctx.getImageData(sx, sy, 1, 1).data;
      const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      if (lum > bestLum) {
        bestLum = lum;
        bgR = p[0];
        bgG = p[1];
        bgB = p[2];
      }
    } catch {
      // ignore
    }
  }

  // 2. Sample interior of the text box for ink color AND ink pixel density (helps detect bold!)
  const rx = Math.max(0, Math.floor(normX * canvas.width));
  const ry = Math.max(0, Math.floor(normY * canvas.height));
  const rw = Math.max(1, Math.min(canvas.width - rx, Math.ceil(normW * canvas.width)));
  const rh = Math.max(1, Math.min(canvas.height - ry, Math.ceil(normH * canvas.height)));

  let fgColor = "#111827";
  let inkRatio = 0.15;
  try {
    const imgData = ctx.getImageData(rx, ry, rw, rh).data;
    const bestDist = 40;
    const topSamples: [number, number, number, number][] = [];
    let totalSampled = 0;

    const step = Math.max(1, Math.floor((rw * rh) / 900));
    for (let i = 0; i < imgData.length; i += 4 * step) {
      totalSampled++;
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
      if (dist > bestDist) {
        topSamples.push([dist, r, g, b]);
      }
    }

    if (totalSampled > 0) {
      inkRatio = topSamples.length / totalSampled;
    }

    if (topSamples.length > 0) {
      topSamples.sort((a, b) => b[0] - a[0]);
      const take = Math.max(1, Math.min(24, Math.ceil(topSamples.length * 0.12)));
      let sr = 0,
        sg = 0,
        sb = 0;
      for (let i = 0; i < take; i++) {
        sr += topSamples[i][1];
        sg += topSamples[i][2];
        sb += topSamples[i][3];
      }
      fgColor = rgbToHex(sr / take, sg / take, sb / take);
    }
  } catch {
    // fallback
  }

  return { bgColor: rgbToHex(bgR, bgG, bgB), fgColor, inkRatio };
}

interface PdfPageViewProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number; // 1-based
  scale: number;
  readingFilter: "normal" | "dark" | "sepia" | "contrast";
  activeTool: EditorTool;
  pendingSignatureUrl: string | null;
  annotations: PageAnnotation[];
  onAddAnnotation: (ann: PageAnnotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<PageAnnotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onRequestSignature: () => void;
}

export const PdfPageView: React.FC<PdfPageViewProps> = ({
  pdfDoc,
  pageNumber,
  scale,
  readingFilter,
  activeTool,
  pendingSignatureUrl,
  annotations,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onRequestSignature,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 800 });
  const [dragBox, setDragBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  );
  const [moving, setMoving] = useState<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup | null>(null);

  useEffect(() => {
    setSelectionPopup(null);
  }, [pageNumber, activeTool, scale]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    let textLayerTask: pdfjsLib.TextLayer | null = null;

    (async () => {
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const viewport = page.getViewport({ scale });
      const hiDpiViewport = page.getViewport({ scale: scale * dpr });

      setSize({ w: Math.round(viewport.width), h: Math.round(viewport.height) });

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.round(hiDpiViewport.width);
      canvas.height = Math.round(hiDpiViewport.height);
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask = page.render({ canvas, canvasContext: ctx, viewport: hiDpiViewport });
      try {
        await renderTask.promise;
      } catch {
        return;
      }

      if (cancelled) return;

      // Render selectable PDF.js text layer aligned with viewport
      const textContainer = textLayerRef.current;
      if (textContainer) {
        textContainer.innerHTML = "";
        textContainer.style.setProperty("--scale-factor", String(scale));
        textContainer.style.setProperty("--total-scale-factor", String(scale));
        try {
          const textContent = await page.getTextContent();
          if (cancelled) return;
          textLayerTask = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textContainer,
            viewport,
          });
          await textLayerTask.render();

          // Attach exact PDF font size, bold, italic & font family metadata to each rendered span
          if (!cancelled) {
            const textItems = textContent.items.filter(
              (it): it is Extract<typeof it, { str: string }> => "str" in it && it.str.length > 0
            );
            const divs = textLayerTask.textDivs;
            let itemCursor = 0;

            for (const div of divs) {
              const divText = div.textContent || "";
              if (!divText) continue;

              // Find matching text item
              let matched = textItems[itemCursor];
              if (!matched || matched.str !== divText) {
                const foundIdx = textItems.findIndex(
                  (it, idx) => idx >= itemCursor && it.str === divText
                );
                if (foundIdx !== -1) {
                  matched = textItems[foundIdx];
                  itemCursor = foundIdx + 1;
                } else {
                  continue;
                }
              } else {
                itemCursor++;
              }

              // Exact PDF font size in points from transform matrix
              const tr = matched.transform;
              const fontSizePt = Math.max(6, Math.round(Math.hypot(tr[2], tr[3]) * 10) / 10);

              // Read true embedded PDF font name & flags (e.g. "ABCDEF+Arial-BoldMT", fontObj.bold)
              let realFontName = matched.fontName || "";
              let fontObjBold = false;
              let fontObjItalic = false;
              let loadedCssName = matched.fontName || "";
              try {
                if (page.commonObjs.has(matched.fontName)) {
                  const fontObj = page.commonObjs.get(matched.fontName) as {
                    name?: string;
                    loadedName?: string;
                    bold?: boolean;
                    black?: boolean;
                    italic?: boolean;
                  } | null;
                  if (fontObj?.name) realFontName = `${fontObj.name} ${realFontName}`;
                  if (fontObj?.loadedName) loadedCssName = fontObj.loadedName;
                  if (fontObj?.bold || fontObj?.black) fontObjBold = true;
                  if (fontObj?.italic) fontObjItalic = true;
                }
              } catch {
                // ignore
              }
              const styleEntry = textContent.styles?.[matched.fontName];
              const combinedName = `${realFontName} ${styleEntry?.fontFamily || ""}`;
              const isBold = fontObjBold || detectBoldFromFontName(combinedName) === "bold";
              const isItalic = fontObjItalic || detectItalicFromFontName(combinedName);
              const isObfuscated = /cidfont|g_d\d+_f\d+/i.test(realFontName) && !isBold;

              div.dataset.pdfSize = String(fontSizePt);
              div.dataset.pdfBold = isBold ? "bold" : "normal";
              div.dataset.pdfItalic = isItalic ? "1" : "0";
              div.dataset.pdfStyle = detectFontStyle(combinedName);
              div.dataset.pdfFont = loadedCssName;
              div.dataset.pdfExplicitWeight = isObfuscated ? "0" : "1";
            }
          }
        } catch {
          // cancelled or non-text page
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayerTask?.cancel();
    };
  }, [pdfDoc, pageNumber, scale]);

  const pageAnns = annotations.filter((a) => a.pageIndex === pageNumber - 1);

  const getNorm = (e: React.PointerEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== overlayRef.current) return;
    if (activeTool === "select") return;

    const pt = getNorm(e);

    if (activeTool === "redact" || activeTool === "highlight") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragBox({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      return;
    }

    if (activeTool === "signature") {
      if (!pendingSignatureUrl) {
        onRequestSignature();
        return;
      }
      onAddAnnotation({
        id: crypto.randomUUID(),
        pageIndex: pageNumber - 1,
        kind: "signature",
        x: Math.max(0, pt.x - 0.12),
        y: Math.max(0, pt.y - 0.04),
        w: 0.24,
        h: 0.08,
        imageDataUrl: pendingSignatureUrl,
      });
      return;
    }

    if (activeTool === "text" || activeTool === "date") {
      const id = crypto.randomUUID();
      const today = new Date().toLocaleDateString();
      onAddAnnotation({
        id,
        pageIndex: pageNumber - 1,
        kind: "text",
        x: Math.max(0, Math.min(0.75, pt.x)),
        y: Math.max(0, Math.min(0.92, pt.y)),
        w: 0.28,
        h: 0.045,
        text: activeTool === "date" ? today : "Type text...",
        color: "#111827",
        fontSize: 16,
      });
      if (activeTool === "text") setEditingTextId(id);
      return;
    }

    if (activeTool === "check") {
      onAddAnnotation({
        id: crypto.randomUUID(),
        pageIndex: pageNumber - 1,
        kind: "check",
        x: Math.max(0, pt.x - 0.02),
        y: Math.max(0, pt.y - 0.02),
        w: 0.04,
        h: 0.04,
        color: "#16a34a",
        fontSize: 24,
      });
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragBox) {
      const pt = getNorm(e);
      setDragBox((b) => (b ? { ...b, x1: pt.x, y1: pt.y } : null));
    } else if (moving) {
      const pt = getNorm(e);
      const dx = pt.x - moving.startX;
      const dy = pt.y - moving.startY;
      onUpdateAnnotation(moving.id, {
        x: Math.max(0, Math.min(0.95, moving.origX + dx)),
        y: Math.max(0, Math.min(0.95, moving.origY + dy)),
      });
    }
  };

  const handleStagePointerUp = () => {
    if (dragBox) {
      const x = Math.min(dragBox.x0, dragBox.x1);
      const y = Math.min(dragBox.y0, dragBox.y1);
      const w = Math.abs(dragBox.x1 - dragBox.x0);
      const h = Math.abs(dragBox.y1 - dragBox.y0);
      if (w > 0.01 && h > 0.008) {
        onAddAnnotation({
          id: crypto.randomUUID(),
          pageIndex: pageNumber - 1,
          kind: activeTool as AnnotationKind,
          x,
          y,
          w,
          h,
          color: activeTool === "highlight" ? "#fde047" : "#000000",
        });
      }
      setDragBox(null);
    }
    if (moving) setMoving(null);
  };

  const cursorClass =
    activeTool === "select"
      ? "cursor-default"
      : activeTool === "text"
      ? "cursor-text"
      : "cursor-crosshair";

  const isSelectMode = activeTool === "select";
  const isEditTextMode = activeTool === "edit-text";

  const readStyleFromSpan = (el: HTMLElement | null): DetectedTextStyle => {
    const span = el?.closest("span[data-pdf-size]") as HTMLElement | null;
    if (span) {
      return {
        fontSize: Math.max(6, Math.round(parseFloat(span.dataset.pdfSize || "12"))),
        fontWeight: span.dataset.pdfBold === "bold" ? "bold" : "normal",
        fontItalic: span.dataset.pdfItalic === "1",
        fontStyle: (span.dataset.pdfStyle as TextFontStyle) || "sans",
        pdfFontName: span.dataset.pdfFont || undefined,
        hasExplicitWeight: span.dataset.pdfExplicitWeight === "1",
      };
    }
    const computed = el ? window.getComputedStyle(el) : null;
    const px = computed ? parseFloat(computed.fontSize) || 14 : 14;
    return {
      fontSize: Math.max(6, Math.round(px / scale)),
      fontWeight: "normal",
      fontItalic: false,
      fontStyle: computed ? detectFontStyle(computed.fontFamily || "") : "sans",
    };
  };

  const createEditTextFromBox = (
    box: { x: number; y: number; w: number; h: number },
    text: string,
    detected: DetectedTextStyle
  ) => {
    const id = crypto.randomUUID();
    const { bgColor, fgColor, inkRatio } = sampleCanvasColors(
      canvasRef.current,
      box.x,
      box.y,
      box.w,
      box.h
    );

    // If the PDF obfuscated the font name (e.g. CIDFont+F2), use ink pixel density to detect bold!
    const inferredBold: "normal" | "bold" =
      detected.fontWeight === "bold" || (!detected.hasExplicitWeight && inkRatio >= 0.27)
        ? "bold"
        : "normal";

    onAddAnnotation({
      id,
      pageIndex: pageNumber - 1,
      kind: "edit-text",
      x: Math.max(0, box.x - 0.002),
      y: Math.max(0, box.y - 0.002),
      w: Math.min(1, box.w + 0.006),
      h: Math.min(1, box.h + 0.004),
      text,
      color: fgColor,
      bgColor,
      fontSize: detected.fontSize,
      fontWeight: inferredBold,
      fontItalic: detected.fontItalic,
      fontStyle: detected.fontStyle,
      pdfFontName: detected.pdfFontName,
      usePdfFont: Boolean(detected.pdfFontName),
    });
    setEditingTextId(id);
    setSelectionPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleTextLayerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditTextMode) return;
    const target = e.target as HTMLElement;
    if (!target || target.tagName !== "SPAN" || !target.textContent?.trim()) return;
    const container = textLayerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const sRect = target.getBoundingClientRect();
    if (cRect.width === 0 || cRect.height === 0) return;

    const detected = readStyleFromSpan(target);
    createEditTextFromBox(
      {
        x: (sRect.left - cRect.left) / cRect.width,
        y: (sRect.top - cRect.top) / cRect.height,
        w: sRect.width / cRect.width,
        h: sRect.height / cRect.height,
      },
      target.textContent,
      detected
    );
  };

  const handleTextLayerMouseUp = () => {
    if (!isSelectMode) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelectionPopup(null);
      return;
    }
    const container = textLayerRef.current;
    if (!container || !sel.anchorNode || !container.contains(sel.anchorNode)) {
      setSelectionPopup(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const sRect = range.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    if (sRect.width < 2 || sRect.height < 2 || cRect.width === 0) return;

    const anchorEl =
      sel.anchorNode.nodeType === Node.ELEMENT_NODE
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode.parentElement;
    const detected = readStyleFromSpan(anchorEl);

    setSelectionPopup({
      text: sel.toString(),
      x: (sRect.left - cRect.left) / cRect.width,
      y: (sRect.top - cRect.top) / cRect.height,
      w: sRect.width / cRect.width,
      h: sRect.height / cRect.height,
      ...detected,
    });
  };

  return (
    <div
      className={`relative shadow-2xl rounded-sm overflow-visible ${
        isSelectMode ? "" : "select-none"
      } pdf-filter-${readingFilter}`}
      style={{ width: size.w, height: size.h, background: "#ffffff" }}
    >
      <canvas ref={canvasRef} className="block" />

      {/* Selectable / Click-to-Edit PDF.js Text Layer */}
      <div
        ref={textLayerRef}
        onClick={handleTextLayerClick}
        onMouseUp={handleTextLayerMouseUp}
        className={`textLayer ${isEditTextMode ? "textLayer-editable" : ""} ${
          (isSelectMode || isEditTextMode) && !moving
            ? "pointer-events-auto"
            : "pointer-events-none select-none"
        }`}
      />

      {/* Floating Selection Quick-Action Bar */}
      {selectionPopup && isSelectMode && (
        <div
          className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-xl shadow-2xl border -translate-y-full -mt-2"
          style={{
            left: `${Math.max(2, Math.min(72, selectionPopup.x * 100))}%`,
            top: `${Math.max(6, selectionPopup.y * 100)}%`,
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--text)",
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              createEditTextFromBox(selectionPopup, selectionPopup.text, {
                fontSize: selectionPopup.fontSize,
                fontWeight: selectionPopup.fontWeight,
                fontItalic: selectionPopup.fontItalic,
                fontStyle: selectionPopup.fontStyle,
                pdfFontName: selectionPopup.pdfFontName,
                hasExplicitWeight: selectionPopup.hasExplicitWeight,
              })
            }
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer"
            style={{ background: "var(--accent)", color: "var(--accent-text)" }}
          >
            <Pencil size={12} /> Edit Text
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onAddAnnotation({
                id: crypto.randomUUID(),
                pageIndex: pageNumber - 1,
                kind: "highlight",
                x: selectionPopup.x,
                y: selectionPopup.y,
                w: selectionPopup.w,
                h: selectionPopup.h,
                color: "#fde047",
              });
              setSelectionPopup(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
          >
            <Highlighter size={12} /> Highlight
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onAddAnnotation({
                id: crypto.randomUUID(),
                pageIndex: pageNumber - 1,
                kind: "redact",
                x: selectionPopup.x,
                y: selectionPopup.y,
                w: selectionPopup.w,
                h: selectionPopup.h,
                color: "#000000",
              });
              setSelectionPopup(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-red-600/90 text-white cursor-pointer"
          >
            <Square size={11} fill="currentColor" /> Redact
          </button>
        </div>
      )}

      <div
        ref={overlayRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        className={`absolute inset-0 z-10 ${cursorClass} ${
          (isSelectMode || isEditTextMode) && !moving
            ? "pointer-events-none"
            : "pointer-events-auto"
        }`}
      >
        {pageAnns.map((ann) => (
          <div
            key={ann.id}
            onPointerDown={(e) => {
              if (editingTextId === ann.id) return;
              e.stopPropagation();
              const pt = getNorm(e);
              setMoving({
                id: ann.id,
                startX: pt.x,
                startY: pt.y,
                origX: ann.x,
                origY: ann.y,
              });
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (ann.kind === "text" || ann.kind === "edit-text") setEditingTextId(ann.id);
            }}
            className="group absolute cursor-move pointer-events-auto select-none"
            style={{
              left: `${ann.x * 100}%`,
              top: `${ann.y * 100}%`,
              width: ann.kind === "edit-text" ? "auto" : `${ann.w * 100}%`,
              minWidth: `${ann.w * 100}%`,
              height: `${ann.h * 100}%`,
            }}
          >
            {ann.kind === "redact" && (
              <div className="w-full h-full bg-black border border-red-500/70 flex items-center justify-center">
                <span className="text-[9px] uppercase tracking-wider text-red-300/80 font-mono">
                  Redacted
                </span>
              </div>
            )}

            {ann.kind === "highlight" && (
              <div
                className="w-full h-full rounded-xs"
                style={{ background: ann.color || "#fde047", opacity: 0.38 }}
              />
            )}

            {ann.kind === "signature" && ann.imageDataUrl && (
              <img
                src={ann.imageDataUrl}
                alt="Signature"
                draggable={false}
                className="w-full h-full object-contain border border-dashed border-blue-500/50"
              />
            )}

            {ann.kind === "check" && (
              <div className="w-full h-full flex items-center justify-center text-emerald-600 font-bold text-2xl leading-none">
                ✓
              </div>
            )}

            {(ann.kind === "text" || ann.kind === "edit-text") &&
              (editingTextId === ann.id ? (
                <div className="relative h-full flex items-center">
                  <input
                    autoFocus
                    type="text"
                    value={ann.text ?? ""}
                    onChange={(e) => onUpdateAnnotation(ann.id, { text: e.target.value })}
                    onBlur={() => setEditingTextId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") setEditingTextId(null);
                    }}
                    className="h-full px-0.5 border border-blue-500 rounded-xs outline-none"
                    style={{
                      minWidth: "100%",
                      width: `${Math.max(4, (ann.text?.length || 4) + 1)}ch`,
                      background:
                        ann.kind === "edit-text" ? ann.bgColor || "#ffffff" : "rgba(255,255,255,0.95)",
                      color: ann.color || "#111827",
                      fontSize: `${Math.max(8, (ann.fontSize || 12) * scale)}px`,
                      fontWeight: !ann.usePdfFont && ann.fontWeight === "bold" ? 700 : 400,
                      fontStyle: !ann.usePdfFont && ann.fontItalic ? "italic" : "normal",
                      fontFamily: resolveFontFamily(ann.fontStyle, ann.pdfFontName, ann.usePdfFont),
                      lineHeight: 1.15,
                    }}
                  />
                </div>
              ) : (
                <div
                  onClick={(e) => {
                    if (isEditTextMode) {
                      e.stopPropagation();
                      setEditingTextId(ann.id);
                    }
                  }}
                  className="w-full h-full px-0.5 flex items-center border border-transparent group-hover:border-blue-500/70 rounded-xs whitespace-pre transition-colors"
                  style={{
                    background:
                      ann.kind === "edit-text" ? ann.bgColor || "#ffffff" : "transparent",
                    color: ann.color || "#111827",
                    fontSize: `${Math.max(8, (ann.fontSize || 12) * scale)}px`,
                    fontWeight: !ann.usePdfFont && ann.fontWeight === "bold" ? 700 : 400,
                    fontStyle: !ann.usePdfFont && ann.fontItalic ? "italic" : "normal",
                    fontFamily: resolveFontFamily(ann.fontStyle, ann.pdfFontName, ann.usePdfFont),
                    lineHeight: 1.15,
                  }}
                  title="Double-click to edit text"
                >
                  {ann.text}
                </div>
              ))}

            {(ann.kind === "text" || ann.kind === "edit-text") && (
              <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 absolute -top-7 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-900/95 text-white text-[10px] shadow-lg z-30 whitespace-nowrap">
                <button
                  type="button"
                  title="Smaller font"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateAnnotation(ann.id, {
                      fontSize: Math.max(6, (ann.fontSize || 12) - 1),
                    });
                  }}
                  className="p-0.5 hover:text-blue-300 cursor-pointer"
                >
                  <Minus size={10} />
                </button>
                <span className="px-0.5 font-mono">{ann.fontSize || 12}</span>
                <button
                  type="button"
                  title="Larger font"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateAnnotation(ann.id, {
                      fontSize: Math.min(72, (ann.fontSize || 12) + 1),
                    });
                  }}
                  className="p-0.5 hover:text-blue-300 cursor-pointer"
                >
                  <Plus size={10} />
                </button>

                <span className="w-px h-3 bg-white/20" />

                <button
                  type="button"
                  title="Toggle Bold"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateAnnotation(ann.id, {
                      fontWeight: ann.fontWeight === "bold" ? "normal" : "bold",
                      usePdfFont: false,
                    });
                  }}
                  className={`p-0.5 rounded cursor-pointer ${
                    ann.fontWeight === "bold" ? "bg-blue-500 text-white" : "hover:text-blue-300"
                  }`}
                >
                  <Bold size={10} />
                </button>

                <button
                  type="button"
                  title="Toggle Italic"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateAnnotation(ann.id, {
                      fontItalic: !ann.fontItalic,
                      usePdfFont: false,
                    });
                  }}
                  className={`p-0.5 rounded cursor-pointer ${
                    ann.fontItalic ? "bg-blue-500 text-white" : "hover:text-blue-300"
                  }`}
                >
                  <Italic size={10} />
                </button>

                <button
                  type="button"
                  title="Cycle Font (Sans / Serif / Mono)"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const order: TextFontStyle[] = ["sans", "serif", "mono"];
                    const cur = order.indexOf(ann.fontStyle || "sans");
                    onUpdateAnnotation(ann.id, {
                      fontStyle: order[(cur + 1) % order.length],
                      usePdfFont: false,
                    });
                  }}
                  className="px-1 rounded bg-white/10 hover:bg-white/20 uppercase font-mono text-[9px] cursor-pointer"
                >
                  {ann.usePdfFont ? "PDF" : ann.fontStyle || "sans"}
                </button>

                <span className="w-px h-3 bg-white/20" />

                {["#111827", "#374151", "#1d4ed8", "#b91c1c"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Text color ${c}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateAnnotation(ann.id, { color: c });
                    }}
                    className="w-3 h-3 rounded-full border cursor-pointer"
                    style={{
                      background: c,
                      borderColor: (ann.color || "#111827") === c ? "#60a5fa" : "rgba(255,255,255,0.4)",
                    }}
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              aria-label="Remove annotation"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteAnnotation(ann.id);
              }}
              className="opacity-0 group-hover:opacity-100 absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center shadow cursor-pointer"
            >
              <X size={11} />
            </button>
          </div>
        ))}

        {dragBox && (
          <div
            className="pointer-events-none absolute border-2"
            style={{
              left: `${Math.min(dragBox.x0, dragBox.x1) * 100}%`,
              top: `${Math.min(dragBox.y0, dragBox.y1) * 100}%`,
              width: `${Math.abs(dragBox.x1 - dragBox.x0) * 100}%`,
              height: `${Math.abs(dragBox.y1 - dragBox.y0) * 100}%`,
              background:
                activeTool === "redact" ? "rgba(0,0,0,0.85)" : "rgba(253, 224, 71, 0.45)",
              borderColor: activeTool === "redact" ? "#ef4444" : "#eab308",
            }}
          />
        )}
      </div>
    </div>
  );
};
