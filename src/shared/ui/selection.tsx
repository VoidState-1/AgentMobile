import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { T, type IconComponent } from './primitives';
import { useWorkbenchTheme, workbenchMetrics as metrics } from '@/shared/theme';

type Option<T extends string> = {
  value: T;
  label: string;
  accessibilityLabel?: string;
  icon?: IconComponent;
  count?: number;
  disabled?: boolean;
};

export function ViewTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  trailing,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  trailing?: ReactNode;
}) {
  const theme = useWorkbenchTheme();
  return (
    <View
      testID="view-tabs"
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderColor: theme.border,
        gap: 4,
      }}
    >
      {options.map(option => (
        <Pressable
          key={option.value}
          accessibilityRole="tab"
          accessibilityLabel={
            option.accessibilityLabel ??
            option.label + (option.count !== undefined ? ' · ' + option.count : '')
          }
          accessibilityState={{ selected: value === option.value, disabled: option.disabled }}
          aria-selected={value === option.value}
          disabled={option.disabled}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => ({
            minHeight: metrics.touch,
            paddingHorizontal: 10,
            justifyContent: 'center',
            borderBottomWidth: 2,
            borderBottomColor: value === option.value ? theme.accent : 'transparent',
            backgroundColor: pressed ? theme.inset : 'transparent',
            opacity: option.disabled ? 0.4 : 1,
          })}
        >
          <T
            tone={value === option.value ? 'accent' : 'secondary'}
            style={{ fontSize: 13, fontWeight: value === option.value ? '600' : '400' }}
          >
            {option.label}
            {option.count !== undefined ? ' · ' + option.count : ''}
          </T>
        </Pressable>
      ))}
      {!!trailing && (
        <View style={{ flex: 1, alignItems: 'flex-end', paddingRight: 6 }}>{trailing}</View>
      )}
    </View>
  );
}

export function SegmentedControl<T extends string>({
  label,
  hideLabel,
  inline,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  hideLabel?: boolean;
  /** Label and options share one row; use for dense object settings. */
  inline?: boolean;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const theme = useWorkbenchTheme();
  const control = (
    <View
      testID="segmented-control"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 3,
        padding: 3,
        borderRadius: metrics.radius,
        backgroundColor: theme.inset,
      }}
    >
      {options.map(({ icon: Icon, ...option }) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          accessibilityLabel={option.accessibilityLabel ?? label + '：' + option.label}
          accessibilityState={{
            selected: value === option.value,
            disabled: disabled || option.disabled,
          }}
          aria-pressed={value === option.value}
          disabled={disabled || option.disabled}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => ({
            flexGrow: 1,
            flexShrink: 1,
            minHeight: metrics.touch,
            paddingHorizontal: 8,
            flexDirection: 'row',
            gap: 6,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            backgroundColor:
              value === option.value ? theme.surface : pressed ? theme.accentSoft : 'transparent',
            opacity: disabled || option.disabled ? 0.4 : 1,
          })}
        >
          {Icon && (
            <Icon size={16} color={value === option.value ? theme.accent : theme.secondary} />
          )}
          <T tone={value === option.value ? 'accent' : 'secondary'} style={{ fontSize: 12 }}>
            {option.label}
          </T>
        </Pressable>
      ))}
    </View>
  );
  if (inline)
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: 48,
        }}
      >
        <T numberOfLines={1} variant="caption" style={{ width: 72, color: theme.secondary }}>
          {label}
        </T>
        <View style={{ flex: 1, minWidth: 0 }}>{control}</View>
      </View>
    );
  return (
    <View style={{ gap: 5 }}>
      {!hideLabel && <T style={{ fontSize: 12 }}>{label}</T>}
      {control}
    </View>
  );
}
