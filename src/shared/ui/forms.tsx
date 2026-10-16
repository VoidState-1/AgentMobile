import { useWorkbenchTheme } from '@/shared/theme';
import { IconButton, Input, T, Toolbar } from '@/shared/ui/primitives';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import type { TextInputProps } from 'react-native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from './icons';

export function ConfigPage({
  title,
  subtitle,
  children,
  footer,
  onBack,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
}) {
  const theme = useWorkbenchTheme();
  const inset = useSafeAreaInsets();
  const router = useRouter();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'web' ? undefined : 'padding'}
      testID={theme.dark ? 'config-dark' : 'config-light'}
      style={{
        flex: 1,
        paddingTop: inset.top,
        paddingBottom: footer ? 0 : inset.bottom,
        backgroundColor: theme.surface,
      }}
    >
      <Toolbar
        title={title}
        subtitle={subtitle}
        maxWidth={820}
        leading={
          <IconButton
            icon={ArrowLeft}
            label="返回"
            onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
          />
        }
        trailing={action}
      />
      <View style={{ flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center', minHeight: 0 }}>
        {children}
      </View>
      {footer && (
        <View
          style={{
            backgroundColor: theme.surface,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            paddingBottom: Math.max(inset.bottom, 8),
          }}
        >
          <View
            style={{
              maxWidth: 820,
              width: '100%',
              alignSelf: 'center',
              paddingHorizontal: 12,
              paddingTop: 8,
            }}
          >
            {footer}
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

export function FormScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, gap: 2 }}
    >
      {children}
    </ScrollView>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const theme = useWorkbenchTheme();
  return (
    <View
      style={{
        gap: 6,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderColor: theme.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, gap: 4 }}>
        <T
          accessibilityRole="header"
          variant="label"
          style={{ flex: 1, fontWeight: '600', color: theme.accent }}
        >
          {title}
        </T>
        {action}
      </View>
      {children}
    </View>
  );
}

export function NumberField({
  label,
  unit,
  accessibilityLabel,
  onFocus,
  onBlur,
  ...props
}: Omit<TextInputProps, 'multiline' | 'style'> & { label: string; unit?: string }) {
  const theme = useWorkbenchTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      testID="number-setting"
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }}
    >
      <T numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
        {label}
      </T>
      <Input
        {...props}
        accessibilityLabel={accessibilityLabel ?? label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={props.keyboardType ?? 'number-pad'}
        placeholderTextColor={theme.muted}
        onFocus={event => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={event => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={{
          width: 86,
          minHeight: 44,
          paddingHorizontal: 8,
          paddingVertical: 8,
          textAlign: 'right',
          fontSize: 16,
          color: theme.text,
          borderBottomWidth: 1,
          borderBottomColor: focused ? theme.accent : theme.border,
        }}
      />
      <T tone="secondary" numberOfLines={1} variant="caption" style={{ width: 44 }}>
        {unit ?? ''}
      </T>
    </View>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useWorkbenchTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="label">{label}</T>
        {!!hint && (
          <T tone="muted" variant="meta">
            {hint}
          </T>
        )}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: theme.accent, false: theme.border }}
        thumbColor={Platform.OS === 'android' ? theme.surface : undefined}
      />
    </View>
  );
}

export function Loading() {
  const theme = useWorkbenchTheme();
  return <ActivityIndicator color={theme.accent} style={{ padding: 20 }} />;
}
