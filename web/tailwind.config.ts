import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'
import containerQueries from '@tailwindcss/container-queries'

// Tokens extraídos de app.fonio.ai (computed styles, 2026-10-18): shadcn HSL vars + --brand.
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      fontFamily: {
        sans: ['"Geist Variable"', 'Geist', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
        // site público (www): Roboto, como observado em www.fonio.ai
        site: ['"Roboto Variable"', 'Roboto', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: 'hsl(var(--brand) / <alpha-value>)',
        // tokens do site público (computed styles www.fonio.ai, 2026-10-18)
        ink: '#0F0F16',
        body: '#555B6E',
        line: '#E1E3F4',
        'brand-blue': '#585DFE',
        heading: '#020618',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: { DEFAULT: 'hsl(var(--primary) / <alpha-value>)', foreground: 'hsl(var(--primary-foreground) / <alpha-value>)' },
        secondary: { DEFAULT: 'hsl(var(--secondary) / <alpha-value>)', foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)' },
        destructive: { DEFAULT: 'hsl(var(--destructive) / <alpha-value>)', foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)' },
        muted: { DEFAULT: 'hsl(var(--muted) / <alpha-value>)', foreground: 'hsl(var(--muted-foreground) / <alpha-value>)' },
        accent: { DEFAULT: 'hsl(var(--accent) / <alpha-value>)', foreground: 'hsl(var(--accent-foreground) / <alpha-value>)' },
        popover: { DEFAULT: 'hsl(var(--popover) / <alpha-value>)', foreground: 'hsl(var(--popover-foreground) / <alpha-value>)' },
        card: { DEFAULT: 'hsl(var(--card) / <alpha-value>)', foreground: 'hsl(var(--card-foreground) / <alpha-value>)' },
        chart: {
          1: 'hsl(var(--chart-1))', 2: 'hsl(var(--chart-2))', 3: 'hsl(var(--chart-3))', 4: 'hsl(var(--chart-4))', 5: 'hsl(var(--chart-5))',
        },
      },
      fontSize: {
        nav: ['15px', { lineHeight: '22.5px' }],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xs: 'calc(var(--radius) - 6px)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'collapsible-down': { from: { height: '0' }, to: { height: 'var(--radix-collapsible-content-height)' } },
        'collapsible-up': { from: { height: 'var(--radix-collapsible-content-height)' }, to: { height: '0' } },
        'gradient-shift': { '0%, 100%': { backgroundPosition: '0% center' }, '50%': { backgroundPosition: '100% center' } },
        'brand-underline-pulse': {
          '0%, 100%': { textDecorationColor: 'hsl(var(--brand) / .38)' },
          '50%': { textDecorationColor: 'hsl(var(--brand) / 1)' },
        },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        'call-pulse': { '0%, 100%': { transform: 'scale(1)', opacity: '0.6' }, '50%': { transform: 'scale(1.15)', opacity: '0.25' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'collapsible-down': 'collapsible-down 0.2s ease-out',
        'collapsible-up': 'collapsible-up 0.2s ease-out',
        'gradient-shift': 'gradient-shift 4s ease-in-out infinite',
        'brand-underline-pulse': 'brand-underline-pulse 2.4s ease-in-out infinite',
        marquee: 'marquee 40s linear infinite',
        'call-pulse': 'call-pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [animate, containerQueries],
}
export default config
