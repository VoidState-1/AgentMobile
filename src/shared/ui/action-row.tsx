import { workbenchMetrics as metrics, useWorkbenchTheme } from '@/shared/theme';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { T } from './primitives';

/** One interactive object row, shared by navigation, selection and reference lists. */
export function ActionRow({
  label,
  title,
  description,
  meta,
  metaTone = 'muted',
  leading,
  trailing,
  selected,
  disabled,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
}: {
  label: string;
  title: string;
  description?: string;
  meta?: string;
  metaTone?: 'muted' | 'secondary' | 'warning' | 'danger';
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityActions?: PressableProps['accessibilityActions'];
  onAccessibilityAction?: PressableProps['onAccessibilityAction'];
}) {
  const theme = useWorkbenchTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: theme.border,
          backgroundColor: selected ? theme.accentSoft : pressed ? theme.inset : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      {leading}
      <View style={styles.body}>
        <T numberOfLines={1} variant="body">
          {title}
        </T>
        {!!description && (
          <T numberOfLines={2} tone="secondary" variant="caption">
            {description}
          </T>
        )}
        {!!meta && (
          <T numberOfLines={1} tone={metaTone} variant="meta">
            {meta}
          </T>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: metrics.touch,
    paddingVertical: 7,
    gap: 9,
    borderBottomWidth: 1,
  },
  body: { flex: 1, minWidth: 0, gap: 1 },
});
