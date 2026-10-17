import type { ModelsApi as ModelConfigurationService } from '@/application/services';
import { publicError } from '@/core/errors';
import { getProviderPreset, protocolNames } from '@/core/models/presets';
import { normalizedServiceAddress, serviceOrigin } from '@/core/models/rules';
import type { ProviderConnection, ProviderPresetId } from '@/core/models/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { useDraftGuard } from '@/shared/use-draft-guard';
import { ActionRow } from '@/shared/ui/action-row';
import { DisclosureRow } from '@/shared/ui/disclosure-row';
import { EmptyState } from '@/shared/ui/empty-state';
import { FormFooter } from '@/shared/ui/feedback';
import { ConfigPage, Loading } from '@/shared/ui/forms';
import {
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from '@/shared/ui/icons';
import { Button, Field, IconButton, Input, T } from '@/shared/ui/primitives';
import { SegmentedControl, ViewTabs } from '@/shared/ui/selection';
import { ConfirmSheet } from '@/shared/ui/sheets';
import { Toast } from '@/shared/ui/toast';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { ProviderIcon } from './provider-icon';
import { useModelConfiguration, type ModelConfigurationController } from './use-configuration';

type Draft = Parameters<ModelConfigurationService['saveConnection']>[0];
type Filter = 'all' | 'favorite' | 'enabled';
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
  icon: value.icon,
});

const nameProblem = (name: string) => (name.trim() ? undefined : '请输入连接名称。');
function addressProblem(value: string) {
  try {
    normalizedServiceAddress(value);
    return undefined;
  } catch (error) {
    return publicError(error).message;
  }
}

