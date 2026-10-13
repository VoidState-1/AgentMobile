import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ModelInput } from '@/core/models/service';
import { defaultModelParameters, unknownCapabilities, type CapabilityName, type CheckKind, type ModelEntry } from '@/core/models/types';
import { mainSessionId } from '@/core/models/rules';
import { presetModelEvidence, protocolNames } from '@/core/models/presets';
import { geminiResource } from '@/adapters/model/http';
import { runDiagnostic } from '@/adapters/model/diagnostics';
import { Button, Field, Sheet, T } from '@/features/workbench/ui';
import { useWorkbenchUi } from '@/features/workbench/ui-store';
import { CheckResult, Choices, ConfigPage, FormScroll, Loading, Section, Toggle, useConfiguration, useDraftGuard, type ConfigurationController } from './common';

const names: Record<CapabilityName, string> = { tools: '工具调用', images: '图片理解', reasoning: '思考能力' };
const sources = { preset: '预设资料', discovery: '服务目录', user: '用户声明', verified: '实测通过' };
const edit = (model: ModelEntry): ModelInput => ({ id: model.id, connectionId: model.connectionId, name: model.name, apiId: model.apiId,
  enabled: model.enabled, favorite: model.favorite, parameters: { ...model.parameters }, capabilities: {
    tools: model.capabilities.tools.support, images: model.capabilities.images.support, reasoning: model.capabilities.reasoning.support } });

