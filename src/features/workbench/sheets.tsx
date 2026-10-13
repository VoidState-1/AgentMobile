import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Check, FileText, Folder, Image as ImageIcon, Laptop, Moon, Plus, Search, Sun, Upload } from './icons';
import type { Workbench } from './use-workbench';
import type { AppearanceMode } from './ui-store';
import { Button, Field, Sheet, T } from './ui';
import { useWorkbenchTheme } from './theme';
import { dateLabel, fileName } from './format';
import { isImage } from '@/core/workspace/path';
import { ModelPicker } from '@/features/model-config/picker';
import { ConversationsPanel } from '@/features/conversations/panel';

function RenameSheet({ controller }: { controller: Workbench }) {
  const [name, setName] = useState(controller.editor?.name ?? '');
  return <Sheet visible title="重命名文件" onClose={() => controller.setSheet(undefined)} busy={controller.busy}
    footer={<Button label="保存名称" busy={controller.busy} disabled={!name.trim() || name === controller.editor?.name}
      onPress={() => { void controller.renameEditor(name); }} />}>
    <Field label="文件名称" value={name} onChangeText={setName} />
    {!!controller.error && <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T>}
  </Sheet>;
}

export function WorkbenchSheets({ controller }: { controller: Workbench }) {
  const theme = useWorkbenchTheme();
  const [projectSearch, setProjectSearch] = useState('');
  return <>
    {(controller.sheet === 'conversations' || controller.sheet === 'conversation-name') && <ConversationsPanel controller={controller} />}
    <Sheet visible={controller.sheet === 'create'} title="新建项目" subtitle="文字、图片和会话都在同一个工作区里。"
      onClose={() => controller.setSheet(undefined)} busy={controller.busy}
      footer={<Button label="创建工作区" icon={Plus} busy={controller.busy} disabled={!controller.projectName.trim() || !controller.runtime}
        onPress={() => { void controller.createProject(); }} />}>
      <Field label="项目名称" value={controller.projectName} onChangeText={controller.setProjectName} placeholder="例如：旅行资料、产品想法…" maxLength={60} autoFocus />
      {!!controller.error && <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T>}
    </Sheet>
    <Sheet visible={controller.sheet === 'projects'} title="切换项目" onClose={() => controller.setSheet(undefined)}
      footer={<Button label="新建项目" icon={Plus} variant="secondary" disabled={controller.busy} onPress={controller.newProject} />}>
      <View style={{ flexDirection: 'row', backgroundColor: theme.inset, paddingHorizontal: 12, borderRadius: 8, gap: 8, alignItems: 'center' }}>
        <Search size={16} color={theme.muted} /><TextInput accessibilityLabel="搜索项目" placeholder="搜索项目…" placeholderTextColor={theme.muted}
          value={projectSearch} onChangeText={setProjectSearch} style={{ height: 42, color: theme.text, fontSize: 13, flex: 1 }} />
      </View>
      {controller.projects.filter((project) => project.name.includes(projectSearch)).map((project) => <Pressable key={project.id}
        accessibilityRole="button" accessibilityLabel={'切换到 ' + project.name} disabled={controller.busy} onPress={() => controller.selectProject(project.id)}
        style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: 9,
          backgroundColor: controller.projectId === project.id ? theme.accentSoft : theme.surface }}>
        <Folder size={20} color={theme.accent} /><View style={{ flex: 1 }}><T style={{ fontSize: 13, fontWeight: '500' }}>{project.name}</T>
          <T tone="muted" style={{ fontSize: 11 }}>{dateLabel(project.updatedAt)}</T></View>
        {controller.projectId === project.id && <Check size={16} color={theme.accent} />}
      </Pressable>)}
    </Sheet>
    <Sheet visible={controller.sheet === 'settings'} title="设置" onClose={() => controller.setSheet(undefined)}>
      <View style={{ gap: 11 }}>
        <T style={{ fontSize: 12, fontWeight: '600' }}>外观</T>
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {([
            { mode: 'system', label: '跟随系统', icon: Laptop }, { mode: 'light', label: '浅色', icon: Sun }, { mode: 'dark', label: '深色', icon: Moon },
          ] as const).map(({ mode, label, icon: Icon }) => <Pressable key={mode} accessibilityRole="button" accessibilityLabel={label}
            accessibilityState={{ selected: controller.appearance === mode }} onPress={() => controller.setAppearance(mode as AppearanceMode)}
            style={{ flex: 1, borderWidth: 1, borderColor: controller.appearance === mode ? theme.accent : theme.border,
              backgroundColor: controller.appearance === mode ? theme.accentSoft : theme.inset, alignItems: 'center', borderRadius: 9, padding: 12, gap: 6 }}>
            <Icon size={19} color={controller.appearance === mode ? theme.accent : theme.secondary} strokeWidth={1.7} />
            <T tone={controller.appearance === mode ? 'accent' : 'secondary'} style={{ fontSize: 11 }}>{label}</T>
          </Pressable>)}
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: theme.border }} />
      <Button label="模型与供应商" variant="secondary" onPress={controller.openModelConfig} />
      <T tone="secondary" style={{ fontSize: 12 }}>管理服务连接、模型、默认选择与检测。</T>
    </Sheet>
    {controller.sheet === 'models' && controller.runtime && <ModelPicker service={controller.runtime.models}
      configuration={controller.configuration} projectId={controller.projectId} conversationId={controller.conversationId}
      onClose={() => controller.setSheet(undefined)} onManage={controller.openModelConfig} />}
    <Sheet visible={controller.sheet === 'attach'} title="参考资料" subtitle="选择当前项目文件，或导入新的资料。"
      onClose={() => controller.setSheet(undefined)}
      footer={<Button label="导入资料" icon={Upload} variant="secondary" busy={controller.busy} onPress={() => { void controller.importFile(true); }} />}>
      {controller.files.map((file) => <Pressable key={file.path} accessibilityRole="button" accessibilityLabel={'引用 ' + file.path}
        onPress={() => { controller.setAttachment(file.path); controller.setSheet(undefined); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: theme.inset, borderRadius: 8 }}>
        {isImage(file.path) ? <ImageIcon size={17} color={theme.secondary} /> : <FileText size={17} color={theme.secondary} />}
        <View style={{ flex: 1 }}><T style={{ fontSize: 13 }}>{fileName(file.path)}</T><T tone="muted" style={{ fontSize: 11 }}>{file.path}</T></View>
      </Pressable>)}
    </Sheet>
    {controller.sheet === 'rename' && <RenameSheet controller={controller} />}
    <Sheet visible={!!controller.confirmation} title={controller.confirmation?.title ?? ''} onClose={() => controller.setConfirmation(undefined)}
      busy={controller.busy} footer={<View style={{ gap: 8 }}>
        {controller.confirmation?.saveFirst && <Button label="保存后离开" busy={controller.busy} onPress={() => { void controller.saveAndLeave(); }} />}
        <Button label={controller.confirmation?.label ?? '确认'} variant={controller.confirmation?.danger ? 'danger' : 'primary'}
          busy={controller.busy} onPress={() => { void controller.confirm(); }} />
        <Button label={controller.confirmation?.saveFirst ? '继续编辑' : '取消'} variant="ghost" disabled={controller.busy}
          onPress={() => controller.setConfirmation(undefined)} />
      </View>}>
      <T tone="secondary" style={{ fontSize: 13, lineHeight: 23 }}>{controller.confirmation?.description}</T>
      {!!controller.error && <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T>}
    </Sheet>
  </>;
}
