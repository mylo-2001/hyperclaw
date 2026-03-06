/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        claw: { 50: '#ecfeff', 500: '#06b6d4', 900: '#0e7490' }
      },
      fontFamily: { mono: ['JetBrains Mono', 'monospace'] }
    }
  },
  plugins: []
};
