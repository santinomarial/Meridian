/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        "on-primary": "var(--color-on-primary)",
        "primary-container": "var(--color-primary-container)",
        surface: "var(--color-surface)",
        "surface-dim": "var(--color-surface-dim)",
        "surface-variant": "var(--color-surface-variant)",
        "surface-container-low": "var(--color-surface-container-low)",
        "surface-container": "var(--color-surface-container)",
        "surface-container-high": "var(--color-surface-container-high)",
        "surface-container-highest": "var(--color-surface-container-highest)",
        "surface-container-lowest": "var(--color-surface-container-lowest)",
        "on-surface": "var(--color-on-surface)",
        "on-surface-variant": "var(--color-on-surface-variant)",
        outline: "var(--color-outline)",
        "outline-variant": "var(--color-outline-variant)",
        secondary: "var(--color-secondary)",
        "on-secondary": "var(--color-on-secondary)",
        tertiary: "var(--color-tertiary)",
        error: "var(--color-error)",
        "on-error": "var(--color-on-error)",
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "headline-xl": ["36px", { lineHeight: "44px" }],
        "headline-md": ["20px", { lineHeight: "28px" }],
        "body-md": ["14px", { lineHeight: "20px" }],
        "label-md": ["12px", { lineHeight: "16px" }],
        "code-md": ["13px", { lineHeight: "1.6" }],
      },
    },
  },
  plugins: [],
};
