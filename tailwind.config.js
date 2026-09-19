/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Segoe UI', 'sans-serif']
      }
    }
  },
  plugins: []
}
