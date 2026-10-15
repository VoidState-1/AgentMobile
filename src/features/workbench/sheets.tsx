import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { FileText, Image as ImageIcon, Plus, Upload } from '@/shared/ui/icons';
import type {
  DialogsCapability,
  EditorCapability,
  FilesCapability,
  ConversationCapability,
} from './use-workbench';
import { Button, Field, Sheet, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { fileName } from '@/shared/format';
import { isImage } from '@/core/workspace/path';
import { ModelPicker } from '@/features/model-config/picker';
import { SkillPicker } from '@/features/skills/picker';

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

export const WorkbenchSheets = memo(function WorkbenchSheets({
  controller,
  editor,
  files,
  conversation,
}: {
  controller: DialogsCapability;
  editor: EditorCapability;
  files: FilesCapability;
  conversation: ConversationCapability;
}) {
  const theme = useWorkbenchTheme();
  return (
    <>
      {controller.sheet === 'skills' && (
        <SkillPicker controller={controller} conversation={conversation} />
      )}
      <Sheet
        visible={controller.sheet === 'create'}
        title="新建项目"
        onClose={() => controller.setSheet(undefined)}
        busy={controller.busy}
        footer={
          <Button
            label="创建工作区"
            icon={Plus}
            busy={controller.busy}
            disabled={!controller.projectName.trim() || !controller.modelsApi}
            onPress={() => {
              void controller.createProject();
            }}
          />
        }
      >
        <Field
          label="项目名称"
          value={controller.projectName}
          onChangeText={controller.setProjectName}
          placeholder="项目名称"
          maxLength={60}
          autoFocus
        />
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </Sheet>
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
          <Pressable
            key={file.path}
            accessibilityRole="button"
            accessibilityLabel={'引用 ' + file.path}
            onPress={() => {
              conversation.setAttachment(file.path);
              controller.setSheet(undefined);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              minHeight: 44,
              borderBottomWidth: 1,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.inset : 'transparent',
            })}
          >
            {isImage(file.path) ? (
              <ImageIcon size={17} color={theme.accent} />
            ) : (
              <FileText size={17} color={theme.secondary} />
            )}
            <T numberOfLines={1} style={{ flex: 1, fontSize: 13 }}>
              {fileName(file.path)}
            </T>
          </Pressable>
        ))}
      </Sheet>
      {controller.sheet === 'rename' && <RenameSheet controller={editor} />}
      <Sheet
        visible={!!controller.confirmation}
        title={controller.confirmation?.title ?? ''}
        onClose={() => controller.setConfirmation(undefined)}
        busy={controller.busy}
        footer={
          <View style={{ gap: 8 }}>
            {controller.confirmation?.saveFirst && (
              <Button
                label="保存后离开"
                busy={controller.busy}
                onPress={() => {
                  void controller.saveAndLeave();
                }}
              />
            )}
            <Button
              label={controller.confirmation?.label ?? '确认'}
              variant={controller.confirmation?.danger ? 'danger' : 'primary'}
              busy={controller.busy}
              onPress={() => {
                void controller.confirm();
              }}
            />
            <Button
              label={controller.confirmation?.saveFirst ? '继续编辑' : '取消'}
              variant="ghost"
              disabled={controller.busy}
              onPress={() => controller.setConfirmation(undefined)}
            />
          </View>
        }
      >
        <T tone="secondary">{controller.confirmation?.description}</T>
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </Sheet>
    </>
  );
});
