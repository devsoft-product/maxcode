/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Newsreader', '"Iowan Old Style"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        composer: '0 1px 1px rgba(74, 54, 38, 0.035), 0 18px 44px -20px rgba(74, 54, 38, 0.22), 0 0 0 1px rgba(74, 54, 38, 0.025)',
        float: '0 22px 60px -24px rgba(58, 41, 28, 0.38), 0 0 0 1px rgba(74, 54, 38, 0.06)',
        pill: '0 1px 2px rgba(74, 54, 38, 0.07), 0 1px 1px rgba(74, 54, 38, 0.025)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        caret: {
          '0%, 100%': { opacity: '0.15' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(0.92)', opacity: '0.75' },
        },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        fade: 'fade 0.2s ease-out both',
        caret: 'caret 1s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
        breathe: 'breathe 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
