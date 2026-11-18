/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        ink: { DEFAULT: '#1b2430', soft: '#4a5666', mute: '#7b8794' },
        line: { DEFAULT: '#e3e7ec', strong: '#cfd6de' },
        canvas: '#f6f7f9',
        brand: { DEFAULT: '#1f4e79', dark: '#173b5c', tint: '#e8eff6' },
      },
      borderRadius: { DEFAULT: '6px' },
    },
  },
  plugins: [],
};
