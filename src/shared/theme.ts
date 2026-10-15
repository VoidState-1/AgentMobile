import { useColorScheme } from 'react-native';
import { useWorkbenchUi } from '@/shared/workbench-state';

const light = {
  dark: false,
  background: '#F5F6F8',
  surface: '#FFFFFF',
  sidebar: '#F9FAFC',
  inset: '#F1F3F7',
  text: '#1C2330',
  secondary: '#687286',
  muted: '#929AAB',
  border: '#E5E9F0',
  accent: '#5264DE',
  accentSoft: '#EEF0FE',
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
  muted: '#707C91',
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

export function useWorkbenchTheme(): WorkbenchTheme {
  const appearance = useWorkbenchUi(state => state.appearance);
  const system = useColorScheme();
  return appearance === 'dark' || (appearance === 'system' && system === 'dark') ? dark : light;
}
