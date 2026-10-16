import { useWorkbenchTheme } from '@/shared/theme';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feedback } from './feedback';
import { X } from './icons';
import { Button, IconButton, T, Toolbar } from './primitives';

interface ModalFrameProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  busy?: boolean;
  size?: 'content' | 'list';
}

/** Shared modal shell; callers choose ScrollView or FlatList for their own content. */
export function ModalFrame({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  busy,
  size = 'content',
}: ModalFrameProps) {
  const theme = useWorkbenchTheme();
  const { width, height } = useWindowDimensions();
  const mobile = width < 700;
  const inset = useSafeAreaInsets();
  if (!visible) return null;
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        style={[
          styles.overlay,
          {
            justifyContent: mobile ? 'flex-end' : 'center',
            padding: mobile ? 0 : 16,
            backgroundColor: theme.overlay,
          },
        ]}
      >
        <Pressable
          accessibilityLabel="关闭面板"
          disabled={busy}
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.surface,
            {
              maxWidth: mobile ? undefined : wide ? 920 : size === 'list' ? 560 : 480,
              maxHeight: mobile ? '90%' : '86%',
              height: size === 'list' ? Math.min(height * 0.86, 650) : undefined,
              backgroundColor: theme.surface,
              borderColor: theme.border,
              borderBottomLeftRadius: mobile ? 0 : 8,
              borderBottomRightRadius: mobile ? 0 : 8,
              paddingBottom: mobile ? inset.bottom : 0,
            },
          ]}
        >
          <Toolbar
            title={title}
            subtitle={subtitle}
            trailing={<IconButton icon={X} label="关闭" disabled={busy} onPress={close} />}
          />
          <View style={[styles.content, size === 'list' && styles.list]}>{children}</View>
          {footer && <View style={[styles.footer, { borderColor: theme.border }]}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Sheet({ children, ...props }: Omit<ModalFrameProps, 'size'>) {
  return (
    <ModalFrame {...props}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
      >
        {children}
      </ScrollView>
    </ModalFrame>
  );
}

export function ConfirmSheet({
  visible,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  busy,
  error,
  danger = false,
  cancelLabel = '取消',
  extraAction,
}: {
  visible: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string;
  danger?: boolean;
  cancelLabel?: string;
  extraAction?: ReactNode;
}) {
  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <View style={styles.actions}>
          {extraAction}
          <Button
            label={confirmLabel}
            variant={danger ? 'danger' : 'primary'}
            busy={busy}
            onPress={onConfirm}
          />
          <Button label={cancelLabel} variant="ghost" disabled={busy} onPress={onClose} />
        </View>
      }
    >
      {typeof description === 'string' ? <T tone="secondary">{description}</T> : description}
      <Feedback error={error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center' },
  surface: { width: '100%', borderRadius: 8, overflow: 'hidden', borderWidth: 1 },
  content: { flexShrink: 1, minHeight: 0 },
  list: { flex: 1 },
  footer: { padding: 10, gap: 8, borderTopWidth: 1 },
  scrollContent: { padding: 12, gap: 10 },
  actions: { gap: 8 },
});
