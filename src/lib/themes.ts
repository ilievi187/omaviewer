export interface ThemeDefinition {
  id: string;
  name: string;
  isDark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceHover: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  border: string;
  canvasBg: string;
  scrollbarThumb: string;
}

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: "midnight",
    name: "Midnight Dark",
    isDark: true,
    bg: "#0f1117",
    surface: "#171a23",
    surfaceAlt: "#1f2430",
    surfaceHover: "#283040",
    text: "#eef1f7",
    textMuted: "#9aa4b8",
    accent: "#5b8cff",
    accentText: "#ffffff",
    border: "rgba(255, 255, 255, 0.1)",
    canvasBg: "#0a0c10",
    scrollbarThumb: "#64748b",
  },
  {
    id: "paper",
    name: "Paper Light",
    isDark: false,
    bg: "#f5f6f8",
    surface: "#ffffff",
    surfaceAlt: "#eef0f4",
    surfaceHover: "#e2e6ee",
    text: "#181c25",
    textMuted: "#5b6475",
    accent: "#2563eb",
    accentText: "#ffffff",
    border: "rgba(15, 23, 42, 0.12)",
    canvasBg: "#e5e8ef",
    scrollbarThumb: "#64748b",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    isDark: true,
    bg: "#16161e",
    surface: "#1a1b26",
    surfaceAlt: "#24283b",
    surfaceHover: "#2f3549",
    text: "#c0caf5",
    textMuted: "#7aa2f7",
    accent: "#7aa2f7",
    accentText: "#15161e",
    border: "rgba(192, 202, 245, 0.12)",
    canvasBg: "#11121a",
    scrollbarThumb: "#565f89",
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    isDark: true,
    bg: "#11111b",
    surface: "#1e1e2e",
    surfaceAlt: "#262637",
    surfaceHover: "#313244",
    text: "#cdd6f4",
    textMuted: "#a6adc8",
    accent: "#cba6f7",
    accentText: "#11111b",
    border: "rgba(205, 214, 244, 0.12)",
    canvasBg: "#0d0d16",
    scrollbarThumb: "#6c7086",
  },
  {
    id: "nord",
    name: "Nord Frost",
    isDark: true,
    bg: "#242933",
    surface: "#2e3440",
    surfaceAlt: "#3b4252",
    surfaceHover: "#434c5e",
    text: "#eceff4",
    textMuted: "#a5b1c2",
    accent: "#88c0d0",
    accentText: "#242933",
    border: "rgba(236, 239, 244, 0.12)",
    canvasBg: "#1e222a",
    scrollbarThumb: "#6f7c91",
  },
  {
    id: "gruvbox",
    name: "Gruvbox Warm",
    isDark: true,
    bg: "#1d2021",
    surface: "#282828",
    surfaceAlt: "#32302f",
    surfaceHover: "#3c3836",
    text: "#ebdbb2",
    textMuted: "#bdae93",
    accent: "#fe8019",
    accentText: "#1d2021",
    border: "rgba(235, 219, 178, 0.12)",
    canvasBg: "#161819",
    scrollbarThumb: "#7c6f64",
  },
  {
    id: "sepia",
    name: "Sepia Reading",
    isDark: false,
    bg: "#efe6d5",
    surface: "#f7f0e2",
    surfaceAlt: "#eadcc6",
    surfaceHover: "#dfd0b6",
    text: "#3a2e21",
    textMuted: "#73604b",
    accent: "#a15c26",
    accentText: "#ffffff",
    border: "rgba(58, 46, 33, 0.14)",
    canvasBg: "#e3d6c0",
    scrollbarThumb: "#8b7355",
  },
];

export function applyThemeToRoot(theme: ThemeDefinition) {
  const root = document.documentElement;
  root.style.colorScheme = theme.isDark ? "dark" : "light";
  root.style.setProperty("--bg", theme.bg);
  root.style.setProperty("--surface", theme.surface);
  root.style.setProperty("--surface-alt", theme.surfaceAlt);
  root.style.setProperty("--surface-hover", theme.surfaceHover);
  root.style.setProperty("--text", theme.text);
  root.style.setProperty("--text-muted", theme.textMuted);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-text", theme.accentText);
  root.style.setProperty("--border", theme.border);
  root.style.setProperty("--canvas-bg", theme.canvasBg);
  root.style.setProperty("--scrollbar-thumb", theme.scrollbarThumb);
}
