import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text as NativeText, TextInput, useWindowDimensions, View, type TextProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';
import type { ModelSettings, Project, ProjectFile, TaskRecord, Version } from '@/core/prototype/types';
import { defaultSettings } from '@/core/prototype/types';
import { isImage, safePath } from '@/core/workspace/path';
import { getRuntime, type Runtime } from '@/adapters/runtime';
import { startAgent } from '@/adapters/agent/runner';
import { pickFile, exportFile } from '@/adapters/io/files';
import { useUiStore } from './ui-store';

const c = {
  bg: '#F5F6F2', surface: '#FFFFFF', text: '#24342C', muted: '#748078', border: '#E1E7DF',
  accent: '#356C50', soft: '#EAF1E9', danger: '#AD453D', orange: '#A77936',
};

function Text(props: TextProps) {
  return <NativeText {...props} style={[
    Platform.OS === 'web' && { fontFamily: 'system-ui, "Microsoft YaHei", sans-serif' }, props.style,
  ]} />;
}

function Button({ children, onPress, disabled, secondary, danger, testID }: {
  children: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean; testID?: string;
}) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={children} onPress={onPress}
      disabled={disabled} style={({ pressed }) => [
        styles.button, secondary && styles.secondary, danger && styles.danger,
        disabled && { opacity: 0.4 }, pressed && { opacity: 0.75 },
      ]}>
      <Text style={[styles.buttonText, secondary && { color: c.text }, danger && { color: c.danger }]}>{children}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, multiline, placeholder, secret, testID }: {
  label: string; value: string; onChangeText: (text: string) => void; multiline?: boolean; placeholder?: string; secret?: boolean; testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor={c.muted} secureTextEntry={secret}
        autoCapitalize="none" autoCorrect={false} multiline={multiline}
        style={[styles.input, multiline && styles.textarea]} />
    </View>
  );
}

