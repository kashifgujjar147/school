/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: 'rgb(var(--brand) / <alpha-value>)', soft: 'rgb(var(--brand) / 0.08)' },
        accent: { DEFAULT: 'rgb(var(--accent) / <alpha-value>)' },
        ink: { DEFAULT: '#14213d', soft: '#4a5568', faint: '#8a94a6' },
        surface: { DEFAULT: '#ffffff', muted: '#f6f7f9', line: '#e6e8ec' }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        urdu: ['"Jameel Noori Nastaleeq"', '"Noto Nastaliq Urdu"', '"Noto Naskh Arabic"', 'Tahoma', 'sans-serif']
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.2rem' },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' }
    }
  },
  plugins: []
};
