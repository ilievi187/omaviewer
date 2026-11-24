use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
pub struct SystemCapabilities {
    pub has_gs: bool,
    pub has_qpdf: bool,
    pub has_tesseract: bool,
    pub has_pdftoppm: bool,
    pub tesseract_langs: Vec<String>,
    pub platform: String,
}

#[derive(Serialize)]
pub struct OmarchyTheme {
    pub name: String,
    pub bg: String,
    pub surface: String,
    pub surface_alt: String,
    pub text: String,
    pub text_muted: String,
    pub accent: String,
    pub border: String,
    pub is_dark: bool,
}

#[derive(Serialize)]
pub struct CompressResult {
    pub data: Vec<u8>,
    pub original_size: usize,
    pub compressed_size: usize,
}

#[derive(Serialize)]
pub struct FilePayload {
    pub name: String,
    pub path: String,
    pub data: Vec<u8>,
}

fn command_exists(cmd: &str) -> bool {
    Command::new("which")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn list_tesseract_langs() -> Vec<String> {
    if !command_exists("tesseract") {
        return vec![];
    }
    let Ok(output) = Command::new("tesseract").arg("--list-langs").output() else {
        return vec![];
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let stderr_text = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", text, stderr_text);
    combined
        .lines()
        .skip(1)
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with("List of") && l != "osd")
        .collect()
}

#[tauri::command]
fn get_capabilities() -> SystemCapabilities {
    SystemCapabilities {
        has_gs: command_exists("gs"),
        has_qpdf: command_exists("qpdf"),
        has_tesseract: command_exists("tesseract"),
        has_pdftoppm: command_exists("pdftoppm"),
        tesseract_langs: list_tesseract_langs(),
        platform: std::env::consts::OS.to_string(),
    }
}

fn hex_luminance(hex: &str) -> f32 {
    let clean = hex.trim().trim_start_matches('#');
    if clean.len() < 6 {
        return 0.0;
    }
    let r = u8::from_str_radix(&clean[0..2], 16).unwrap_or(0) as f32 / 255.0;
    let g = u8::from_str_radix(&clean[2..4], 16).unwrap_or(0) as f32 / 255.0;
    let b = u8::from_str_radix(&clean[4..6], 16).unwrap_or(0) as f32 / 255.0;
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

fn extract_hex(line: &str) -> Option<String> {
    let idx = line.find('#')?;
    let rest = &line[idx..];
    if rest.len() >= 7 && rest[1..7].chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(rest[0..7].to_string());
    }
    None
}

#[tauri::command]
fn get_omarchy_theme() -> Option<OmarchyTheme> {
    let home = dirs::home_dir()?;
    let theme_dir = home.join(".config/omarchy/current/theme");
    if !theme_dir.exists() {
        return None;
    }

    let theme_name = fs::read_link(&theme_dir)
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "Omarchy".to_string());

    let colors_toml = theme_dir.join("colors.toml");
    let content = fs::read_to_string(&colors_toml).ok()?;

    let mut bg = "#1a1b26".to_string();
    let mut fg = "#c0caf5".to_string();
    let mut accent = "#7aa2f7".to_string();
    let mut surface = "#24283b".to_string();
    let mut muted = "#565f89".to_string();

    for line in content.lines() {
        let lower = line.trim().to_lowercase();
        if let Some(hex) = extract_hex(line) {
            if lower.starts_with("background") {
                bg = hex;
            } else if lower.starts_with("foreground") {
                fg = hex;
            } else if lower.starts_with("accent") || lower.starts_with("color4") {
                accent = hex;
            } else if lower.starts_with("color0") || lower.starts_with("selection_background") {
                surface = hex;
            } else if lower.starts_with("color8") {
                muted = hex;
            }
        }
    }

    let is_dark = hex_luminance(&bg) < 0.5;
    let border = if is_dark {
        "rgba(255, 255, 255, 0.12)".to_string()
    } else {
        "rgba(0, 0, 0, 0.12)".to_string()
    };

    Some(OmarchyTheme {
        name: theme_name,
        bg: bg.clone(),
        surface,
        surface_alt: bg,
        text: fg,
        text_muted: muted,
        accent,
        border,
        is_dark,
    })
}

