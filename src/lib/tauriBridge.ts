import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ThemeDefinition } from "./themes";

export interface SystemCapabilities {
  has_gs: boolean;
  has_qpdf: boolean;
  has_tesseract: boolean;
  has_pdftoppm: boolean;
  tesseract_langs: string[];
  platform: string;
}

export interface FilePayload {
  name: string;
  path: string;
  data: Uint8Array;
}

export interface CompressResult {
  data: Uint8Array;
  originalSize: number;
  compressedSize: number;
}

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getCapabilities(): Promise<SystemCapabilities> {
  if (!isTauriEnv()) {
    return {
      has_gs: false,
      has_qpdf: false,
      has_tesseract: false,
      has_pdftoppm: false,
      tesseract_langs: [],
      platform: "web",
    };
  }
  return invoke<SystemCapabilities>("get_capabilities");
}

export async function getOmarchyTheme(): Promise<ThemeDefinition | null> {
  if (!isTauriEnv()) return null;
  try {
    const raw = await invoke<{
      name: string;
      bg: string;
      surface: string;
      surface_alt: string;
      text: string;
      text_muted: string;
      accent: string;
      border: string;
      is_dark: boolean;
    } | null>("get_omarchy_theme");
    if (!raw) return null;
    return {
      id: "omarchy",
      name: `Omarchy (${raw.name})`,
      isDark: raw.is_dark,
      bg: raw.bg,
      surface: raw.surface,
      surfaceAlt: raw.surface_alt,
      surfaceHover: raw.is_dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
      text: raw.text,
      textMuted: raw.text_muted,
      accent: raw.accent,
      accentText: raw.is_dark ? "#11111b" : "#ffffff",
      border: raw.border,
      canvasBg: raw.bg,
      scrollbarThumb: raw.text_muted,
    };
  } catch {
    return null;
  }
}

export async function getCliFile(): Promise<FilePayload | null> {
  if (!isTauriEnv()) return null;
  try {
    const res = await invoke<{ name: string; path: string; data: number[] } | null>("get_cli_file");
    if (!res) return null;
    return { name: res.name, path: res.path, data: new Uint8Array(res.data) };
  } catch {
    return null;
  }
}

export async function pickPdfFile(): Promise<FilePayload | null> {
  if (isTauriEnv()) {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
    });
    if (!selected || typeof selected !== "string") return null;
    const res = await invoke<{ name: string; path: string; data: number[] }>("read_file_bytes", {
      path: selected,
    });
    return { name: res.name, path: res.path, data: new Uint8Array(res.data) };
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const buf = await file.arrayBuffer();
      resolve({ name: file.name, path: file.name, data: new Uint8Array(buf) });
    };
    input.click();
  });
}

export async function pickMultipleFiles(acceptExt: string[], mime: string): Promise<FilePayload[]> {
  if (isTauriEnv()) {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Files", extensions: acceptExt }],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    const results: FilePayload[] = [];
    for (const p of paths) {
      const res = await invoke<{ name: string; path: string; data: number[] }>("read_file_bytes", {
        path: p,
      });
      results.push({ name: res.name, path: res.path, data: new Uint8Array(res.data) });
    }
    return results;
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = mime;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      const out: FilePayload[] = [];
      for (const f of files) {
        out.push({ name: f.name, path: f.name, data: new Uint8Array(await f.arrayBuffer()) });
      }
      resolve(out);
    };
    input.click();
  });
}

export async function saveBytesToDisk(
  bytes: Uint8Array,
  suggestedName: string,
  ext = "pdf",
  mime = "application/pdf"
): Promise<string | null> {
  if (isTauriEnv()) {
    const targetPath = await save({
      defaultPath: suggestedName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!targetPath) return null;
    await invoke("save_file_bytes", { path: targetPath, data: Array.from(bytes) });
    return targetPath;
  }

  const blob = new Blob([bytes.slice().buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggestedName;
}

export async function compressPdfNative(
  bytes: Uint8Array,
  preset: "email" | "balanced" | "print" | "high"
): Promise<CompressResult> {
  const res = await invoke<{
    data: number[];
    original_size: number;
    compressed_size: number;
  }>("compress_pdf", { data: Array.from(bytes), preset });
  return {
    data: new Uint8Array(res.data),
    originalSize: res.original_size,
    compressedSize: res.compressed_size,
  };
}

export async function protectPdfNative(
  bytes: Uint8Array,
  userPassword: string,
  ownerPassword = ""
): Promise<Uint8Array> {
  const res = await invoke<number[]>("protect_pdf", {
    data: Array.from(bytes),
    userPassword,
    ownerPassword,
  });
  return new Uint8Array(res);
}

export async function unlockPdfNative(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const res = await invoke<number[]>("unlock_pdf", {
    data: Array.from(bytes),
    password,
  });
  return new Uint8Array(res);
}

export async function ocrPdfNative(bytes: Uint8Array, lang: string): Promise<Uint8Array> {
  const res = await invoke<number[]>("ocr_pdf", {
    data: Array.from(bytes),
    lang,
  });
  return new Uint8Array(res);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriEnv()) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
