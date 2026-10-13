import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronDown, Folder, FolderOpen, HardDrive, History, MessageSquare, Plus, Settings2, X } from './icons';
import { useWorkbench } from './use-workbench';
import type { Workbench } from './use-workbench';
import { useWorkbenchTheme } from './theme';
import { Brand, Button, IconButton, T } from './ui';
import { Conversation } from './conversation';
import { FilesPane } from './files';
import { HistoryPane } from './history';
import { Editor } from './editor';
import { ReviewSheet } from './review';
import { WorkbenchSheets } from './sheets';
import type { WorkbenchTab } from './ui-store';
import { dateLabel } from './format';

const tabs = [
  { id: 'agent', name: '会话', icon: MessageSquare }, { id: 'files', name: '资料', icon: FolderOpen }, { id: 'history', name: '版本', icon: History },
] as const;

function Navigation({ controller, mobile }: { controller: Workbench; mobile: boolean }) {
  const theme = useWorkbenchTheme();
  return <View style={{ flexDirection: 'row', backgroundColor: theme.surface, borderTopWidth: mobile ? 1 : 0,
    borderBottomWidth: mobile ? 0 : 1, borderColor: theme.border, paddingHorizontal: mobile ? 12 : 22, gap: mobile ? 0 : 16 }}>
    {tabs.map(({ id, name, icon: Icon }) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={name}
      accessibilityState={{ selected: controller.tab === id }}
      onPress={() => controller.selectTab(id as WorkbenchTab)}
      style={{ flex: mobile ? 1 : undefined, minHeight: mobile ? 58 : 43, alignItems: 'center', justifyContent: 'center',
        flexDirection: mobile ? 'column' : 'row', paddingHorizontal: mobile ? 8 : 6, gap: mobile ? 3 : 7,
        borderBottomWidth: mobile ? 0 : 2, borderBottomColor: controller.tab === id ? theme.accent : 'transparent' }}>
      <Icon size={mobile ? 19 : 15} color={controller.tab === id ? theme.accent : theme.secondary} strokeWidth={controller.tab === id ? 2 : 1.7} />
      <T tone={controller.tab === id ? 'accent' : 'secondary'} style={{ fontSize: mobile ? 10 : 12, lineHeight: 15,
        fontWeight: controller.tab === id ? '600' : '400' }}>{name}</T>
    </Pressable>)}
  </View>;
}

