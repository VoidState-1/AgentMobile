import { ModelPicker } from '@/features/model-config/picker';
import { SkillPicker } from '@/features/skills/picker';
import { fileName } from '@/shared/format';
import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { FileText, Image as ImageIcon, Plus, Upload } from '@/shared/ui/icons';
import { Button, Field, T } from '@/shared/ui/primitives';
import { ConfirmSheet, Sheet } from '@/shared/ui/sheets';
import { memo, useState } from 'react';
import type {
  ConversationCapability,
  EditorCapability,
  FilesCapability,
  SheetsCapability,
} from './use-workbench';

function RenameSheet({ controller }: { controller: EditorCapability }) {
  const [name, setName] = useState(controller.editor?.name ?? '');
  return (
    <Sheet
      visible
      title="重命名文件"
      onClose={() => controller.setSheet(undefined)}
      busy={controller.busy}
      footer={
        <Button
          label="保存名称"
          busy={controller.busy}
          disabled={!name.trim() || name === controller.editor?.name}
          onPress={() => {
            void controller.renameEditor(name);
          }}
        />
      }
    >
      <Field label="文件名称" value={name} onChangeText={setName} />
      {!!controller.error && <T tone="danger">{controller.error}</T>}
    </Sheet>
  );
}

function CreateProjectSheet({ controller }: { controller: SheetsCapability }) {
  const [clone, setClone] = useState(false);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const transfer = controller.cloneTransfer;
  return (
    <Sheet
      visible
      title={clone ? '克隆 Git 仓库' : '新建项目'}
      onClose={() => controller.setSheet(undefined)}
      busy={controller.busy}
      footer={
        <>
          <Button
            label={clone ? '克隆仓库' : '创建工作区'}
            icon={Plus}
            busy={controller.busy}
            disabled={
              !controller.projectName.trim() || !controller.modelsApi || (clone && !url.trim())
            }
            onPress={() => {
              if (clone)
                void controller.cloneProject(
                  { name: controller.projectName, url: url.trim() },
                  token ? { username, token } : undefined,
                );
              else void controller.createProject();
            }}
          />
          {clone && transfer?.state === 'running' && (
            <Button label="取消克隆" variant="ghost" onPress={controller.cancelClone} />
          )}
        </>
      }
    >
      <Button
        label={clone ? '改为新建普通项目' : '从 Git 仓库克隆'}
        variant="ghost"
        disabled={controller.busy}
        onPress={() => {
          setClone(!clone);
          setToken('');
        }}
      />
      <Field
        label="项目名称"
        value={controller.projectName}
        onChangeText={controller.setProjectName}
        placeholder="项目名称"
        maxLength={60}
        autoFocus
        editable={!controller.busy}
      />
      {clone && (
        <>
          <Field
            label="克隆 HTTPS 仓库地址"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!controller.busy}
            keyboardType="url"
          />
          <T variant="caption" tone="secondary">
            私有仓库可填写用户名和访问令牌；认证设置可在克隆后保存。
          </T>
          <Field
            label="克隆 Git 用户名（可选）"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!controller.busy}
          />
          <Field
            label="克隆访问令牌（可选）"
            value={token}
            onChangeText={setToken}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!controller.busy}
          />
          {transfer?.state === 'running' && (
            <T variant="caption" tone="secondary">
              正在克隆{transfer.total ? ` · ${transfer.completed}/${transfer.total}` : ''}
              {transfer.bytes ? ` · ${(transfer.bytes / 1024).toFixed(0)} KiB` : ''}
            </T>
          )}
        </>
      )}
      {!!controller.error && <T tone="danger">{controller.error}</T>}
    </Sheet>
  );
}

export const WorkbenchSheets = memo(function WorkbenchSheets({
  controller,
  editor,
  files,
  conversation,
}: {
  controller: SheetsCapability;
  editor: EditorCapability;
  files: FilesCapability;
  conversation: ConversationCapability;
}) {
  const theme = useWorkbenchTheme();
  return (
    <>
      {controller.sheet === 'skills' && (
        <SkillPicker
          projectId={controller.projectId}
          prompt={conversation.prompt}
          onChoose={conversation.setPrompt}
          onClose={() => controller.setSheet(undefined)}
          onManage={controller.openSkills}
        />
      )}
      {controller.sheet === 'create' && <CreateProjectSheet controller={controller} />}
      <Sheet
        visible={controller.sheet === 'conversation-name'}
        title="重命名对话"
        onClose={() => controller.setSheet(undefined)}
        busy={controller.busy}
        footer={
          <Button
            label="保存对话名称"
            disabled={!controller.conversationName.trim()}
            busy={controller.busy}
            onPress={() => {
              void controller.renameConversation();
            }}
          />
        }
      >
        <Field
          label="对话名称"
          value={controller.conversationName}
          onChangeText={controller.setConversationName}
          maxLength={60}
          autoFocus
        />
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </Sheet>
      {controller.sheet === 'models' && controller.modelsApi && (
        <ModelPicker
          service={controller.modelsApi}
          configuration={controller.configuration}
          projectId={controller.projectId}
          conversationId={controller.conversationId}
          onClose={() => controller.setSheet(undefined)}
          onManage={controller.openModelConfig}
        />
      )}
      <Sheet
        visible={controller.sheet === 'attach'}
        title="参考资料"
        onClose={() => controller.setSheet(undefined)}
        footer={
          <Button
            label="导入资料"
            icon={Upload}
            variant="secondary"
            busy={controller.busy}
            onPress={() => {
              void files.importFile(true);
            }}
          />
        }
      >
        {files.files.map(file => (
          <ActionRow
            key={file.path}
            label={'引用 ' + file.path}
            title={fileName(file.path)}
            onPress={() => {
              conversation.setAttachment(file.path);
              controller.setSheet(undefined);
            }}
            selected={conversation.attachment === file.path}
            leading={
              file.kind === 'image' ? (
                <ImageIcon size={17} color={theme.accent} />
              ) : (
                <FileText size={17} color={theme.secondary} />
              )
            }
          />
        ))}
      </Sheet>
      {controller.sheet === 'rename' && <RenameSheet controller={editor} />}
      <ConfirmSheet
        visible={!!controller.confirmation}
        title={controller.confirmation?.title ?? ''}
        description={controller.confirmation?.description}
        onClose={() => controller.setConfirmation(undefined)}
        busy={controller.busy}
        error={controller.error}
        confirmLabel={controller.confirmation?.label ?? '确认'}
        danger={controller.confirmation?.danger}
        cancelLabel={controller.confirmation?.saveFirst ? '继续编辑' : '取消'}
        onConfirm={() => {
          void controller.confirm();
        }}
        extraAction={
          controller.confirmation?.saveFirst && (
            <Button
              label={controller.confirmation?.saveLabel ?? '保存后离开'}
              busy={controller.busy}
              onPress={() => {
                void controller.saveAndLeave();
              }}
            />
          )
        }
      />
    </>
  );
});
