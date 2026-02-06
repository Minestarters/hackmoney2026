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
      keyframes: {
        'scan': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-15deg)' },
          '75%': { transform: 'rotate(15deg)' },
        },
        'hammer': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '50%': { transform: 'rotate(-25deg)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'shine': {
          '0%, 100%': { filter: 'brightness(1) drop-shadow(0 0 0px transparent)', transform: 'scale(1)' },
          '50%': { filter: 'brightness(1.3) drop-shadow(0 0 10px rgba(52, 211, 153, 0.6))', transform: 'scale(1.1)' },
        },
      },
      animation: {
        'scan': 'scan 3s ease-in-out infinite',
        'hammer': 'hammer 0.6s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'shine': 'shine 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
