import { useState } from 'react';
import { ActionRow } from './action-row';
import { MoreHorizontal } from './icons';
import { IconButton } from './primitives';
import { Sheet } from './sheets';

export function OverflowMenu({
  label,
  disabled,
  items,
}: {
  label: string;
  disabled?: boolean;
  items: { label: string; onPress: () => void; disabled?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon={MoreHorizontal}
        label={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        {items.map(item => (
          <ActionRow
            key={item.label}
            label={item.label}
            title={item.label}
            disabled={item.disabled}
            onPress={() => {
              setOpen(false);
              item.onPress();
            }}
          />
        ))}
      </Sheet>
    </>
  );
}
