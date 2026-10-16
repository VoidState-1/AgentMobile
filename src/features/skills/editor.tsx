import { AppError } from '@/core/errors';
import { useEffect, useState } from 'react';
import { Buffer } from 'buffer';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { SkillBundle, SkillVersionPage } from '@/core/skills/types';
import { resourceKind, skillLimits, skillPath } from '@/core/skills/rules';
import { mimeFor } from '@/core/workspace/path';
import {
  Choices,
  ConfigPage,
  FormScroll,
  Loading,
  Section,
  Toggle,
  useDraftGuard,
} from '@/shared/ui/forms';
import { Button, Field, Sheet, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { useSkills } from './common';

const template =
  '---\nname: my-skill\ndescription: 整理文字资料，适用于需要提炼重点并形成结构化笔记的任务。\n---\n\n# 工作流程\n\n1. 读取相关项目资料，核对目标。\n2. 提炼重点、待确认信息和下一步。\n3. 保存为 Markdown，保留来源说明。\n';
export function SkillEditorPage() {
  const controller = useSkills();
  const { name } = useLocalSearchParams<{ name?: string }>();
  if (!controller.runtime)
    return (
      <ConfigPage title="技能编辑">
        <Loading />
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </ConfigPage>
    );
  if (name && !controller.config.skills.some(skill => skill.name === name))
    return (
      <ConfigPage title="技能已删除">
        <T style={{ padding: 20 }}>请返回技能库重新选择。</T>
      </ConfigPage>
    );
  return <Editor key={name ?? 'new'} name={name} controller={controller} />;
}
type ResourceDraft = {
  path: string;
  text: string;
  savedText: string;
  fresh?: boolean;
  bytes?: Uint8Array;
};
function Editor({ name, controller }: { name?: string; controller: ReturnType<typeof useSkills> }) {
  const { runtime, config, busy, error, action, projectId, setProjectId, projects } = controller;
  const router = useRouter();
  const theme = useWorkbenchTheme();
  const skill = config.skills.find(skill => skill.name === name);
  const [source, setSource] = useState(name ? '' : template);
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  const [savedSource, setSavedSource] = useState(name ? '' : template);
  const [files, setFiles] = useState<SkillBundle['files']>([]);
  const [baseCommit, setBaseCommit] = useState(config.commit);
  const [loaded, setLoaded] = useState(!name);
  const [changed, setChanged] = useState(false);
  const [notice, setNotice] = useState('');
  const [resource, setResource] = useState<ResourceDraft>();
  const [discardResource, setDiscardResource] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [versions, setVersions] = useState<SkillVersionPage>();
  const [restoring, setRestoring] = useState<{
    bundle: SkillBundle;
    commit: string;
    expectedCommit: string;
  }>();
  const resourceType = resource?.fresh
    ? 'text'
    : resource
      ? resourceKind(resource.path)
      : undefined;
  const resourceDirty =
    !!resource &&
    resourceType === 'text' &&
    (resource.fresh
      ? !!resource.text || resource.path !== 'references/notes.md'
      : resource.text !== resource.savedText);
  const dirty = source !== savedSource || changed || resourceDirty;
  const guard = useDraftGuard(dirty);
  useEffect(() => {
    if (!name) return;
    let current = true;
    const commit = runtime!.skills.getSnapshot().commit;
    void runtime!.skills
      .bundle(commit, name)
      .then(bundle => {
        if (!current) return;
        const text = runtime!.skills.decodeText(
          bundle.files.find(file => file.path === 'SKILL.md')!.bytes,
        );
        setFiles(bundle.files);
        setSource(text);
        setSavedSource(text);
        setBaseCommit(commit);
        setLoaded(true);
      })
      .catch(() => {
        if (current) setNotice('技能正文读取失败，请重新打开此页。');
      });
    return () => {
      current = false;
    };
  }, [runtime, name]);
  const adopt = (bundle: SkillBundle) => {
    const text = runtime!.skills.decodeText(
      bundle.files.find(file => file.path === 'SKILL.md')!.bytes,
    );
    setFiles(bundle.files);
    setSource(text);
    setSavedSource(text);
    setBaseCommit(runtime!.skills.getSnapshot().commit);
    setChanged(false);
    setResource(undefined);
  };
  const draftBundle = () => {
    const bundle = runtime!.skills.validateBundle([
      { path: 'SKILL.md', bytes: Buffer.from(source) },
      ...files.filter(file => file.path !== 'SKILL.md'),
    ]);
    if (name && bundle.name !== name)
      throw new AppError(
        'VALIDATION',
        '已有技能名称不能直接改名；请保持 name 字段，或新建另一个技能。',
      );
    return bundle;
  };
  const save = () => {
    void action(async () => {
      if (resourceDirty) throw new AppError('VALIDATION', '请先将资源编辑应用到技能草稿。');
      const bundle = draftBundle();
      await runtime!.skills.install([bundle], baseCommit);
      adopt(bundle);
      setNotice('技能已保存；内容变化后请重新启用。');
      if (!name)
        guard.allow(() =>
          router.replace({ pathname: '/skills/edit', params: { name: bundle.name } }),
        );
    });
  };
  return (
    <ConfigPage
      title={name ?? '新建技能'}
      onBack={() =>
        guard.exit(() => (router.canGoBack() ? router.back() : router.replace('/skills')))
      }
      footer={
        <View style={{ gap: 6 }}>
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
            label="保存技能"
            busy={busy}
            disabled={!loaded || (!!name && !dirty)}
            onPress={save}
          />
        </View>
      }
    >
      {!loaded ? (
        <Loading />
      ) : (
        <FormScroll>
          <Section title="SKILL.md">
            <Field
              label="SKILL.md 内容"
              hideLabel
              value={source}
              onChangeText={value => {
                setSource(value);
                setNotice('');
              }}
              editable={!busy}
              multiline
              textAlignVertical="top"
              maxLength={65_536}
              style={{ minHeight: 220, fontSize: 14, lineHeight: 21 }}
            />
            {sourceBytes >= skillLimits.instructionBytes * 0.9 && (
              <T tone="warning" style={{ fontSize: 12 }}>
                {(sourceBytes / 1024).toFixed(1)} / {skillLimits.instructionBytes / 1024} KB
              </T>
            )}
          </Section>
          <Section title="配套资源">
            {files
              .filter(file => file.path !== 'SKILL.md')
              .map(file => (
                <Pressable
                  key={file.path}
                  accessibilityRole="button"
                  accessibilityLabel={'编辑技能资源 ' + file.path}
                  disabled={busy}
                  onPress={() =>
                    setResource({
                      path: file.path,
                      text:
                        resourceKind(file.path) === 'text'
                          ? runtime!.skills.decodeText(file.bytes)
                          : '',
                      savedText:
                        resourceKind(file.path) === 'text'
                          ? runtime!.skills.decodeText(file.bytes)
                          : '',
                      bytes: file.bytes,
                    })
                  }
                  style={{
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderColor: theme.border,
                    gap: 3,
                  }}
                >
                  <T tone="accent" style={{ fontSize: 12 }}>
                    {file.path}
                  </T>
                  <T tone="muted" style={{ fontSize: 10 }}>
                    {(file.bytes.length / 1024).toFixed(1)} KB ·{' '}
                    {resourceKind(file.path) === 'text'
                      ? '文字'
                      : resourceKind(file.path) === 'image'
                        ? '图片'
                        : '保留供导出'}
                  </T>
                </Pressable>
              ))}
            {!files.some(file => file.path !== 'SKILL.md') && (
              <T tone="muted" style={{ fontSize: 12 }}>
                暂无资源
              </T>
            )}
            <Button
              label="添加文字资源"
              variant="secondary"
              disabled={busy}
              onPress={() =>
                setResource({ path: 'references/notes.md', text: '', savedText: '', fresh: true })
              }
            />
          </Section>
          {skill && (
            <Section title="项目启用">
              {projects.length ? (
                <Choices
                  label="启用项目"
                  value={projectId}
                  options={projects.map(project => ({ value: project.id, label: project.name }))}
                  onChange={setProjectId}
                  disabled={busy}
                />
              ) : (
                <T tone="muted">请先创建项目。</T>
              )}
              <Toggle
                label={'启用技能 ' + name}
                hint={dirty ? '先保存草稿，再启用。' : undefined}
                value={config.grants[projectId]?.[name!] === skill.revision}
                disabled={busy || dirty || !projectId}
                onChange={allow => {
                  void action(() => runtime!.skills.grant(projectId, name!, allow, skill.revision));
                }}
              />
              {skill.warnings.map(warning => (
                <T key={warning} tone="warning" style={{ fontSize: 11 }}>
                  {warning}
                </T>
              ))}
            </Section>
          )}
          {!!name && (
            <Section title="版本与导出">
              <Button
                label="导出技能 ZIP"
                variant="secondary"
                disabled={busy || dirty}
                onPress={() => {
                  void action(async () => {
                    await runtime!.io.exportSkill(name, baseCommit);
                  });
                }}
              />
              <Button
                label="查看技能版本"
                variant="secondary"
                busy={busy}
                onPress={() => {
                  void action(async () => {
                    setVersions(await runtime!.skills.versions(name));
                  });
                }}
              />
              {versions?.versions.map((version, index) => (
                <View key={version.commit} style={{ gap: 5 }}>
                  <T tone="secondary" style={{ fontSize: 11 }}>
                    {version.message} · {new Date(version.timestamp).toLocaleString()}
                  </T>
                  <T tone="muted" style={{ fontSize: 10 }}>
                    {version.revision.slice(0, 7)}
                    {index === 0 ? ' · 当前版本' : ''}
                  </T>
                  {index > 0 && (
                    <Button
                      label={'预览技能版本 ' + version.revision.slice(0, 7)}
                      variant="ghost"
                      disabled={busy || dirty}
                      onPress={() => {
                        void action(async () => {
                          setRestoring({
                            bundle: await runtime!.skills.bundle(version.commit, name),
                            commit: version.commit,
                            expectedCommit: config.commit,
                          });
                        });
                      }}
                    />
                  )}
                </View>
              ))}
              {versions?.cursor && (
                <Button
                  label="加载更多技能版本"
                  variant="ghost"
                  busy={busy}
                  onPress={() => {
                    void action(async () => {
                      const page = await runtime!.skills.versions(name!, versions.cursor);
                      setVersions({
                        versions: [...versions.versions, ...page.versions],
                        cursor: page.cursor,
                      });
                    });
                  }}
                />
              )}
              {dirty && (
                <T tone="muted" style={{ fontSize: 11 }}>
                  先保存草稿，再导出或恢复版本。
                </T>
              )}
              <Button
                label="删除技能"
                variant="danger"
                disabled={busy}
                onPress={() => setDeleting(true)}
              />
            </Section>
          )}
        </FormScroll>
      )}
      {guard.guard}
      <Sheet
        visible={!!resource}
        title="技能资源"
        busy={busy}
        onClose={() => (resourceDirty ? setDiscardResource(true) : setResource(undefined))}
        footer={
          <View style={{ gap: 8 }}>
            {resource && resourceType === 'text' && (
              <Button
                label="应用资源到草稿"
                disabled={busy}
                onPress={() => {
                  void action(async () => {
                    const path = skillPath(resource.path);
                    if (path.toLowerCase() === 'skill.md')
                      throw new AppError('VALIDATION', '请在主编辑区修改 SKILL.md。');
                    if (resourceKind(path) !== 'text')
                      throw new AppError('VALIDATION', '文字资源需要使用 .md、.txt 等文本扩展名。');
                    if (
                      resource.fresh &&
                      files.some(file => file.path.toLowerCase() === path.toLowerCase())
                    )
                      throw new AppError('VALIDATION', '技能资源路径已存在，请选择现有文件编辑。');
                    const bytes = Buffer.from(resource.text);
                    if (bytes.length > 1024 * 1024)
                      throw new AppError('VALIDATION', '技能资源最多 1 MB。');
                    setFiles([...files.filter(file => file.path !== path), { path, bytes }]);
                    setChanged(true);
                    setResource(undefined);
                    setNotice('资源已加入草稿，保存技能后生效。');
                  });
                }}
              />
            )}
            {resource && !resource.fresh && (
              <Button
                label="从技能移除此资源"
                variant="danger"
                disabled={busy}
                onPress={() => {
                  setFiles(files.filter(file => file.path !== resource.path));
                  setChanged(true);
                  setResource(undefined);
                }}
              />
            )}
          </View>
        }
      >
        {resource && (
          <>
            <Field
              label="技能资源路径"
              value={resource.path}
              editable={!!resource.fresh}
              onChangeText={path => setResource({ ...resource, path })}
              maxLength={160}
            />
            {resourceType === 'text' ? (
              <Field
                label="技能资源内容"
                value={resource.text}
                onChangeText={text => setResource({ ...resource, text })}
                multiline
                textAlignVertical="top"
                style={{ minHeight: 220, fontSize: 12, lineHeight: 21 }}
                maxLength={500_000}
              />
            ) : resourceType === 'image' ? (
              <Image
                accessibilityLabel="技能资源图片"
                source={{
                  uri:
                    'data:' +
                    mimeFor(resource.path) +
                    ';base64,' +
                    Buffer.from(resource.bytes ?? []).toString('base64'),
                }}
                style={{ width: '100%', height: 240 }}
                contentFit="contain"
              />
            ) : (
              <T tone="secondary">二进制资源保留在包内，可导出后使用。</T>
            )}
          </>
        )}
        {!!error && (
          <T tone="danger" style={{ fontSize: 12 }}>
            {error}
          </T>
        )}
      </Sheet>
      <Sheet
        visible={discardResource}
        title="放弃资源编辑"
        onClose={() => setDiscardResource(false)}
        footer={
          <Button
            label="放弃资源草稿"
            variant="danger"
            onPress={() => {
              setDiscardResource(false);
              setResource(undefined);
            }}
          />
        }
      >
        <T tone="secondary">资源修改尚未应用到技能草稿。</T>
      </Sheet>
      <Sheet
        visible={deleting}
        title="删除技能"
        busy={busy}
        onClose={() => setDeleting(false)}
        footer={
          <Button
            label="确认删除技能"
            variant="danger"
            busy={busy}
            onPress={() =>
              guard.allow(() => {
                void action(async () => {
                  await runtime!.skills.remove(name!, baseCommit);
                  router.replace('/skills');
                });
              })
            }
          />
        }
      >
        <T tone="secondary">
          将移除此技能并撤销项目启用。运行任务继续使用原版本，已保存内容保留在 Git 历史中。
        </T>
      </Sheet>
      <Sheet
        visible={!!restoring}
        title="预览历史技能"
        busy={busy}
        onClose={() => setRestoring(undefined)}
        footer={
          <Button
            label="恢复此技能版本"
            busy={busy}
            onPress={() => {
              void action(async () => {
                const bundle = restoring!.bundle;
                await runtime!.skills.install([bundle], restoring!.expectedCommit);
                adopt(bundle);
                setRestoring(undefined);
                setVersions(await runtime!.skills.versions(name!));
                setNotice('技能版本已恢复，请重新启用。');
              });
            }}
          />
        }
      >
        <T selectable style={{ fontSize: 12 }}>
          {restoring &&
            runtime!.skills.decodeText(
              restoring.bundle.files.find(file => file.path === 'SKILL.md')!.bytes,
            )}
        </T>
        {!!restoring && (
          <T tone="muted" style={{ fontSize: 11 }}>
            {restoring.bundle.files.length} 个文件 · {restoring.commit.slice(0, 7)}
          </T>
        )}
      </Sheet>
    </ConfigPage>
  );
}
