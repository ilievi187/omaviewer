import { PDFDocument, degrees, rgb } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export type AnnotationKind = "signature" | "text" | "edit-text" | "redact" | "highlight" | "check";

export type TextFontStyle = "sans" | "serif" | "mono";

export interface PageAnnotation {
  id: string;
  pageIndex: number; // 0-based
  kind: AnnotationKind;
  // Normalized coordinates (0..1) relative to page width/height
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color?: string;
  bgColor?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontItalic?: boolean;
  fontStyle?: TextFontStyle;
  pdfFontName?: string; // Live PDF.js loaded font-family name
  usePdfFont?: boolean; // Use exact embedded PDF font unless user overrode style
  imageDataUrl?: string; // PNG data URL for signatures
}

export interface PageOp {
  sourceIndex: number; // 0-based original page index
  rotationDelta: number; // 0, 90, 180, 270
}

export async function readPdfMetadata(bytes: Uint8Array): Promise<PdfMetadata> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return {
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: doc.getKeywords() ?? "",
    creator: doc.getCreator() ?? "",
    producer: doc.getProducer() ?? "",
  };
}

export async function writePdfMetadata(
  bytes: Uint8Array,
  meta: PdfMetadata
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setKeywords(meta.keywords ? meta.keywords.split(",").map((k) => k.trim()) : []);
  doc.setCreator(meta.creator);
  doc.setProducer(meta.producer);
  return doc.save();
}

export async function stripAllMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  return writePdfMetadata(bytes, {
    title: "",
    author: "",
    subject: "",
    keywords: "",
    creator: "",
    producer: "",
  });
}

export async function rebuildPages(bytes: Uint8Array, ops: PageOp[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const dst = await PDFDocument.create();

  for (const op of ops) {
    const [copied] = await dst.copyPages(src, [op.sourceIndex]);
    if (op.rotationDelta % 360 !== 0) {
      const current = copied.getRotation().angle;
      copied.setRotation(degrees((current + op.rotationDelta) % 360));
    }
    dst.addPage(copied);
  }

  return dst.save();
}

export async function extractPages(bytes: Uint8Array, pageIndices: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const dst = await PDFDocument.create();
  const copied = await dst.copyPages(src, pageIndices);
  for (const p of copied) {
    dst.addPage(p);
  }
  return dst.save();
}

export async function mergePdfBuffers(buffers: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const indices = doc.getPageIndices();
    const pages = await merged.copyPages(doc, indices);
    for (const p of pages) {
      merged.addPage(p);
    }
  }
  return merged.save();
}

async function imageBytesToPngDataUrl(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const blob = new Blob([bytes.slice().buffer], { type: mime });
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const pngBlob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png")
  );
  return new Uint8Array(await pngBlob.arrayBuffer());
}

export async function imagesToPdf(
  files: { name: string; bytes: Uint8Array }[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  for (const file of files) {
    const lower = file.name.toLowerCase();
    let img;
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
      img = await doc.embedJpg(file.bytes);
    } else if (lower.endsWith(".png")) {
      img = await doc.embedPng(file.bytes);
    } else {
      const pngBytes = await imageBytesToPngDataUrl(file.bytes, "image/webp");
      img = await doc.embedPng(pngBytes);
    }

    // Fit to A4 if very large, preserving aspect ratio
    const maxW = 595.28; // A4 pt
    const maxH = 841.89;
    let w = img.width;
    let h = img.height;
    const scale = Math.min(maxW / w, maxH / h, 1);
    w *= scale;
    h *= scale;

    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }

  return doc.save();
}

export function resolveFontFamily(
  style: TextFontStyle = "sans",
  pdfFontName?: string,
  usePdfFont = false
): string {
  const fallback =
    style === "serif"
      ? '"Noto Serif", Georgia, "Times New Roman", serif'
      : style === "mono"
      ? '"JetBrains Mono", "DejaVu Sans Mono", ui-monospace, monospace'
      : 'Inter, "Noto Sans", "Liberation Sans", Arial, sans-serif';

  if (usePdfFont && pdfFontName) {
    return `"${pdfFontName}", ${fallback}`;
  }
  return fallback;
}

function renderUnicodeTextToPng(
  text: string,
  color: string,
  fontSizePt: number,
  fontWeight: "normal" | "bold" = "normal",
  fontStyle: TextFontStyle = "sans",
  fontItalic = false,
  pdfFontName?: string,
  usePdfFont = false
): { pngBytes: Uint8Array; widthPt: number; heightPt: number } {
  const scale = 4; // 4x HiDPI (~288 DPI) for razor-sharp Cyrillic & Latin glyphs
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  // If using the embedded PDF font directly, its glyphs already have their native weight/slant baked in
  const italic = !usePdfFont && fontItalic ? "italic " : "";
  const weight = !usePdfFont && fontWeight === "bold" ? "700" : "400";
  const family = resolveFontFamily(fontStyle, pdfFontName, usePdfFont);
  const pxSize = fontSizePt * scale;
  const font = `${italic}${weight} ${pxSize}px ${family}`;
  ctx.font = font;

  const lines = text.split("\n");
  const lineH = Math.ceil(pxSize * 1.18);
  const maxWidth = Math.max(
    Math.ceil(pxSize * 0.6),
    ...lines.map((l) => Math.ceil(ctx.measureText(l).width))
  );
  const padX = Math.ceil(2 * scale);
  const padY = Math.ceil(1.5 * scale);

  canvas.width = maxWidth + padX * 2;
  canvas.height = Math.max(lineH, lines.length * lineH) + padY * 2;

  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(line, padX, padY + i * lineH);
  });

  const dataUrl = canvas.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return {
    pngBytes: bytes,
    widthPt: canvas.width / scale,
    heightPt: canvas.height / scale,
  };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [isNaN(r) ? 1 : r, isNaN(g) ? 0.9 : g, isNaN(b) ? 0 : b];
}

