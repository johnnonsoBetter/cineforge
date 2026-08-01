/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['var(--serif)'],
        sans: ['var(--sans)'],
        mono: ['var(--mono)'],
      },
      colors: {
        bg: 'var(--bg)',
        'bg-canvas': 'var(--bg-canvas)',
        'bg-topbar': 'var(--bg-topbar)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        surface3: 'var(--surface-3)',
        line: 'var(--line)',
        'line-soft': 'var(--line-soft)',
        'line-strong': 'var(--line-strong)',
        gold: 'var(--gold)',
        'gold-soft': 'var(--gold-soft)',
        'gold-dim': 'var(--gold-dim)',
        cream: 'var(--cream)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        green: 'var(--green)',
        red: 'var(--red)',
        // Landing palette — gold ramp (re-skins the source's emerald "accent")
        accent: {
          50:  '#fbf3e2',
          100: '#f6e6c4',
          200: '#efd3a0',
          300: '#ecc07a',
          400: '#e4a555',
          500: '#d68f3c',
          600: '#b0762c',
          700: '#8a5c20',
        },
        // Warm near-blacks (re-skins the source's cool "ink")
        ink: {
          950: '#0a0805',
          900: '#131008',
          800: '#1a1410',
          700: '#241d14',
          600: '#2f2618',
        },
        // Full amber ramp so the landing's amber-* highlights resolve (was a flat token,
        // unused as a class in the existing app). Warm secondary accent.
        amber: {
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
      },
      boxShadow: {
        studio: '0 18px 50px -24px rgba(0, 0, 0, 0.7)',
        'studio-strong': '0 22px 60px -22px rgba(0, 0, 0, 0.8)',
      },
    },
  },
  plugins: [],
};
