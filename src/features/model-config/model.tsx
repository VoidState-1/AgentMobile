import { geminiResource } from '@/core/models/model-id';
import { presetModelEvidence, protocolNames } from '@/core/models/presets';
import {
  defaultModelParameters,
  unknownCapabilities,
  type CapabilityName,
  type CheckKind,
  type ModelEntry,
  type ModelInput,
} from '@/core/models/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { useDraftGuard } from '@/shared/use-draft-guard';
import { FormFooter } from '@/shared/ui/feedback';
import { ConfigPage, FormScroll, Loading, NumberField, Toggle } from '@/shared/ui/forms';
import { Check, MoreHorizontal, Pencil, Star } from '@/shared/ui/icons';
import { PageMenu } from '@/shared/ui/page-menu';
import { Button, Field, IconButton, Input, T } from '@/shared/ui/primitives';
import { SegmentedControl } from '@/shared/ui/selection';
import { ConfirmSheet } from '@/shared/ui/sheets';
import { useWorkbenchUi } from '@/shared/workbench-state';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Switch, View } from 'react-native';
import { CheckResult } from './check-result';
import { ProviderIcon } from './provider-icon';
import { useModelConfiguration, type ModelConfigurationController } from './use-configuration';

const capabilityNames: Record<CapabilityName, string> = {
  tools: '工具调用',
  images: '图片理解',
  reasoning: '思考能力',
};
const checkNames: Record<Exclude<CheckKind, 'connection'>, { short: string; label: string }> = {
  text: { short: '文本', label: '文本检测' },
  tools: { short: '工具', label: '工具检测' },
  images: { short: '图片', label: '图片检测' },
};
const edit = (model: ModelEntry): ModelInput => ({
  id: model.id,
  connectionId: model.connectionId,
  name: model.name,
  apiId: model.apiId,
  enabled: model.enabled,
  favorite: model.favorite,
  parameters: { ...model.parameters },
  capabilities: {
    tools: model.capabilities.tools.support,
    images: model.capabilities.images.support,
    reasoning: model.capabilities.reasoning.support,
  },
});

const nameProblem = (name: string) => (name.trim() ? undefined : '请输入模型显示名。');

export function ModelScreen() {
  const controller = useModelConfiguration();
  const params = useLocalSearchParams<{ id?: string; connectionId: string }>();
  const model = controller.config.models.find(item => item.id === params.id);
  if (!controller.runtime)
    return (
      <ConfigPage title="模型配置">
        <Loading />
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </ConfigPage>
    );
  if (
    !controller.config.connections.some(item => item.id === params.connectionId) ||
    (params.id && !model)
  )
    return (
      <ConfigPage title="模型已删除">
        <T style={{ padding: 20 }}>返回列表后重新选择模型。</T>
      </ConfigPage>
    );
  return (
    <ModelEditor
      key={params.id ?? params.connectionId}
      controller={controller}
      model={model}
      connectionId={params.connectionId}
    />
  );
}