function Sidebar({ controller }: { controller: Workbench }) {
  const theme = useWorkbenchTheme();
  return <View style={{ width: 226, backgroundColor: theme.sidebar, borderRightWidth: 1, borderColor: theme.border }}>
    <View style={{ height: 70, paddingHorizontal: 18, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
      <Brand small /><T style={{ fontSize: 14, fontWeight: '600' }}>Agent Mobile</T>
    </View>
    <View style={{ paddingHorizontal: 14, paddingTop: 3, paddingBottom: 16 }}>
      <Button label="新建项目" icon={Plus} variant="secondary" compact onPress={controller.newProject} />
    </View>
    <View style={{ paddingHorizontal: 20, marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <T tone="muted" style={{ fontSize: 10, fontWeight: '500' }}>项目</T><T tone="muted" style={{ fontSize: 10 }}>{controller.projects.length}</T>
    </View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 10, gap: 4 }}>
      {controller.projects.map((project) => <Pressable key={project.id} accessibilityRole="button" accessibilityLabel={'切换到 ' + project.name}
        onPress={() => controller.selectProject(project.id)} style={({ pressed }) => ({
          paddingHorizontal: 10, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 8,
          backgroundColor: project.id === controller.projectId ? theme.accentSoft : pressed ? theme.inset : 'transparent',
        })}>
        <Folder size={16} color={project.id === controller.projectId ? theme.accent : theme.secondary} strokeWidth={1.6} />
        <View style={{ flex: 1 }}><T numberOfLines={1} tone={project.id === controller.projectId ? 'accent' : 'text'}
          style={{ fontSize: 12, fontWeight: project.id === controller.projectId ? '500' : '400' }}>{project.name}</T>
          <T tone="muted" style={{ fontSize: 10, marginTop: 2 }}>{dateLabel(project.updatedAt)}</T></View>
        {project.id === controller.active?.projectId && <ActivityIndicator size={12} color={theme.accent} />}
      </Pressable>)}
    </ScrollView>
    <View style={{ padding: 14, gap: 12, borderTopWidth: 1, borderColor: theme.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 6 }}>
        <HardDrive size={14} color={theme.muted} /><T tone="muted" style={{ fontSize: 11 }}>本地工作区</T>
      </View>
      <Button label="设置与模型" icon={Settings2} variant="ghost" compact style={{ justifyContent: 'flex-start' }}
        onPress={() => { void controller.openSettings(); }} />
    </View>
  </View>;
}

export function WorkbenchScreen() {
  const controller = useWorkbench();
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 1100;
  const currentTab = controller.tab;
  const selectTab = controller.selectTab;
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (currentTab === 'agent') return false;
      selectTab('agent'); return true;
    });
    return () => back.remove();
  }, [currentTab, selectTab]);

  if (controller.loading) return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 15 }}><Brand />
      <ActivityIndicator color={theme.accent} /><T tone="secondary" style={{ fontSize: 12 }}>正在打开工作区…</T></View>
  </SafeAreaView>;

  return <SafeAreaView testID={theme.dark ? 'workbench-dark' : 'workbench-light'} style={{ flex: 1, backgroundColor: theme.surface }} edges={['top', 'bottom']}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        {wide && <Sidebar controller={controller} />}
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <View style={{ height: wide ? 70 : 59, backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.border,
            paddingHorizontal: wide ? 24 : 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {!wide && <Brand small />}
            <Pressable accessibilityRole="button" accessibilityLabel="切换项目" onPress={() => controller.setSheet('projects')}
              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 42 }}>
              <View style={{ minWidth: 0, flexShrink: 1 }}>
                <T numberOfLines={1} style={{ fontSize: wide ? 15 : 14, fontWeight: '600' }}>{controller.selectedProject?.name ?? 'Agent Mobile'}</T>
                <T tone="muted" style={{ fontSize: 10, lineHeight: 15 }}>{controller.selectedProject ? '本地项目' : '你的随身工作区'}</T>
              </View>
              <ChevronDown size={14} color={theme.muted} />
            </Pressable>
            {controller.projectActive && <ActivityIndicator size="small" color={theme.accent} />}
            <IconButton icon={Settings2} label="设置" onPress={() => { void controller.openSettings(); }} />
          </View>
          {!!controller.error && !controller.editor && <View accessibilityRole="alert" style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8,
            alignItems: 'center', gap: 8, backgroundColor: theme.dangerSoft }}>
            <T tone="danger" style={{ flex: 1, fontSize: 12, lineHeight: 19 }}>{controller.error}</T>
            <IconButton icon={X} label="关闭提示" size={30} onPress={() => controller.setError('')} />
          </View>}
          {!!controller.notice && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: theme.successSoft }}>
            <Check size={13} color={theme.success} /><T style={{ fontSize: 12, color: theme.success }}>{controller.notice}</T>
          </View>}
          {!controller.projectId ? <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 16 }}>
            <View style={{ padding: 20, borderRadius: 16, backgroundColor: theme.inset }}><FolderOpen size={32} color={theme.secondary} strokeWidth={1.5} /></View>
            <T style={{ fontSize: 22, fontWeight: '600', marginTop: 4 }}>创建你的第一个项目</T>
            <T tone="secondary" style={{ fontSize: 13, textAlign: 'center', lineHeight: 23 }}>把文字和图片放在一起，{'\n'}让 Agent 帮你整理与修改。</T>
            <Button label="新建项目" icon={Plus} onPress={controller.newProject} />
            <T tone="muted" style={{ fontSize: 11 }}>资料本地保存 · 每次修改都有版本</T>
          </View> : <>
            {wide && <Navigation controller={controller} mobile={false} />}
            <View style={{ flex: 1, minHeight: 0 }}>
              {controller.tab === 'agent' ? <Conversation controller={controller} /> :
                controller.tab === 'files' ? <FilesPane key={controller.projectId} controller={controller} /> : <HistoryPane controller={controller} />}
            </View>
            {!wide && !keyboard && <Navigation controller={controller} mobile />}
          </>}
        </View>
        {wide && controller.editor && <Editor controller={controller} mobile={false} />}
      </View>
    </KeyboardAvoidingView>
    {!wide && controller.editor && <Editor controller={controller} mobile />}
    {controller.review && <ReviewSheet controller={controller} />}
    <WorkbenchSheets controller={controller} />
  </SafeAreaView>;
}
