import { useWorkbenchTheme, workbenchMetrics } from '@/shared/theme';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronDown, ChevronRight } from './icons';

export function DisclosureRow({
  label,
  expanded,
  onPress,
  leading,
  trailing,
  children,
  disabled,
  style,
}: {
  label: string;
  expanded: boolean;
  onPress(): void;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useWorkbenchTheme();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded, disabled }}
      aria-expanded={expanded}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.inset : 'transparent', opacity: disabled ? 0.4 : 1 },
        style,
      ]}
    >
      {leading}
      <View style={styles.body}>{children}</View>
      {trailing}
      <Chevron size={13} color={theme.muted} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: workbenchMetrics.touch, gap: 7 },
  body: { flex: 1, minWidth: 0 },
});
