import { useState } from 'react';
import { Platform, Pressable, Switch, TextInput, View } from 'react-native';
import { Check, FileText, Folder, Image as ImageIcon, Laptop, Moon, Plus, Search, ShieldCheck, Sun, Upload } from './icons';
import type { Workbench } from './use-workbench';
import type { AppearanceMode } from './ui-store';
import { Button, Field, Sheet, T } from './ui';
import { useWorkbenchTheme } from './theme';
import { dateLabel, fileName } from './format';
import { isImage } from '@/core/workspace/path';

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
    <Sheet visible={controller.sheet === 'create'} title="新建项目" subtitle="文字、图片和会话都在同一个工作区里。"
      onClose={() => controller.setSheet(undefined)} busy={controller.busy}
      footer={<Button label="创建工作区" icon={Plus} busy={controller.busy} disabled={!controller.projectName.trim() || !controller.runtime}
        onPress={() => { void controller.createProject(); }} />}>
      <Field label="项目名称" value={controller.projectName} onChangeText={controller.setProjectName} placeholder="例如：旅行资料、产品想法…" maxLength={60} autoFocus />
      {!!controller.error && <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T>}
    </Sheet>
    <Sheet visible={controller.sheet === 'projects'} title="切换项目" onClose={() => controller.setSheet(undefined)}
      footer={<Button label="新建项目" icon={Plus} variant="secondary" onPress={controller.newProject} />}>
      <View style={{ flexDirection: 'row', backgroundColor: theme.inset, paddingHorizontal: 12, borderRadius: 8, gap: 8, alignItems: 'center' }}>
        <Search size={16} color={theme.muted} /><TextInput accessibilityLabel="搜索项目" placeholder="搜索项目…" placeholderTextColor={theme.muted}
          value={projectSearch} onChangeText={setProjectSearch} style={{ height: 42, color: theme.text, fontSize: 13, flex: 1 }} />
      </View>
      {controller.projects.filter((project) => project.name.includes(projectSearch)).map((project) => <Pressable key={project.id}
        accessibilityRole="button" accessibilityLabel={'切换到 ' + project.name} onPress={() => controller.selectProject(project.id)}
        style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: 9,
          backgroundColor: controller.projectId === project.id ? theme.accentSoft : theme.surface }}>
        <Folder size={20} color={theme.accent} /><View style={{ flex: 1 }}><T style={{ fontSize: 13, fontWeight: '500' }}>{project.name}</T>
          <T tone="muted" style={{ fontSize: 11 }}>{dateLabel(project.updatedAt)}</T></View>
        {controller.projectId === project.id && <Check size={16} color={theme.accent} />}
      </Pressable>)}
    </Sheet>
    <Sheet visible={controller.sheet === 'settings'} title="设置" onClose={() => { controller.setSheet(undefined); controller.setSecret(''); }}
      busy={controller.busy} footer={<Button label="保存设置" busy={controller.busy} disabled={!!controller.active}
        onPress={() => { void controller.saveSettings(); }} />}>
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
      <View style={{ gap: 11 }}>
        <T style={{ fontSize: 12, fontWeight: '600' }}>模型连接</T>
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {(['demo', 'remote'] as const).map((mode) => <Pressable key={mode} accessibilityRole="button"
            accessibilityLabel={mode === 'demo' ? '演示模式' : '真实模型'} disabled={!!controller.active}
            onPress={() => controller.setSettingsDraft({ ...controller.settingsDraft, mode })}
            style={{ flex: 1, borderWidth: 1, borderColor: controller.settingsDraft.mode === mode ? theme.accent : theme.border,
              borderRadius: 9, padding: 13, backgroundColor: controller.settingsDraft.mode === mode ? theme.accentSoft : theme.surface }}>
            <T style={{ fontSize: 13, fontWeight: '500' }}>{mode === 'demo' ? '演示模式' : '真实模型'}</T>
            <T tone="muted" style={{ fontSize: 11, marginTop: 4 }}>{mode === 'demo' ? '固定流程，无需密钥' : '连接你的模型服务'}</T>
          </Pressable>)}
        </View>
      </View>
      {controller.settingsDraft.mode === 'remote' ? <>
        <Field label="服务基础地址" value={controller.settingsDraft.baseUrl} placeholder="https://your-provider.example/v1"
          editable={!controller.active} onChangeText={(baseUrl) => { controller.setSecret(''); controller.setSettingsDraft({ ...controller.settingsDraft, baseUrl }); }} />
        <Field label="模型名称" value={controller.settingsDraft.model} placeholder="供应商提供的模型 ID" editable={!controller.active}
          onChangeText={(model) => controller.setSettingsDraft({ ...controller.settingsDraft, model })} />
        <Field label="API Key" value={controller.secret} secureTextEntry placeholder="输入服务密钥" editable={!controller.active} onChangeText={controller.setSecret} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}><T style={{ fontSize: 13 }}>图片理解</T><T tone="muted" style={{ fontSize: 11 }}>所选模型需要支持图片输入</T></View>
          <Switch accessibilityLabel="图片理解" disabled={!!controller.active} value={controller.settingsDraft.imageInput}
            trackColor={{ true: theme.accent, false: theme.border }}
            onValueChange={(imageInput) => controller.setSettingsDraft({ ...controller.settingsDraft, imageInput })} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, padding: 11, borderRadius: 8, backgroundColor: theme.inset }}>
          <ShieldCheck size={16} color={theme.secondary} />
          <T tone="secondary" style={{ flex: 1, fontSize: 11, lineHeight: 18 }}>{Platform.OS === 'web' ?
            '浏览器只在本次会话中保留密钥。刷新后需要重新输入，服务需允许跨域。' :
            '密钥保存在设备安全存储中。任务相关资料会发送到你配置的服务。'}</T>
        </View>
      </> : <T tone="secondary" style={{ fontSize: 12, lineHeight: 21 }}>演示会读取项目资料并保存一份整理文档，使用预设步骤，不进行语义理解。</T>}
      {!!controller.active && <T tone="secondary" style={{ fontSize: 12 }}>任务进行中，暂时不能更改模型连接。</T>}
      {!!controller.error && <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T>}
    </Sheet>
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
