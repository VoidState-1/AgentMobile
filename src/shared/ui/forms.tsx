import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
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
      <T tone="secondary">保存后才能让新任务使用这些设置。</T>
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
      style={{ flex: 1, paddingTop: inset.top, backgroundColor: theme.background }}
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
            maxWidth: 960,
            alignSelf: 'center',
            paddingHorizontal: 12,
            minHeight: 66,
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
          <View style={{ flex: 1 }}>
            <T accessibilityRole="header" style={{ fontWeight: '600', fontSize: 17 }}>
              {title}
            </T>
            {!!subtitle && (
              <T tone="muted" style={{ fontSize: 11 }}>
                {subtitle}
              </T>
            )}
          </View>
          {action}
        </View>
      </View>
      <View style={{ flex: 1, width: '100%', maxWidth: 960, alignSelf: 'center', minHeight: 0 }}>
        {children}
      </View>
      {footer && (
        <View
          style={{
            backgroundColor: theme.surface,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            paddingBottom: Math.max(inset.bottom, 12),
          }}
        >
          <View
            style={{
              maxWidth: 960,
              width: '100%',
              alignSelf: 'center',
              paddingHorizontal: 20,
              paddingTop: 12,
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
      contentContainerStyle={{ padding: 18, gap: 16 }}
    >
      {children}
    </ScrollView>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const theme = useWorkbenchTheme();
  return (
    <View
      style={{
        gap: 14,
        padding: 16,
        backgroundColor: theme.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <View>
        <T style={{ fontWeight: '600', fontSize: 13 }}>{title}</T>
        {!!hint && (
          <T tone="secondary" style={{ fontSize: 11, marginTop: 3 }}>
            {hint}
          </T>
        )}
      </View>
      {children}
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
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
    <View style={{ gap: 8 }}>
      <T style={{ fontSize: 12 }}>{label}</T>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {options.map(option => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={label + '：' + option.label}
            accessibilityState={{ selected: value === option.value }}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            style={{
              minHeight: 40,
              paddingHorizontal: 12,
              justifyContent: 'center',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: value === option.value ? theme.accent : theme.border,
              backgroundColor: value === option.value ? theme.accentSoft : theme.inset,
            }}
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
  return <ActivityIndicator color={theme.accent} style={{ padding: 40 }} />;
}