function ModelEditor({
  controller,
  model,
  connectionId,
}: {
  controller: ModelConfigurationController;
  model?: ModelEntry;
  connectionId: string;
}) {
  const { runtime, config, error, busy, action } = controller;
  const router = useRouter();
  const theme = useWorkbenchTheme();
  const projectId = useWorkbenchUi(state => state.projectId);
  const conversationId = useWorkbenchUi(state => state.conversationId);
  const connection = config.connections.find(c => c.id === connectionId)!;
  const initial: ModelInput = model
    ? edit(model)
    : {
        connectionId,
        apiId: '',
        name: '',
        enabled: true,
        favorite: false,
        parameters: { ...defaultModelParameters },
        capabilities: { tools: 'unknown', images: 'unknown', reasoning: 'unknown' },
      };
  const [draft, setDraft] = useState(initial);
  const [output, setOutput] = useState(String(initial.parameters.maxOutputTokens));
  const [temperature, setTemperature] = useState(initial.parameters.temperature?.toString() ?? '');
  const [reasoningBudget, setReasoningBudget] = useState(
    String(initial.parameters.reasoningBudget ?? 1024),
  );
  const signature = (value: ModelInput, tokens: string, temp: string) =>
    JSON.stringify([value, tokens, temp]);
  const [saved, setSaved] = useState(signature(initial, output, temperature));
  const revision = useRef(model?.revision);
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [touched, setTouched] = useState({ name: false, apiId: false });
  const probe = useRef<AbortController | undefined>(undefined);
  const [probing, setProbing] = useState<CheckKind>();
  const dirty = signature(draft, output, temperature) !== saved;
  const guard = useDraftGuard(dirty);
  const nameError = nameProblem(draft.name);
  const apiIdError = draft.apiId.trim() ? undefined : '请输入请求模型 ID。';
  const valid = !nameError && !apiIdError;
  useEffect(() => () => probe.current?.abort(), []);
  const update = (value: Partial<ModelInput>) => {
    setDraft({ ...draft, ...value });
    setNotice('');
  };
  const save = () => {
    if (!valid) {
      setTouched({ name: true, apiId: true });
      return;
    }
    setMenuOpen(false);
    void action(async () => {
      if (connection.protocol === 'gemini') geminiResource(draft.apiId);
      const value = await runtime!.models.saveModel(
        {
          ...draft,
          parameters: {
            ...draft.parameters,
            maxOutputTokens: Number(output),
            temperature: temperature.trim() ? Number(temperature) : undefined,
          },
        },
        revision.current,
      );
      const next = edit(value);
      revision.current = value.revision;
      setSaved(
        signature(
          next,
          String(value.parameters.maxOutputTokens),
          value.parameters.temperature?.toString() ?? '',
        ),
      );
      setDraft(next);
      setOutput(String(value.parameters.maxOutputTokens));
      setTemperature(value.parameters.temperature?.toString() ?? '');
      setReasoningBudget(String(value.parameters.reasoningBudget ?? 1024));
      setEditingName(false);
      setNotice('模型配置已保存。');
      if (!model)
        guard.allow(() =>
          router.replace({ pathname: '/models/model', params: { id: value.id, connectionId } }),
        );
    });
  };
  const test = (kind: CheckKind) => {
    void action(async () => {
      const abort = new AbortController();
      probe.current = abort;
      setProbing(kind);
      try {
        await runtime!.models.diagnose(connectionId, model!.id, kind, abort.signal);
        const current = runtime!.models.getSnapshot().models.find(item => item.id === model!.id);
        if (current) {
          const next = edit(current);
          setDraft(next);
          setSaved(signature(next, output, temperature));
        }
      } finally {
        probe.current = undefined;
        setProbing(undefined);
      }
    });
  };
  const select = (scope: 'global' | 'project' | 'session') => {
    void action(async () => {
      await runtime!.models.setSelection(
        scope,
        model!.id,
        scope === 'session' ? conversationId : projectId,
      );
      setNotice('默认选择已更新，下次任务使用此模型。');
    });
  };
  const restoreDefaults = () => {
    const tokens = Math.min(
      defaultModelParameters.maxOutputTokens,
      model?.limits?.outputTokens ?? defaultModelParameters.maxOutputTokens,
    );
    update({ parameters: { ...defaultModelParameters, maxOutputTokens: tokens } });
    setOutput(String(tokens));
    setTemperature('');
    setReasoningBudget('1024');
  };
  const defaults = [
    config.defaults.global,
    ...Object.values(config.defaults.projects),
    ...Object.values(config.defaults.sessions),
  ].filter(id => id === model?.id).length;
  const globalDefault = config.defaults.global === model?.id;
  const projectDefault = !!projectId && config.defaults.projects[projectId] === model?.id;
  const sessionDefault = !!conversationId && config.defaults.sessions[conversationId] === model?.id;
  const disabled = !model || dirty || busy;
  return (
    <ConfigPage
      title={model ? '模型设置' : '添加模型'}
      onBack={() =>
        guard.exit(() => (router.canGoBack() ? router.back() : router.replace('/models')))
      }
      action={
        model ? (
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
            label="保存模型"
            busy={busy && !probing}
            disabled={!!probing || !valid || (!dirty && !!model)}
            onPress={save}
          />
        </FormFooter>
      }
    >
      <FormScroll>
        <View style={[styles.identity, { borderColor: theme.border }]}>
          <ProviderIcon
            presetId={connection.presetId}
            baseUrl={connection.baseUrl}
            icon={connection.icon}
            size={40}
          />
          <View style={styles.identityBody}>
            <View style={styles.nameRow}>
              {editingName ? (
                <>
                  <Input
                    accessibilityLabel="模型显示名"
                    value={draft.name}
                    maxLength={100}
                    editable={!busy}
                    autoFocus
                    placeholder="未命名模型"
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
                    label="完成编辑模型名称"
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
                    {draft.name.trim() || '未命名模型'}
                  </T>
                  <IconButton
                    icon={Pencil}
                    label="编辑模型名称"
                    disabled={busy}
                    size={32}
                    onPress={() => setEditingName(true)}
                  />
                </>
              )}
            </View>
            <T numberOfLines={1} tone="muted" variant="meta">
              {connection.name} · {protocolNames[connection.protocol]}
            </T>
            {!!(nameError && touched.name) && (
              <T tone="danger" variant="meta">
                {nameError}
              </T>
            )}
            {!draft.enabled && defaults > 0 && (
              <T tone="warning" variant="meta">
                停用后有 {defaults} 处默认选择会失效。
              </T>
            )}
          </View>
          <IconButton
            icon={Star}
            label="收藏模型"
            selected={draft.favorite}
            disabled={busy}
            size={36}
            onPress={() => update({ favorite: !draft.favorite })}
          />
          <View style={[styles.enable, { opacity: busy ? 0.4 : 1 }]}>
            <T variant="meta" style={{ fontSize: 10 }}>
              启用
            </T>
            <Switch
              accessibilityLabel="启用模型"
              value={draft.enabled}
              disabled={busy}
              onValueChange={enabled => update({ enabled })}
              {...(Platform.OS === 'web' ? ({ activeThumbColor: theme.surface } as object) : null)}
              trackColor={{ true: theme.accent, false: theme.border }}
              thumbColor={Platform.OS === 'ios' ? undefined : theme.surface}
            />
          </View>
        </View>

        <Field
          inline
          label="请求 ID"
          value={draft.apiId}
          editable={!busy}
          placeholder={
            connection.protocol === 'gemini' ? 'models/供应商模型名称' : '供应商提供的模型 ID'
          }
          error={touched.apiId ? apiIdError : undefined}
          onBlur={() => setTouched(current => ({ ...current, apiId: true }))}
          onChangeText={apiId => {
            const evidence = {
              ...unknownCapabilities(),
              ...presetModelEvidence(connection.presetId, apiId),
            };
            update({
              apiId,
              ...(!model ? { name: draft.name === draft.apiId ? apiId : draft.name || apiId } : {}),
              capabilities:
                model && apiId === model.apiId
                  ? edit(model).capabilities
                  : {
                      tools: evidence.tools.support,
                      images: evidence.images.support,
                      reasoning: evidence.reasoning.support,
                    },
            });
          }}
        />
        {model?.catalog.missing && (
          <T tone="warning" variant="meta" style={styles.rowNote}>
            最近一次服务目录未发现此 ID，仍可手工配置与检测。
          </T>
        )}

        {(['tools', 'images', 'reasoning'] as const).map(name => (
          <SegmentedControl
            key={name}
            inline
            label={capabilityNames[name]}
            value={draft.capabilities[name]}
            disabled={busy}
            options={[
              { value: 'unknown', label: '未知' },
              { value: 'supported', label: '支持' },
              { value: 'unsupported', label: '不支持' },
            ]}
            onChange={support =>
              update({
                capabilities: { ...draft.capabilities, [name]: support },
                ...(name === 'images' && support === 'unsupported'
                  ? { parameters: { ...draft.parameters, allowImages: false } }
                  : {}),
              })
            }
          />
        ))}
        {draft.capabilities.tools === 'unsupported' && (
          <T tone="warning" variant="meta" style={styles.warning}>
            此模型不支持工具，无法执行 Agent 任务。
          </T>
        )}
        <View style={[styles.blockDivider, { backgroundColor: theme.border }]} />

        <NumberField
          label="最大输出"
          accessibilityLabel="最大输出 tokens"
          unit="tokens"
          value={output}
          keyboardType="number-pad"
          editable={!busy}
          onChangeText={setOutput}
        />
        <NumberField
          label="温度"
          accessibilityLabel="温度（留空采用服务默认）"
          value={temperature}
          keyboardType="decimal-pad"
          editable={!busy}
          placeholder="默认"
          onChangeText={setTemperature}
        />
        <Toggle
          label="允许图片输入"
          value={draft.parameters.allowImages}
          disabled={busy || draft.capabilities.images === 'unsupported'}
          onChange={allowImages => update({ parameters: { ...draft.parameters, allowImages } })}
        />
        <SegmentedControl
          inline
          label="推理模式"
          value={draft.parameters.reasoning}
          disabled={busy}
          options={[
            { value: 'off', label: '关闭' },
            { value: 'provider-default', label: '服务默认' },
            ...(connection.protocol !== 'chat-completions' ||
            connection.compatibility === 'deepseek'
              ? [{ value: 'on', label: '开启' }]
              : []),
          ]}
          onChange={reasoning => {
            if (reasoning !== 'on') setReasoningBudget('1024');
            update({
              parameters: {
                ...draft.parameters,
                reasoning: reasoning as ModelEntry['parameters']['reasoning'],
                ...(reasoning !== 'on' ? { reasoningBudget: undefined } : {}),
              },
            });
          }}
        />
        {draft.parameters.reasoning === 'on' && connection.protocol !== 'chat-completions' && (
          <>
            <SegmentedControl
              inline
              label="推理格式"
              value={draft.parameters.reasoningStrategy ?? 'budget'}
              disabled={busy}
              options={[
                { value: 'budget', label: 'Token 预算' },
                connection.protocol === 'gemini'
                  ? { value: 'level', label: '推理等级' }
                  : { value: 'adaptive', label: '自适应' },
              ]}
              onChange={reasoningStrategy => {
                setReasoningBudget('1024');
                update({
                  parameters: {
                    ...draft.parameters,
                    reasoningStrategy,
                    reasoningBudget: undefined,
                  },
                });
              }}
            />
            {(draft.parameters.reasoningStrategy ?? 'budget') === 'budget' && (
              <NumberField
                label="推理预算"
                accessibilityLabel="推理预算 tokens"
                unit="tokens"
                value={reasoningBudget}
                keyboardType="number-pad"
                editable={!busy}
                onChangeText={value => {
                  setReasoningBudget(value);
                  update({ parameters: { ...draft.parameters, reasoningBudget: Number(value) } });
                }}
              />
            )}
            {draft.parameters.reasoningStrategy === 'level' && (
              <SegmentedControl
                inline
                label="推理强度"
                value={draft.parameters.reasoningEffort ?? 'high'}
                disabled={busy}
                options={[
                  { value: 'low', label: '低' },
                  { value: 'medium', label: '中' },
                  { value: 'high', label: '高' },
                ]}
                onChange={reasoningEffort =>
                  update({ parameters: { ...draft.parameters, reasoningEffort } })
                }
              />
            )}
          </>
        )}
        <SegmentedControl
          inline
          label="公开推理"
          value={
            draft.parameters.reasoningDisplay ??
            (connection.protocol === 'chat-completions' ? 'reasoning' : 'summary')
          }
          disabled={busy}
          options={[
            { value: 'reasoning', label: '思考过程' },
            { value: 'summary', label: '推理摘要' },
          ]}
          onChange={reasoningDisplay =>
            update({ parameters: { ...draft.parameters, reasoningDisplay } })
          }
        />
        {!!model?.limits && (
          <T tone="muted" variant="meta" style={styles.limits}>
            服务上限：上下文 {model.limits.contextTokens?.toLocaleString() ?? '未知'} · 输出{' '}
            {model.limits.outputTokens?.toLocaleString() ?? '未知'}
          </T>
        )}

        {model && (
          <>
            <View style={[styles.detectRow, { borderColor: theme.border }]}>
              <T tone="secondary" variant="caption" style={styles.rowLabel}>
                检测
              </T>
              <View style={styles.detectButtons}>
                {(['text', 'tools', 'images'] as const).map(kind => (
                  <Button
                    key={kind}
                    label={checkNames[kind].short}
                    accessibilityLabel={checkNames[kind].label + ' · 可能计费'}
                    compact
                    variant="secondary"
                    busy={probing === kind}
                    disabled={disabled}
                    onPress={() => test(kind)}
                    style={styles.flex}
                  />
                ))}
              </View>
              {probing ? (
                <Button
                  label="取消"
                  compact
                  variant="ghost"
                  onPress={() => probe.current?.abort()}
                />
              ) : (
                <T tone="muted" variant="meta" style={styles.cost}>
                  计费
                </T>
              )}
            </View>
            {(['text', 'tools', 'images'] as const).map(kind => {
              const result = model.checks[kind];
              const history = model.checkHistory?.[kind];
              if (!result && !history?.length) return null;
              return (
                <View key={kind} style={styles.check}>
                  <CheckResult result={result} history={history} />
                </View>
              );
            })}
          </>
        )}

        {model && (
          <View style={[styles.defaultRow, { borderColor: theme.border }]}>
            <T tone="secondary" variant="caption" style={styles.rowLabel}>
              默认
            </T>
            <View style={styles.detectButtons}>
              <Button
                label="全局"
                accessibilityLabel={globalDefault ? '已为全局默认' : '设为全局默认'}
                compact
                variant={globalDefault ? 'primary' : 'secondary'}
                disabled={disabled || !draft.enabled || !connection.enabled}
                onPress={() => select('global')}
                style={styles.flex}
              />
              <Button
                label="项目"
                accessibilityLabel={projectDefault ? '已为项目默认' : '设为当前项目默认'}
                compact
                variant={projectDefault ? 'primary' : 'secondary'}
                disabled={disabled || !projectId || !draft.enabled || !connection.enabled}
                onPress={() => select('project')}
                style={styles.flex}
              />
              <Button
                label="会话"
                accessibilityLabel={sessionDefault ? '已选用于此会话' : '用于当前会话'}
                compact
                variant={sessionDefault ? 'primary' : 'secondary'}
                disabled={disabled || !conversationId || !draft.enabled || !connection.enabled}
                onPress={() => select('session')}
                style={styles.flex}
              />
            </View>
          </View>
        )}
      </FormScroll>
      <PageMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          { label: '恢复默认参数', disabled: busy, onPress: restoreDefaults },
          ...(projectId && config.defaults.projects[projectId]
            ? [
                {
                  label: '清除项目默认',
                  disabled: busy,
                  onPress: () => {
                    void action(() =>
                      runtime!.models.setSelection('project', undefined, projectId),
                    );
                  },
                },
              ]
            : []),
          ...(conversationId && config.defaults.sessions[conversationId]
            ? [
                {
                  label: '清除会话选择',
                  disabled: busy,
                  onPress: () => {
                    void action(() =>
                      runtime!.models.setSelection('session', undefined, conversationId),
                    );
                  },
                },
              ]
            : []),
          { label: '删除模型', disabled: busy, onPress: () => setDeleting(true) },
        ]}
      />
      {guard.guard}
      <ConfirmSheet
        visible={deleting}
        title="删除这个模型？"
        busy={busy}
        onClose={() => setDeleting(false)}
        confirmLabel="确认删除模型"
        onConfirm={() => {
          void action(async () => {
            await runtime!.models.removeModel(model!.id);
            guard.allow(() =>
              router.replace({ pathname: '/models/connection', params: { id: connectionId } }),
            );
          });
        }}
        danger
        description={
          <T tone="secondary">
            {defaults} 处默认选择将失效，下次发送时需要重新选择。历史和正在运行的任务保留原配置。
          </T>
        }
      />
    </ConfigPage>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
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
  blockDivider: { height: 1, marginTop: 8 },
  rowNote: { paddingTop: 4, paddingLeft: 82 },
  warning: { paddingTop: 4, paddingLeft: 82 },
  limits: { paddingTop: 4, paddingLeft: 82 },
  rowLabel: { width: 72 },
  detectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    marginTop: 8,
    borderTopWidth: 1,
  },
  detectButtons: { flex: 1, flexDirection: 'row', gap: 6 },
  flex: { flex: 1 },
  cost: { fontSize: 10 },
  check: { paddingTop: 6 },
  defaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    marginTop: 8,
    borderTopWidth: 1,
  },
});
