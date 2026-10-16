import { useWorkbenchTheme } from '@/shared/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { T, type IconComponent } from './primitives';

export function EmptyState({
  title,
  icon: Icon,
  action,
  compact = false,
}: {
  title: string;
  icon?: IconComponent;
  action?: ReactNode;
  compact?: boolean;
}) {
  const theme = useWorkbenchTheme();
  return (
    <View style={[styles.container, compact ? styles.compact : styles.full]}>
      {Icon && <Icon size={24} color={theme.accent} />}
      <T tone={compact ? 'secondary' : 'text'} variant={compact ? 'caption' : 'title'}>
        {title}
      </T>
      {action}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { padding: 12, gap: 10 },
  full: { alignItems: 'center', justifyContent: 'center' },
  compact: { alignItems: 'flex-start' },
});
