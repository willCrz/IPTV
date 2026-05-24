import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        tv: {
          bg:         '#0a0a0f',
          surface:    '#111118',
          card:       '#1a1a24',
          border:     '#2a2a38',
          accent:     '#6c63ff',
          'accent-hover': '#8b84ff',
          muted:      '#4a4a60',
          text:       '#e8e8f0',
          'text-muted': '#8888a8',
          success:    '#22c55e',
          warning:    '#f59e0b',
          danger:     '#ef4444',
          focus:      '#6c63ff',
        },
      },
      boxShadow: {
        'tv-focus': '0 0 0 3px rgba(108, 99, 255, 0.7)',
        'tv-card':  '0 4px 24px rgba(0,0,0,0.4)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.25s ease-out',
        'slide-left': 'slideLeft 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'spin-slow':  'spin 3s linear infinite',
        'zap':        'zap 0.15s ease-out',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:   { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideLeft: { from: { opacity: '0', transform: 'translateX(12px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        zap:       { '0%': { opacity: '0.5', transform: 'scale(0.97)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      screens: {
        'tv-sm': '1280px',
        'tv-md': '1920px',
        'tv-4k': '3840px',
      },
    },
  },
  plugins: [],
} satisfies Config;
