import React, { useEffect, useRef, useState } from "react";
import { Trash2, Upload, Eraser, Check } from "lucide-react";
import { ModalDialog } from "./ModalDialog";

interface SignatureModalProps {
  open: boolean;
  onClose: () => void;
  onSelectSignature: (dataUrl: string) => void;
}

const STORAGE_KEY = "omaviewer_saved_signatures";

function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const SignatureModal: React.FC<SignatureModalProps> = ({
  open,
  onClose,
  onSelectSignature,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [inkColor, setInkColor] = useState("#111827");
  const [lineWidth, setLineWidth] = useState(3);
  const [saved, setSaved] = useState<string[]>(loadSaved);

  useEffect(() => {
    if (open) clearCanvas();
  }, [open]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  };

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = lineWidth * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
    setHasStroke(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const onPointerUp = () => {
    setDrawing(false);
  };

  const saveAndUse = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke) return;
    const dataUrl = canvas.toDataURL("image/png");
    const next = [dataUrl, ...saved.filter((s) => s !== dataUrl)].slice(0, 6);
    setSaved(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    onSelectSignature(dataUrl);
    onClose();
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const next = [dataUrl, ...saved].slice(0, 6);
      setSaved(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      onSelectSignature(dataUrl);
      onClose();
    };
    reader.readAsDataURL(file);
  };

  const removeSaved = (idx: number) => {
    const next = saved.filter((_, i) => i !== idx);
    setSaved(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Signature Studio"
      subtitle="Draw with mouse/touch or upload a PNG signature. Saved locally on your device."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Ink:
            </span>
            {[
              { color: "#111827", label: "Black" },
              { color: "#1d4ed8", label: "Blue" },
              { color: "#b91c1c", label: "Red" },
            ].map((c) => (
              <button
                key={c.color}
                type="button"
                onClick={() => setInkColor(c.color)}
                aria-label={c.label}
                className="w-6 h-6 rounded-full cursor-pointer transition-transform"
                style={{
                  background: c.color,
                  border: inkColor === c.color ? "2px solid var(--accent)" : "2px solid var(--border)",
                  transform: inkColor === c.color ? "scale(1.15)" : "scale(1)",
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Size
            </span>
            <input
              type="range"
              min={1}
              max={6}
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              className="w-24 cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearCanvas}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ background: "var(--surface-alt)", color: "var(--text)" }}
            >
              <Eraser size={14} /> Clear
            </button>
            <label
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ background: "var(--surface-alt)", color: "var(--text)" }}
            >
              <Upload size={14} /> Upload PNG
              <input type="file" accept="image/png,image/webp" className="hidden" onChange={handleUpload} />
            </label>
          </div>
        </div>

        <div
          className="rounded-xl overflow-hidden border relative"
          style={{
            background: "#ffffff",
            borderColor: "var(--border)",
          }}
        >
          <canvas
            ref={canvasRef}
            width={1000}
            height={340}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="w-full h-44 touch-none cursor-crosshair block"
          />
          {!hasStroke && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
              Sign here...
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)", color: "var(--text)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!hasStroke}
            onClick={saveAndUse}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--accent-text)" }}
          >
            <Check size={16} /> Use Signature
          </button>
        </div>

        {saved.length > 0 && (
          <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-medium mb-2.5" style={{ color: "var(--text-muted)" }}>
              Saved Signatures (click to place on document)
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {saved.map((src, idx) => (
                <div
                  key={idx}
                  className="group relative rounded-lg border p-2 bg-white flex items-center justify-center h-16 cursor-pointer"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => {
                    onSelectSignature(src);
                    onClose();
                  }}
                >
                  <img src={src} alt={`Saved signature ${idx + 1}`} className="max-h-12 object-contain" />
                  <button
                    type="button"
                    aria-label="Delete saved signature"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSaved(idx);
                    }}
                    className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 p-1 rounded bg-red-600 text-white cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
};