export function ModelScreen() {
  const controller = useConfiguration(); const params = useLocalSearchParams<{ id?: string; connectionId: string }>();
  const model = controller.config.models.find((item) => item.id === params.id);
  if (!controller.runtime) return <ConfigPage title="模型配置"><Loading />{!!controller.error && <T tone="danger">{controller.error}</T>}</ConfigPage>;
  if (!controller.config.connections.some((item) => item.id === params.connectionId) || (params.id && !model)) return <ConfigPage title="模型已删除"><T style={{ padding: 20 }}>返回列表后重新选择模型。</T></ConfigPage>;
  return <ModelEditor key={params.id ?? params.connectionId} controller={controller} model={model} connectionId={params.connectionId} />;
}
function ModelEditor({ controller, model, connectionId }: { controller: ConfigurationController; model?: ModelEntry; connectionId: string }) {
  const { runtime, config, error, busy, action } = controller; const router = useRouter();
  const projectId = useWorkbenchUi((state) => state.projectId); const connection = config.connections.find((c) => c.id === connectionId)!;
  const initial: ModelInput = model ? edit(model) : { connectionId, apiId: '', name: '', enabled: true, favorite: false,
    parameters: { ...defaultModelParameters }, capabilities: { tools: 'unknown', images: 'unknown', reasoning: 'unknown' } };
  const [draft, setDraft] = useState(initial); const [output, setOutput] = useState(String(initial.parameters.maxOutputTokens));
  const [temperature, setTemperature] = useState(initial.parameters.temperature?.toString() ?? '');
  const signature = (value: ModelInput, tokens: string, temp: string) => JSON.stringify([value, tokens, temp]);
  const [saved, setSaved] = useState(signature(initial, output, temperature)); const revision = useRef(model?.revision);
  const [notice, setNotice] = useState(''); const [deleting, setDeleting] = useState(false);
  const probe = useRef<AbortController | undefined>(undefined); const [probing, setProbing] = useState<CheckKind>();
  const dirty = signature(draft, output, temperature) !== saved; const guard = useDraftGuard(dirty);
  useEffect(() => () => probe.current?.abort(), []);
  const update = (value: Partial<ModelInput>) => { setDraft({ ...draft, ...value }); setNotice(''); };
  const save = () => { void action(async () => {
    if (connection.protocol === 'gemini') geminiResource(draft.apiId);
    const value = await runtime!.models.saveModel({ ...draft, parameters: { ...draft.parameters, maxOutputTokens: Number(output), temperature: temperature.trim() ? Number(temperature) : undefined } }, revision.current);
    const next = edit(value); revision.current = value.revision; setSaved(signature(next, String(value.parameters.maxOutputTokens), value.parameters.temperature?.toString() ?? ''));
    setDraft(next); setOutput(String(value.parameters.maxOutputTokens)); setTemperature(value.parameters.temperature?.toString() ?? ''); setNotice('模型配置已保存。');
    if (!model) guard.allow(() => router.replace({ pathname: '/models/model', params: { id: value.id, connectionId } }));
  }); };
  const test = (kind: CheckKind) => { void action(async () => {
    const abort = new AbortController(); probe.current = abort; setProbing(kind);
    try {
      await runDiagnostic(runtime!.models, connectionId, model!.id, kind, Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'ios' : 'android', abort.signal);
      const current = runtime!.models.getSnapshot().models.find((item) => item.id === model!.id);
      if (current) { const next = edit(current); setDraft(next); setSaved(signature(next, output, temperature)); }
    }
    finally { probe.current = undefined; setProbing(undefined); }
  }); };
  const select = (scope: 'global' | 'project' | 'session') => { void action(async () => {
    await runtime!.models.setSelection(scope, model!.id, scope === 'session' ? mainSessionId(projectId!) : projectId);
    setNotice('默认选择已更新，下次任务使用此模型。');
  }); };
  const defaults = [config.defaults.global, ...Object.values(config.defaults.projects), ...Object.values(config.defaults.sessions)].filter((id) => id === model?.id).length;
  const disabled = !model || dirty || busy;
  return <ConfigPage title={model ? model.name : '添加模型'} subtitle={connection.name + ' · ' + protocolNames[connection.protocol]}
    onBack={() => guard.exit(() => router.canGoBack() ? router.back() : router.replace('/models'))}
    footer={<View style={{ gap: 6 }}>{!!error && <T tone="danger" style={{ fontSize: 12 }}>{error}</T>}{!!notice && <T tone="accent" style={{ fontSize: 12 }}>{notice}</T>}
      <Button label="保存模型" busy={busy && !probing} disabled={!!probing || (!dirty && !!model)} onPress={save} /></View>}>
    <FormScroll>
      <Section title="模型信息">
        <Field label="请求模型 ID" value={draft.apiId} editable={!busy} placeholder={connection.protocol === 'gemini' ? 'models/供应商模型名称' : '供应商提供的模型 ID'} onChangeText={(apiId) => {
          const evidence = { ...unknownCapabilities(), ...presetModelEvidence(connection.presetId, apiId) };
          update({ apiId, ...(!model ? { name: draft.name === draft.apiId ? apiId : draft.name || apiId } : {}), capabilities: model && apiId === model.apiId ? edit(model).capabilities :
            { tools: evidence.tools.support, images: evidence.images.support, reasoning: evidence.reasoning.support } });
        }} />
        <Field label="模型显示名" value={draft.name} maxLength={100} editable={!busy} onChangeText={(name) => update({ name })} />
        <Toggle label="收藏模型" hint="收藏会优先出现在会话选择器。" value={draft.favorite} disabled={busy} onChange={(favorite) => update({ favorite })} />
        <Toggle label="启用模型" hint={defaults ? '此模型被 ' + defaults + ' 处默认选择引用。' : '停用后保留历史与配置。'} value={draft.enabled} disabled={busy} onChange={(enabled) => update({ enabled })} />
        {model?.catalog.missing && <T tone="warning" style={{ fontSize: 11 }}>最近一次服务目录未发现此 ID，仍可手工配置与检测。</T>}
      </Section>
      <Section title="模型能力" hint="能力声明和检测结果独立记录；鉴权或网络失败不会改为不支持。">
        {(['tools', 'images', 'reasoning'] as const).map((name) => <View key={name} style={{ gap: 5 }}>
          <Choices label={names[name]} value={draft.capabilities[name]} disabled={busy} options={[{ value: 'unknown', label: '未知' }, { value: 'supported', label: '支持' }, { value: 'unsupported', label: '不支持' }]}
            onChange={(support) => update({ capabilities: { ...draft.capabilities, [name]: support }, ...(name === 'images' && support === 'unsupported' ? { parameters: { ...draft.parameters, allowImages: false } } : {}) })} />
          <T tone="muted" style={{ fontSize: 10 }}>依据：{model && model.apiId === draft.apiId && model.capabilities[name].support === draft.capabilities[name] ? sources[model.capabilities[name].source] : '用户声明'}{model?.apiId === draft.apiId && model?.capabilities[name].checkedAt ? ' · ' + new Date(model.capabilities[name].checkedAt!).toLocaleDateString() : ''}</T>
        </View>)}
        <T tone="secondary" style={{ fontSize: 11 }}>明确不支持工具的模型不能执行工作区 Agent。未知能力可先配置，再按需验证。</T>
      </Section>
      <Section title="运行参数" hint="这里的参数会实际进入每一轮请求，任务启动后固定。">
        <Field label="最大输出 tokens" value={output} keyboardType="number-pad" editable={!busy} onChangeText={setOutput} />
        <Field label="温度（留空采用服务默认）" value={temperature} keyboardType="decimal-pad" editable={!busy} placeholder={'0–' + (model?.limits?.maxTemperature ?? (connection.protocol === 'anthropic-messages' ? 1 : 2))} onChangeText={setTemperature} />
        <Toggle label="允许图片输入" hint={draft.capabilities.images === 'unknown' ? '图片能力未知，建议先进行图片检测。' : '允许发送参考图片和工具读取的图片。'} value={draft.parameters.allowImages}
          disabled={busy || draft.capabilities.images === 'unsupported'} onChange={(allowImages) => update({ parameters: { ...draft.parameters, allowImages } })} />
        <T tone="muted" style={{ fontSize: 11 }}>思考参数控制尚未开放；DeepSeek 使用非思考模式。其他协议遵循服务默认，必要签名随工具上下文回传。</T>
        {!!model?.limits && <T tone="secondary" style={{ fontSize: 11 }}>服务公布：上下文 {model.limits.contextTokens?.toLocaleString() ?? '未知'} · 输出上限 {model.limits.outputTokens?.toLocaleString() ?? '未知'}</T>}
        <Button label="恢复默认参数" variant="ghost" disabled={busy} onPress={() => { update({ parameters: { ...defaultModelParameters, maxOutputTokens: Math.min(4096, model?.limits?.outputTokens ?? 4096) } }); setOutput(String(Math.min(4096, model?.limits?.outputTokens ?? 4096))); setTemperature(''); }} />
      </Section>
      <Section title="指定模型检测" hint="使用内置样本，可能计费。每项最多 2 次生成、128 输出 tokens、30 秒；不读取工作区。">
        {(['text', 'tools', 'images'] as const).map((kind) => <View key={kind} style={{ gap: 7 }}>
          <Button label={({ text: '文本检测', tools: '工具检测', images: '图片检测' }[kind]) + ' · 可能计费'} variant="secondary" disabled={disabled} busy={probing === kind} onPress={() => test(kind)} />
          <CheckResult result={model?.checks[kind]} history={model?.checkHistory?.[kind]} />
        </View>)}
        {!!probing && <Button label="取消检测" variant="ghost" onPress={() => probe.current?.abort()} />}
        {dirty && <T tone="muted" style={{ fontSize: 11 }}>保存当前草稿后再检测。</T>}
      </Section>
      <Section title="默认选择" hint="会话选择优先于项目默认，项目默认优先于全局默认。">
        <Button label={config.defaults.global === model?.id && model ? '已为全局默认' : '设为全局默认'} variant="secondary" disabled={disabled || !draft.enabled || !connection.enabled} onPress={() => select('global')} />
        <Button label={projectId && config.defaults.projects[projectId] === model?.id && model ? '已为项目默认' : '设为当前项目默认'} variant="secondary" disabled={disabled || !projectId || !draft.enabled || !connection.enabled} onPress={() => select('project')} />
        <Button label={projectId && config.defaults.sessions[mainSessionId(projectId)] === model?.id && model ? '已选用于此会话' : '用于当前会话'} variant="secondary" disabled={disabled || !projectId || !draft.enabled || !connection.enabled} onPress={() => select('session')} />
        {projectId && config.defaults.projects[projectId] && <Button label="清除项目默认" variant="ghost" disabled={busy} onPress={() => { void action(() => runtime!.models.setSelection('project', undefined, projectId)); }} />}
        {projectId && config.defaults.sessions[mainSessionId(projectId)] && <Button label="清除会话选择" variant="ghost" disabled={busy} onPress={() => { void action(() => runtime!.models.setSelection('session', undefined, mainSessionId(projectId))); }} />}
        {!projectId && <T tone="muted" style={{ fontSize: 11 }}>先打开一个项目，才能设置项目与会话选择。</T>}
      </Section>
      {model && <Button label="删除模型" variant="danger" disabled={busy} onPress={() => setDeleting(true)} />}
    </FormScroll>
    {guard.guard}
    <Sheet visible={deleting} title="删除这个模型？" busy={busy} onClose={() => setDeleting(false)} footer={<Button label="确认删除模型" variant="danger" busy={busy} onPress={() => { void action(async () => {
      await runtime!.models.removeModel(model!.id); guard.allow(() => router.replace({ pathname: '/models/connection', params: { id: connectionId } }));
    }); }} />}><T tone="secondary">{defaults} 处默认选择将失效，下次发送时需要重新选择。历史和正在运行的任务保留原配置。</T></Sheet>
  </ConfigPage>;
}
