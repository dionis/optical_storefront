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
          200: "#BFDBFE",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#0F6FFF",
          700: "#0D63E6",
          800: "#0A4FB8",
          900: "#083D8F",
        },
        sale: "#DC2626",
      },
    },
  },
  plugins: [],
};
