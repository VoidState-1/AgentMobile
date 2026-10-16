import { useDraftGuard } from '@/shared/use-draft-guard';
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
import { FormFooter } from '@/shared/ui/feedback';
import { ConfigPage, FormScroll, Loading, NumberField, Section, Toggle } from '@/shared/ui/forms';
import { OverflowMenu } from '@/shared/ui/menus';
import { Button, Field, T } from '@/shared/ui/primitives';
import { SegmentedControl } from '@/shared/ui/selection';
import { ConfirmSheet } from '@/shared/ui/sheets';
import { useWorkbenchUi } from '@/shared/workbench-state';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { CheckResult } from './check-result';
import { useModelConfiguration, type ModelConfigurationController } from './use-configuration';

const names: Record<CapabilityName, string> = {
  tools: '工具调用',
  images: '图片理解',
  reasoning: '思考能力',
};
const sources = {
  preset: '预设资料',
  discovery: '服务目录',
  user: '用户声明',
  verified: '实测通过',
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
  const projectId = useWorkbenchUi(state => state.projectId);
  const connection = config.connections.find(c => c.id === connectionId)!;
  const conversationId = useWorkbenchUi(state => state.conversationId);
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
  const probe = useRef<AbortController | undefined>(undefined);
  const [probing, setProbing] = useState<CheckKind>();
  const dirty = signature(draft, output, temperature) !== saved;
  const guard = useDraftGuard(dirty);
  useEffect(() => () => probe.current?.abort(), []);
  const update = (value: Partial<ModelInput>) => {
    setDraft({ ...draft, ...value });
    setNotice('');
  };
  const save = () => {
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
  const defaults = [
    config.defaults.global,
    ...Object.values(config.defaults.projects),
    ...Object.values(config.defaults.sessions),
  ].filter(id => id === model?.id).length;
  const disabled = !model || dirty || busy;
  return (
    <ConfigPage
      title={model ? model.name : '添加模型'}
      subtitle={connection.name + ' · ' + protocolNames[connection.protocol]}
      onBack={() =>
        guard.exit(() => (router.canGoBack() ? router.back() : router.replace('/models')))
      }
      footer={
        <FormFooter error={error} notice={notice}>
          <Button
            label="保存模型"
            busy={busy && !probing}
            disabled={!!probing || (!dirty && !!model)}
            onPress={save}
          />
        </FormFooter>
      }
    >
      <FormScroll>
        <Section title="模型信息">
          <Field
            label="请求模型 ID"
            value={draft.apiId}
            editable={!busy}
            placeholder={
              connection.protocol === 'gemini' ? 'models/供应商模型名称' : '供应商提供的模型 ID'
            }
            onChangeText={apiId => {
              const evidence = {
                ...unknownCapabilities(),
                ...presetModelEvidence(connection.presetId, apiId),
              };
              update({
                apiId,
                ...(!model
                  ? { name: draft.name === draft.apiId ? apiId : draft.name || apiId }
                  : {}),
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
          <Field
            label="模型显示名"
            value={draft.name}
            maxLength={100}
            editable={!busy}
            onChangeText={name => update({ name })}
          />
          <Toggle
            label="收藏模型"
            value={draft.favorite}
            disabled={busy}
            onChange={favorite => update({ favorite })}
          />
          <Toggle
            label="启用模型"
            hint={defaults ? '此模型被 ' + defaults + ' 处默认选择引用。' : undefined}
            value={draft.enabled}
            disabled={busy}
            onChange={enabled => update({ enabled })}
          />
          {model?.catalog.missing && (
            <T tone="warning" variant="meta">
              最近一次服务目录未发现此 ID，仍可手工配置与检测。
            </T>
          )}
        </Section>
        <Section title="模型能力">
          {(['tools', 'images', 'reasoning'] as const).map(name => (
            <View key={name} style={{ gap: 5 }}>
              <SegmentedControl
                label={names[name]}
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
              <T tone="muted" variant="meta">
                依据：
                {model &&
                model.apiId === draft.apiId &&
                model.capabilities[name].support === draft.capabilities[name]
                  ? sources[model.capabilities[name].source]
                  : '用户声明'}
                {model?.apiId === draft.apiId && model?.capabilities[name].checkedAt
                  ? ' · ' + new Date(model.capabilities[name].checkedAt!).toLocaleDateString()
                  : ''}
              </T>
            </View>
          ))}
          {draft.capabilities.tools === 'unsupported' && (
            <T tone="warning" variant="caption">
              此模型不支持工具，无法执行 Agent 任务。
            </T>
          )}
        </Section>
        <Section
          title="运行参数"
          action={
            <OverflowMenu
              label="运行参数操作"
              disabled={busy}
              items={[
                {
                  label: '恢复默认参数',
                  onPress: () => {
                    const tokens = Math.min(
                      defaultModelParameters.maxOutputTokens,
                      model?.limits?.outputTokens ?? defaultModelParameters.maxOutputTokens,
                    );
                    update({ parameters: { ...defaultModelParameters, maxOutputTokens: tokens } });
                    setOutput(String(tokens));
                    setTemperature('');
                    setReasoningBudget('1024');
                  },
                },
              ]}
            />
          }
        >
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
                label="推理参数格式"
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
            label="公开推理展示"
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
            <T tone="secondary" variant="meta">
              服务公布：上下文 {model.limits.contextTokens?.toLocaleString() ?? '未知'} · 输出上限{' '}
              {model.limits.outputTokens?.toLocaleString() ?? '未知'}
            </T>
          )}
        </Section>
        {model && (
          <>
            <Section title="指定模型检测">
              {(['text', 'tools', 'images'] as const).map(kind => (
                <View key={kind} style={{ gap: 7 }}>
                  <Button
                    label={
                      { text: '文本检测', tools: '工具检测', images: '图片检测' }[kind] +
                      ' · 可能计费'
                    }
                    variant="secondary"
                    disabled={disabled}
                    busy={probing === kind}
                    onPress={() => test(kind)}
                  />
                  <CheckResult result={model?.checks[kind]} history={model?.checkHistory?.[kind]} />
                </View>
              ))}
              {!!probing && (
                <Button label="取消检测" variant="ghost" onPress={() => probe.current?.abort()} />
              )}
            </Section>
            <Section title="默认选择">
              <Button
                label={
                  config.defaults.global === model?.id && model ? '已为全局默认' : '设为全局默认'
                }
                variant="secondary"
                disabled={disabled || !draft.enabled || !connection.enabled}
                onPress={() => select('global')}
              />
              <Button
                label={
                  projectId && config.defaults.projects[projectId] === model?.id && model
                    ? '已为项目默认'
                    : '设为当前项目默认'
                }
                variant="secondary"
                disabled={disabled || !projectId || !draft.enabled || !connection.enabled}
                onPress={() => select('project')}
              />
              <Button
                label={
                  conversationId && config.defaults.sessions[conversationId] === model?.id && model
                    ? '已选用于此会话'
                    : '用于当前会话'
                }
                variant="secondary"
                disabled={disabled || !conversationId || !draft.enabled || !connection.enabled}
                onPress={() => select('session')}
              />
              {projectId && config.defaults.projects[projectId] && (
                <Button
                  label="清除项目默认"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => {
                    void action(() =>
                      runtime!.models.setSelection('project', undefined, projectId),
                    );
                  }}
                />
              )}
              {conversationId &&
                (config.defaults.sessions[conversationId] ||
                  config.sessionModes?.[conversationId]) && (
                  <Button
                    label="清除会话选择"
                    variant="ghost"
                    disabled={busy}
                    onPress={() => {
                      void action(() =>
                        runtime!.models.setSelection('session', undefined, conversationId),
                      );
                    }}
                  />
                )}
            </Section>
          </>
        )}
        {model && (
          <Button
            label="删除模型"
            variant="danger"
            disabled={busy}
            onPress={() => setDeleting(true)}
          />
        )}
      </FormScroll>
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
          <>
            <T tone="secondary">
              {defaults} 处默认选择将失效，下次发送时需要重新选择。历史和正在运行的任务保留原配置。
            </T>
          </>
        }
      />
    </ConfigPage>
  );
}
