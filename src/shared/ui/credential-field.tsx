import { Button, Field, T } from './primitives';

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
  return (
    <>
      <T tone={changedWarning || remove || !ready ? 'warning' : 'accent'} variant="caption">
        {changedWarning ||
          (remove
            ? '保存后将移除凭证'
            : ready
              ? '凭证已保存 · 留空保留现有凭证'
              : '凭证缺失 · 可先保存连接，稍后补填')}
      </T>
      <Field
        label={label}
        value={value}
        secureTextEntry
        maxLength={8192}
        editable={!disabled}
        placeholder={ready ? '留空保留，填写则替换' : '输入凭证'}
        onChangeText={next => {
          onChange(next);
          onRemoveChange(false);
        }}
      />
      {ready && (
        <Button
          label={remove ? '保留已有凭证' : '移除已有凭证'}
          variant="ghost"
          disabled={disabled}
          onPress={() => {
            onRemoveChange(!remove);
            onChange('');
          }}
        />
      )}
    </>
  );
}
