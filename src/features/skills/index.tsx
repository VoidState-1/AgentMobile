import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { SkillBundle } from '@/core/skills/types';
import { Choices, ConfigPage, FormScroll, Loading, Section, Toggle } from '@/shared/ui/forms';
import { Button, Field, Sheet, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { ChevronRight } from '@/shared/ui/icons';
import { useSkills } from './common';

export function SkillsPage() {
  const { runtime, config, error, busy, action, projectId, setProjectId, projects } = useSkills();
  const router = useRouter();
  const theme = useWorkbenchTheme();
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<{ bundles: SkillBundle[]; commit: string }>();
  const [notice, setNotice] = useState('');
  const skills = config.skills.filter(skill =>
    (skill.name + skill.description).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <ConfigPage
      title="Agent Skills"
      subtitle={config.skills.length + ' 个技能'}
      action={
        <Button label="新建技能" variant="secondary" onPress={() => router.push('/skills/edit')} />
      }
    >
      {!runtime ? (
        <Loading />
      ) : (
        <FormScroll>
          <Section title="技能库">
            <Button
              label="导入 SKILL.md / ZIP"
              variant="secondary"
              busy={busy}
              onPress={() => {
                void action(async () => {
                  const file = await runtime.io.pickSkillPackage();
                  if (!file) return;
                  setPreview({
                    bundles: runtime.skills.importPackage(file.name, file.bytes),
                    commit: runtime.skills.getSnapshot().commit,
                  });
                  setNotice('');
                });
              }}
            />
            <Field
              label="搜索技能"
              hideLabel
              value={search}
              onChangeText={setSearch}
              placeholder="名称或描述"
            />
            {projects.length ? (
              <Choices
                label="启用项目"
                value={projectId}
                options={projects.map(project => ({ value: project.id, label: project.name }))}
                onChange={setProjectId}
                disabled={busy}
              />
            ) : (
              <T tone="muted" style={{ fontSize: 12 }}>
                未选择项目
              </T>
            )}
            {!skills.length && (
              <T tone="secondary" style={{ fontSize: 12 }}>
                {config.skills.length ? '没有匹配的技能。' : '暂无技能'}
              </T>
            )}
            {skills.map(skill => (
              <View
                key={skill.name}
                style={{ borderTopWidth: 1, borderColor: theme.border, paddingTop: 6, gap: 2 }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'管理技能 ' + skill.name}
                  onPress={() =>
                    router.push({ pathname: '/skills/edit', params: { name: skill.name } })
                  }
                  style={({ pressed }) => ({
                    gap: 2,
                    minHeight: 44,
                    justifyContent: 'center',
                    backgroundColor: pressed ? theme.inset : 'transparent',
                  })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <T tone="accent" style={{ fontSize: 13, fontWeight: '600' }}>
                      {skill.name}
                    </T>
                    <T tone="muted" style={{ flex: 1, fontSize: 11, textAlign: 'right' }}>
                      {skill.files.length} 个文件
                    </T>
                    <ChevronRight size={15} color={theme.muted} />
                  </View>
                  <T tone="secondary" numberOfLines={2} style={{ fontSize: 12, lineHeight: 19 }}>
                    {skill.description}
                  </T>
                  <T tone="muted" style={{ fontSize: 10 }}>
                    {skill.revision.slice(0, 7)}
                    {skill.warnings.length ? ' · 查看兼容说明' : ''}
                  </T>
                </Pressable>
                <Toggle
                  label={'启用技能 ' + skill.name}
                  value={config.grants[projectId]?.[skill.name] === skill.revision}
                  disabled={busy || !projectId}
                  onChange={allow => {
                    void action(() =>
                      runtime.skills.grant(projectId, skill.name, allow, skill.revision),
                    );
                  }}
                />
              </View>
            ))}
          </Section>
          {!!config.issues.length && (
            <Section title="需要处理的技能">
              {config.issues.map(issue => (
                <T key={issue} tone="warning" style={{ fontSize: 12 }}>
                  {issue}
                </T>
              ))}
            </Section>
          )}
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
        </FormScroll>
      )}
      <Sheet
        visible={!!preview}
        title="导入技能预览"
        onClose={() => setPreview(undefined)}
        busy={busy}
        footer={
          <Button
            label="安装技能包"
            busy={busy}
            onPress={() => {
              void action(async () => {
                await runtime!.skills.install(preview!.bundles, preview!.commit);
                setPreview(undefined);
                setNotice('技能已安装，请按项目启用。');
              });
            }}
          />
        }
      >
        {preview?.bundles.map(skill => (
          <View key={skill.name} style={{ gap: 5 }}>
            <T style={{ fontWeight: '600' }}>
              {skill.name}
              {config.skills.some(existing => existing.name === skill.name)
                ? ' · 将更新现有技能'
                : ''}
            </T>
            <T tone="secondary" style={{ fontSize: 12 }}>
              {skill.description}
            </T>
            <T tone="muted" style={{ fontSize: 11 }}>
              {skill.files.length} 个文件
            </T>
            {skill.warnings.map(warning => (
              <T key={warning} tone="warning" style={{ fontSize: 11 }}>
                {warning}
              </T>
            ))}
          </View>
        ))}
        <T tone="secondary" style={{ fontSize: 12 }}>
          更新后旧版本保留在 Git，已运行任务继续使用原版本，变化后的技能需重新启用。
        </T>
      </Sheet>
    </ConfigPage>
  );
}
