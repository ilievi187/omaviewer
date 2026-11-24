# OmaViewer — Fast, Modern FOSS PDF Studio

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support%20OmaViewer-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/aurorauap)

**OmaViewer** is a 100% offline, privacy-first, cross-platform FOSS PDF Viewer & Studio built with **Tauri v2 (Rust)** + **React / TypeScript**.

## Features
- **Fast PDF Reader**: HiDPI rendering, text search (`Ctrl+F`), zoom, keyboard shortcuts, and eye-friendly reading modes (*Original, Dark Ink, Sepia, High Contrast*).
- **Adaptive & Multi-Theme UI**: Built-in themes (*Midnight Dark, Paper Light, Tokyo Night, Catppuccin Mocha, Nord Frost, Gruvbox Warm, Sepia Reading*) + **Live Omarchy theme sync** on Linux. Responsive layout for desktop & mobile (Android).
- **Page Organizer**: Drag-and-drop page reordering, rotate 90°, duplicate, delete, and extract selected pages into a new PDF.
- **Signing & Annotations**: Draw signatures with mouse/touch (saved locally for reuse) or upload PNG signatures, add Unicode/Cyrillic text, dates, checkmarks, and highlights.
- **True Permanent Redaction**: Flattens redacted pages at high DPI with solid black bars burned in — permanently destroying underlying text so it cannot be copy-pasted.
- **PDF Studio Tools (100% Local)**:
  - Merge multiple PDFs
  - Convert Images (PNG/JPG/WebP) → PDF & Export pages → PNG
  - Compress PDFs (*Email / Balanced / Print / High*) via Ghostscript
  - AES-256 Password Protection & Decryption via `qpdf`
  - Offline OCR (searchable PDFs, incl. Bulgarian `bul` & English `eng`) via Tesseract
  - Inspect, edit, or 1-click **Strip All Metadata** for privacy

## Development
```bash
npm install
npm run tauri dev
```

## Build
```bash
# Desktop (Linux / Windows / macOS)
npm run tauri build

# Android (Tauri v2 mobile)
npx tauri android init
npx tauri android build
```

## Support the Project

OmaViewer is 100% free, open-source, and offline — no subscriptions, no paywalls, no tracking.
If it saves you time or money, consider supporting development:

☕ **[Buy Me a Coffee](https://buymeacoffee.com/aurorauap)**

## License
MIT
