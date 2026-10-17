import { useWorkbenchTheme } from '@/shared/theme';
import { StyleSheet, View } from 'react-native';
import { T } from './primitives';

/** Non-modal transient feedback; it never takes focus or intercepts touches. */
export function Toast({
  message,
  tone = 'info',
  bottom = 12,
}: {
  message: string;
  tone?: 'info' | 'danger';
  bottom?: number;
}) {
  const theme = useWorkbenchTheme();
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom }]}>
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.pill,
          {
            backgroundColor: tone === 'danger' ? theme.danger : theme.text,
            shadowColor: '#000000',
          },
        ]}
      >
        <T numberOfLines={3} variant="caption" style={{ color: theme.surface }}>
          {message}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 30 },
  pill: {
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
