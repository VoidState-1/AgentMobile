import { useEffect, useState } from 'react';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { ConfirmSheet } from '@/shared/ui/sheets';
import { useBeforeUnload } from './use-before-unload';

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
  useBeforeUnload(dirty);
  const exit = (next: () => void) => {
    if (dirty) setLeave(() => () => allow(next));
    else next();
  };
  const guard = (
    <ConfirmSheet
      visible={!!leave}
      title="有尚未保存的配置"
      onClose={() => setLeave(undefined)}
      confirmLabel="放弃修改并离开"
      cancelLabel="继续编辑"
      danger
      description="离开将丢弃当前修改。"
      onConfirm={() => {
        const next = leave;
        setLeave(undefined);
        next?.();
      }}
    />
  );
  return { exit, guard, allow };
}
