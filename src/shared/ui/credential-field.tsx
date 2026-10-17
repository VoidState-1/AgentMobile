import { useState } from 'react';
import { View } from 'react-native';
import { Eye, EyeOff } from './icons';
import { Button, Field, IconButton, T } from './primitives';

/** Editing contract only; credential reads and writes remain in AppServices. */
export function CredentialField({
  label,
  value,
  onChange,
  ready,
  remove,
  onRemoveChange,
  changedWarning,
  disabled,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  ready: boolean;
  remove: boolean;
  onRemoveChange(remove: boolean): void;
  changedWarning?: string;
  disabled?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const warning = !!changedWarning || remove;
  return (
    <View style={{ gap: 6 }}>
      <Field
        label={label}
        value={value}
        secureTextEntry={!revealed}
        maxLength={8192}
        editable={!disabled}
        placeholder={ready ? '留空保留，填写则替换' : '输入凭证'}
        onChangeText={next => {
          onChange(next);
          onRemoveChange(false);
        }}
        trailing={
          <IconButton
            icon={revealed ? EyeOff : Eye}
            label={revealed ? '隐藏凭证' : '显示凭证'}
            disabled={disabled}
            size={40}
            onPress={() => setRevealed(current => !current)}
          />
        }
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T tone={warning ? 'warning' : 'muted'} variant="meta" style={{ flex: 1 }}>
          {changedWarning ||
            (remove
              ? '保存后将移除凭证'
              : value.trim()
                ? ready
                  ? '保存后将替换凭证'
                  : '将保存此凭证'
                : ready
                  ? '已保存凭证，留空则保留'
                  : '尚未填写凭证，可稍后补填')}
        </T>
        {ready && (
          <Button
            label={remove ? '保留凭证' : '移除凭证'}
            variant="ghost"
            compact
            disabled={disabled}
            onPress={() => {
              onRemoveChange(!remove);
              onChange('');
            }}
          />
        )}
      </View>
    </View>
  );
}
