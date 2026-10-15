import type { ComponentType, ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, useWindowDimensions, View, type TextProps, type TextInputProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Command, type LucideProps } from '@/shared/ui/icons';
import { useWorkbenchTheme } from '@/shared/theme';

export type IconComponent = ComponentType<LucideProps>;

export function T({ tone = 'text', style, ...props }: TextProps & { tone?: 'text' | 'secondary' | 'muted' | 'accent' | 'danger' | 'warning' }) {
  const theme = useWorkbenchTheme();
  return <Text {...props} style={[{ color: theme[tone], fontSize: 14, lineHeight: 21,
    fontFamily: Platform.OS === 'web' ? 'system-ui, "Microsoft YaHei", sans-serif' : undefined }, style]} />;
}

export function Brand({ small }: { small?: boolean }) {
  const theme = useWorkbenchTheme();
  return <View style={{ width: small ? 30 : 36, height: small ? 30 : 36, borderRadius: 10,
    backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
    <Command size={small ? 17 : 21} color={theme.accentText} strokeWidth={2.2} />
  </View>;
}

export function Button({ label, onPress, icon: Icon, disabled, busy, variant = 'primary', style, compact, testID }: {
  label: string; onPress: () => void; icon?: IconComponent; disabled?: boolean; busy?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; style?: StyleProp<ViewStyle>; compact?: boolean; testID?: string;
}) {
  const theme = useWorkbenchTheme();
  const fg = variant === 'primary' ? theme.accentText : variant === 'danger' ? theme.danger : theme.text;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy} testID={testID}
    onPress={onPress} style={({ pressed }) => [{
      minHeight: compact ? 34 : 44, paddingHorizontal: compact ? 11 : 15, borderRadius: 9, borderWidth: variant === 'secondary' ? 1 : 0,
      borderColor: theme.border, backgroundColor: variant === 'primary' ? theme.accent : variant === 'danger' ? theme.dangerSoft : variant === 'secondary' ? theme.surface : 'transparent',
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      opacity: disabled ? 0.38 : pressed ? 0.72 : 1,
    }, style]}>
    {busy ? <ActivityIndicator size="small" color={fg} /> : Icon ? <Icon size={16} color={fg} /> : null}
    <T style={{ color: fg, fontWeight: '600', fontSize: 13, lineHeight: 19 }}>{label}</T>
  </Pressable>;
}

export function IconButton({ icon: Icon, label, onPress, disabled, selected, size = 40 }: {
  icon: IconComponent; label: string; onPress: () => void; disabled?: boolean; selected?: boolean; size?: number;
}) {
  const theme = useWorkbenchTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    hitSlop={size < 44 ? (44 - size) / 2 : 0}
    style={({ pressed }) => ({ width: size, height: size, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      backgroundColor: selected ? theme.accentSoft : pressed ? theme.inset : 'transparent', opacity: disabled ? 0.35 : 1 })}>
    <Icon size={19} color={selected ? theme.accent : theme.secondary} strokeWidth={1.8} />
  </Pressable>;
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const theme = useWorkbenchTheme();
  return <View style={{ gap: 7 }}>
    <T style={{ fontSize: 12, fontWeight: '500' }}>{label}</T>
    <TextInput accessibilityLabel={label} placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} {...props}
      style={[{ minHeight: 44, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inset, borderRadius: 9,
        paddingHorizontal: 12, paddingVertical: 11, color: theme.text, fontSize: 14 }, style]} />
  </View>;
}

export function Sheet({ visible, title, subtitle, onClose, children, footer, wide, busy }: {
  visible: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode;
  footer?: ReactNode; wide?: boolean; busy?: boolean;
}) {
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const mobile = width < 700;
  const inset = useSafeAreaInsets();
  // Mount portals only while visible so nested confirmations appear above the
  // editor/review that opened them, on both web and native modal stacks.
  if (!visible) return null;
  return <Modal visible={visible} transparent animationType="none" onRequestClose={() => { if (!busy) onClose(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'}
      style={[StyleSheet.absoluteFill, { justifyContent: mobile ? 'flex-end' : 'center', alignItems: 'center',
        padding: mobile ? 0 : 24, backgroundColor: theme.overlay }]}>
      <Pressable accessibilityLabel="关闭面板" onPress={() => { if (!busy) onClose(); }} style={StyleSheet.absoluteFill} />
      <View style={{ width: '100%', maxWidth: mobile ? undefined : wide ? 920 : 480, maxHeight: mobile ? '90%' : '86%',
        backgroundColor: theme.surface, borderRadius: mobile ? 18 : 14,
        borderBottomLeftRadius: mobile ? 0 : 14, borderBottomRightRadius: mobile ? 0 : 14,
        paddingBottom: mobile ? Math.max(inset.bottom, 16) : 0, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
        {mobile && <View style={{ alignSelf: 'center', width: 34, height: 4, marginTop: 9, borderRadius: 2, backgroundColor: theme.border }} />}
        <View style={{ paddingHorizontal: 20, paddingVertical: 15, flexDirection: 'row', gap: 12, alignItems: 'center',
          borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <View style={{ flex: 1 }}><T accessibilityRole="header" style={{ fontWeight: '600', fontSize: 16 }}>{title}</T>
            {!!subtitle && <T tone="secondary" style={{ fontSize: 12, marginTop: 3 }}>{subtitle}</T>}</View>
          <IconButton icon={X} label="关闭" disabled={busy} onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 20, gap: 18 }}>
          {children}
        </ScrollView>
        {footer && <View style={{ padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: theme.border }}>{footer}</View>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
