/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: 'rgb(var(--brand) / <alpha-value>)', soft: 'rgb(var(--brand) / 0.08)' },
        accent: { DEFAULT: 'rgb(var(--accent) / <alpha-value>)' },
        ink: { DEFAULT: '#14213d', soft: '#4a5568', faint: '#8a94a6' },
        surface: { DEFAULT: '#ffffff', muted: '#f6f7f9', line: '#e6e8ec' },
        // Public website design tokens (set per school from Website Management → Theme & Branding).
        site: {
          primary: 'rgb(var(--site-primary) / <alpha-value>)', secondary: 'rgb(var(--site-secondary) / <alpha-value>)',
          accent: 'rgb(var(--site-accent) / <alpha-value>)', 'accent-text': 'rgb(var(--site-accent-text) / <alpha-value>)',
          'on-primary': 'rgb(var(--site-on-primary) / <alpha-value>)', 'on-accent': 'rgb(var(--site-on-accent) / <alpha-value>)',
          bg: 'rgb(var(--site-bg) / <alpha-value>)', ink: '#101828', soft: '#475467', line: 'rgb(16 24 40 / 0.12)'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: 'var(--site-font-heading)', site: 'var(--site-font-body)',
        urdu: ['"Jameel Noori Nastaleeq"', '"Noto Nastaliq Urdu"', '"Noto Naskh Arabic"', 'Tahoma', 'sans-serif']
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.2rem', site: 'var(--site-radius)' },
      maxWidth: { site: '82rem' },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' }
    }
  },
  plugins: []
};
