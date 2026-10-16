import type { AppServices as Runtime } from '@/application/services';
import type { McpAttempt } from '@/core/mcp/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { Section } from '@/shared/ui/forms';
import { Button, T } from '@/shared/ui/primitives';
import { ConfirmSheet } from '@/shared/ui/sheets';
import { useAction } from '@/shared/use-action';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

/** Global receipts remain reachable even after a connection has been deleted. */
export function UnknownCalls({
  runtime,
  serverId,
  disabled,
}: {
  runtime: Runtime;
  serverId?: string;
  disabled?: boolean;
}) {
  const theme = useWorkbenchTheme();
  const [attempts, setAttempts] = useState<McpAttempt[]>([]);
  const [selected, setSelected] = useState<McpAttempt>();
  const { busy, error, setError, action } = useAction();
  useEffect(() => {
    let current = true;
    const refresh = () => {
      void runtime.mcp
        .unknown(serverId)
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
  }, [runtime, serverId, setError]);
  if (!attempts.length && !error) return null;
  return (
    <>
      <Section title="待核对的远端调用">
        <T tone="warning" variant="caption">
          远端可能已执行，解除重试限制前请核对。
        </T>
        {attempts.map(attempt => (
          <View
            key={attempt.id}
            style={{ gap: 5, paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.border }}
          >
            <T tone="warning" variant="caption">
              {attempt.serverName} · {attempt.tool} ·{' '}
              {attempt.state === 'unknown' ? '远端结果未知' : '等待回执或尚未收束'}
            </T>
            <T tone="muted" variant="meta">
              {new Date(attempt.createdAt).toLocaleString()} · {attempt.url}
            </T>
            <T selectable variant="meta">
              {attempt.preview}
            </T>
            <Button
              label={'核对调用 ' + attempt.tool}
              variant="secondary"
              disabled={disabled || busy || attempt.state !== 'unknown'}
              onPress={() => setSelected(attempt)}
            />
          </View>
        ))}
        {!!error && (
          <T tone="danger" variant="caption">
            {error}
          </T>
        )}
      </Section>
      <ConfirmSheet
        visible={!!selected}
        title="解除重试限制"
        busy={busy}
        error={error}
        onClose={() => setSelected(undefined)}
        confirmLabel="已核对，允许再次调用"
        onConfirm={() => {
          void action(async () => {
            await runtime.mcp.acknowledge(selected!.id);
            setAttempts(await runtime.mcp.unknown(serverId));
            setSelected(undefined);
          });
        }}
        description={
          <>
            <T tone="warning">
              解除后，Agent
              可以再次发送相同调用，可能造成重复操作。请确认你已核对远端执行状态。这个操作只解除本地限制，不会立即调用服务器。
            </T>
          </>
        }
      />
    </>
  );
}
