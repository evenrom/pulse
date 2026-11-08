import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        accent: {
          DEFAULT: "#67e8e7",
          bright: "#a7f7f2",
          ink: "#0a2123",
        },
        slate: {
          50: "#f3f9f8",
          100: "#e6f2f1",
          200: "#d3e4e2",
          300: "#bfcece",
          400: "#a8bbbf",
          500: "#8fa5aa",
          600: "#81989e",
          700: "#395158",
          800: "#283d43",
          900: "#152024",
          950: "#0a1215",
        },
      },
    },
  },
  plugins: [],
};
export default config;
