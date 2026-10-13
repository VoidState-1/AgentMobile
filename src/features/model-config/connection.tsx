import { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ModelConfigurationService } from '@/core/models/service';
import type { ProviderConnection, ProviderPresetId } from '@/core/models/types';
import { providerPresets, protocolNames } from '@/core/models/presets';
import { serviceOrigin } from '@/core/models/rules';
import { runDiagnostic } from '@/adapters/model/diagnostics';
import { Button, Field, Sheet, T } from '@/features/workbench/ui';
import { ChevronRight, Plus } from '@/features/workbench/icons';
import { useWorkbenchTheme } from '@/features/workbench/theme';
import { CheckResult, Choices, ConfigPage, Loading, Section, Toggle, useConfiguration, useDraftGuard, type ConfigurationController } from './common';

type Draft = Parameters<ModelConfigurationService['saveConnection']>[0];
const edit = (value: ProviderConnection): Draft => ({ id: value.id, name: value.name, baseUrl: value.baseUrl, presetId: value.presetId,
  protocol: value.protocol, compatibility: value.compatibility, apiVersion: value.apiVersion, auth: value.auth, enabled: value.enabled });

export function ConnectionScreen() {
  const controller = useConfiguration(); const params = useLocalSearchParams<{ id?: string; preset?: ProviderPresetId }>();
  const connection = controller.config.connections.find((item) => item.id === params.id);
  if (!controller.runtime) return <ConfigPage title="服务连接"><Loading />{!!controller.error && <T tone="danger">{controller.error}</T>}</ConfigPage>;
  if (params.id && !connection) return <ConfigPage title="连接已删除"><T style={{ padding: 20 }}>返回列表后重新选择连接。</T></ConfigPage>;
  return <ConnectionEditor key={params.id ?? params.preset ?? 'custom'} controller={controller} connection={connection} preset={params.preset ?? 'custom'} />;
}
function ConnectionEditor({ controller, connection, preset }: { controller: ConfigurationController; connection?: ProviderConnection; preset: ProviderPresetId }) {
  const { runtime, config, busy, error, action } = controller; const router = useRouter(); const theme = useWorkbenchTheme();
  const template = providerPresets.find((p) => p.id === preset) ?? providerPresets[3];
  const initial: Draft = connection ? edit(connection) : { name: template.name, presetId: template.id, protocol: template.protocol,
    baseUrl: template.baseUrl, compatibility: template.compatibility, apiVersion: template.apiVersion, auth: 'key', enabled: true };
  const [draft, setDraft] = useState(initial); const [saved, setSaved] = useState(JSON.stringify(initial)); const revision = useRef(connection?.revision);
  const [secret, setSecret] = useState(''); const [removeKey, setRemoveKey] = useState(false); const [keyReady, setKeyReady] = useState(false);
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState<'all' | 'favorite' | 'enabled'>('all');
  const [deleting, setDeleting] = useState(false); const [notice, setNotice] = useState(''); const probe = useRef<AbortController | undefined>(undefined); const [probing, setProbing] = useState(false);
  const dirty = JSON.stringify(draft) !== saved || !!secret || removeKey; const guard = useDraftGuard(dirty);
  useEffect(() => { let current = true;
    if (runtime && connection) void runtime.models.keyReady(connection.id).then((ready) => { if (current) setKeyReady(ready); });
    return () => { current = false; };
  }, [runtime, connection]);
  useEffect(() => () => probe.current?.abort(), []);
  const update = (value: Partial<Draft>) => { setDraft({ ...draft, ...value }); setNotice(''); };
  let originChanged = false;
  try { originChanged = !!connection && serviceOrigin(connection.baseUrl) !== serviceOrigin(draft.baseUrl); } catch {}
  const models = config.models.filter((item) => item.connectionId === connection?.id && (item.name + item.apiId).toLowerCase().includes(search.toLowerCase()) &&
    (filter === 'all' || (filter === 'favorite' ? item.favorite : item.enabled)));
  const save = () => { void action(async () => {
    const value = await runtime!.models.saveConnection(draft, { value: secret || undefined, remove: removeKey }, revision.current);
    const next = edit(value); setSaved(JSON.stringify(next)); revision.current = value.revision; setDraft(next); setSecret(''); setRemoveKey(false); setNotice('连接已保存。');
    if (!connection) guard.allow(() => router.replace({ pathname: '/models/connection', params: { id: value.id } }));
  }); };
  const test = () => { void action(async () => {
    const controller = new AbortController(); probe.current = controller; setProbing(true);
    try { await runDiagnostic(runtime!.models, connection!.id, undefined, 'connection', Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'ios' : 'android', controller.signal); }
    finally { setProbing(false); probe.current = undefined; }
  }); };
  return <ConfigPage title={connection ? connection.name : '添加服务连接'} subtitle={protocolNames[draft.protocol]}
    onBack={() => guard.exit(() => router.canGoBack() ? router.back() : router.replace('/models'))}
    footer={<View style={{ gap: 6 }}>
      {!!error && <T tone="danger" style={{ fontSize: 12 }}>{error}</T>}{!!notice && <T tone="accent" style={{ fontSize: 12 }}>{notice}</T>}
      <Button label="保存连接" busy={busy && !probing} disabled={probing || (!dirty && !!connection)} onPress={save} />
    </View>}>
    <FlatList data={models} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 10 }}
      ListHeaderComponent={<View style={{ gap: 16, marginBottom: 6 }}>
        <Section title="连接信息">
          <Field label="连接名称" value={draft.name} maxLength={80} editable={!busy} onChangeText={(name) => update({ name })} />
          <Choices label="通信协议" value={draft.protocol} disabled={busy} options={Object.entries(protocolNames).map(([value, label]) => ({ value: value as Draft['protocol'], label }))}
            onChange={(protocol) => update({ protocol, compatibility: protocol === 'chat-completions' ? draft.compatibility : 'standard',
              apiVersion: protocol === 'anthropic-messages' ? '2023-06-01' : '', auth: protocol === 'chat-completions' ? draft.auth : 'key' })} />
          <Field label="服务基础地址" value={draft.baseUrl} editable={!busy} placeholder="https://api.example.com/v1" keyboardType="url" onChangeText={(baseUrl) => update({ baseUrl })} />
          <T tone="muted" style={{ fontSize: 11 }}>请求地址：{draft.baseUrl.replace(/\/+$/, '')}/{draft.protocol === 'anthropic-messages' ? 'messages' : draft.protocol === 'gemini' ? 'models/模型:streamGenerateContent' : 'chat/completions'}</T>
          {draft.protocol === 'anthropic-messages' && <Field label="Anthropic API 版本" value={draft.apiVersion} editable={!busy} onChangeText={(apiVersion) => update({ apiVersion })} />}
          {draft.protocol === 'chat-completions' && <Choices label="兼容特性" value={draft.compatibility} disabled={busy}
            options={[{ value: 'standard', label: '标准兼容' }, { value: 'deepseek', label: 'DeepSeek' }]} onChange={(compatibility) => update({ compatibility })} />}
          <Toggle label="启用连接" value={draft.enabled} disabled={busy} hint={connection && runtime!.models.affectedDefaults(connection.id) ? '该连接被默认选择引用。停用后新任务会提示重新选择。' : '停用后保留配置和历史。'} onChange={(enabled) => update({ enabled })} />
        </Section>
        <Section title="认证与凭证" hint={Platform.OS === 'web' ? '刷新页面后需要重新填写密钥。' : '密钥写入设备安全存储，编辑时只显示保存状态。'}>
          {draft.protocol === 'chat-completions' && <Choices label="认证方式" value={draft.auth} disabled={busy} options={[{ value: 'key', label: 'API Key' }, { value: 'none', label: '无需认证' }]}
            onChange={(auth) => { update({ auth }); setSecret(''); }} />}
          {draft.auth === 'key' && <>
            <T tone={originChanged || removeKey || !keyReady ? 'warning' : 'accent'} style={{ fontSize: 12 }}>{originChanged ? '服务 Origin 已变更，保存时需重新绑定密钥。' : removeKey ? '保存后将移除凭证' : keyReady ? '凭证已保存 · 留空保留现有密钥' : '凭证缺失 · 可先保存连接，稍后补填'}</T>
            <Field label={keyReady ? '替换 API Key' : 'API Key'} secureTextEntry value={secret} editable={!busy} placeholder={keyReady ? '输入新密钥，或留空保留' : '输入服务密钥'}
              onChangeText={(value) => { setSecret(value); setRemoveKey(false); }} />
            {keyReady && <Button label={removeKey ? '保留已有凭证' : '移除已有凭证'} variant="ghost" disabled={busy} onPress={() => { setRemoveKey(!removeKey); setSecret(''); }} />}
          </>}
        </Section>
        <Section title="服务检测" hint="读取模型目录，不生成内容。发现失败仍可手工添加。">
          <Button label="检测连接并发现模型" variant="secondary" busy={probing} disabled={!connection || dirty || busy}
            onPress={test} />{probing && <Button label="取消检测" variant="ghost" onPress={() => probe.current?.abort()} />}
          <CheckResult result={connection?.check} history={connection?.checkHistory} />{dirty && <T tone="muted" style={{ fontSize: 11 }}>先保存当前草稿，再使用已保存配置检测。</T>}
        </Section>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View><T style={{ fontWeight: '600' }}>模型目录</T>{!!connection?.catalogAt && <T tone="muted" style={{ fontSize: 10 }}>更新于 {new Date(connection.catalogAt).toLocaleString()}</T>}</View>
          <Button label="手工添加" icon={Plus} compact variant="secondary" disabled={!connection || dirty || busy}
            onPress={() => router.push({ pathname: '/models/model', params: { connectionId: connection!.id } })} />
        </View>
        <Field label="搜索模型" value={search} placeholder="显示名或请求 ID" onChangeText={setSearch} />
        <Choices label="目录筛选" value={filter} options={[{ value: 'all', label: '全部' }, { value: 'favorite', label: '收藏' }, { value: 'enabled', label: '已启用' }]} onChange={setFilter} />
      </View>}
      ListEmptyComponent={<T tone="muted" style={{ padding: 12, fontSize: 12 }}>{connection ? '暂无匹配模型。可发现目录或手工添加。' : '保存连接后可添加模型。'}</T>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={'编辑模型 ' + item.name} disabled={dirty || busy}
        onPress={() => router.push({ pathname: '/models/model', params: { id: item.id, connectionId: item.connectionId } })}
        style={{ padding: 14, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, flexDirection: 'row', gap: 10, alignItems: 'center', opacity: dirty ? 0.5 : 1 }}>
        <View style={{ flex: 1 }}><T style={{ fontSize: 13, fontWeight: '500' }}>{item.favorite ? '★ ' : ''}{item.name}</T>
          <T tone="muted" style={{ fontSize: 11 }} numberOfLines={1}>{item.apiId}</T>
          <T tone={item.catalog.missing ? 'warning' : 'secondary'} style={{ fontSize: 10 }}>{item.enabled ? '已启用' : '已停用'} · {item.catalog.missing ? '最近目录未发现' : item.catalog.source === 'discovered' ? '来自目录' : '手工配置'}</T></View>
        <ChevronRight size={16} color={theme.muted} />
      </Pressable>}
      ListFooterComponent={connection ? <View style={{ gap: 8, marginTop: 16 }}>
        <Button label="复制连接" variant="secondary" disabled={dirty || busy} onPress={() => { void action(async () => {
          const copied = await runtime!.models.copyConnection(connection.id); guard.allow(() => router.replace({ pathname: '/models/connection', params: { id: copied.id } }));
        }); }} />
        <T tone="muted" style={{ fontSize: 11 }}>复制模型与参数，副本需要单独填写密钥。</T>
        <Button label="删除连接" variant="danger" disabled={busy} onPress={() => setDeleting(true)} />
      </View> : null} />
    {guard.guard}
    <Sheet visible={deleting} title="删除这个连接？" busy={busy} onClose={() => setDeleting(false)} footer={<Button label="确认删除连接" variant="danger" busy={busy} onPress={() => { void action(async () => {
      await runtime!.models.removeConnection(connection!.id); guard.allow(() => router.replace('/models'));
    }); }} />}><T tone="secondary">将删除连接与所属模型。{runtime!.models.affectedDefaults(connection?.id ?? '')} 处默认选择将失效，需要重新选择。历史任务与正在运行的任务仍保留启动时配置。</T></Sheet>
  </ConfigPage>;
}
