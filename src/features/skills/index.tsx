import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { SkillBundle } from '@/core/skills/types';
import { importSkillPackage } from '@/adapters/skills/package';
import { pickSkillPackage } from '@/adapters/skills/io';
import { Choices, ConfigPage, FormScroll, Loading, Section, Toggle } from '@/features/model-config/common';
import { Button, Field, Sheet, T } from '@/features/workbench/ui';
import { useWorkbenchTheme } from '@/features/workbench/theme';
import { useSkills } from './common';

export function SkillsPage() {
  const { runtime, config, error, busy, action, projectId, setProjectId, projects } = useSkills(); const router = useRouter(); const theme = useWorkbenchTheme();
  const [search, setSearch] = useState(''); const [preview, setPreview] = useState<{ bundles: SkillBundle[]; commit: string }>(); const [notice, setNotice] = useState('');
  const skills = config.skills.filter((skill) => (skill.name + skill.description).toLowerCase().includes(search.toLowerCase()));
  return <ConfigPage title="Agent Skills" subtitle="复用工作流程，按需加载说明" action={<Button label="新建技能" variant="secondary" onPress={() => router.push('/skills/edit')} />}>
    {!runtime ? <Loading /> : <FormScroll>
      <Section title="技能库" hint="支持通用 SKILL.md 与含 references/assets 的 ZIP。导入后按项目启用。">
        <Button label="导入 SKILL.md / ZIP" variant="secondary" busy={busy} onPress={() => { void action(async () => {
          const file = await pickSkillPackage(); if (!file) return; setPreview({ bundles: importSkillPackage(file.name, file.bytes), commit: runtime.skills.getSnapshot().commit }); setNotice('');
        }); }} />
        <Field label="搜索技能" value={search} onChangeText={setSearch} placeholder="名称或描述" />
        {projects.length ? <Choices label="启用项目" value={projectId} options={projects.map((project) => ({ value: project.id, label: project.name }))} onChange={setProjectId} disabled={busy} /> : <T tone="muted" style={{ fontSize: 12 }}>先创建项目，再启用技能。技能库可独立管理。</T>}
        {!skills.length && <T tone="secondary" style={{ fontSize: 12 }}>{config.skills.length ? '没有匹配的技能。' : '还没有技能。可以新建，或导入现有技能包。'}</T>}
        {skills.map((skill) => <View key={skill.name} style={{ borderTopWidth: 1, borderColor: theme.border, paddingTop: 12, gap: 7 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={'管理技能 ' + skill.name} onPress={() => router.push({ pathname: '/skills/edit', params: { name: skill.name } })} style={{ gap: 3 }}>
            <T tone="accent" style={{ fontSize: 13, fontWeight: '600' }}>{skill.name}</T>
            <T tone="secondary" numberOfLines={3} style={{ fontSize: 11, lineHeight: 19 }}>{skill.description}</T>
            <T tone="muted" style={{ fontSize: 10 }}>{skill.files.length} 个文件 · {skill.revision.slice(0, 7)}{skill.warnings.length ? ' · 查看兼容说明' : ''}</T>
          </Pressable>
          <Toggle label={'启用技能 ' + skill.name} hint="本项目内所有对话可使用；修改只影响新任务。" value={config.grants[projectId]?.[skill.name] === skill.revision} disabled={busy || !projectId}
            onChange={(allow) => { void action(() => runtime.skills.grant(projectId, skill.name, allow, skill.revision)); }} />
        </View>)}
      </Section>
      <Section title="如何调用">
        <T tone="secondary" style={{ fontSize: 12, lineHeight: 21 }}>启用后，Agent 会根据任务选择技能并加载正文。你也可以在消息中输入 $技能名，明确指定使用。引用文件按需读取，工作轨迹会显示加载步骤。</T>
        <T tone="muted" style={{ fontSize: 11, lineHeight: 20 }}>技能说明不增加工具权限。当前支持文字和图片资源；脚本可以保存和阅读，执行能力尚未实现。更新正文或资源后，需要重新启用对应项目。</T>
      </Section>
      {!!config.issues.length && <Section title="需要处理的技能">{config.issues.map((issue) => <T key={issue} tone="warning" style={{ fontSize: 12 }}>{issue}</T>)}</Section>}
      {!!error && <T tone="danger" style={{ fontSize: 12 }}>{error}</T>}{!!notice && <T tone="accent" style={{ fontSize: 12 }}>{notice}</T>}
    </FormScroll>}
    <Sheet visible={!!preview} title="导入技能预览" onClose={() => setPreview(undefined)} busy={busy} footer={<Button label="安装技能包" busy={busy}
      onPress={() => { void action(async () => { await runtime!.skills.install(preview!.bundles, preview!.commit); setPreview(undefined); setNotice('技能已安装，请按项目启用。'); }); }} />}>
      {preview?.bundles.map((skill) => <View key={skill.name} style={{ gap: 5 }}>
        <T style={{ fontWeight: '600' }}>{skill.name}{config.skills.some((existing) => existing.name === skill.name) ? ' · 将更新现有技能' : ''}</T>
        <T tone="secondary" style={{ fontSize: 12 }}>{skill.description}</T><T tone="muted" style={{ fontSize: 11 }}>{skill.files.length} 个文件</T>
        {skill.warnings.map((warning) => <T key={warning} tone="warning" style={{ fontSize: 11 }}>{warning}</T>)}
      </View>)}
      <T tone="secondary" style={{ fontSize: 12 }}>更新后旧版本保留在 Git，已运行任务继续使用原版本，变化后的技能需重新启用。</T>
    </Sheet>
  </ConfigPage>;
}
