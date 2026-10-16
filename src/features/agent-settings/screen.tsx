import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { AppServices as Runtime } from '@/application/services';
import {
  defaultAgentLimits,
  defaultSystemPrompt,
  contentLimits,
  type AgentLimits,
} from '@/core/agent/settings';
import { Button, Field, OverflowMenu, T } from '@/shared/ui/primitives';
import {
  ConfigPage,
  FormScroll,
  Loading,
  NumberField,
  Section,
  useDraftGuard,
} from '@/shared/ui/forms';
import { useAppServices } from '@/shared/use-app-services';

const fields: {
  key: keyof AgentLimits;
  label: string;
  name: string;
  suffix: string;
  unit: number;
}[] = [
  { key: 'maxModelRounds', label: '模型请求轮数', name: '模型请求轮数', suffix: '轮', unit: 1 },
  { key: 'maxToolCalls', label: '工具调用次数', name: '工具调用次数', suffix: '次', unit: 1 },
  {
    key: 'maxRuntimeMs',
    label: '任务总时长（分钟）',
    name: '任务总时长',
    suffix: '分钟',
    unit: 60_000,
  },
  {
    key: 'requestTimeoutMs',
    label: '单次请求超时（秒）',
    name: '单次请求超时',
    suffix: '秒',
    unit: 1000,
  },
  { key: 'historyTasks', label: '携带的历史任务数量', name: '携带历史任务', suffix: '条', unit: 1 },
];
const limitsDraft = (limits: Readonly<AgentLimits>) =>
  Object.fromEntries(
    fields.map(field => [field.key, String(limits[field.key] / field.unit)]),
  ) as Record<keyof AgentLimits, string>;
export function AgentSettingsScreen() {
  const controller = useAppServices();
  if (!controller.runtime)
    return (
      <ConfigPage title="Agent 设置">
        <Loading />
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </ConfigPage>
    );
  return <Editor runtime={controller.runtime} />;
}
function Editor({ runtime }: { runtime: Runtime }) {
  const router = useRouter();
  const initial = runtime.agentSettings.getSnapshot();
  const [prompt, setPrompt] = useState(initial.systemPrompt);
  const [limits, setLimits] = useState(() => limitsDraft(initial.limits));
  const [revision, setRevision] = useState(initial.revision);
  const [saved, setSaved] = useState(
    JSON.stringify([initial.systemPrompt, limitsDraft(initial.limits)]),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const signature = JSON.stringify([prompt, limits]);
  const dirty = signature !== saved;
  const guard = useDraftGuard(dirty);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await runtime.agentSettings.save(
        {
          systemPrompt: prompt,
          limits: Object.fromEntries(
            fields.map(field => [field.key, Number(limits[field.key]) * field.unit]),
          ) as unknown as AgentLimits,
        },
        revision,
      );
      const next = limitsDraft(value.limits);
      setPrompt(value.systemPrompt);
      setLimits(next);
      setRevision(value.revision);
      setSaved(JSON.stringify([value.systemPrompt, next]));
      setNotice('Agent 设置已保存，下次任务生效。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfigPage
      title="Agent 设置"
      onBack={() => guard.exit(() => (router.canGoBack() ? router.back() : router.replace('/')))}
      footer={
        <View style={{ gap: 7 }}>
          {!!error && (
            <T tone="danger" style={{ fontSize: 12 }}>
              {error}
            </T>
          )}
          {!!notice && (
            <T tone="accent" style={{ fontSize: 12 }}>
              {notice}
            </T>
          )}
          <Button
            label="保存 Agent 设置"
            disabled={!dirty}
            busy={busy}
            onPress={() => {
              void save();
            }}
          />
        </View>
      }
    >
      <FormScroll>
        <Section
          title="系统提示词"
          action={
            <OverflowMenu
              label="系统提示词操作"
              disabled={busy}
              items={[
                {
                  label: '恢复默认提示词',
                  onPress: () => {
                    setPrompt(defaultSystemPrompt);
                    setNotice('');
                  },
                },
              ]}
            />
          }
        >
          <Field
            label="系统提示词"
            hideLabel
            value={prompt}
            onChangeText={text => {
              setPrompt(text);
              setNotice('');
            }}
            editable={!busy}
            multiline
            maxLength={contentLimits.systemPromptCharacters}
            textAlignVertical="top"
            style={{ height: 144, lineHeight: 22 }}
          />
          {prompt.length >= contentLimits.systemPromptCharacters * 0.9 && (
            <T tone="warning" style={{ fontSize: 12 }}>
              {prompt.length.toLocaleString()} / 16,000 字符
            </T>
          )}
        </Section>
        <Section
          title="执行预算"
          action={
            <OverflowMenu
              label="执行预算操作"
              disabled={busy}
              items={[
                {
                  label: '恢复默认预算',
                  onPress: () => {
                    setLimits(limitsDraft(defaultAgentLimits));
                    setNotice('');
                  },
                },
              ]}
            />
          }
        >
          {fields.map(field => (
            <NumberField
              key={field.key}
              label={field.name}
              accessibilityLabel={field.label}
              unit={field.suffix}
              value={limits[field.key]}
              keyboardType={field.unit === 60_000 ? 'decimal-pad' : 'number-pad'}
              editable={!busy}
              onChangeText={value => {
                setLimits({ ...limits, [field.key]: value });
                setNotice('');
              }}
            />
          ))}
        </Section>
      </FormScroll>
      {guard.guard}
    </ConfigPage>
  );
}
