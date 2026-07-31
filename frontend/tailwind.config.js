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
        amber: 'var(--amber)',
        red: 'var(--red)',
      },
      boxShadow: {
        studio: '0 18px 50px -24px rgba(0, 0, 0, 0.7)',
        'studio-strong': '0 22px 60px -22px rgba(0, 0, 0, 0.8)',
      },
    },
  },
  plugins: [],
};
