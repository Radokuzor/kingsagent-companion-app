/**
 * One place for colour and spacing, so the app reads as the same product as
 * the console rather than as a debug tool that grew screens. The palette is
 * the website's: slate surfaces under a violet accent.
 */
export const C = {
  bg: '#0B1020',
  bgDeep: '#070B16',
  card: '#151B2E',
  cardHi: '#1C2438',
  line: '#26304A',
  text: '#F3F5FA',
  dim: '#93A0BD',
  faint: '#64708C',
  accent: '#7C5CFF',
  accentSoft: 'rgba(124,92,255,0.16)',
  good: '#34D399',
  goodSoft: 'rgba(52,211,153,0.14)',
  warn: '#FBBF24',
  warnSoft: 'rgba(251,191,36,0.14)',
  bad: '#F87171',
  badSoft: 'rgba(248,113,113,0.14)',
} as const;

export const R = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
export const S = { xs: 6, sm: 10, md: 16, lg: 22, xl: 30 } as const;
