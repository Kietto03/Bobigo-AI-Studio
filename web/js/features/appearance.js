/**
 * Theme & style skin system.
 * Owns the THEMES registry, body-class management and localStorage persistence.
 * main.js creates one controller with its DOM refs and talks to it exclusively.
 */

export const THEMES = {
    obsidian:  { family: "dark",  accent: null,              label: "Obsidian" },
    daylight:  { family: "light", accent: null,              label: "Daylight" },
    indigo:    { family: "dark",  accent: "theme-indigo",    label: "Indigo" },
    evergreen: { family: "dark",  accent: "theme-evergreen", label: "Evergreen" },
    amethyst:  { family: "dark",  accent: "theme-amethyst",  label: "Amethyst" },
    porcelain: { family: "light", accent: "theme-porcelain", label: "Porcelain" },
};

export const THEME_CLASSES = ["dark", "light", "theme-indigo", "theme-evergreen", "theme-amethyst", "theme-porcelain"];
export const STYLE_CLASSES = ["style-pixel"];

export function createAppearance({ body, highlightStyle }) {
    let currentTheme = "daylight";
    let currentStyle = "modern";

    function normalizeTheme(name) {
        if (name === "dark") return "obsidian";
        if (name === "light") return "daylight";
        return THEMES[name] ? name : "daylight";
    }

    function setTheme(name) {
        const theme = THEMES[name] || THEMES.daylight;
        currentTheme = THEMES[name] ? name : "daylight";
        body.classList.remove(...THEME_CLASSES);
        body.classList.add(theme.family);
        if (theme.accent) body.classList.add(theme.accent);
        if (highlightStyle) {
            highlightStyle.href = theme.family === "light"
                ? "vendor/hljs/github.min.css"
                : "vendor/hljs/tokyo-night-dark.min.css";
        }
        localStorage.setItem("bobigo_theme", currentTheme);
        document.querySelectorAll(".theme-swatch").forEach((s) => {
            s.classList.toggle("active", s.getAttribute("data-theme") === currentTheme);
        });
    }

    function initTheme() {
        setTheme(normalizeTheme(localStorage.getItem("bobigo_theme") || "daylight"));
    }

    function setStyle(name) {
        currentStyle = (name === "pixel") ? "pixel" : "modern";
        body.classList.remove(...STYLE_CLASSES);
        if (currentStyle === "pixel") body.classList.add("style-pixel");
        localStorage.setItem("bobigo_style", currentStyle);
        document.querySelectorAll(".style-swatch").forEach((s) => {
            s.classList.toggle("active", s.getAttribute("data-style") === currentStyle);
        });
    }

    function initStyle() {
        setStyle(localStorage.getItem("bobigo_style") || "modern");
    }

    return {
        initTheme,
        setTheme,
        initStyle,
        setStyle,
        get theme() { return currentTheme; },
        get style() { return currentStyle; },
        isLightFamily() { return (THEMES[currentTheme] || THEMES.obsidian).family === "light"; },
    };
}
