/** @type {import('tailwindcss').Config} */
const config =  {
  content: [
     "./src/renderer/**/*.html",
    "./src/renderer/**/*.js",
  ],
  theme: {
    extend: {
      fontFamily: {
      }
    },
  },
  plugins: [],
}

export default config;