export function ConnectionScreen() {
  const controller = useModelConfiguration();
  const params = useLocalSearchParams<{ id?: string; preset?: ProviderPresetId }>();
  if (!controller.runtime)
    return (
      <ConfigPage title="服务连接">
        <Loading />
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </ConfigPage>
    );
  const connection = params.id
    ? controller.config.connections.find(item => item.id === params.id)
    : undefined;
  if (params.id && !connection)
    return (
      <ConfigPage title="连接已删除">
        <T style={{ padding: 20 }}>返回列表后重新选择连接。</T>
      </ConfigPage>
    );
  return (
    <ConnectionEditor
      controller={controller}
      connection={connection}
      preset={connection?.presetId ?? params.preset ?? 'custom'}
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
  const template = getProviderPreset(preset);
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
  const [connectionId, setConnectionId] = useState(connection?.id);
  const revision = useRef(connection?.revision);
  const [secret, setSecret] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [removeKey, setRemoveKey] = useState(false);
  const [keyReady, setKeyReady] = useState(false);
  const [touched, setTouched] = useState({ name: false, baseUrl: false });
  const [editingName, setEditingName] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'danger' }>();
  const probe = useRef<AbortController | undefined>(undefined);
  const [probing, setProbing] = useState(false);
  const savedConnection = config.connections.find(item => item.id === connectionId);
  const connectionRevision = savedConnection?.revision;
  const dirty = JSON.stringify(draft) !== saved || !!secret || removeKey;
  const guard = useDraftGuard(dirty);
  const nameError = nameProblem(draft.name);
  const addressError = addressProblem(draft.baseUrl);
  const valid = !nameError && !addressError;
  useEffect(() => {
    let current = true;
    if (runtime && connectionId)
      void runtime.models
        .keyReady(connectionId)
        .then(ready => {
          if (current) setKeyReady(ready);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [runtime, connectionId, connectionRevision]);
  useEffect(() => () => probe.current?.abort(), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), toast.tone === 'danger' ? 4200 : 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  const update = (value: Partial<Draft>) => {
    setDraft(current => ({ ...current, ...value }));
    setNotice('');
  };
  let originChanged = false;
  try {
    originChanged =
      !!savedConnection && serviceOrigin(savedConnection.baseUrl) !== serviceOrigin(draft.baseUrl);
  } catch {}
  const credentialReady =
    draft.auth === 'none' || (!removeKey && (!!secret.trim() || (keyReady && !originChanged)));
  const allModels = config.models.filter(item => item.connectionId === connectionId);
  const models = allModels.filter(
    item =>
      (item.name + item.apiId).toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || (filter === 'favorite' ? item.favorite : item.enabled)),
  );
  const apply = (value: ProviderConnection) => {
    const next = edit(value);
    setDraft(next);
    setSaved(JSON.stringify(next));
    setConnectionId(value.id);
    revision.current = value.revision;
    setSecret('');
    setRemoveKey(false);
    setTouched({ name: false, baseUrl: false });
    setEditingName(false);
  };
  const persist = async () => {
    const value = await runtime!.models.saveConnection(
      draft,
      { value: secret || undefined, remove: removeKey },
      revision.current,
    );
    const first = !savedConnection;
    apply(value);
    if (first) {
      Keyboard.dismiss();
      router.setParams({ id: value.id });
    }
    return value;
  };
  const save = () => {
    setMenuOpen(false);
    void action(async () => {
      await persist();
      setNotice('连接已保存。');
    });
  };
  const test = () => {
    void action(async () => {
      const target = dirty || !savedConnection ? await persist() : savedConnection;
      setNotice('');
      const controller = new AbortController();
      probe.current = controller;
      setProbing(true);
      Keyboard.dismiss();
      try {
        const result = await runtime!.models.diagnose(
          target.id,
          undefined,
          'connection',
          controller.signal,
        );
        if (result.status === 'passed') {
          const found = runtime!.models
            .getSnapshot()
            .models.filter(item => item.connectionId === target.id).length;
          setToast({ message: found ? '发现 ' + found + ' 个模型' : '未发现模型' });
        } else if (result.status === 'cancelled') setToast({ message: '已取消检测' });
        else setToast({ message: result.message, tone: 'danger' });
      } finally {
        setProbing(false);
        probe.current = undefined;
      }
    });
  };
  const copy = () => {
    if (!savedConnection) return;
    void action(async () => {
      const copied = await runtime!.models.copyConnection(savedConnection.id);
      setKeyReady(false);
      apply(copied);
      router.setParams({ id: copied.id });
      setNotice('已复制连接，凭证需要重新填写。');
    });
  };
  const openModel = (id?: string) => {
    if (!savedConnection) return;
    router.push({
      pathname: '/models/model',
      params: id ? { id, connectionId: savedConnection.id } : { connectionId: savedConnection.id },
    });
  };
  const changeProtocol = (protocol: Draft['protocol']) =>
    update({
      protocol,
      compatibility: protocol === 'chat-completions' ? draft.compatibility : 'standard',
      apiVersion: protocol === 'anthropic-messages' ? '2023-06-01' : '',
      auth: protocol === 'chat-completions' ? draft.auth : 'key',
    });
  const changeAuth = (auth: Draft['auth']) => {
    update({ auth });
    setSecret('');
    setRemoveKey(false);
  };
  const meta = [
    preset === 'custom' ? '自定义服务' : undefined,
    protocolNames[draft.protocol],
    draft.auth === 'none' ? '无需认证' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const showRemove = keyReady && !removeKey;
  const keyPlaceholder = removeKey
    ? '输入凭证'
    : originChanged && !secret
      ? '重新输入凭证'
      : keyReady
        ? '已保存，留空保留'
        : '输入凭证';
  return (
    <ConfigPage
      title={savedConnection ? '连接设置' : '添加连接'}
      onBack={() =>
        guard.exit(() => (router.canGoBack() ? router.back() : router.replace('/models')))
      }
      action={
        draft.icon || savedConnection ? (
          <IconButton
            icon={MoreHorizontal}
            label="更多操作"
            selected={menuOpen}
            disabled={busy}
            onPress={() => setMenuOpen(current => !current)}
          />
        ) : undefined
      }
      footer={
        <FormFooter error={error} notice={notice}>
          <Button
            label="保存连接"
            busy={busy && !probing}
            disabled={probing || !valid || (!dirty && !!savedConnection)}
            onPress={save}
          />
        </FormFooter>
      }
    >
      <FlatList
        data={models}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <View style={[styles.identity, { borderColor: theme.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="上传供应商图标"
                disabled={busy}
                onPress={() => {
                  void action(async () => {
                    const file = await runtime!.io.pickFile('image');
                    if (file) update({ icon: runtime!.models.prepareIcon(file) });
                  });
                }}
                style={({ pressed }) => ({ opacity: busy ? 0.4 : pressed ? 0.7 : 1 })}
              >
                <ProviderIcon {...draft} size={44} />
                <View
                  style={[
                    styles.iconBadge,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <Upload size={10} color={theme.secondary} strokeWidth={2} />
                </View>
              </Pressable>
              <View style={styles.identityBody}>
                <View style={styles.nameRow}>
                  {editingName ? (
                    <>
                      <Input
                        accessibilityLabel="连接名称"
                        value={draft.name}
                        maxLength={80}
                        editable={!busy}
                        autoFocus
                        placeholder="未命名连接"
                        placeholderTextColor={theme.muted}
                        returnKeyType="done"
                        onFocus={() => setNameFocused(true)}
                        onBlur={() => {
                          setNameFocused(false);
                          setTouched(current => ({ ...current, name: true }));
                          setEditingName(false);
                        }}
                        onSubmitEditing={() => {
                          setEditingName(false);
                          Keyboard.dismiss();
                        }}
                        onChangeText={name => update({ name })}
                        style={[
                          styles.nameInput,
                          { color: theme.text },
                          nameFocused && { backgroundColor: theme.inset },
                        ]}
                      />
                      <IconButton
                        icon={Check}
                        label="完成编辑名称"
                        disabled={busy}
                        size={32}
                        onPress={() => {
                          setEditingName(false);
                          Keyboard.dismiss();
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <T
                        accessibilityRole="header"
                        numberOfLines={1}
                        style={[
                          styles.nameText,
                          { color: draft.name.trim() ? theme.text : theme.muted },
                        ]}
                      >
                        {draft.name.trim() || '未命名连接'}
                      </T>
                      <IconButton
                        icon={Pencil}
                        label="编辑连接名称"
                        disabled={busy}
                        size={32}
                        onPress={() => setEditingName(true)}
                      />
                    </>
                  )}
                </View>
                <T numberOfLines={1} tone="muted" variant="meta">
                  {meta}
                </T>
                {!!(nameError && touched.name) && (
                  <T tone="danger" variant="meta">
                    {nameError}
                  </T>
                )}
              </View>
              <View style={[styles.enable, { opacity: busy ? 0.4 : 1 }]}>
                <T variant="meta" style={{ fontSize: 10 }}>
                  启用
                </T>
                <Switch
                  accessibilityLabel="启用连接"
                  value={draft.enabled}
                  disabled={busy}
                  onValueChange={enabled => update({ enabled })}
                  {...(Platform.OS === 'web'
                    ? ({ activeThumbColor: theme.surface } as object)
                    : null)}
                  trackColor={{ true: theme.accent, false: theme.border }}
                  thumbColor={Platform.OS === 'ios' ? undefined : theme.surface}
                />
              </View>
            </View>

            <Field
              inline
              label="服务地址"
              value={draft.baseUrl}
              editable={!busy}
              placeholder="https://api.example.com/v1"
              keyboardType="url"
              error={touched.baseUrl ? addressError : undefined}
              onBlur={() => setTouched(current => ({ ...current, baseUrl: true }))}
              onChangeText={baseUrl => update({ baseUrl })}
            />
            {draft.auth === 'key' && (
              <>
                <Field
                  inline
                  label="API Key"
                  value={secret}
                  secureTextEntry={!revealed}
                  maxLength={8192}
                  editable={!busy}
                  placeholder={keyPlaceholder}
                  style={{ paddingRight: showRemove ? 72 : 40 }}
                  onChangeText={next => {
                    setSecret(next);
                    setRemoveKey(false);
                    setNotice('');
                  }}
                  trailing={
                    <View style={styles.keyActions}>
                      <IconButton
                        icon={revealed ? EyeOff : Eye}
                        label={revealed ? '隐藏凭证' : '显示凭证'}
                        disabled={busy}
                        size={32}
                        onPress={() => setRevealed(current => !current)}
                      />
                      {showRemove && (
                        <IconButton
                          icon={X}
                          label="移除已保存凭证"
                          disabled={busy}
                          size={32}
                          onPress={() => {
                            setRemoveKey(true);
                            setSecret('');
                            setNotice('');
                          }}
                        />
                      )}
                    </View>
                  }
                />
                {removeKey && (
                  <View style={styles.warningRow}>
                    <T tone="warning" variant="meta" style={{ flex: 1 }}>
                      保存后将移除凭证。
                    </T>
                    <Button
                      label="撤销"
                      variant="ghost"
                      compact
                      onPress={() => setRemoveKey(false)}
                    />
                  </View>
                )}
                {!removeKey && originChanged && !secret && (
                  <T tone="warning" variant="meta" style={styles.warning}>
                    服务地址已变更，保存后需重新填写凭证。
                  </T>
                )}
              </>
            )}

            <View style={{ borderBottomWidth: 1, borderColor: theme.border }}>
              <DisclosureRow
                label="高级设置"
                expanded={advanced}
                disabled={busy}
                onPress={() => setAdvanced(current => !current)}
              >
                <T style={styles.disclosureTitle}>高级设置</T>
              </DisclosureRow>
              {advanced && (
                <View style={styles.advanced}>
                  <SegmentedControl
                    label="通信协议"
                    value={draft.protocol}
                    disabled={busy}
                    options={Object.entries(protocolNames).map(([value, label]) => ({
                      value: value as Draft['protocol'],
                      label,
                    }))}
                    onChange={changeProtocol}
                  />
                  {draft.protocol === 'chat-completions' && (
                    <SegmentedControl
                      label="认证方式"
                      value={draft.auth}
                      disabled={busy}
                      options={[
                        { value: 'key', label: 'API Key' },
                        { value: 'none', label: '无需认证' },
                      ]}
                      onChange={changeAuth}
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
                  {draft.protocol === 'anthropic-messages' && (
                    <Field
                      inline
                      label="API 版本"
                      value={draft.apiVersion}
                      editable={!busy}
                      onChangeText={apiVersion => update({ apiVersion })}
                    />
                  )}
                </View>
              )}
            </View>

            {savedConnection && (
              <View style={[styles.modelsHeader, { borderColor: theme.border }]}>
                <T style={styles.modelsTitle}>模型</T>
                <T tone="muted" variant="meta" style={styles.modelsCount}>
                  {allModels.length}
                </T>
                <View style={{ flex: 1 }} />
                {allModels.length > 0 && (
                  <IconButton
                    icon={searchOpen ? X : Search}
                    label={searchOpen ? '关闭搜索' : '搜索模型'}
                    size={36}
                    onPress={() => {
                      setSearchOpen(current => !current);
                      if (searchOpen) setSearch('');
                    }}
                  />
                )}
                {probing ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="取消检测"
                    onPress={() => probe.current?.abort()}
                    style={styles.detect}
                  >
                    <ActivityIndicator size="small" color={theme.accent} />
                  </Pressable>
                ) : (
                  <IconButton
                    icon={RefreshCw}
                    label="检测连接并发现模型"
                    size={36}
                    disabled={!valid || !credentialReady || busy}
                    onPress={test}
                  />
                )}
                <IconButton
                  icon={Plus}
                  label="添加模型"
                  disabled={dirty || busy}
                  size={36}
                  onPress={() => openModel()}
                />
              </View>
            )}
            {savedConnection && searchOpen && allModels.length > 0 && (
              <View style={styles.search}>
                <Field
                  label="搜索模型"
                  hideLabel
                  autoFocus
                  value={search}
                  placeholder="搜索显示名或请求 ID"
                  onChangeText={setSearch}
                />
              </View>
            )}
            {savedConnection && allModels.length > 0 && (
              <ViewTabs
                label="目录筛选"
                value={filter}
                options={[
                  { value: 'all', label: '全部', count: allModels.length },
                  {
                    value: 'favorite',
                    label: '收藏',
                    count: allModels.filter(item => item.favorite).length,
                    accessibilityLabel: '目录筛选：收藏',
                  },
                  {
                    value: 'enabled',
                    label: '已启用',
                    count: allModels.filter(item => item.enabled).length,
                  },
                ]}
                onChange={setFilter}
              />
            )}
          </View>
        }
        ListEmptyComponent={
          savedConnection ? (
            <EmptyState
              compact
              title={allModels.length || search || filter !== 'all' ? '没有匹配的模型' : '尚无模型'}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ActionRow
            label={'编辑模型 ' + item.name}
            onPress={() => openModel(item.id)}
            disabled={dirty || busy}
            title={item.name}
            description={item.apiId}
            meta={[
              item.enabled ? undefined : '已停用',
              item.favorite ? '收藏' : undefined,
              item.catalog.missing ? '目录未发现' : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
            metaTone={item.catalog.missing ? 'warning' : 'secondary'}
            trailing={<ChevronRight size={16} color={theme.muted} />}
          />
        )}
      />
      {menuOpen && (
        <>
          <Pressable
            accessible={false}
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
          />
          <View
            style={[styles.menu, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            {!!draft.icon && (
              <ActionRow
                label="恢复默认供应商图标"
                title="恢复默认供应商图标"
                disabled={busy}
                onPress={() => {
                  setMenuOpen(false);
                  update({ icon: undefined });
                }}
              />
            )}
            {!!savedConnection && (
              <>
                <ActionRow
                  label="复制连接"
                  title="复制连接"
                  disabled={busy || dirty}
                  onPress={() => {
                    setMenuOpen(false);
                    copy();
                  }}
                />
                <ActionRow
                  label="删除连接"
                  title="删除连接"
                  disabled={busy}
                  onPress={() => {
                    setMenuOpen(false);
                    setDeleting(true);
                  }}
                />
              </>
            )}
          </View>
        </>
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} />}
      {guard.guard}
      <ConfirmSheet
        visible={deleting}
        title="删除这个连接？"
        busy={busy}
        onClose={() => setDeleting(false)}
        confirmLabel="确认删除连接"
        onConfirm={() => {
          if (!savedConnection) return;
          void action(async () => {
            await runtime!.models.removeConnection(savedConnection.id);
            guard.allow(() => router.replace('/models'));
          });
        }}
        danger
        description={
          <T tone="secondary">
            将删除连接与所属模型。{runtime!.models.affectedDefaults(savedConnection?.id ?? '')}{' '}
            处默认选择将失效，需要重新选择。历史任务与正在运行的任务仍保留启动时配置。
          </T>
        }
      />
    </ConfigPage>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 12, paddingBottom: 12 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  iconBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityBody: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 0 },
  nameText: { flexShrink: 1, fontSize: 17, lineHeight: 24, fontWeight: '600' },
  nameInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 17,
    fontWeight: '600',
  },
  enable: { alignItems: 'center', gap: 1 },
  keyActions: { flexDirection: 'row', alignItems: 'center' },
  warning: { paddingTop: 4, paddingLeft: 82 },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
    paddingLeft: 82,
  },
  disclosureTitle: { fontSize: 14 },
  advanced: { gap: 8, paddingTop: 4, paddingBottom: 10 },
  modelsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 44,
    marginTop: 8,
    borderTopWidth: 1,
  },
  modelsTitle: { fontWeight: '600' },
  modelsCount: { marginLeft: 5 },
  search: { paddingBottom: 6 },
  detect: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  menu: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 220,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    zIndex: 20,
    elevation: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
});
