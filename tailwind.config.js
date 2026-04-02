/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        dark: {
          50: "#e2e8f0",
          100: "#cbd5e1",
          200: "#94a3b8",
          300: "#64748b",
          400: "#475569",
          500: "#334155",
          600: "#1e293b",
          700: "#172033",
          800: "#111827",
          900: "#0f172a",
          950: "#0a0f1a",
        },
        saffron: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
        "kp-indigo": {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
      },
      fontFamily: {
        serif: ['"Playfair Display"', "Georgia", "serif"],
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.4", transform: "scale(1)" },
          "50%": { opacity: "0.8", transform: "scale(1.15)" },
        },
        "splash-fade": {
          "0%": { opacity: "1" },
          "80%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.3s ease-out",
        "slide-down": "slide-down 0.2s ease-out",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "splash-fade": "splash-fade 2s ease-in-out forwards",
      },
    },
  },
  plugins: [],
};
