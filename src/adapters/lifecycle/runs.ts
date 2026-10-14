import { AppState, Platform } from 'react-native';
import type { RunKernel } from '@/application/runs/kernel';

/** Foreground admission only. It does not promise mobile background execution. */
export function bindRunLifecycle(kernel: RunKernel): () => void {
  if (Platform.OS === 'web') {
    const update = () => kernel.setForeground(document.visibilityState !== 'hidden');
    update(); document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }
  kernel.setForeground(AppState.currentState === null || AppState.currentState === 'active');
  const subscription = AppState.addEventListener('change', (state) => kernel.setForeground(state === 'active'));
  return () => subscription.remove();
}
