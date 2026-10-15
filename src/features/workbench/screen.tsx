import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Check,
  FolderOpen,
  GitCommitHorizontal,
  MessageSquare,
  PanelLeft,
  Plus,
  Settings2,
  X,
} from '@/shared/ui/icons';
import { useWorkbench } from './use-workbench';
import type { DialogsCapability } from './use-workbench';
import { useWorkbenchTheme, workbenchMetrics as metrics } from '@/shared/theme';
import { RunActivity } from './run-activity';
import { Brand, Button, IconButton, T } from '@/shared/ui/primitives';
import { Conversation } from './conversation';
import { FilesPane } from './files';
import { HistoryPane } from './history';
import { Editor } from './editor';
import { ReviewSheet } from './review';
import { WorkbenchSheets } from './sheets';
import { ProjectTree } from './project-tree';
import { ProjectDrawer } from './project-drawer';
import { WorkbenchSettings } from './settings';

const tabs = [
  { id: 'agent', name: '对话', icon: MessageSquare },
  { id: 'files', name: '文件', icon: FolderOpen },
  { id: 'history', name: 'Git', icon: GitCommitHorizontal },
  { id: 'settings', name: '设置', icon: Settings2 },
] as const;

function DevelopmentRebuild({ controller }: { controller: DialogsCapability }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
      <T style={{ fontSize: 18, fontWeight: '600' }}>开发数据需要重建</T>
      <T tone="secondary" style={{ maxWidth: 440 }}>
        重建将清除当前设备上此应用的项目、对话、资料和文件历史；设备凭证保留。
      </T>
      {confirm ? (
        <View style={{ gap: 10 }}>
          <T tone="danger">确认清除当前开发数据？</T>
          <Button
            label="确认重建开发数据"
            busy={controller.busy}
            onPress={() => {
              void controller.action(() => controller.rebuildData());
            }}
          />
          <Button label="取消" variant="ghost" onPress={() => setConfirm(false)} />
        </View>
      ) : (
        <Button label="重建开发数据" onPress={() => setConfirm(true)} />
      )}
    </View>
  );
}