/**
 * Bakes all annotations into the PDF.
 * Pages containing `redact` annotations are flattened at high DPI with opaque black bars
 * so that underlying text/vectors are PERMANENTLY destroyed (true redaction).
 */
export async function bakeAnnotations(
  pdfBytes: Uint8Array,
  annotations: PageAnnotation[],
  pdfJsDoc: pdfjsLib.PDFDocumentProxy | null
): Promise<Uint8Array> {
  if (annotations.length === 0) return pdfBytes;

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();

  const redactedPages = new Set(
    annotations.filter((a) => a.kind === "redact").map((a) => a.pageIndex)
  );

  // 1. True permanent redaction: flatten pages that have redaction boxes
  if (redactedPages.size > 0 && pdfJsDoc) {
    for (const pageIdx of redactedPages) {
      const page = pages[pageIdx];
      if (!page) continue;
      const { width: ptW, height: ptH } = page.getSize();
      const jsPage = await pdfJsDoc.getPage(pageIdx + 1);
      const renderScale = 2.5;
      const viewport = jsPage.getViewport({ scale: renderScale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      await jsPage.render({ canvas, canvasContext: ctx, viewport }).promise;

      // Burn opaque black redaction rectangles directly into the raster
      const pageRedactions = annotations.filter(
        (a) => a.pageIndex === pageIdx && a.kind === "redact"
      );
      ctx.fillStyle = "#000000";
      for (const r of pageRedactions) {
        ctx.fillRect(
          r.x * canvas.width,
          r.y * canvas.height,
          r.w * canvas.width,
          r.h * canvas.height
        );
      }

      const jpgDataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const jpgBytes = dataUrlToBytes(jpgDataUrl);
      const embedded = await doc.embedJpg(jpgBytes);

      // Replace the original page with a clean flattened page (destroys underlying text)
      doc.removePage(pageIdx);
      const freshPage = doc.insertPage(pageIdx, [ptW, ptH]);
      freshPage.drawImage(embedded, { x: 0, y: 0, width: ptW, height: ptH });
    }
  }

  // 2. Apply non-redaction annotations on top
  const updatedPages = doc.getPages();
  for (const ann of annotations) {
    if (ann.kind === "redact") continue;
    const page = updatedPages[ann.pageIndex];
    if (!page) continue;
    const { width: ptW, height: ptH } = page.getSize();

    const px = ann.x * ptW;
    const pw = ann.w * ptW;
    const ph = ann.h * ptH;
    // PDF origin is bottom-left; UI origin is top-left
    const py = ptH - (ann.y * ptH) - ph;

    if (ann.kind === "highlight") {
      const [r, g, b] = hexToRgb01(ann.color || "#fde047");
      page.drawRectangle({
        x: px,
        y: py,
        width: pw,
        height: ph,
        color: rgb(r, g, b),
        opacity: 0.36,
      });
    } else if (ann.kind === "signature" && ann.imageDataUrl) {
      const imgBytes = dataUrlToBytes(ann.imageDataUrl);
      const png = await doc.embedPng(imgBytes);
      page.drawImage(png, { x: px, y: py, width: pw, height: ph });
    } else if (ann.kind === "edit-text") {
      // Cover original text cleanly with sampled page background color
      const [br, bg, bb] = hexToRgb01(ann.bgColor || "#ffffff");
      const padX = 2.5;
      const padY = 2.5;
      const content = ann.text || "";
      const rendered = content.trim()
        ? renderUnicodeTextToPng(
            content,
            ann.color || "#111827",
            ann.fontSize || 12,
            ann.fontWeight || "normal",
            ann.fontStyle || "sans",
            Boolean(ann.fontItalic),
            ann.pdfFontName,
            Boolean(ann.usePdfFont)
          )
        : null;

      const coverW = Math.max(pw, rendered ? rendered.widthPt : 0) + padX * 2;
      const coverH = Math.max(ph, rendered ? rendered.heightPt : 0) + padY * 2;

      page.drawRectangle({
        x: Math.max(0, px - padX),
        y: Math.max(0, py - padY),
        width: coverW,
        height: coverH,
        color: rgb(br, bg, bb),
      });

      if (rendered) {
        const png = await doc.embedPng(rendered.pngBytes);
        // Vertically center the new text inside the original line box
        const drawY = py + (ph - rendered.heightPt) / 2;
        page.drawImage(png, {
          x: px,
          y: drawY,
          width: rendered.widthPt,
          height: rendered.heightPt,
        });
      }
    } else if (ann.kind === "text" || ann.kind === "check") {
      const content = ann.kind === "check" ? "✓" : ann.text || "";
      if (!content.trim()) continue;
      const rendered = renderUnicodeTextToPng(
        content,
        ann.color || "#111827",
        ann.fontSize || (ann.kind === "check" ? 22 : 14),
        ann.fontWeight || (ann.kind === "check" ? "bold" : "normal"),
        ann.fontStyle || "sans",
        Boolean(ann.fontItalic)
      );
      const png = await doc.embedPng(rendered.pngBytes);
      page.drawImage(png, {
        x: px,
        y: py + (ph - rendered.heightPt) / 2,
        width: rendered.widthPt,
        height: rendered.heightPt,
      });
    }
  }

  return doc.save();
}

export async function renderPageToImageBytes(
  pdfJsDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  format: "png" | "jpeg" = "png",
  scale = 2.0
): Promise<Uint8Array> {
  const page = await pdfJsDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mime, 0.92);
  return dataUrlToBytes(dataUrl);
}
