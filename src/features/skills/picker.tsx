import { Pressable, View } from 'react-native';
import type { DialogsCapability, ConversationCapability } from '@/features/workbench/use-workbench';
import { Button, Sheet, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { contentLimits } from '@/core/agent/settings';
import { explicitSkills } from '@/core/skills/rules';
import { useSkills } from './common';
import { Layers, Plus } from '@/shared/ui/icons';

export function SkillPicker({
  controller,
  conversation,
}: {
  controller: DialogsCapability;
  conversation: ConversationCapability;
}) {
  const { config } = useSkills();
  const theme = useWorkbenchTheme();
  const skills = config.skills.filter(
    skill => config.grants[controller.projectId ?? '']?.[skill.name] === skill.revision,
  );
  return (
    <Sheet
      visible
      title="选择技能"
      onClose={() => controller.setSheet(undefined)}
      footer={
        <Button label="管理 Agent Skills" variant="secondary" onPress={controller.openSkills} />
      }
    >
      {!skills.length && (
        <T tone="secondary" style={{ fontSize: 12 }}>
          暂无已启用技能
        </T>
      )}
      {skills.map(skill => (
        <Pressable
          key={skill.name}
          accessibilityRole="button"
          accessibilityLabel={'使用技能 ' + skill.name}
          disabled={
            conversation.prompt.length + skill.name.length + 2 > contentLimits.promptCharacters
          }
          onPress={() => {
            if (
              !explicitSkills(
                conversation.prompt,
                skills.map(skill => skill.name),
              ).includes(skill.name)
            )
              conversation.setPrompt('$' + skill.name + ' ' + conversation.prompt);
            controller.setSheet(undefined);
          }}
          style={({ pressed }) => ({
            paddingVertical: 8,
            minHeight: 52,
            borderBottomWidth: 1,
            borderColor: theme.border,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: pressed ? theme.inset : 'transparent',
            gap: 8,
          })}
        >
          <Layers size={17} color={theme.accent} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T tone="accent" style={{ fontSize: 13, fontWeight: '600' }}>
              {skill.name}
            </T>
            <T tone="secondary" numberOfLines={2} style={{ fontSize: 12 }}>
              {skill.description}
            </T>
          </View>
          <Plus size={16} color={theme.secondary} />
        </Pressable>
      ))}
    </Sheet>
  );
}