#[tauri::command]
fn get_cli_file() -> Option<FilePayload> {
    let arg = std::env::args().skip(1).find(|a| {
        let lower = a.to_lowercase();
        lower.ends_with(".pdf") && !a.starts_with('-')
    })?;
    let path = PathBuf::from(&arg);
    let data = fs::read(&path).ok()?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.pdf".to_string());
    Some(FilePayload {
        name,
        path: path.to_string_lossy().to_string(),
        data,
    })
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<FilePayload, String> {
    let p = PathBuf::from(&path);
    let data = fs::read(&p).map_err(|e| format!("Failed to read file: {}", e))?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.pdf".to_string());
    Ok(FilePayload { name, path, data })
}

#[tauri::command]
fn save_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn compress_pdf(data: Vec<u8>, preset: String) -> Result<CompressResult, String> {
    if !command_exists("gs") {
        return Err("Ghostscript (gs) is not installed on this system.".to_string());
    }
    let original_size = data.len();
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input_path = dir.path().join("in.pdf");
    let output_path = dir.path().join("out.pdf");
    fs::write(&input_path, &data).map_err(|e| e.to_string())?;

    let pdf_setting = match preset.as_str() {
        "email" => "/screen",
        "balanced" => "/ebook",
        "print" => "/printer",
        "high" => "/prepress",
        _ => "/ebook",
    };

    let output = Command::new("gs")
        .args([
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.5",
            &format!("-dPDFSETTINGS={}", pdf_setting),
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            "-dDetectDuplicateImages=true",
            "-dCompressFonts=true",
            &format!("-sOutputFile={}", output_path.display()),
            &input_path.display().to_string(),
        ])
        .output()
        .map_err(|e| format!("Failed to launch gs: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Compression failed: {}", stderr));
    }

    let compressed = fs::read(&output_path).map_err(|e| e.to_string())?;
    let compressed_size = compressed.len();
    Ok(CompressResult {
        data: compressed,
        original_size,
        compressed_size,
    })
}

#[tauri::command]
fn protect_pdf(
    data: Vec<u8>,
    user_password: String,
    owner_password: String,
) -> Result<Vec<u8>, String> {
    if !command_exists("qpdf") {
        return Err("qpdf is not installed on this system.".to_string());
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input_path = dir.path().join("in.pdf");
    let output_path = dir.path().join("out.pdf");
    fs::write(&input_path, &data).map_err(|e| e.to_string())?;

    let owner = if owner_password.is_empty() {
        user_password.clone()
    } else {
        owner_password
    };

    let output = Command::new("qpdf")
        .args([
            "--encrypt",
            &user_password,
            &owner,
            "256",
            "--",
            &input_path.display().to_string(),
            &output_path.display().to_string(),
        ])
        .output()
        .map_err(|e| format!("Failed to launch qpdf: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Encryption failed: {}", stderr));
    }

    fs::read(&output_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn unlock_pdf(data: Vec<u8>, password: String) -> Result<Vec<u8>, String> {
    if !command_exists("qpdf") {
        return Err("qpdf is not installed on this system.".to_string());
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input_path = dir.path().join("in.pdf");
    let output_path = dir.path().join("out.pdf");
    fs::write(&input_path, &data).map_err(|e| e.to_string())?;

    let output = Command::new("qpdf")
        .args([
            &format!("--password={}", password),
            "--decrypt",
            &input_path.display().to_string(),
            &output_path.display().to_string(),
        ])
        .output()
        .map_err(|e| format!("Failed to launch qpdf: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Unlock failed (wrong password?): {}", stderr));
    }

    fs::read(&output_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn ocr_pdf(data: Vec<u8>, lang: String) -> Result<Vec<u8>, String> {
    if !command_exists("tesseract") || !command_exists("pdftoppm") {
        return Err("Offline OCR requires tesseract and pdftoppm installed.".to_string());
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input_path = dir.path().join("in.pdf");
    let img_prefix = dir.path().join("page");
    fs::write(&input_path, &data).map_err(|e| e.to_string())?;

    let render = Command::new("pdftoppm")
        .args([
            "-png",
            "-r",
            "200",
            &input_path.display().to_string(),
            &img_prefix.display().to_string(),
        ])
        .output()
        .map_err(|e| format!("Failed to run pdftoppm: {}", e))?;

    if !render.status.success() {
        return Err(format!(
            "Failed to rasterize PDF for OCR: {}",
            String::from_utf8_lossy(&render.stderr)
        ));
    }

    let mut page_images: Vec<PathBuf> = fs::read_dir(dir.path())
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension().map(|e| e == "png").unwrap_or(false)
                && p.file_name()
                    .map(|n| n.to_string_lossy().starts_with("page-"))
                    .unwrap_or(false)
        })
        .collect();
    page_images.sort();

    if page_images.is_empty() {
        return Err("No pages rendered for OCR.".to_string());
    }

    let list_file = dir.path().join("images.txt");
    let list_content: String = page_images
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&list_file, list_content).map_err(|e| e.to_string())?;

    let out_base = dir.path().join("ocr_out");
    let ocr = Command::new("tesseract")
        .args([
            &list_file.display().to_string(),
            &out_base.display().to_string(),
            "-l",
            &lang,
            "pdf",
        ])
        .output()
        .map_err(|e| format!("Failed to run tesseract: {}", e))?;

    if !ocr.status.success() {
        return Err(format!(
            "Tesseract OCR failed: {}",
            String::from_utf8_lossy(&ocr.stderr)
        ));
    }

    let out_pdf = dir.path().join("ocr_out.pdf");
    fs::read(&out_pdf).map_err(|e| format!("Failed to read OCR output: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_capabilities,
            get_omarchy_theme,
            get_cli_file,
            read_file_bytes,
            save_file_bytes,
            compress_pdf,
            protect_pdf,
            unlock_pdf,
            ocr_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running OmaViewer");
}
