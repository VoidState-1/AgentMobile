import type { ProviderPreset } from '@/core/models/presets';
import type { ModelEntry, ProviderConnection } from '@/core/models/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { DisclosureRow } from '@/shared/ui/disclosure-row';
import { ChevronRight } from '@/shared/ui/icons';
import { T } from '@/shared/ui/primitives';
import { useState } from 'react';
import { StyleSheet, View, type PressableProps } from 'react-native';
import { ProviderIcon } from './provider-icon';

interface ReorderProps {
  onLongPress(): void;
  onMove(delta: -1 | 1): void;
  disabled?: boolean;
  dragging?: boolean;
}
const reorderActions = [
  { name: 'decrement', label: '上移供应商' },
  { name: 'increment', label: '下移供应商' },
];
const moveAction =
  (onMove: ReorderProps['onMove']): PressableProps['onAccessibilityAction'] =>
  event => {
    if (event.nativeEvent.actionName === 'decrement') onMove(-1);
    if (event.nativeEvent.actionName === 'increment') onMove(1);
  };

function ConnectionSummary({ saved, count }: { saved: boolean; count: number }) {
  const theme = useWorkbenchTheme();
  return (
    <View testID="connection-summary" style={styles.trailing}>
      {saved && (
        <T variant="caption" tone="secondary">
          {count} 个模型
        </T>
      )}
      <View
        testID="connection-status"
        aria-hidden
        accessibilityElementsHidden
        style={[
          styles.dot,
          {
            borderColor: saved ? theme.success : theme.muted,
            backgroundColor: saved ? theme.success : 'transparent',
          },
        ]}
      />
    </View>
  );
}

export function ConnectionRow({
  connection,
  models,
  keyReady,
  onOpen,
  providerName,
  onLongPress,
  onMove,
  disabled,
  dragging,
}: {
  connection: ProviderConnection;
  models: ModelEntry[];
  keyReady: boolean;
  onOpen(id: string): void;
  providerName?: string;
} & ReorderProps) {
  const theme = useWorkbenchTheme();
  const saved = connection.auth === 'none' || keyReady;
  return (
    <ActionRow
      label={
        providerName
          ? providerName + (saved ? ' · 已保存连接' : ' · 未保存连接')
          : '打开连接 ' + connection.name
      }
      title={providerName ?? connection.name}
      leading={<ProviderIcon {...connection} />}
      trailing={
        <View style={styles.trailing}>
          <ConnectionSummary
            saved={saved}
            count={models.filter(model => model.connectionId === connection.id).length}
          />
          <ChevronRight size={16} color={theme.muted} />
        </View>
      }
      onPress={() => onOpen(connection.id)}
      onLongPress={onLongPress}
      disabled={disabled || dragging}
      selected={dragging}
      accessibilityActions={reorderActions}
      onAccessibilityAction={moveAction(onMove)}
    />
  );
}

export function ProviderRow({
  preset,
  connections,
  models,
  keys,
  onOpen,
  onConfigure,
  onLongPress,
  onMove,
  disabled,
  dragging,
}: {
  preset: ProviderPreset;
  connections: ProviderConnection[];
  models: ModelEntry[];
  keys: Record<string, boolean>;
  onOpen(id: string): void;
  onConfigure(): void;
} & ReorderProps) {
  const theme = useWorkbenchTheme();
  const [expanded, setExpanded] = useState(false);
  const startDrag = () => {
    if (expanded) {
      setExpanded(false);
      requestAnimationFrame(() => requestAnimationFrame(onLongPress));
    } else onLongPress();
  };
  if (!connections.length)
    return (
      <ActionRow
        label={preset.name + ' · 未保存连接'}
        title={preset.name}
        leading={<ProviderIcon presetId={preset.id} baseUrl={preset.baseUrl} />}
        trailing={
          <View style={styles.trailing}>
            <ConnectionSummary saved={false} count={0} />
            <ChevronRight size={16} color={theme.muted} />
          </View>
        }
        onPress={onConfigure}
        onLongPress={startDrag}
        disabled={disabled || dragging}
        selected={dragging}
        accessibilityActions={reorderActions}
        onAccessibilityAction={moveAction(onMove)}
      />
    );
  if (connections.length === 1)
    return (
      <ConnectionRow
        connection={connections[0]}
        providerName={preset.name}
        models={models}
        keyReady={!!keys[connections[0].id]}
        onOpen={onOpen}
        onLongPress={startDrag}
        onMove={onMove}
        disabled={disabled}
        dragging={dragging}
      />
    );
  const saved = connections.filter(connection => connection.auth === 'none' || keys[connection.id]);
  const savedIds = new Set(saved.map(connection => connection.id));
  return (
    <View
      style={{
        borderBottomWidth: expanded ? 0 : 1,
        borderColor: theme.border,
        backgroundColor: dragging ? theme.accentSoft : 'transparent',
      }}
    >
      <DisclosureRow
        label={preset.name + ' · ' + connections.length + ' 个连接'}
        expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        onLongPress={startDrag}
        disabled={disabled || dragging}
        leading={<ProviderIcon presetId={preset.id} baseUrl={preset.baseUrl} />}
        trailing={
          <ConnectionSummary
            saved={saved.length > 0}
            count={models.filter(model => savedIds.has(model.connectionId)).length}
          />
        }
        accessibilityActions={reorderActions}
        onAccessibilityAction={moveAction(onMove)}
      >
        <T>{preset.name}</T>
      </DisclosureRow>
      {expanded && (
        <View style={[styles.children, { borderColor: theme.border }]}>
          {connections.map(connection => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              models={models}
              keyReady={!!keys[connection.id]}
              onOpen={onOpen}
              disabled={disabled}
              onLongPress={startDrag}
              onMove={onMove}
            />
          ))}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  children: { marginLeft: 4, paddingLeft: 12, borderLeftWidth: 1 },
});
