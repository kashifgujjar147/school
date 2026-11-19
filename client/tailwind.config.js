/** @type {import('tailwindcss').Config} */
/*
 * Design tokens. Brand and accent come from the school's settings (CSS variables set at runtime);
 * everything else is a fixed, restrained institutional palette: deep ink, warm ivory neutrals and
 * hairline borders. Use these tokens instead of raw colours so the whole app stays consistent.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: 'rgb(var(--brand) / <alpha-value>)', soft: 'rgb(var(--brand) / 0.08)', deep: 'rgb(var(--brand-deep) / <alpha-value>)' },
        accent: { DEFAULT: 'rgb(var(--accent) / <alpha-value>)', soft: 'rgb(var(--accent) / 0.12)' },
        ink: { DEFAULT: '#12153d', soft: '#4a5070', faint: '#8a90a8' },
        // Sidebar / dark chrome.
        night: { DEFAULT: '#0d1033', soft: '#161a4a', line: 'rgb(255 255 255 / 0.08)' },
        surface: { DEFAULT: '#ffffff', muted: '#f5f7fb', sunken: '#edf0f6', line: '#e2e6ef' },
        // Public website design tokens (set per school from Website Management → Theme & Branding).
        site: {
          primary: 'rgb(var(--site-primary) / <alpha-value>)', secondary: 'rgb(var(--site-secondary) / <alpha-value>)',
          accent: 'rgb(var(--site-accent) / <alpha-value>)', 'accent-text': 'rgb(var(--site-accent-text) / <alpha-value>)',
          'on-primary': 'rgb(var(--site-on-primary) / <alpha-value>)', 'on-accent': 'rgb(var(--site-on-accent) / <alpha-value>)',
          bg: 'rgb(var(--site-bg) / <alpha-value>)', ink: '#101828', soft: '#475467', line: 'rgb(16 24 40 / 0.12)'
        }
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Institutional serif for page titles and brand moments in the dashboards.
        serif: ['"Cormorant Garamond"', '"Iowan Old Style"', '"Palatino Linotype"', 'Georgia', 'serif'],
        display: 'var(--site-font-heading)', site: 'var(--site-font-body)',
        urdu: ['"Jameel Noori Nastaleeq"', '"Noto Nastaliq Urdu"', '"Noto Naskh Arabic"', 'Tahoma', 'sans-serif']
      },
      fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] },
      letterSpacing: { eyebrow: '0.18em' },
      borderRadius: { xl: '0.75rem', '2xl': '1rem', '3xl': '1.375rem', site: 'var(--site-radius)' },
      maxWidth: { site: '82rem' },
      boxShadow: {
        card: '0 1px 2px rgb(15 27 45 / 0.04), 0 1px 1px rgb(15 27 45 / 0.02)',
        raised: '0 1px 2px rgb(15 27 45 / 0.04), 0 8px 24px -12px rgb(15 27 45 / 0.14)',
        overlay: '0 24px 64px -16px rgb(15 27 45 / 0.35), 0 2px 6px rgb(15 27 45 / 0.06)',
        inset: 'inset 0 1px 0 rgb(255 255 255 / 0.12)'
      },
      transitionTimingFunction: { lux: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(8px) scale(0.985)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        'drawer-in': { from: { transform: 'translateX(var(--drawer-from, -100%))' }, to: { transform: 'none' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } }
      },
      // Transform animations use 'backwards' fill: once finished they stop applying, so the element is
      // not left as a containing block that would trap position:fixed children (modals, drawers).
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 0.61, 0.36, 1) backwards',
        'fade-in': 'fade-in 0.25s ease-out both',
        'pop-in': 'pop-in 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) backwards',
        'sheet-up': 'sheet-up 0.35s cubic-bezier(0.22, 0.61, 0.36, 1) backwards',
        'drawer-in': 'drawer-in 0.32s cubic-bezier(0.22, 0.61, 0.36, 1) backwards',
        shimmer: 'shimmer 1.6s linear infinite'
      }
    }
  },
  plugins: []
};
