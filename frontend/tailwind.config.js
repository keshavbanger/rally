/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic theme system (HSL CSS vars from globals.css)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        // Brand tokens
        'card-border': 'hsl(var(--border))',
        'surface-dark': 'hsl(var(--card))',
        'rally-blue': {
          DEFAULT: '#19BFFF',
          secondary: '#1688FF',
          glow: 'rgba(25, 191, 255, 0.25)',
        },
        'rally-text': {
          primary: 'hsl(var(--foreground))',
          secondary: 'hsl(var(--muted-foreground))',
          muted: 'hsl(var(--muted-foreground))',
        },
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      boxShadow: {
        'blue-glow': '0 0 30px rgba(25, 191, 255, 0.25)',
        'blue-glow-lg': '0 0 60px rgba(25, 191, 255, 0.2), 0 0 140px rgba(25, 191, 255, 0.1)',
        'card': '0 4px 20px -2px rgba(0, 0, 0, 0.08)',
        'card-hover': '0 10px 30px -4px rgba(0, 0, 0, 0.12)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['var(--font-instrument-serif)', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'hero': ['4.5rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '500' }],
        'hero-sm': ['2.75rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '500' }],
        'display': ['3.5rem', { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '500' }],
        'display-sm': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '500' }],
      },
      maxWidth: {
        'content': '1280px',
      },
      animation: {
        'pulse-subtle': 'pulse-subtle 3s ease-in-out infinite',
        'float': 'float 4s ease-in-out infinite',
        'live-pulse': 'live-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
