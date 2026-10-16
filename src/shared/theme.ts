import { useWorkbenchUi } from '@/shared/workbench-state';
import { useColorScheme } from 'react-native';

const light = {
  dark: false,
  background: '#F7F8FC',
  surface: '#FFFFFF',
  sidebar: '#F5F6FB',
  inset: '#EFF1F8',
  text: '#1C2330',
  secondary: '#687286',
  muted: '#788397',
  border: '#E5E9F0',
  accent: '#5365C5',
  accentSoft: '#EDF0FC',
  accentText: '#FFFFFF',
  success: '#228064',
  successSoft: '#EAF6F0',
  danger: '#C04753',
  dangerSoft: '#FCEEF0',
  warning: '#A17131',
  warningSoft: '#FBF3E6',
  overlay: '#10162470',
  added: '#ECF8EF',
  removed: '#FDEEF0',
  code: '#F8F9FB',
};
const dark: typeof light = {
  dark: true,
  background: '#111318',
  surface: '#191C23',
  sidebar: '#15181E',
  inset: '#22262F',
  text: '#ECEFF6',
  secondary: '#A3ACBD',
  muted: '#93A0B5',
  border: '#2B303C',
  accent: '#8D99FF',
  accentSoft: '#252D4C',
  accentText: '#161A2D',
  success: '#77CAAD',
  successSoft: '#20352E',
  danger: '#EE8891',
  dangerSoft: '#39262E',
  warning: '#DAB375',
  warningSoft: '#342F25',
  overlay: '#03050BAA',
  added: '#1D3328',
  removed: '#37232B',
  code: '#15181F',
};
export type WorkbenchTheme = typeof light;

export const typography = {
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 13, lineHeight: 20 },
  caption: { fontSize: 12, lineHeight: 19 },
  meta: { fontSize: 11, lineHeight: 17 },
  title: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: '600' as const },
} as const;

export const workbenchMetrics = {
  header: 48,
  touch: 44,
  gutter: 12,
  radius: 6,
  composerRadius: 8,
  body: 14,
} as const;

export function useWorkbenchTheme(): WorkbenchTheme {
  const appearance = useWorkbenchUi(state => state.appearance);
  const system = useColorScheme();
  return appearance === 'dark' || (appearance === 'system' && system === 'dark') ? dark : light;
}
