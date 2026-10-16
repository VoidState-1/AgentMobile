import { useDraftGuard } from '@/shared/use-draft-guard';
import type { ModelsApi as ModelConfigurationService } from '@/application/services';
import { protocolNames, providerPresets } from '@/core/models/presets';
import { serviceOrigin } from '@/core/models/rules';
import type { ProviderConnection, ProviderPresetId } from '@/core/models/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { CredentialField } from '@/shared/ui/credential-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { FormFooter } from '@/shared/ui/feedback';
import { ConfigPage, Loading, Section, Toggle } from '@/shared/ui/forms';
import { ChevronRight, Plus } from '@/shared/ui/icons';
import { Button, Field, T } from '@/shared/ui/primitives';
import { SegmentedControl, ViewTabs } from '@/shared/ui/selection';
import { ConfirmSheet } from '@/shared/ui/sheets';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { CheckResult } from './check-result';
import { useModelConfiguration, type ModelConfigurationController } from './use-configuration';

type Draft = Parameters<ModelConfigurationService['saveConnection']>[0];
const edit = (value: ProviderConnection): Draft => ({
  id: value.id,
  name: value.name,
  baseUrl: value.baseUrl,
  presetId: value.presetId,
  protocol: value.protocol,
  compatibility: value.compatibility,
  apiVersion: value.apiVersion,
  auth: value.auth,
  enabled: value.enabled,
});

