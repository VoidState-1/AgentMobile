import { useWorkbenchTheme } from '@/shared/theme';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActionRow } from './action-row';

/** In-page popover menu: no dimmed overlay, no modal focus trap. */
export function PageMenu({
  visible,
  items,
  onClose,
}: {
  visible: boolean;
  items: readonly { label: string; onPress: () => void; disabled?: boolean }[];
  onClose: () => void;
}) {
  const theme = useWorkbenchTheme();
  if (!visible) return null;
  return (
    <>
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.menu, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {items.map(item => (
          <ActionRow
            key={item.label}
            label={item.label}
            title={item.label}
            disabled={item.disabled}
            onPress={() => {
              onClose();
              item.onPress();
            }}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 220,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    zIndex: 20,
    elevation: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
});
