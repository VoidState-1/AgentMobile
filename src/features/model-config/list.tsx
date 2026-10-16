import { providerPresets, type ProviderPreset } from '@/core/models/presets';
import type { ProviderConnection } from '@/core/models/types';
import {
  connectionKey,
  mergeVisibleProviderOrder,
  orderedProviderKeys,
  providerKey,
} from '@/core/models/provider-order';
import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { EmptyState } from '@/shared/ui/empty-state';
import { ConfigPage, Loading } from '@/shared/ui/forms';
import { Plus } from '@/shared/ui/icons';
import { Button, Field, T } from '@/shared/ui/primitives';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { useModelConfiguration } from './use-configuration';
import { ConnectionRow, ProviderRow } from './provider-row';

type ProviderEntry = { key: string } & (
  | { kind: 'preset'; preset: ProviderPreset; connections: ProviderConnection[] }
  | { kind: 'connection'; connection: ProviderConnection }
);

export function ConnectionList() {
  const controller = useModelConfiguration();
  const { runtime, config, busy, error, action } = controller;
  const theme = useWorkbenchTheme();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [pendingOrder, setPendingOrder] = useState<string[]>();
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ revision: number; order: string[] } | undefined>(undefined);
  useEffect(() => {
    let current = true;
    if (runtime)
      void Promise.all(
        config.connections.map(
          async item => [item.id, await runtime.models.keyReady(item.id)] as const,
        ),
      )
        .then(entries => {
          if (current) setKeys(Object.fromEntries(entries));
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [runtime, config]);
  const defaultModel = config.models.find(model => model.id === config.defaults.global);
  const query = search.trim().toLowerCase();
  const matches = (connection: ProviderConnection) =>
    (connection.name + ' ' + connection.baseUrl).toLowerCase().includes(query);
  const entries: ProviderEntry[] = [];
  for (const preset of providerPresets) {
    if (preset.id === 'custom') continue;
    const connections = config.connections.filter(connection => connection.presetId === preset.id);
    const providerMatches = (preset.name + ' ' + preset.id).toLowerCase().includes(query);
    const matching = providerMatches ? connections : connections.filter(matches);
    if (!query || providerMatches || matching.length)
      entries.push({ key: providerKey(preset.id), kind: 'preset', preset, connections: matching });
  }
  for (const connection of config.connections) {
    if (connection.presetId === 'custom' && matches(connection))
      entries.push({ key: connectionKey(connection.id), kind: 'connection', connection });
  }
  const fullOrder = orderedProviderKeys(pendingOrder ?? config.providerOrder, config.connections);
  entries.sort((a, b) => fullOrder.indexOf(a.key) - fullOrder.indexOf(b.key));
  const saveOrder = (
    visible: ProviderEntry[],
    snapshot = { revision: config.revision, order: fullOrder },
  ) => {
    void action(async () => {
      const next = mergeVisibleProviderOrder(
        snapshot.order,
        visible.map(item => item.key),
      );
      setPendingOrder(next);
      await runtime!.models.setProviderOrder(next, snapshot.revision);
    }).finally(() => setPendingOrder(undefined));
  };
  const move = (key: string, delta: -1 | 1) => {
    if (busy) return;
    const next = [...entries];
    const index = next.findIndex(item => item.key === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    saveOrder(next);
  };
  const openConnection = (id: string) =>
    router.push({ pathname: '/models/connection', params: { id } });
  return (
    <ConfigPage
      title="模型与供应商"
      subtitle={
        config.connections.filter(connection => connection.auth === 'none' || keys[connection.id])
          .length +
        ' 个连接 · ' +
        config.models.length +
        ' 个模型'
      }
    >
      {!runtime ? (
        <Loading />
      ) : (
        <DraggableFlatList
          keyboardShouldPersistTaps="handled"
          data={entries}
          keyExtractor={item => item.key}
          containerStyle={{ flex: 1 }}
          onDragBegin={() => {
            dragStart.current = { revision: config.revision, order: fullOrder };
            setDragging(true);
          }}
          onDragEnd={({ data, from, to }) => {
            setDragging(false);
            if (from !== to && dragStart.current) saveOrder(data, dragStart.current);
            dragStart.current = undefined;
          }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 4 }}>
              {config.models.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
                  <T tone="secondary" variant="caption">
                    全局默认
                  </T>
                  <T numberOfLines={1} style={{ flex: 1 }}>
                    {defaultModel?.name ?? '未选择'}
                  </T>
                  {config.defaults.global && (
                    <Button
                      label="清除默认"
                      compact
                      variant="ghost"
                      disabled={busy}
                      onPress={() => {
                        void action(() => runtime.models.setSelection('global', undefined));
                      }}
                    />
                  )}
                </View>
              )}
              {!!error && <T tone="danger">{error}</T>}
              {!!runtime.models.recoveryIssues.length && (
                <T tone="warning">{runtime.models.recoveryIssues.join('\n')}</T>
              )}
              <Field
                label="搜索供应商"
                hideLabel
                placeholder="搜索供应商"
                value={search}
                onChangeText={setSearch}
                editable={!dragging && !busy}
              />
            </View>
          }
          ListEmptyComponent={<EmptyState compact title="没有匹配的供应商" />}
          ListFooterComponent={
            <ActionRow
              label="添加其他供应商"
              title="添加其他供应商"
              onPress={() =>
                router.push({ pathname: '/models/connection', params: { preset: 'custom' } })
              }
              trailing={<Plus size={18} color={theme.accent} />}
            />
          }
          renderItem={({ item, drag, isActive }) =>
            item.kind === 'preset' ? (
              <ProviderRow
                preset={item.preset}
                connections={item.connections}
                models={config.models}
                keys={keys}
                onLongPress={drag}
                onMove={delta => move(item.key, delta)}
                disabled={busy}
                dragging={isActive}
                onOpen={openConnection}
                onConfigure={() =>
                  router.push({
                    pathname: '/models/connection',
                    params: { preset: item.preset.id },
                  })
                }
              />
            ) : (
              <ConnectionRow
                connection={item.connection}
                models={config.models}
                keyReady={!!keys[item.connection.id]}
                onLongPress={drag}
                onMove={delta => move(item.key, delta)}
                disabled={busy}
                dragging={isActive}
                onOpen={openConnection}
              />
            )
          }
        />
      )}
    </ConfigPage>
  );
}