export function ConnectionScreen() {
  const controller = useModelConfiguration();
  const params = useLocalSearchParams<{ id?: string; preset?: ProviderPresetId }>();
  const connection = controller.config.connections.find(item => item.id === params.id);
  if (!controller.runtime)
    return (
      <ConfigPage title="服务连接">
        <Loading />
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </ConfigPage>
    );
  if (params.id && !connection)
    return (
      <ConfigPage title="连接已删除">
        <T style={{ padding: 20 }}>返回列表后重新选择连接。</T>
      </ConfigPage>
    );
  return (
    <ConnectionEditor
      key={params.id ?? params.preset ?? 'custom'}
      controller={controller}
      connection={connection}
      preset={params.preset ?? 'custom'}
    />
  );
}
function ConnectionEditor({
  controller,
  connection,
  preset,
}: {
  controller: ModelConfigurationController;
  connection?: ProviderConnection;
  preset: ProviderPresetId;
}) {
  const { runtime, config, busy, error, action } = controller;
  const router = useRouter();
  const theme = useWorkbenchTheme();
  const template = providerPresets.find(p => p.id === preset) ?? providerPresets[3];
  const initial: Draft = connection
    ? edit(connection)
    : {
        name: template.name,
        presetId: template.id,
        protocol: template.protocol,
        baseUrl: template.baseUrl,
        compatibility: template.compatibility,
        apiVersion: template.apiVersion,
        auth: 'key',
        enabled: true,
      };
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const revision = useRef(connection?.revision);
  const [secret, setSecret] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [keyReady, setKeyReady] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorite' | 'enabled'>('all');
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const probe = useRef<AbortController | undefined>(undefined);
  const [probing, setProbing] = useState(false);
  const dirty = JSON.stringify(draft) !== saved || !!secret || removeKey;
  const guard = useDraftGuard(dirty);
  useEffect(() => {
    let current = true;
    if (runtime && connection)
      void runtime.models.keyReady(connection.id).then(ready => {
        if (current) setKeyReady(ready);
      });
    return () => {
      current = false;
    };
  }, [runtime, connection]);
  useEffect(() => () => probe.current?.abort(), []);
  const update = (value: Partial<Draft>) => {
    setDraft({ ...draft, ...value });
    setNotice('');
  };
  let originChanged = false;
  try {
    originChanged =
      !!connection && serviceOrigin(connection.baseUrl) !== serviceOrigin(draft.baseUrl);
  } catch {}
  const models = config.models.filter(
    item =>
      item.connectionId === connection?.id &&
      (item.name + item.apiId).toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || (filter === 'favorite' ? item.favorite : item.enabled)),
  );
  const save = () => {
    void action(async () => {
      const value = await runtime!.models.saveConnection(
        draft,
        { value: secret || undefined, remove: removeKey },
        revision.current,
      );
      const next = edit(value);
      setSaved(JSON.stringify(next));
      revision.current = value.revision;
      setDraft(next);
      setSecret('');
      setRemoveKey(false);
      setNotice('连接已保存。');
      if (!connection)
        guard.allow(() =>
          router.replace({ pathname: '/models/connection', params: { id: value.id } }),
        );
    });
  };
  const test = () => {
    void action(async () => {
      const controller = new AbortController();
      probe.current = controller;
      setProbing(true);
      try {
        await runtime!.models.diagnose(connection!.id, undefined, 'connection', controller.signal);
      } finally {
        setProbing(false);
        probe.current = undefined;
      }
    });
  };
  return (
    <ConfigPage
      title={connection ? connection.name : '添加服务连接'}
      subtitle={protocolNames[draft.protocol]}
      onBack={() =>
        guard.exit(() => (router.canGoBack() ? router.back() : router.replace('/models')))
      }
      footer={
        <FormFooter error={error} notice={notice}>
          <Button
            label="保存连接"
            busy={busy && !probing}
            disabled={probing || (!dirty && !!connection)}
            onPress={save}
          />
        </FormFooter>
      }
    >
      <FlatList
        data={models}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 4 }}>
            <Section title="连接信息">
              <Field
                label="连接名称"
                value={draft.name}
                maxLength={80}
                editable={!busy}
                onChangeText={name => update({ name })}
              />
              <SegmentedControl
                label="通信协议"
                value={draft.protocol}
                disabled={busy}
                options={Object.entries(protocolNames).map(([value, label]) => ({
                  value: value as Draft['protocol'],
                  label,
                }))}
                onChange={protocol =>
                  update({
                    protocol,
                    compatibility:
                      protocol === 'chat-completions' ? draft.compatibility : 'standard',
                    apiVersion: protocol === 'anthropic-messages' ? '2023-06-01' : '',
                    auth: protocol === 'chat-completions' ? draft.auth : 'key',
                  })
                }
              />
              <Field
                label="服务基础地址"
                value={draft.baseUrl}
                editable={!busy}
                placeholder="https://api.example.com/v1"
                keyboardType="url"
                onChangeText={baseUrl => update({ baseUrl })}
              />
              {draft.protocol === 'anthropic-messages' && (
                <Field
                  label="Anthropic API 版本"
                  value={draft.apiVersion}
                  editable={!busy}
                  onChangeText={apiVersion => update({ apiVersion })}
                />
              )}
              {draft.protocol === 'chat-completions' && (
                <SegmentedControl
                  label="兼容特性"
                  value={draft.compatibility}
                  disabled={busy}
                  options={[
                    { value: 'standard', label: '标准兼容' },
                    { value: 'deepseek', label: 'DeepSeek' },
                  ]}
                  onChange={compatibility => update({ compatibility })}
                />
              )}
              <Toggle
                label="启用连接"
                value={draft.enabled}
                disabled={busy}
                hint={
                  connection && runtime!.models.affectedDefaults(connection.id)
                    ? '该连接被默认选择引用。停用后新任务会提示重新选择。'
                    : undefined
                }
                onChange={enabled => update({ enabled })}
              />
            </Section>
            <Section title="认证与凭证">
              {draft.protocol === 'chat-completions' && (
                <SegmentedControl
                  label="认证方式"
                  value={draft.auth}
                  disabled={busy}
                  options={[
                    { value: 'key', label: 'API Key' },
                    { value: 'none', label: '无需认证' },
                  ]}
                  onChange={auth => {
                    update({ auth });
                    setSecret('');
                  }}
                />
              )}
              {draft.auth === 'key' && (
                <CredentialField
                  label={keyReady ? '替换 API Key' : 'API Key'}
                  value={secret}
                  onChange={setSecret}
                  ready={keyReady}
                  remove={removeKey}
                  onRemoveChange={setRemoveKey}
                  disabled={busy}
                  changedWarning={
                    originChanged ? '服务 Origin 已变更，保存时需重新绑定密钥。' : undefined
                  }
                />
              )}
            </Section>
            {connection && (
              <>
                <Section title="服务检测">
                  <Button
                    label="检测连接并发现模型"
                    variant="secondary"
                    busy={probing}
                    disabled={!connection || dirty || busy}
                    onPress={test}
                  />
                  {probing && (
                    <Button
                      label="取消检测"
                      variant="ghost"
                      onPress={() => probe.current?.abort()}
                    />
                  )}
                  <CheckResult result={connection?.check} history={connection?.checkHistory} />
                </Section>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <View>
                    <T style={{ fontWeight: '600' }}>模型目录</T>
                    {!!connection?.catalogAt && (
                      <T tone="muted" variant="meta">
                        更新于 {new Date(connection.catalogAt).toLocaleString()}
                      </T>
                    )}
                  </View>
                  <Button
                    label="手工添加"
                    icon={Plus}
                    compact
                    variant="secondary"
                    disabled={!connection || dirty || busy}
                    onPress={() =>
                      router.push({
                        pathname: '/models/model',
                        params: { connectionId: connection!.id },
                      })
                    }
                  />
                </View>
                <Field
                  label="搜索模型"
                  hideLabel
                  value={search}
                  placeholder="显示名或请求 ID"
                  onChangeText={setSearch}
                />
                <ViewTabs
                  label="目录筛选"
                  value={filter}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'favorite', label: '收藏', accessibilityLabel: '目录筛选：收藏' },
                    { value: 'enabled', label: '已启用' },
                  ]}
                  onChange={setFilter}
                />
              </>
            )}
          </View>
        }
        ListEmptyComponent={connection ? <EmptyState compact title="暂无匹配模型" /> : null}
        renderItem={({ item }) => (
          <ActionRow
            label={'编辑模型 ' + item.name}
            onPress={() =>
              router.push({
                pathname: '/models/model',
                params: { id: item.id, connectionId: item.connectionId },
              })
            }
            disabled={dirty || busy}
            title={(item.favorite ? '★ ' : '') + item.name}
            description={item.apiId}
            meta={
              (item.enabled ? '已启用' : '已停用') +
              ' · ' +
              (item.catalog.missing
                ? '最近目录未发现'
                : item.catalog.source === 'discovered'
                  ? '来自目录'
                  : '手工配置')
            }
            metaTone={item.catalog.missing ? 'warning' : 'secondary'}
            trailing={<ChevronRight size={16} color={theme.muted} />}
          />
        )}
        ListFooterComponent={
          connection ? (
            <View style={{ gap: 6, marginTop: 10 }}>
              <Button
                label="复制连接"
                variant="secondary"
                disabled={dirty || busy}
                onPress={() => {
                  void action(async () => {
                    const copied = await runtime!.models.copyConnection(connection.id);
                    guard.allow(() =>
                      router.replace({ pathname: '/models/connection', params: { id: copied.id } }),
                    );
                  });
                }}
              />
              <Button
                label="删除连接"
                variant="danger"
                disabled={busy}
                onPress={() => setDeleting(true)}
              />
            </View>
          ) : null
        }
      />
      {guard.guard}
      <ConfirmSheet
        visible={deleting}
        title="删除这个连接？"
        busy={busy}
        onClose={() => setDeleting(false)}
        confirmLabel="确认删除连接"
        onConfirm={() => {
          void action(async () => {
            await runtime!.models.removeConnection(connection!.id);
            guard.allow(() => router.replace('/models'));
          });
        }}
        danger
        description={
          <>
            <T tone="secondary">
              将删除连接与所属模型。{runtime!.models.affectedDefaults(connection?.id ?? '')}{' '}
              处默认选择将失效，需要重新选择。历史任务与正在运行的任务仍保留启动时配置。
            </T>
          </>
        }
      />
    </ConfigPage>
  );
}
