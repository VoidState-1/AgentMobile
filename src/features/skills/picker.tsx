import { Pressable, View } from 'react-native';
import type { DialogsCapability, ConversationCapability } from '@/features/workbench/use-workbench';
import { Button, Sheet, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { contentLimits } from '@/core/agent/settings';
import { explicitSkills } from '@/core/skills/rules';
import { useSkills } from './common';

export function SkillPicker({ controller, conversation }: { controller: DialogsCapability; conversation: ConversationCapability }) {
  const { config } = useSkills(); const theme = useWorkbenchTheme();
  const skills = config.skills.filter((skill) => config.grants[controller.projectId ?? '']?.[skill.name] === skill.revision);
  return <Sheet visible title="选择技能" subtitle="加入消息，明确指定本次使用。" onClose={() => controller.setSheet(undefined)}
    footer={<Button label="管理 Agent Skills" variant="secondary" onPress={controller.openSkills} />}>
    {!skills.length && <T tone="secondary" style={{ fontSize: 12 }}>当前项目还没有启用技能。先在技能库中安装并启用。</T>}
    {skills.map((skill) => <Pressable key={skill.name} accessibilityRole="button" accessibilityLabel={'使用技能 ' + skill.name}
      disabled={conversation.prompt.length + skill.name.length + 2 > contentLimits.promptCharacters}
      onPress={() => { if (!explicitSkills(conversation.prompt, skills.map((skill) => skill.name)).includes(skill.name)) conversation.setPrompt('$' + skill.name + ' ' + conversation.prompt); controller.setSheet(undefined); }}
      style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.border, gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}><T tone="accent" style={{ fontSize: 13, fontWeight: '600' }}>{skill.name}</T></View>
      <T tone="secondary" style={{ fontSize: 11 }}>{skill.description}</T>
    </Pressable>)}
  </Sheet>;
}
