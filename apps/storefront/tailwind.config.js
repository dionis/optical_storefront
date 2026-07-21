/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        accent: {
          DEFAULT: "#0F6FFF",
          50: "#EFF6FF",
          100: "#DBEAFE",
          600: "#0F6FFF",
          700: "#0D63E6",
        },
      },
    },
  },
  plugins: [],
};