export function PrototypeScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const { projectId, tab, selectProject, selectTab } = useUiStore();
  const [runtime, setRuntime] = useState<Runtime>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [settings, setSettings] = useState<ModelSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState<ModelSettings>(defaultSettings);
  const [active, setActive] = useState<TaskRecord>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'create' | 'new-file' | 'file' | 'settings' | 'changes'>();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [opened, setOpened] = useState<{ path: string; revision: string }>();
  const [key, setKey] = useState('');
  const [prompt, setPrompt] = useState('将我的资料整理成一份清晰的图文笔记，保存为 documents/summary.md。');
  const [changes, setChanges] = useState<{ path: string; kind: string; before: string; after: string }[]>([]);
  const [confirmation, setConfirmation] = useState<{ title: string; detail: string; perform: () => Promise<void> }>();
  const cancel = useRef<(() => void) | undefined>(undefined);
  const runtimeRef = useRef<Runtime | undefined>(undefined);
  const project = projects.find((item) => item.id === projectId);

  const refresh = useCallback(async (id?: string) => {
    const service = runtimeRef.current;
    if (!service) return;
    setProjects(await service.workspace.projects());
    if (id) {
      const [nextFiles, nextVersions, nextTasks] = await Promise.all([
        service.workspace.files(id), service.workspace.git.log(id), service.tasks(id),
      ]);
      if (useUiStore.getState().projectId !== id) return;
      setFiles(nextFiles); setVersions(nextVersions); setTasks(nextTasks);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getRuntime().then(async (service) => {
      const [list, config] = await Promise.all([service.workspace.projects(), service.settings()]);
      if (!mounted) return;
      runtimeRef.current = service; setRuntime(service); setProjects(list); setSettings(config);
      if (service.workspace.recoveryIssues.length) setError(service.workspace.recoveryIssues.join('\n'));
    }).catch(() => { if (mounted) setError('本地存储初始化失败。请保留浏览器或设备数据后重试。'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; cancel.current?.(); };
  }, []);

  useEffect(() => {
    if (runtime && projectId) {
      refresh(projectId).catch((reason) => setError(String(reason.message)));
    }
  }, [runtime, projectId, refresh]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试');
    } finally { setBusy(false); }
  }

  async function createProject() {
    if (!runtime) return;
    await action(async () => {
      const created = await runtime.workspace.create(name);
      selectProject(created.id); setModal(undefined); setName('');
      await refresh(created.id);
    });
  }

  async function openFile(file: ProjectFile) {
    if (!runtime || !projectId) return;
    await action(async () => {
      const preview = await runtime.workspace.preview(projectId, file.path);
      setOpened({ path: file.path, revision: preview.revision }); setPath(file.path);
      setContent(preview.content); setModal('file');
    });
  }

  async function saveFile() {
    if (!runtime || !projectId) return;
    await action(async () => {
      if (modal === 'new-file') {
        if (!/\.(md|txt)$/i.test(path)) throw new Error('文本文件请使用 .md 或 .txt 扩展名');
        await runtime.workspace.write(projectId, safePath(path), Buffer.from(content), null);
      } else if (opened) {
        await runtime.workspace.write(projectId, opened.path, Buffer.from(content), opened.revision);
      }
      setModal(undefined); setNotice('文件已保存，历史版本已记录。'); await refresh(projectId);
    });
  }

  async function importFile() {
    if (!runtime || !projectId) return;
    await action(async () => {
      const selected = await pickFile();
      if (!selected) return;
      if (!/\.(md|txt|png|jpg|jpeg|webp)$/i.test(selected.name)) throw new Error('请选择 Markdown、文本或 PNG/JPEG/WebP 图片');
      const target = (isImage(selected.name) ? 'assets/' : 'documents/') + safePath(selected.name);
      await runtime.workspace.write(projectId, target, selected.bytes, null, { message: '导入 ' + selected.name });
      await refresh(projectId); setNotice('已导入 ' + selected.name);
    });
  }

  async function run() {
    if (!runtime || !projectId || !prompt.trim()) return;
    await action(async () => {
      const started = await startAgent(runtime.workspace, projectId, prompt.trim(), settings,
        await runtime.credentials.get(), Crypto.randomUUID, setActive);
      cancel.current = started.cancel; selectTab('agent');
      void started.done.then(async (task) => {
        cancel.current = undefined; setActive(undefined);
        if (task.error) setError(task.error);
        await refresh(projectId);
      }).catch(() => {
        cancel.current = undefined; setActive(undefined); setError('任务状态保存失败，请重新打开应用恢复。');
      });
    });
  }

  async function showChanges(task: TaskRecord) {
    if (!runtime || !projectId) return;
    await action(async () => {
      setChanges(await runtime.workspace.changes(projectId, task.baseCommit,
        task.finalCommit ?? await runtime.workspace.git.head(projectId)));
      setModal('changes');
    });
  }

  async function openSettings() {
    if (!runtime) return;
    setSettingsDraft({ ...settings }); setKey(await runtime.credentials.get()); setModal('settings');
  }

  const header = (
    <View style={styles.topbar}>
      <View style={styles.brandGroup}><View style={styles.logo}><Text style={styles.logoText}>a.</Text></View>
        <View><Text style={styles.brand}>Agent Mobile</Text><Text style={styles.caption}>文字 · 图片 · 每一步创作</Text></View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="模型设置" onPress={() => { void openSettings(); }} style={styles.settingsButton}>
        <Text style={styles.settingsIcon}>⚙</Text>
      </Pressable>
    </View>
  );

  if (loading) return <SafeAreaView style={styles.screen}><View style={styles.loading}><ActivityIndicator color={c.accent} /><Text style={styles.muted}>正在打开本地工作区…</Text></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      {!!error && <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text>
        <Pressable accessibilityLabel="关闭提示" onPress={() => setError('')}><Text style={styles.errorText}>×</Text></Pressable></View>}
      {!!notice && <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View>}
      <View style={[styles.body, wide && { flexDirection: 'row' }]}>
        {(wide || !projectId) && <ScrollView style={[styles.sidebar, wide && { width: 260, flexGrow: 0 }]} contentContainerStyle={styles.sidebarContent}>
          <View style={styles.rowBetween}><Text style={styles.sidebarHeading}>我的工作区</Text><Text style={styles.count}>{projects.length}</Text></View>
          <Button onPress={() => { setName(''); setModal('create'); }} disabled={busy || !!active}>＋ 新建项目</Button>
          {projects.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => selectProject(item.id)}
            disabled={!!active} style={[styles.projectCard, projectId === item.id && styles.selectedProject]}>
            <Text style={styles.projectSymbol}>▤</Text><View style={{ flex: 1 }}>
              <Text style={styles.projectName}>{item.name}</Text>
              <Text style={styles.caption}>{new Date(item.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} · 本地保存</Text>
            </View>
          </Pressable>)}
          {projects.length === 0 && <Text style={styles.sidebarHint}>从一份笔记开始。{'\n'}文字、图片和历史会保存在设备上。</Text>}
          {wide && <View style={styles.sidebarFooter}><View style={styles.statusDot} /><Text style={styles.caption}>本地工作区 · 原型版本</Text></View>}
        </ScrollView>}
        {(!projectId && wide) && <View style={styles.welcome}>
          <Text style={styles.eyebrow}>把零散的灵感，留在一起</Text>
          <Text style={styles.welcomeTitle}>让想法，{'\n'}慢慢成为作品。</Text>
          <Text style={styles.welcomeDescription}>整理文字与图片，和 Agent 一起修改。{'\n'}随时查看变化，回到任意一个版本。</Text>
          <Button onPress={() => { setName('我的第一个项目'); setModal('create'); }} disabled={busy}>创建第一个项目</Button>
          <View style={styles.welcomeNotes}><Text style={styles.muted}>01  导入资料</Text><Text style={styles.muted}>02  一起修改</Text><Text style={styles.muted}>03  留住版本</Text></View>
        </View>}
        {!!projectId && <View style={styles.main}>
          <View style={styles.projectHeader}>
            <View style={{ flex: 1 }}>
              {!wide && <Pressable accessibilityRole="button" onPress={() => selectProject(undefined)} disabled={!!active}>
                <Text style={styles.back}>← 工作区</Text></Pressable>}
              <Text style={styles.projectTitle}>{project?.name ?? '工作区'}</Text>
              <Text style={styles.muted}>所有修改，保留来时的路。</Text>
            </View>
            <View style={styles.modeBadge}><View style={[styles.statusDot, settings.mode === 'remote' && { backgroundColor: c.orange }]} />
              <Text style={styles.modeText}>{settings.mode === 'demo' ? '演示模式' : '云端模型'}</Text></View>
          </View>
          <View style={styles.tabs}>
            {(['files', 'agent', 'history'] as const).map((item) => <Pressable key={item} accessibilityRole="tab"
              accessibilityState={{ selected: tab === item }} onPress={() => selectTab(item)}
              style={[styles.tab, tab === item && styles.tabSelected]}>
              <Text style={[styles.tabText, tab === item && styles.tabTextSelected]}>
                {{ files: '资料', agent: 'Agent', history: '历史' }[item]}
              </Text>
            </Pressable>)}
          </View>
          <ScrollView style={styles.mainScroll} contentContainerStyle={styles.mainContent} keyboardShouldPersistTaps="handled">
            {tab === 'files' && <>
              <View style={styles.rowBetween}><Text style={styles.sectionHeading}>项目资料 <Text style={styles.count}>{files.length}</Text></Text>
                <View style={styles.actions}>
                  <Button secondary disabled={busy || !!active} onPress={() => { void importFile(); }}>导入</Button>
                  <Button disabled={busy || !!active} onPress={() => {
                    setPath('documents/untitled.md'); setContent(''); setOpened(undefined); setModal('new-file');
                  }}>＋ 新建</Button>
                </View>
              </View>
              <Text style={styles.hint}>支持 Markdown、文本与 PNG / JPEG / WebP 图片</Text>
              <View style={styles.fileList}>
                {files.map((file) => <Pressable key={file.path} accessibilityRole="button" accessibilityLabel={'打开 ' + file.path}
                  onPress={() => { void openFile(file); }} disabled={busy || !!active} style={styles.fileRow}>
                  <View style={[styles.fileIcon, isImage(file.path) && { backgroundColor: '#FAEEE0' }]}>
                    <Text style={[styles.fileIconText, isImage(file.path) && { color: c.orange }]}>{isImage(file.path) ? '▧' : 'T'}</Text>
                  </View>
                  <View style={{ flex: 1 }}><Text style={styles.fileName}>{file.path.split('/').pop()}</Text>
                    <Text style={styles.caption}>{file.path} · {file.size < 1024 ? file.size + ' B' : Math.ceil(file.size / 1024) + ' KB'}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>)}
              </View>
              <View style={styles.tipCard}><Text style={styles.tipTitle}>资料准备好了？</Text><Text style={styles.tipText}>告诉 Agent 你想完成什么，它会通过工具读取并修改当前项目。</Text>
                <Pressable accessibilityRole="button" onPress={() => selectTab('agent')}><Text style={styles.textLink}>开始一起创作 →</Text></Pressable></View>
            </>}
            {tab === 'agent' && <>
              <View style={styles.agentIntro}><View style={styles.agentMark}><Text style={styles.agentMarkText}>✳</Text></View>
                <Text style={styles.sectionHeading}>想让资料变成什么？</Text>
                <Text style={styles.hint}>例如整理笔记、润色文字，或把图片编排成图文资料。</Text></View>
              <View style={styles.composer}>
                <TextInput testID="task-prompt" accessibilityLabel="任务目标" multiline value={prompt} onChangeText={setPrompt}
                  editable={!active} style={styles.prompt} placeholder="描述你想完成的任务…" maxLength={4000} />
                <View style={styles.rowBetween}>
                  <Text style={styles.composerHint}>{settings.mode === 'demo' ? '预设演示 · 无需密钥' : '相关资料将发送到已配置的服务'}</Text>
                  {active ? <Button danger secondary onPress={() => cancel.current?.()}>停止任务</Button> :
                    <Button disabled={busy || !prompt.trim()} onPress={() => { void run(); }}>开始任务 ↗</Button>}
                </View>
              </View>
              {settings.mode === 'demo' && <Text style={styles.hint}>演示会读取资料并生成 summary.md，使用预设步骤，不进行语义理解。</Text>}
              {active && <View style={styles.taskCard}><View style={styles.rowBetween}><Text style={styles.taskHeading}>正在处理</Text><ActivityIndicator size="small" color={c.accent} /></View>
                {active.events.map((event, index) => <Text key={index} style={styles.eventText}>{event.state === 'done' ? '✓' : event.state === 'error' ? '!' : '·'} {event.tool} · {event.description}</Text>)}
                {!!active.response && <Text style={styles.response}>{active.response}</Text>}
              </View>}
              <Text style={[styles.sectionHeading, { marginTop: 16 }]}>任务记录</Text>
              {tasks.length === 0 && !active && <Text style={styles.hint}>第一次任务完成后，结果和文件变化会出现在这里。</Text>}
              {tasks.filter((task) => task.id !== active?.id).map((task) => <View key={task.id} style={styles.taskCard}>
                <View style={styles.rowBetween}><Text style={styles.taskHeading}>{{
                  completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '已中断', running: '执行中',
                }[task.state]}</Text><Text style={styles.caption}>{task.mode === 'demo' ? '演示' : '模型'} · {new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</Text></View>
                <Text style={styles.taskPrompt}>{task.prompt}</Text>
                {task.events.map((event, index) => <Text key={index} style={styles.eventText}>{event.state === 'done' ? '✓' : '!'} {event.tool}</Text>)}
                {!!task.response && <Text selectable style={styles.response}>{task.response}</Text>}
                {!!task.error && <Text style={styles.errorText}>{task.error}</Text>}
                <View style={styles.actions}>
                  <Button secondary disabled={busy || !!active} onPress={() => { void showChanges(task); }}>查看变化</Button>
                  <Button secondary disabled={busy || !!active || task.finalCommit !== versions[0]?.oid || task.baseCommit === task.finalCommit}
                    onPress={() => setConfirmation({
                      title: '撤销这次任务？', detail: '恢复任务开始前的项目内容。当前历史和任务记录会保留。',
                      perform: async () => {
                        await runtime!.workspace.restore(projectId, task.baseCommit, task.finalCommit!);
                        await refresh(projectId); setNotice('已恢复任务开始前的内容。');
                      },
                    })}>撤销修改</Button>
                </View>
                {task.finalCommit !== versions[0]?.oid && <Text style={styles.caption}>后续已有修改，可在历史中选择恢复。</Text>}
              </View>)}
            </>}
            {tab === 'history' && <>
              <Text style={styles.sectionHeading}>每一步，都可以回看</Text>
              <Text style={styles.hint}>恢复会创建一个新版本，已有历史不会被抹去。</Text>
              {versions.map((version, index) => <View key={version.oid} style={styles.versionRow}>
                <View style={[styles.versionDot, index === 0 && { backgroundColor: c.accent }]} />
                <View style={{ flex: 1 }}><Text style={styles.versionTitle}>{version.message.split('\n')[0]}</Text>
                  <Text style={styles.caption}>{new Date(version.timestamp).toLocaleString('zh-CN')} · {version.oid.slice(0, 7)}{index === 0 ? ' · 当前版本' : ''}</Text></View>
                {index > 0 && <Button secondary disabled={busy || !!active} onPress={() => setConfirmation({
                  title: '恢复这个版本？', detail: '项目全部文件将恢复到「' + version.message.split('\n')[0] + '」，并保存一个新版本。',
                  perform: async () => {
                    await runtime!.workspace.restore(projectId, version.oid, versions[0].oid);
                    await refresh(projectId); setNotice('历史内容已恢复。');
                  },
                })}>恢复</Button>}
              </View>)}
            </>}
          </ScrollView>
        </View>}
      </View>
      <Modal visible={!!modal} transparent animationType="none" onRequestClose={() => { if (!busy) setModal(undefined); }}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalCard, modal === 'file' && { maxWidth: 780 }]}>
            <View style={styles.rowBetween}><Text style={styles.modalTitle}>{{
              create: '新的创作空间', 'new-file': '新建文字资料', file: opened?.path.split('/').pop() ?? '资料',
              settings: '模型设置', changes: '本次文件变化',
            }[modal ?? 'create']}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭" disabled={busy} onPress={() => setModal(undefined)}>
                <Text style={styles.close}>×</Text></Pressable></View>
            {!!error && <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 18, paddingBottom: 4 }}>
              {modal === 'create' && <>
                <Text style={styles.hint}>为这份创作取一个名字。</Text>
                <Field label="项目名称" testID="project-name" value={name} onChangeText={setName} placeholder="例如：旅行笔记" />
                <Button disabled={busy || !name.trim() || !runtime} onPress={() => { void createProject(); }}>创建工作区</Button>
              </>}
              {modal === 'new-file' && <>
                <Field label="文件路径" value={path} onChangeText={setPath} placeholder="documents/notes.md" />
                <Field label="正文" multiline value={content} onChangeText={setContent} placeholder="写下第一行…" />
                <Button disabled={busy || !path.trim()} onPress={() => { void saveFile(); }}>保存文件</Button>
              </>}
              {modal === 'file' && opened && <>
                <Text style={styles.caption}>{opened.path} · {opened.revision.slice(0, 7)}</Text>
                {isImage(opened.path) ? <Image source={{ uri: content }} style={styles.imagePreview} contentFit="contain" /> :
                  <Field label="正文" testID="file-content" multiline value={content} onChangeText={setContent} />}
                <View style={styles.actions}>
                  {!isImage(opened.path) && opened.path !== 'project.json' &&
                    <Button disabled={busy} onPress={() => { void saveFile(); }}>保存修改</Button>}
                  <Button secondary disabled={busy} onPress={() => { void action(() => exportFile(runtime!.workspace, projectId!, opened.path)); }}>导出</Button>
                  {opened.path !== 'project.json' && <Button secondary danger disabled={busy} onPress={() => setConfirmation({
                    title: '删除这个文件？', detail: '文件会从当前项目移除，历史版本仍可恢复。',
                    perform: async () => {
                      await runtime!.workspace.remove(projectId!, opened.path, opened.revision);
                      setModal(undefined); await refresh(projectId); setNotice('文件已删除。');
                    },
                  })}>删除</Button>}
                </View>
                {opened.path !== 'project.json' && <>
                  <Field label="移动或重命名" value={path} onChangeText={setPath} />
                  <Button secondary disabled={busy || path === opened.path} onPress={() => { void action(async () => {
                    await runtime!.workspace.move(projectId!, opened.path, path, opened.revision);
                    setModal(undefined); await refresh(projectId);
                  }); }}>应用新路径</Button>
                </>}
              </>}
              {modal === 'settings' && <>
                <Text style={styles.hint}>选择演示，或连接支持工具调用的 Chat Completions 兼容服务。</Text>
                <View style={styles.actions}>
                  <Button secondary={settingsDraft.mode !== 'demo'} onPress={() => setSettingsDraft({ ...settingsDraft, mode: 'demo' })}>演示模式</Button>
                  <Button secondary={settingsDraft.mode !== 'remote'} onPress={() => setSettingsDraft({ ...settingsDraft, mode: 'remote' })}>真实模型</Button>
                </View>
                {settingsDraft.mode === 'remote' && <>
                  <Field label="服务基础地址" value={settingsDraft.baseUrl} onChangeText={(baseUrl) => {
                    setKey(''); setSettingsDraft({ ...settingsDraft, baseUrl });
                  }}
                    placeholder="https://your-provider.example/v1" />
                  <Field label="模型名称" value={settingsDraft.model} onChangeText={(model) => setSettingsDraft({ ...settingsDraft, model })} placeholder="填写供应商提供的模型 ID" />
                  <Field label="API Key" secret value={key} onChangeText={setKey} />
                  <View style={styles.rowBetween}><Text style={styles.label}>允许模型读取项目图片</Text>
                    <Switch value={settingsDraft.imageInput} onValueChange={(imageInput) => setSettingsDraft({ ...settingsDraft, imageInput })} trackColor={{ true: c.accent }} /></View>
                  <Text style={styles.hint}>{Platform.OS === 'web' ?
                    '浏览器预览只在本次页面会话中保留密钥；刷新后需重新输入。服务需允许跨域请求。' :
                    '密钥保存在设备安全存储中。相关文本、图片将发送到你配置的服务。'}</Text>
                </>}
                <Button disabled={busy || !!active} onPress={() => { void action(async () => {
                  if (settingsDraft.mode === 'remote') {
                    const url = new URL(settingsDraft.baseUrl);
                    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('请使用 HTTPS 地址');
                    if (!key || !settingsDraft.model.trim()) throw new Error('请填写模型名称和密钥');
                  }
                  await runtime!.credentials.set(key);
                  await runtime!.metadata.put('settings', 'model', settingsDraft);
                  setSettings(settingsDraft); setKey('');
                  setModal(undefined); setNotice('模型设置已保存。');
                }); }}>保存设置</Button>
              </>}
              {modal === 'changes' && <>
                {changes.length === 0 && <Text style={styles.hint}>本次任务没有改变项目文件。</Text>}
                {changes.map((change) => <View key={change.path} style={styles.changeCard}>
                  <Text style={styles.fileName}>{change.kind} · {change.path}</Text>
                  {isImage(change.path) ? <View style={styles.actions}>
                    {!!change.before && <Image source={{ uri: change.before }} style={styles.diffImage} contentFit="contain" />}
                    {!!change.after && <Image source={{ uri: change.after }} style={styles.diffImage} contentFit="contain" />}
                  </View> : <>
                    {!!change.before && <View style={styles.before}><Text style={styles.diffLabel}>修改前</Text><Text selectable style={styles.code}>{change.before.slice(0, 12000)}</Text></View>}
                    {!!change.after && <View style={styles.after}><Text style={styles.diffLabel}>修改后</Text><Text selectable style={styles.code}>{change.after.slice(0, 12000)}</Text></View>}
                  </>}
                </View>)}
              </>}
            </ScrollView>
            {busy && <ActivityIndicator color={c.accent} />}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!confirmation} transparent animationType="none" onRequestClose={() => { if (!busy) setConfirmation(undefined); }}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{confirmation?.title}</Text><Text style={styles.hint}>{confirmation?.detail}</Text>
          <View style={styles.actions}>
            <Button secondary disabled={busy} onPress={() => setConfirmation(undefined)}>取消</Button>
            <Button disabled={busy} onPress={() => { void action(async () => {
              await confirmation?.perform(); setConfirmation(undefined);
            }); }}>确认</Button>
          </View>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  topbar: { height: 86, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface },
  brandGroup: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  logo: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontSize: 29, fontWeight: '700', marginTop: -5 },
  brand: { fontSize: 17, fontWeight: '700', color: c.text },
  caption: { fontSize: 12, color: c.muted, lineHeight: 20 },
  settingsButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: c.bg },
  settingsIcon: { fontSize: 23, color: c.text },
  body: { flex: 1 }, sidebar: { backgroundColor: c.surface },
  sidebarContent: { padding: 20, gap: 14, flexGrow: 1 },
  sidebarHeading: { fontSize: 13, fontWeight: '600', color: c.muted },
  count: { fontSize: 12, color: c.muted, fontWeight: '400' },
  sidebarHint: { color: c.muted, fontSize: 14, lineHeight: 26, paddingVertical: 24 },
  sidebarFooter: { marginTop: 'auto', paddingTop: 40, flexDirection: 'row', gap: 8, alignItems: 'center' },
  projectCard: { padding: 12, borderRadius: 14, flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  selectedProject: { backgroundColor: c.soft, borderColor: '#D5E3D5' },
  projectSymbol: { fontSize: 22, color: c.accent },
  projectName: { fontSize: 14, color: c.text, fontWeight: '600', lineHeight: 23 },
  main: { flex: 1 }, projectHeader: { paddingHorizontal: 24, paddingTop: 30, paddingBottom: 24, flexDirection: 'row', gap: 16, alignItems: 'center' },
  projectTitle: { fontSize: 27, color: c.text, fontWeight: '700', marginBottom: 10 },
  muted: { fontSize: 13, color: c.muted, lineHeight: 22 }, back: { fontSize: 13, color: c.accent, marginBottom: 18 },
  modeBadge: { paddingVertical: 8, paddingHorizontal: 10, backgroundColor: c.soft, borderRadius: 20, flexDirection: 'row', gap: 6, alignItems: 'center' },
  modeText: { color: c.accent, fontSize: 11 }, statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent },
  tabs: { flexDirection: 'row', paddingHorizontal: 24, gap: 24, borderBottomWidth: 1, borderBottomColor: c.border },
  tab: { paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: 'transparent', paddingHorizontal: 6 },
  tabSelected: { borderBottomColor: c.accent }, tabText: { color: c.muted, fontSize: 14 }, tabTextSelected: { color: c.accent, fontWeight: '700' },
  mainScroll: { flex: 1 }, mainContent: { padding: 24, gap: 18, maxWidth: 1000, width: '100%', alignSelf: 'center', paddingBottom: 60 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  sectionHeading: { color: c.text, fontSize: 17, fontWeight: '600', lineHeight: 26 },
  hint: { color: c.muted, fontSize: 13, lineHeight: 23 },
  button: { minHeight: 40, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 10, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  secondary: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  danger: { borderColor: '#E9CFCB', backgroundColor: '#FFF5F3' },
  fileList: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 18, overflow: 'hidden' },
  fileRow: { flexDirection: 'row', padding: 16, alignItems: 'center', gap: 13, borderBottomWidth: 1, borderBottomColor: c.border },
  fileIcon: { width: 40, height: 44, borderRadius: 10, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' },
  fileIconText: { color: c.accent, fontSize: 18, fontWeight: '600' },
  fileName: { color: c.text, fontSize: 14, fontWeight: '600', lineHeight: 24 },
  chevron: { fontSize: 25, color: c.muted },
  tipCard: { padding: 23, backgroundColor: c.soft, borderRadius: 16, gap: 10 },
  tipTitle: { color: c.accent, fontSize: 15, fontWeight: '600' },
  tipText: { fontSize: 13, color: '#627568', lineHeight: 23 },
  textLink: { fontSize: 13, color: c.accent, fontWeight: '600', marginTop: 5 },
  agentIntro: { paddingVertical: 10, gap: 10 },
  agentMark: { width: 44, height: 44, backgroundColor: c.soft, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  agentMarkText: { color: c.accent, fontSize: 27 },
  composer: { padding: 16, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: '#CDDACC', gap: 12 },
  prompt: { minHeight: 92, fontSize: 15, lineHeight: 25, textAlignVertical: 'top', color: c.text },
  composerHint: { flex: 1, color: c.muted, fontSize: 11, lineHeight: 19 },
  taskCard: { padding: 18, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, gap: 12 },
  taskHeading: { fontSize: 14, color: c.accent, fontWeight: '600' },
  taskPrompt: { fontSize: 14, lineHeight: 23, color: c.text },
  eventText: { fontSize: 12, color: c.muted, lineHeight: 19 },
  response: { fontSize: 14, color: c.text, lineHeight: 25, paddingVertical: 4 },
  versionRow: { flexDirection: 'row', paddingVertical: 18, gap: 13, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.border },
  versionDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#CED9CE' },
  versionTitle: { fontSize: 14, color: c.text, lineHeight: 24 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  error: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#FFF0ED', gap: 12 },
  errorText: { fontSize: 13, color: c.danger, lineHeight: 23, flexShrink: 1 },
  notice: { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: c.soft },
  noticeText: { color: c.accent, fontSize: 13, lineHeight: 22 },
  modalBackdrop: { flex: 1, backgroundColor: '#192D2766', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { backgroundColor: c.surface, padding: 24, borderRadius: 22, width: '100%', maxWidth: 580, maxHeight: '90%', gap: 20 },
  modalTitle: { fontSize: 19, fontWeight: '600', color: c.text, flexShrink: 1 },
  close: { color: c.muted, fontSize: 27, paddingHorizontal: 6 },
  field: { gap: 9 }, label: { fontSize: 13, color: c.text, fontWeight: '500' },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, fontSize: 14, color: c.text, backgroundColor: '#FAFBF9', minHeight: 46 },
  textarea: { minHeight: 220, textAlignVertical: 'top', lineHeight: 24, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  imagePreview: { width: '100%', height: 280, backgroundColor: c.bg, borderRadius: 12 },
  changeCard: { gap: 12 }, before: { backgroundColor: '#FFF0EC', padding: 14, borderRadius: 10 },
  after: { backgroundColor: '#EAF3E8', padding: 14, borderRadius: 10 }, diffLabel: { fontSize: 11, color: c.muted, marginBottom: 8 },
  code: { fontSize: 12, lineHeight: 21, color: c.text }, diffImage: { width: 200, height: 180 },
  welcome: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', padding: 70, gap: 24 },
  eyebrow: { color: c.accent, fontSize: 13 }, welcomeTitle: { fontSize: 48, lineHeight: 65, color: c.text, fontWeight: '700' },
  welcomeDescription: { fontSize: 16, lineHeight: 29, color: c.muted },
  welcomeNotes: { flexDirection: 'row', gap: 30, marginTop: 30 },
});
