/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Press Start 2P"', "system-ui", "sans-serif"],
      },
      colors: {
        grass: "#5EBD3E",
        dirt: "#836953",
        sky: "#6ECFF6",
        stone: "#9E9E9E",
        night: "#0f1115",
      },
      boxShadow: {
        pixel: "0 6px 0 0 #1b5b3c",
      },
    },
  },
  plugins: [],
}
