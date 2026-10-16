import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { AppServices as Runtime } from '@/application/services';
import type { McpAttempt } from '@/core/mcp/types';
import { Section } from '@/shared/ui/forms';
import { Button, Sheet, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';

/** Global receipts remain reachable even after a connection has been deleted. */
export function UnknownCalls({ runtime }: { runtime: Runtime }) {
  const theme = useWorkbenchTheme();
  const [attempts, setAttempts] = useState<McpAttempt[]>([]);
  const [selected, setSelected] = useState<McpAttempt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const refresh = () => {
      void runtime.mcp
        .unknown()
        .then(values => {
          if (current) setAttempts(values);
        })
        .catch(() => {
          if (current) setError('调用记录读取失败，请重开应用。');
        });
    };
    refresh();
    const unsubscribe = runtime.agent.subscribe(refresh);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [runtime]);
  if (!attempts.length && !error) return null;
  return (
    <>
      <Section title="待核对的远端调用">
        <T tone="warning" style={{ fontSize: 12 }}>
          远端可能已执行，解除重试限制前请核对。
        </T>
        {attempts.map(attempt => (
          <View
            key={attempt.id}
            style={{ gap: 5, paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.border }}
          >
            <T tone="warning" style={{ fontSize: 12 }}>
              {attempt.serverName} · {attempt.tool} ·{' '}
              {attempt.state === 'unknown' ? '远端结果未知' : '等待回执或尚未收束'}
            </T>
            <T tone="muted" style={{ fontSize: 11 }}>
              {new Date(attempt.createdAt).toLocaleString()} · {attempt.url}
            </T>
            <T selectable style={{ fontSize: 11 }}>
              {attempt.preview}
            </T>
            <Button
              label={'核对调用 ' + attempt.tool}
              variant="secondary"
              disabled={busy || attempt.state !== 'unknown'}
              onPress={() => setSelected(attempt)}
            />
          </View>
        ))}
        {!!error && (
          <T tone="danger" style={{ fontSize: 12 }}>
            {error}
          </T>
        )}
      </Section>
      <Sheet
        visible={!!selected}
        title="解除重试限制"
        onClose={() => setSelected(undefined)}
        busy={busy}
        footer={
          <Button
            label="已核对，允许再次调用"
            busy={busy}
            onPress={() => {
              setBusy(true);
              setError('');
              void (async () => {
                try {
                  await runtime.mcp.acknowledge(selected!.id);
                  setAttempts(await runtime.mcp.unknown());
                  setSelected(undefined);
                } catch {
                  setError('记录保存失败，请重试。');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          />
        }
      >
        <T tone="warning">
          解除后，Agent
          可以再次发送相同调用，可能造成重复操作。请确认你已核对远端执行状态。这个操作只解除本地限制，不会立即调用服务器。
        </T>
      </Sheet>
    </>
  );
}
