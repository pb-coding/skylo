/** @type {import('tailwindcss').Config} */

import color from "tailwindcss/colors";

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/flowbite-react/**/*.js",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      opacity: {
        95: "0.95",
      },
      colors: {
        "theme-bg": color.teal[400],
        "theme-primary": color.green[800],
        "theme-primary-hover": color.green[700],
        "theme-secondary": color.red[400],
        "theme-secondary-hover": color.red[300],
        "theme-tertiary": color.teal[200],
        "theme-font": color.gray[800],
        "theme-accent": color.yellow[500],
      },
      fontFamily: {
        theme: ["Alegreya", "serif"],
      },
      dropShadow: {
        white: "2px 2px 2px rgba(255, 255, 255, 1)",
        black: "2px 2px 2px rgba(0, 0, 0, 1)",
      },
    },
  },
  plugins: [import("flowbite/plugin")],
  darkMode: "class",
};
