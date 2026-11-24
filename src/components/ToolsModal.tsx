import React, { useEffect, useState } from "react";
import {
  Files,
  Image as ImageIcon,
  Minimize2,
  Lock,
  Unlock,
  ScanText,
  ShieldAlert,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import {
  compressPdfNative,
  ocrPdfNative,
  pickMultipleFiles,
  protectPdfNative,
  saveBytesToDisk,
  unlockPdfNative,
  type FilePayload,
  type SystemCapabilities,
} from "../lib/tauriBridge";
import {
  imagesToPdf,
  mergePdfBuffers,
  readPdfMetadata,
  stripAllMetadata,
  writePdfMetadata,
  type PdfMetadata,
} from "../lib/pdfOps";

export type StudioTab = "merge" | "images" | "compress" | "security" | "ocr" | "metadata";

interface ToolsModalProps {
  open: boolean;
  initialTab: StudioTab;
  onClose: () => void;
  currentPdfBytes: Uint8Array | null;
  currentFileName: string;
  capabilities: SystemCapabilities;
  onLoadNewPdf: (bytes: Uint8Array, name: string, toastMsg: string) => void;
  onToast: (msg: string, isError?: boolean) => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const ToolsModal: React.FC<ToolsModalProps> = ({
  open,
  initialTab,
  onClose,
  currentPdfBytes,
  currentFileName,
  capabilities,
  onLoadNewPdf,
  onToast,
}) => {
  const [tab, setTab] = useState<StudioTab>(initialTab);
  const [busy, setBusy] = useState(false);

  // Merge state
  const [mergeList, setMergeList] = useState<FilePayload[]>([]);
  // Images state
  const [imageList, setImageList] = useState<FilePayload[]>([]);
  // Compress state
  const [preset, setPreset] = useState<"email" | "balanced" | "print" | "high">("balanced");
  const [compressInfo, setCompressInfo] = useState<string | null>(null);
  // Security state
  const [password, setPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [unlockPw, setUnlockPw] = useState("");
  // OCR state
  const [ocrLang, setOcrLang] = useState("eng");
  // Metadata state
  const [meta, setMeta] = useState<PdfMetadata>({
    title: "",
    author: "",
    subject: "",
    keywords: "",
    creator: "",
    producer: "",
  });

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (capabilities.tesseract_langs.includes("bul") && capabilities.tesseract_langs.includes("eng")) {
      setOcrLang("bul+eng");
    } else if (capabilities.tesseract_langs.length > 0) {
      setOcrLang(capabilities.tesseract_langs[0]);
    }
  }, [capabilities]);

  useEffect(() => {
    if (open && tab === "metadata" && currentPdfBytes) {
      readPdfMetadata(currentPdfBytes)
        .then(setMeta)
        .catch(() => {});
    }
  }, [open, tab, currentPdfBytes]);

  const addMergeFiles = async () => {
    const picked = await pickMultipleFiles(["pdf"], "application/pdf,.pdf");
    if (picked.length > 0) setMergeList((prev) => [...prev, ...picked]);
  };

  const runMerge = async () => {
    if (mergeList.length < 2) {
      onToast("Add at least 2 PDF files to merge.", true);
      return;
    }
    setBusy(true);
    try {
      const merged = await mergePdfBuffers(mergeList.map((f) => f.data));
      onLoadNewPdf(merged, "merged-document.pdf", `Merged ${mergeList.length} PDFs successfully!`);
      setMergeList([]);
      onClose();
    } catch (e) {
      onToast(`Merge failed: ${String(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const addImages = async () => {
    const picked = await pickMultipleFiles(
      ["png", "jpg", "jpeg", "webp"],
      "image/png,image/jpeg,image/webp"
    );
    if (picked.length > 0) setImageList((prev) => [...prev, ...picked]);
  };

  const runImagesToPdf = async () => {
    if (imageList.length === 0) return;
    setBusy(true);
    try {
      const pdfBytes = await imagesToPdf(
        imageList.map((f) => ({ name: f.name, bytes: f.data }))
      );
      onLoadNewPdf(pdfBytes, "images-combined.pdf", `Created PDF from ${imageList.length} images!`);
      setImageList([]);
      onClose();
    } catch (e) {
      onToast(`Images → PDF failed: ${String(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const runCompress = async () => {
    if (!currentPdfBytes) return;
    setBusy(true);
    setCompressInfo(null);
    try {
      const res = await compressPdfNative(currentPdfBytes, preset);
      const savedPct = Math.max(
        0,
        Math.round((1 - res.compressedSize / Math.max(1, res.originalSize)) * 100)
      );
      const summary = `${fmtSize(res.originalSize)} → ${fmtSize(res.compressedSize)} (${savedPct}% smaller)`;
      setCompressInfo(summary);
      onLoadNewPdf(res.data, currentFileName.replace(/\.pdf$/i, "") + "-compressed.pdf", `Compressed: ${summary}`);
    } catch (e) {
      onToast(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const runProtect = async () => {
    if (!currentPdfBytes || !password.trim()) return;
    setBusy(true);
    try {
      const locked = await protectPdfNative(currentPdfBytes, password, ownerPassword);
      const saved = await saveBytesToDisk(
        locked,
        currentFileName.replace(/\.pdf$/i, "") + "-protected.pdf"
      );
      if (saved) {
        onToast("Saved AES-256 password-protected PDF!");
        setPassword("");
        setOwnerPassword("");
        onClose();
      }
    } catch (e) {
      onToast(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const runUnlock = async () => {
    if (!currentPdfBytes || !unlockPw.trim()) return;
    setBusy(true);
    try {
      const unlocked = await unlockPdfNative(currentPdfBytes, unlockPw);
      onLoadNewPdf(unlocked, currentFileName.replace(/\.pdf$/i, "") + "-unlocked.pdf", "PDF decrypted & unlocked!");
      setUnlockPw("");
      onClose();
    } catch (e) {
      onToast(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const runOcr = async () => {
    if (!currentPdfBytes) return;
    setBusy(true);
    try {
      const searchable = await ocrPdfNative(currentPdfBytes, ocrLang);
      onLoadNewPdf(
        searchable,
        currentFileName.replace(/\.pdf$/i, "") + "-ocr.pdf",
        `Offline OCR (${ocrLang}) complete — text is now searchable!`
      );
      onClose();
    } catch (e) {
      onToast(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const runSaveMeta = async () => {
    if (!currentPdfBytes) return;
    setBusy(true);
    try {
      const updated = await writePdfMetadata(currentPdfBytes, meta);
      onLoadNewPdf(updated, currentFileName, "Metadata updated!");
      onClose();
    } catch (e) {
      onToast(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const runStripMeta = async () => {
    if (!currentPdfBytes) return;
    setBusy(true);
    try {
      const cleaned = await stripAllMetadata(currentPdfBytes);
      onLoadNewPdf(cleaned, currentFileName, "All PDF metadata stripped cleanly!");
      onClose();
    } catch (e) {
      onToast(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const moveItem = <T,>(list: T[], setList: React.Dispatch<React.SetStateAction<T[]>>, idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= list.length) return;
    const copy = [...list];
    const [item] = copy.splice(idx, 1);
    copy.splice(nextIdx, 0, item);
    setList(copy);
  };

  const tabs: { id: StudioTab; label: string; icon: React.ReactNode }[] = [
    { id: "merge", label: "Merge", icon: <Files size={15} /> },
    { id: "images", label: "Images → PDF", icon: <ImageIcon size={15} /> },
    { id: "compress", label: "Compress", icon: <Minimize2 size={15} /> },
    { id: "security", label: "Security", icon: <Lock size={15} /> },
    { id: "ocr", label: "Offline OCR", icon: <ScanText size={15} /> },
    { id: "metadata", label: "Metadata", icon: <ShieldAlert size={15} /> },
  ];

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="OmaViewer PDF Studio"
      subtitle="100% offline local tools — your files never leave your device."
    >
      <div className="space-y-4">
        <div
          className="flex flex-wrap gap-1.5 p-1 rounded-xl border"
          style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
              style={{
                background: tab === t.id ? "var(--accent)" : "transparent",
                color: tab === t.id ? "var(--accent-text)" : "var(--text)",
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* MERGE TAB */}
        {tab === "merge" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs m-0" style={{ color: "var(--text-muted)" }}>
                Combine multiple PDF files into a single document in your chosen order.
              </p>
              <button
                type="button"
                onClick={addMergeFiles}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{ background: "var(--surface-alt)", color: "var(--text)" }}
              >
                <Plus size={14} /> Add PDFs
              </button>
            </div>

            {currentPdfBytes && mergeList.length === 0 && (
              <button
                type="button"
                onClick={() =>
                  setMergeList([{ name: currentFileName, path: currentFileName, data: currentPdfBytes }])
                }
                className="w-full py-2 rounded-lg text-xs border border-dashed cursor-pointer"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                + Start with currently open file ({currentFileName})
              </button>
            )}

            <div className="space-y-1.5 max-h-56 overflow-y-auto oma-scroll">
              {mergeList.map((f, idx) => (
                <div
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs"
                  style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
                >
                  <span className="truncate font-medium">
                    {idx + 1}. {f.name} ({fmtSize(f.data.length)})
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveItem(mergeList, setMergeList, idx, -1)}
                      className="p-1 rounded hover:opacity-80 cursor-pointer"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(mergeList, setMergeList, idx, 1)}
                      className="p-1 rounded hover:opacity-80 cursor-pointer"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMergeList((l) => l.filter((_, i) => i !== idx))}
                      className="p-1 rounded text-red-400 hover:opacity-80 cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy || mergeList.length < 2}
                onClick={runMerge}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-text)" }}
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                Merge {mergeList.length} PDFs
              </button>
            </div>
          </div>
        )}

        {/* IMAGES TO PDF TAB */}
        {tab === "images" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs m-0" style={{ color: "var(--text-muted)" }}>
                Convert PNG, JPG, or WebP photos/scans into a clean multi-page PDF.
              </p>
              <button
                type="button"
                onClick={addImages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{ background: "var(--surface-alt)", color: "var(--text)" }}
              >
                <Plus size={14} /> Add Images
              </button>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto oma-scroll">
              {imageList.map((f, idx) => (
                <div
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs"
                  style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
                >
                  <span className="truncate font-medium">
                    {idx + 1}. {f.name} ({fmtSize(f.data.length)})
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveItem(imageList, setImageList, idx, -1)}
                      className="p-1 rounded cursor-pointer"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(imageList, setImageList, idx, 1)}
                      className="p-1 rounded cursor-pointer"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageList((l) => l.filter((_, i) => i !== idx))}
                      className="p-1 rounded text-red-400 cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy || imageList.length === 0}
                onClick={runImagesToPdf}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-text)" }}
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                Create PDF ({imageList.length})
              </button>
            </div>
          </div>
        )}

        {/* COMPRESS TAB */}
        {tab === "compress" && (
          <div className="space-y-4">
            {!currentPdfBytes ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Open a PDF document first to compress it.
              </p>
            ) : !capabilities.has_gs ? (
              <p className="text-sm text-amber-400">
                Ghostscript (`gs`) was not detected on this device. Install `ghostscript` to enable
                deep local compression.
              </p>
            ) : (
              <>
                <p className="text-xs m-0" style={{ color: "var(--text-muted)" }}>
                  Current file: <strong>{currentFileName}</strong> ({fmtSize(currentPdfBytes.length)})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    { id: "email", title: "Email / Viber", desc: "72 DPI — smallest file size" },
                    { id: "balanced", title: "Balanced (Recommended)", desc: "150 DPI — crisp screen reading" },
                    { id: "print", title: "Print Quality", desc: "300 DPI — sharp text & graphics" },
                    { id: "high", title: "Archival High", desc: "Minimal loss, font/image dedup" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPreset(opt.id as typeof preset)}
                      className="text-left p-3 rounded-xl border cursor-pointer transition-colors"
                      style={{
                        background: preset === opt.id ? "var(--surface-hover)" : "var(--surface-alt)",
                        borderColor: preset === opt.id ? "var(--accent)" : "var(--border)",
                      }}
                    >
                      <div className="text-sm font-semibold">{opt.title}</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
                {compressInfo && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <CheckCircle2 size={15} /> {compressInfo}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={runCompress}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-40"
                    style={{ background: "var(--accent)", color: "var(--accent-text)" }}
                  >
                    {busy && <Loader2 size={15} className="animate-spin" />}
                    Compress PDF
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* SECURITY TAB */}
        {tab === "security" && (
          <div className="space-y-4">
            {!currentPdfBytes ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Open a PDF document first to lock or unlock it.
              </p>
            ) : !capabilities.has_qpdf ? (
              <p className="text-sm text-amber-400">
                `qpdf` was not detected. Install `qpdf` for AES-256 encryption and decryption.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div
                  className="p-4 rounded-xl border space-y-3"
                  style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Lock size={15} /> Protect with AES-256
                  </div>
                  <input
                    type="password"
                    placeholder="Open password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs border"
                    style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                  />
                  <input
                    type="password"
                    placeholder="Owner password (optional)"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs border"
                    style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                  />
                  <button
                    type="button"
                    disabled={busy || !password.trim()}
                    onClick={runProtect}
                    className="w-full py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
                    style={{ background: "var(--accent)", color: "var(--accent-text)" }}
                  >
                    Encrypt & Save Copy
                  </button>
                </div>

                <div
                  className="p-4 rounded-xl border space-y-3"
                  style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Unlock size={15} /> Remove Password
                  </div>
                  <input
                    type="password"
                    placeholder="Current PDF password"
                    value={unlockPw}
                    onChange={(e) => setUnlockPw(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs border"
                    style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                  />
                  <button
                    type="button"
                    disabled={busy || !unlockPw.trim()}
                    onClick={runUnlock}
                    className="w-full py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
                    style={{ background: "var(--surface-hover)", color: "var(--text)" }}
                  >
                    Decrypt Document
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* OFFLINE OCR TAB */}
        {tab === "ocr" && (
          <div className="space-y-4">
            {!currentPdfBytes ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Open a scanned PDF first to make its text searchable offline.
              </p>
            ) : !capabilities.has_tesseract || !capabilities.has_pdftoppm ? (
              <p className="text-sm text-amber-400">
                Offline OCR requires `tesseract` and `pdftoppm` installed locally.
              </p>
            ) : (
              <>
                <p className="text-xs m-0" style={{ color: "var(--text-muted)" }}>
                  Converts scanned image-only pages into a searchable, selectable PDF using local
                  Tesseract OCR.
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium block">OCR Language(s)</label>
                  <input
                    type="text"
                    value={ocrLang}
                    onChange={(e) => setOcrLang(e.target.value)}
                    placeholder="e.g. eng, bul, bul+eng"
                    className="w-full px-3 py-2 rounded-lg text-sm border"
                    style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
                  />
                  {capabilities.tesseract_langs.length > 0 && (
                    <p className="text-xs m-0" style={{ color: "var(--text-muted)" }}>
                      Installed languages: {capabilities.tesseract_langs.join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy || !ocrLang.trim()}
                    onClick={runOcr}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-40"
                    style={{ background: "var(--accent)", color: "var(--accent-text)" }}
                  >
                    {busy && <Loader2 size={15} className="animate-spin" />}
                    Run Offline OCR
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* METADATA TAB */}
        {tab === "metadata" && (
          <div className="space-y-3">
            {!currentPdfBytes ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Open a PDF document first to inspect or strip its metadata.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(["title", "author", "subject", "keywords", "creator", "producer"] as const).map(
                    (field) => (
                      <div key={field}>
                        <label
                          className="text-xs capitalize block mb-1"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {field}
                        </label>
                        <input
                          type="text"
                          value={meta[field]}
                          onChange={(e) => setMeta({ ...meta, [field]: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-lg text-xs border"
                          style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
                        />
                      </div>
                    )
                  )}
                </div>
                <div className="flex flex-wrap justify-between gap-2 pt-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={runStripMeta}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white cursor-pointer disabled:opacity-40"
                  >
                    <ShieldAlert size={14} /> Strip All Metadata (Privacy)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={runSaveMeta}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
                    style={{ background: "var(--accent)", color: "var(--accent-text)" }}
                  >
                    Save Metadata
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
};
