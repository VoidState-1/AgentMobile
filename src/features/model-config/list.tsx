import { protocolNames, providerPresets } from '@/core/models/presets';
import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { EmptyState } from '@/shared/ui/empty-state';
import { ConfigPage, Loading } from '@/shared/ui/forms';
import { ChevronRight, Plus } from '@/shared/ui/icons';
import { Button, Field, T, ToolbarAction } from '@/shared/ui/primitives';
import { SegmentedControl } from '@/shared/ui/selection';
import { Sheet } from '@/shared/ui/sheets';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useModelConfiguration } from './use-configuration';

export function ConnectionList() {
  const controller = useModelConfiguration();
  const { runtime, config, busy, error, action } = controller;
  const theme = useWorkbenchTheme();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
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
  return (
    <ConfigPage
      title="模型与供应商"
      subtitle={config.connections.length + ' 个连接 · ' + config.models.length + ' 个模型'}
      action={
        config.connections.length > 0 ? (
          <ToolbarAction label="添加连接" icon={Plus} onPress={() => setAdding(true)} />
        ) : undefined
      }
    >
      {!runtime ? (
        <Loading />
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          data={config.connections.filter(item =>
            (item.name + item.baseUrl).toLowerCase().includes(search.toLowerCase()),
          )}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 4 }}>
              <SegmentedControl
                label="运行模式"
                value={config.mode}
                disabled={busy}
                options={[
                  { value: 'demo', label: '演示模式' },
                  { value: 'remote', label: '模型服务' },
                ]}
                onChange={mode => {
                  void action(() => runtime.models.setMode(mode));
                }}
              />
              {config.mode === 'remote' && config.models.length > 0 && (
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
              {config.connections.length > 0 && (
                <Field
                  label="搜索连接"
                  hideLabel
                  placeholder="搜索连接"
                  value={search}
                  onChangeText={setSearch}
                />
              )}
            </View>
          }
          ListEmptyComponent={
            config.connections.length ? (
              <EmptyState compact title="没有匹配的连接" />
            ) : (
              <View testID="model-onboarding">
                <EmptyState
                  compact
                  title="连接模型服务"
                  action={<Button label="添加连接" icon={Plus} onPress={() => setAdding(true)} />}
                />
              </View>
            )
          }
          renderItem={({ item }) => (
            <ActionRow
              label={'打开连接 ' + item.name}
              onPress={() =>
                router.push({ pathname: '/models/connection', params: { id: item.id } })
              }
              title={item.name}
              description={item.baseUrl}
              meta={
                protocolNames[item.protocol] +
                ' · ' +
                config.models.filter(m => m.connectionId === item.id).length +
                ' 个模型 · ' +
                (item.enabled
                  ? keys[item.id]
                    ? item.auth === 'none'
                      ? '无需密钥'
                      : '凭证已保存'
                    : '需补填凭证'
                  : '已停用')
              }
              metaTone={!item.enabled || !keys[item.id] ? 'warning' : 'secondary'}
              leading={
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 5,
                    backgroundColor: theme.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <T tone="accent" variant="title">
                    {item.name[0].toUpperCase()}
                  </T>
                </View>
              }
              trailing={<ChevronRight size={16} color={theme.muted} />}
            />
          )}
        />
      )}
      <Sheet visible={adding} title="选择供应商" onClose={() => setAdding(false)}>
        {providerPresets.map(preset => (
          <ActionRow
            key={preset.id}
            label={preset.name}
            title={preset.name}
            onPress={() => {
              setAdding(false);
              router.push({ pathname: '/models/connection', params: { preset: preset.id } });
            }}
            trailing={<ChevronRight size={16} color={theme.muted} />}
          />
        ))}
      </Sheet>
    </ConfigPage>
  );
}
