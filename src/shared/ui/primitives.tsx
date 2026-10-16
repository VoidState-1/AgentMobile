import { typography, useWorkbenchTheme, workbenchMetrics } from '@/shared/theme';
import { Command, type LucideProps } from '@/shared/ui/icons';
import { forwardRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

export type IconComponent = ComponentType<LucideProps>;

export function T({
  tone = 'text',
  variant = 'body',
  style,
  ...props
}: TextProps & {
  tone?: 'text' | 'secondary' | 'muted' | 'accent' | 'danger' | 'warning';
  variant?: keyof typeof typography;
}) {
  const theme = useWorkbenchTheme();
  return (
    <Text
      {...props}
      style={[
        {
          color: theme[tone],
          ...typography[variant],
          fontFamily:
            Platform.OS === 'web' ? 'system-ui, "Microsoft YaHei", sans-serif' : undefined,
        },
        style,
      ]}
    />
  );
}

export const Input = forwardRef<TextInput, TextInputProps>(function Input(
  { style, ...props },
  ref,
) {
  const theme = useWorkbenchTheme();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={theme.muted}
      {...props}
      style={[
        { color: theme.text, fontSize: 16 },
        Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined,
        style,
      ]}
    />
  );
});

export function Brand({ small }: { small?: boolean }) {
  const theme = useWorkbenchTheme();
  return (
    <View
      style={{
        width: small ? 30 : 36,
        height: small ? 30 : 36,
        borderRadius: 10,
        backgroundColor: theme.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Command size={small ? 17 : 21} color={theme.accentText} strokeWidth={2.2} />
    </View>
  );
}

export function Toolbar({
  title,
  subtitle,
  leading,
  trailing,
  children,
  testID,
  maxWidth,
}: {
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
  testID?: string;
  maxWidth?: number;
}) {
  const theme = useWorkbenchTheme();
  return (
    <View
      testID={testID}
      style={{ borderBottomWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}
    >
      <View
        style={{
          minHeight: workbenchMetrics.header,
          paddingHorizontal: 4,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          maxWidth,
          alignSelf: 'center',
        }}
      >
        {leading}
        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 6 }}>
          {children ?? (
            <>
              <T
                accessibilityRole="header"
                numberOfLines={1}
                variant="title"
                style={{ fontWeight: '600' }}
              >
                {title}
              </T>
              {!!subtitle && (
                <T numberOfLines={1} tone="muted" variant="meta">
                  {subtitle}
                </T>
              )}
            </>
          )}
        </View>
        {trailing}
      </View>
    </View>
  );
}

export function ToolbarAction({
  label,
  text,
  icon: Icon,
  onPress,
  disabled,
  busy,
  primary,
}: {
  label: string;
  text?: string;
  icon?: IconComponent;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
}) {
  const theme = useWorkbenchTheme();
  const color = primary ? theme.accent : theme.secondary;
  if (Icon && !text && !busy)
    return <IconButton icon={Icon} label={label} disabled={disabled} onPress={onPress} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: workbenchMetrics.touch,
        minHeight: workbenchMetrics.touch,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 5,
        borderRadius: workbenchMetrics.radius,
        backgroundColor: pressed ? theme.inset : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : Icon ? (
        <Icon size={19} color={color} />
      ) : null}
      {!!text && (
        <T variant="label" style={{ fontWeight: '600', color }}>
          {text}
        </T>
      )}
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  icon: Icon,
  disabled,
  busy,
  variant = 'primary',
  style,
  compact,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: IconComponent;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useWorkbenchTheme();
  const fg =
    variant === 'primary' ? theme.accentText : variant === 'danger' ? theme.danger : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled || busy}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingHorizontal: compact ? 11 : 15,
          borderRadius: workbenchMetrics.radius,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: theme.border,
          backgroundColor:
            variant === 'primary'
              ? theme.accent
              : variant === 'danger'
                ? theme.dangerSoft
                : variant === 'secondary'
                  ? theme.surface
                  : 'transparent',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          opacity: disabled ? 0.38 : pressed ? 0.72 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : Icon ? (
        <Icon size={16} color={fg} />
      ) : null}
      <T variant="label" style={{ color: fg, fontWeight: '600' }}>
        {label}
      </T>
    </Pressable>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled,
  selected,
  size = 44,
}: {
  icon: IconComponent;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  size?: number;
}) {
  const theme = useWorkbenchTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={size < 44 ? (44 - size) / 2 : 0}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: workbenchMetrics.radius,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? theme.accentSoft : pressed ? theme.inset : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Icon size={19} color={selected ? theme.accent : theme.secondary} strokeWidth={1.8} />
    </Pressable>
  );
}

export function Field({
  label,
  hideLabel,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { label: string; hideLabel?: boolean }) {
  const theme = useWorkbenchTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 5, minWidth: 0 }}>
      {!hideLabel && (
        <T variant="caption" style={{ fontWeight: '500' }}>
          {label}
        </T>
      )}
      <Input
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={event => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={event => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
        style={[
          {
            minHeight: 44,
            borderWidth: 1,
            borderColor: focused ? theme.accent : theme.border,
            backgroundColor: theme.inset,
            borderRadius: workbenchMetrics.radius,
            paddingHorizontal: 10,
            paddingVertical: 9,
            color: theme.text,
            fontSize: 16,
          },
          style,
        ]}
      />
    </View>
  );
}