function Navigation({ controller, changes }: { controller: DialogsCapability; changes: number }) {
  const theme = useWorkbenchTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 6,
        minHeight: 52,
      }}
    >
      {tabs.map(({ id, name, icon: Icon }) => {
        const selected = controller.tab === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityLabel={name}
            accessibilityState={{ selected, disabled: id !== 'settings' && !controller.projectId }}
            aria-selected={selected}
            disabled={id !== 'settings' && !controller.projectId}
            onPress={() => controller.selectTab(id)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              borderTopWidth: 2,
              borderTopColor: selected ? theme.accent : 'transparent',
              backgroundColor: pressed ? theme.accentSoft : 'transparent',
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon size={19} color={selected ? theme.accent : theme.secondary} />
              {id === 'history' && changes > 0 && (
                <T
                  style={{
                    fontSize: 10,
                    lineHeight: 14,
                    paddingHorizontal: 3,
                    borderRadius: 3,
                    color: theme.accentText,
                    backgroundColor: theme.accent,
                  }}
                >
                  {changes}
                </T>
              )}
            </View>
            <T
              style={{
                fontSize: 11,
                lineHeight: 17,
                color: selected ? theme.accent : theme.secondary,
                fontWeight: selected ? '600' : '400',
              }}
            >
              {name}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

function WorkbenchHeader({ controller, wide }: { controller: DialogsCapability; wide: boolean }) {
  const theme = useWorkbenchTheme();
  const [editing, setEditing] = useState<{ id: string; value: string }>();
  const saving = useRef(false);
  const current = controller.selectedConversation;
  const finish = async () => {
    if (!editing || !current || editing.id !== current.id || saving.current) return;
    saving.current = true;
    try {
      if (
        editing.value.trim() === current.title ||
        (await controller.saveConversationTitle(current, editing.value))
      )
        setEditing(undefined);
    } finally {
      saving.current = false;
    }
  };
  const title =
    controller.tab === 'agent'
      ? (current?.title ?? controller.selectedProject?.name ?? 'Agent Mobile')
      : (tabs.find(tab => tab.id === controller.tab)?.name ?? 'Agent Mobile');
  return (
    <View
      testID="workbench-header"
      style={{
        height: metrics.header,
        paddingHorizontal: 4,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
      }}
    >
      {!wide && (
        <IconButton
          icon={PanelLeft}
          label="项目与对话"
          size={44}
          onPress={() => controller.setDrawerOpen(true)}
        />
      )}
      <View testID="conversation-bar" style={{ flex: 1, minWidth: 0, paddingHorizontal: 7 }}>
        {editing && current?.id === editing.id ? (
          <TextInput
            autoFocus
            selectTextOnFocus
            accessibilityLabel="对话名称"
            value={editing.value}
            maxLength={60}
            onChangeText={value => setEditing({ ...editing, value })}
            onSubmitEditing={() => {
              void finish();
            }}
            onBlur={() => {
              void finish();
            }}
            onKeyPress={event => {
              if (event.nativeEvent.key === 'Escape') setEditing(undefined);
            }}
            style={{ height: 44, fontSize: 16, color: theme.text, padding: 0 }}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={controller.tab === 'agent' && current ? '重命名当前对话' : title}
            disabled={controller.busy || controller.tab !== 'agent' || !current}
            onPress={() => current && setEditing({ id: current.id, value: current.title })}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <T numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>
              {title}
            </T>
          </Pressable>
        )}
      </View>
      {controller.tab === 'agent' && controller.projectId && (
        <IconButton
          icon={Plus}
          label="新建对话"
          size={44}
          disabled={controller.busy}
          onPress={() => {
            void controller.newConversation();
          }}
        />
      )}
    </View>
  );
}

export function WorkbenchScreen() {
  const capabilities = useWorkbench();
  const controller = capabilities.dialogs;
  const theme = useWorkbenchTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 1100;
  const { drawerOpen, setDrawerOpen, tab, selectTab } = controller;
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      if (tab === 'agent') return false;
      selectTab('agent');
      return true;
    });
    return () => back.remove();
  }, [drawerOpen, setDrawerOpen, tab, selectTab]);

  if (controller.loading)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.surface,
          gap: 12,
        }}
      >
        <Brand />
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  return (
    <ProjectDrawer controller={controller} width={width} wide={wide}>
      <SafeAreaView
        testID={theme.dark ? 'workbench-dark' : 'workbench-light'}
        style={{ flex: 1, backgroundColor: theme.surface }}
        edges={['top', 'bottom']}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, minHeight: 0 }}
        >
          <View
            aria-hidden={!wide && drawerOpen}
            accessibilityElementsHidden={!wide && drawerOpen}
            importantForAccessibility={!wide && drawerOpen ? 'no-hide-descendants' : 'auto'}
            style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}
          >
            {wide && (
              <View style={{ width: 240, borderRightWidth: 1, borderColor: theme.border }}>
                <ProjectTree controller={controller} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <WorkbenchHeader controller={controller} wide={wide} />
              {!!controller.error && !controller.editorOpen && (
                <View
                  accessibilityRole="alert"
                  style={{
                    flexDirection: 'row',
                    paddingHorizontal: 12,
                    alignItems: 'center',
                    backgroundColor: theme.dangerSoft,
                  }}
                >
                  <T tone="danger" style={{ flex: 1, fontSize: 12, lineHeight: 19 }}>
                    {controller.error}
                  </T>
                  <IconButton
                    icon={X}
                    label="关闭提示"
                    size={44}
                    onPress={() => controller.setError('')}
                  />
                </View>
              )}
              {!!controller.notice && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    backgroundColor: theme.successSoft,
                  }}
                >
                  <Check size={12} color={theme.success} />
                  <T style={{ fontSize: 12, color: theme.success }}>{controller.notice}</T>
                </View>
              )}
              {controller.formatMismatch ? (
                <DevelopmentRebuild controller={controller} />
              ) : controller.tab === 'settings' ? (
                <WorkbenchSettings controller={controller} />
              ) : !controller.projectId ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                  <T style={{ fontSize: 18, fontWeight: '600' }}>创建第一个项目</T>
                  <Button label="新建项目" icon={Plus} onPress={controller.newProject} />
                </View>
              ) : (
                <>
                  {controller.runs.some(
                    run => run.conversationId !== controller.conversationId,
                  ) && <RunActivity controller={capabilities.runs} />}
                  <View style={{ flex: 1, minHeight: 0 }}>
                    {controller.tab === 'agent' ? (
                      <Conversation
                        key={controller.conversationId}
                        controller={capabilities.conversation}
                      />
                    ) : controller.tab === 'files' ? (
                      <FilesPane key={controller.projectId} controller={capabilities.files} />
                    ) : (
                      <HistoryPane controller={capabilities.git} />
                    )}
                  </View>
                </>
              )}
              {!keyboard && !controller.formatMismatch && (
                <Navigation
                  controller={controller}
                  changes={capabilities.git.gitStatus?.files.length ?? 0}
                />
              )}
            </View>
            {wide && controller.editorOpen && (
              <Editor controller={capabilities.editor} mobile={false} />
            )}
          </View>
        </KeyboardAvoidingView>
        {!wide && controller.editorOpen && <Editor controller={capabilities.editor} mobile />}
        {controller.reviewOpen && <ReviewSheet controller={capabilities.git} />}
        <WorkbenchSheets
          controller={controller}
          editor={capabilities.editor}
          files={capabilities.files}
          conversation={capabilities.conversation}
        />
      </SafeAreaView>
    </ProjectDrawer>
  );
}
