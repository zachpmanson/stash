export const Colors = {
  bg: '#0f0f14',
  surface: '#1a1a24',
  surface2: '#242434',
  surface3: '#2e2e42',
  accent: '#7c6af7',
  accentDim: 'rgba(124,106,247,0.15)',
  text: '#f0f0f8',
  textSecondary: '#8080a0',
  textMuted: '#4a4a6a',
  success: '#4ade80',
  danger: '#f87171',
  warning: '#fbbf24',
  border: '#2a2a3a',
  overlay: 'rgba(0,0,0,0.6)',
  white: '#ffffff',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const Typography = {
  heading: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  subheading: { fontSize: 18, fontWeight: '600' as const, color: Colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.text },
  caption: { fontSize: 13, fontWeight: '400' as const, color: Colors.textSecondary },
  label: { fontSize: 12, fontWeight: '500' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
} as const;
