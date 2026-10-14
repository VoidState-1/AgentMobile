import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Runtime } from '@/adapters/runtime';
import { defaultAgentLimits, defaultSystemPrompt, contentLimits, type AgentLimits } from '@/core/agent/settings';
import { Button, Field, T } from '@/features/workbench/ui';
import { ConfigPage, FormScroll, Loading, Section, useConfiguration, useDraftGuard } from '@/features/model-config/common';

const fields: { key: keyof AgentLimits; label: string; hint: string; unit: number }[] = [
  { key: 'maxModelRounds', label: '模型请求轮数', hint: '1–200 轮', unit: 1 },
  { key: 'maxToolCalls', label: '工具调用次数', hint: '1–2,000 次', unit: 1 },
  { key: 'maxRuntimeMs', label: '任务总时长（分钟）', hint: '1–120 分钟', unit: 60_000 },
  { key: 'requestTimeoutMs', label: '单次请求超时（秒）', hint: '5–1,800 秒', unit: 1000 },
  { key: 'historyTasks', label: '携带的历史任务数量', hint: '0–50 条；0 表示不带历史', unit: 1 },
];
const limitsDraft = (limits: Readonly<AgentLimits>) => Object.fromEntries(fields.map((field) => [field.key, String(limits[field.key] / field.unit)])) as Record<keyof AgentLimits, string>;
export function AgentSettingsScreen() {
  const controller = useConfiguration();
  if (!controller.runtime) return <ConfigPage title="Agent 设置"><Loading />{!!controller.error && <T tone="danger">{controller.error}</T>}</ConfigPage>;
  return <Editor runtime={controller.runtime} />;
}
function Editor({ runtime }: { runtime: Runtime }) {
  const router = useRouter(); const initial = runtime.agentSettings.getSnapshot();
  const [prompt, setPrompt] = useState(initial.systemPrompt); const [limits, setLimits] = useState(() => limitsDraft(initial.limits));
  const [revision, setRevision] = useState(initial.revision); const [saved, setSaved] = useState(JSON.stringify([initial.systemPrompt, limitsDraft(initial.limits)]));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const signature = JSON.stringify([prompt, limits]); const dirty = signature !== saved; const guard = useDraftGuard(dirty);
  const save = async () => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const value = await runtime.agentSettings.save({ systemPrompt: prompt, limits: Object.fromEntries(fields.map((field) => [field.key, Number(limits[field.key]) * field.unit])) as unknown as AgentLimits }, revision);
      const next = limitsDraft(value.limits); setPrompt(value.systemPrompt); setLimits(next); setRevision(value.revision);
      setSaved(JSON.stringify([value.systemPrompt, next])); setNotice('Agent 设置已保存，下次任务生效。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <ConfigPage title="Agent 设置" subtitle="系统提示词与执行预算"
    onBack={() => guard.exit(() => router.canGoBack() ? router.back() : router.replace('/'))}
    footer={<View style={{ gap: 7 }}>{!!error && <T tone="danger" style={{ fontSize: 12 }}>{error}</T>}{!!notice && <T tone="accent" style={{ fontSize: 12 }}>{notice}</T>}
      <Button label="保存 Agent 设置" disabled={!dirty} busy={busy} onPress={() => { void save(); }} /></View>}>
    <FormScroll>
      <Section title="系统提示词" hint="应用于所有项目的新任务。正在运行的任务继续使用启动时的设置。">
        <Field label="系统提示词" value={prompt} onChangeText={(text) => { setPrompt(text); setNotice(''); }} editable={!busy} multiline
          maxLength={contentLimits.systemPromptCharacters} textAlignVertical="top" style={{ minHeight: 210, lineHeight: 22 }} />
        <T tone="muted" style={{ fontSize: 10 }}>{prompt.length.toLocaleString()} / 16,000 字符</T>
        <Button label="恢复默认提示词" variant="ghost" disabled={busy} onPress={() => { setPrompt(defaultSystemPrompt); setNotice(''); }} />
      </Section>
      <Section title="执行预算" hint="提高预算可支持更长的任务，也可能增加模型调用费用。达到上限时停止并保留已完成的修改。">
        {fields.map((field) => <View key={field.key} style={{ gap: 5 }}>
          <Field label={field.label} value={limits[field.key]} keyboardType={field.unit === 60_000 ? 'decimal-pad' : 'number-pad'} editable={!busy}
            onChangeText={(value) => { setLimits({ ...limits, [field.key]: value }); setNotice(''); }} />
          <T tone="muted" style={{ fontSize: 10 }}>{field.hint}</T>
        </View>)}
        <T tone="secondary" style={{ fontSize: 11, lineHeight: 18 }}>历史数量是上限，实际输入会给当前任务预留空间。供应商的上下文和输出限制仍适用。</T>
        <Button label="恢复默认预算" variant="ghost" disabled={busy} onPress={() => { setLimits(limitsDraft(defaultAgentLimits)); setNotice(''); }} />
      </Section>
      <Section title="模型输出与资料" hint="输出 tokens 和推理预算在对应模型中设置。已有模型的输出设置保留原值。">
        <T tone="secondary" style={{ fontSize: 12, lineHeight: 21 }}>新模型默认 8,192 输出 tokens，可配置至 65,536，受模型公布的上限约束。文本文件 1 MB，导入文件 20 MB，模型图片输入 4 MB。大型文本支持分段读取。</T>
        <Button label="模型与供应商" variant="secondary" disabled={busy} onPress={() => guard.exit(() => router.push('/models'))} />
      </Section>
    </FormScroll>
    {guard.guard}
  </ConfigPage>;
}
