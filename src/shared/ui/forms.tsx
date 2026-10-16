import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from './icons';
import { Button, IconButton, Sheet, T } from './primitives';
import { useWorkbenchTheme } from '@/shared/theme';

export function useDraftGuard(dirty: boolean) {
  const navigation = useNavigation();
  const [leave, setLeave] = useState<() => void>();
  const [allowed, setAllowed] = useState(false);
  const [pending, setPending] = useState<() => void>();
  const allow = (next: () => void) => {
    setAllowed(true);
    setPending(() => next);
  };
  usePreventRemove(dirty && !allowed, ({ data }) =>
    setLeave(() => () => allow(() => navigation.dispatch(data.action))),
  );
  useEffect(() => {
    pending?.();
  }, [pending]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  const exit = (next: () => void) => {
    if (dirty) setLeave(() => () => allow(next));
    else next();
  };
  const guard = (
    <Sheet
      visible={!!leave}
      title="有尚未保存的配置"
      onClose={() => setLeave(undefined)}
      footer={
        <View style={{ gap: 8 }}>
          <Button label="继续编辑" onPress={() => setLeave(undefined)} />
          <Button
            label="放弃修改并离开"
            variant="danger"
            onPress={() => {
              const next = leave;
              setLeave(undefined);
              next?.();
            }}
          />
        </View>
      }
    >
      <T tone="secondary">离开将丢弃当前修改。</T>
    </Sheet>
  );
  return { exit, guard, allow };
}

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
      <View
        style={{
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 820,
            alignSelf: 'center',
            paddingHorizontal: 6,
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <IconButton
            icon={ArrowLeft}
            label="返回"
            onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
          />
          <View style={{ flex: 1, minWidth: 0, paddingVertical: 5 }}>
            <T
              accessibilityRole="header"
              numberOfLines={1}
              style={{ fontWeight: '600', fontSize: 15 }}
            >
              {title}
            </T>
            {!!subtitle && (
              <T tone="muted" numberOfLines={1} style={{ fontSize: 11 }}>
                {subtitle}
              </T>
            )}
          </View>
          {action}
        </View>
      </View>
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
          style={{ flex: 1, fontWeight: '600', fontSize: 13, color: theme.accent }}
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
  ...props
}: Omit<TextInputProps, 'multiline' | 'style'> & { label: string; unit?: string }) {
  const theme = useWorkbenchTheme();
  return (
    <View
      testID="number-setting"
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }}
    >
      <T numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
        {label}
      </T>
      <TextInput
        {...props}
        accessibilityLabel={accessibilityLabel ?? label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={props.keyboardType ?? 'number-pad'}
        placeholderTextColor={theme.muted}
        style={{
          width: 86,
          minHeight: 44,
          paddingHorizontal: 8,
          paddingVertical: 8,
          textAlign: 'right',
          fontSize: 16,
          color: theme.text,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        }}
      />
      <T tone="secondary" numberOfLines={1} style={{ width: 44, fontSize: 12 }}>
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
        <T style={{ fontSize: 13 }}>{label}</T>
        {!!hint && (
          <T tone="muted" style={{ fontSize: 11 }}>
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

export function Choices<TValue extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: TValue;
  options: { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
  disabled?: boolean;
}) {
  const theme = useWorkbenchTheme();
  return (
    <View style={{ gap: 5 }}>
      <T style={{ fontSize: 12 }}>{label}</T>
      <View
        style={{
          flexDirection: 'row',
          gap: 3,
          flexWrap: 'wrap',
          padding: 3,
          borderRadius: 6,
          backgroundColor: theme.inset,
        }}
      >
        {options.map(option => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={label + '：' + option.label}
            accessibilityState={{ selected: value === option.value }}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexShrink: 1,
              minHeight: 44,
              paddingHorizontal: 8,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 4,
              backgroundColor:
                value === option.value ? theme.surface : pressed ? theme.accentSoft : 'transparent',
              opacity: disabled ? 0.45 : 1,
            })}
          >
            <T tone={value === option.value ? 'accent' : 'secondary'} style={{ fontSize: 12 }}>
              {option.label}
            </T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Loading() {
  const theme = useWorkbenchTheme();
  return <ActivityIndicator color={theme.accent} style={{ padding: 20 }} />;
}
