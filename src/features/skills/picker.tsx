import { contentLimits } from '@/core/agent/settings';
import { explicitSkills } from '@/core/skills/rules';
import { emptySkillConfiguration } from '@/core/skills/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { EmptyState } from '@/shared/ui/empty-state';
import { Layers, Plus } from '@/shared/ui/icons';
import { Button } from '@/shared/ui/primitives';
import { Sheet } from '@/shared/ui/sheets';
import { useAppServices } from '@/shared/use-app-services';
import { useServiceSnapshot } from '@/shared/use-service-snapshot';

export function SkillPicker({
  projectId,
  prompt,
  onChoose,
  onClose,
  onManage,
}: {
  projectId?: string;
  prompt: string;
  onChoose: (prompt: string) => void;
  onClose: () => void;
  onManage: () => void;
}) {
  const { runtime } = useAppServices();
  const config = useServiceSnapshot(runtime?.skills, emptySkillConfiguration);
  const theme = useWorkbenchTheme();
  const skills = config.skills.filter(
    skill => config.grants[projectId ?? '']?.[skill.name] === skill.revision,
  );
  return (
    <Sheet
      visible
      title="选择技能"
      onClose={onClose}
      footer={<Button label="管理 Agent Skills" variant="secondary" onPress={onManage} />}
    >
      {!skills.length && <EmptyState compact title="暂无已启用技能" />}
      {skills.map(skill => (
        <ActionRow
          key={skill.name}
          label={'使用技能 ' + skill.name}
          title={skill.name}
          description={skill.description}
          leading={<Layers size={17} color={theme.accent} />}
          trailing={<Plus size={16} color={theme.secondary} />}
          disabled={prompt.length + skill.name.length + 2 > contentLimits.promptCharacters}
          onPress={() => {
            if (
              !explicitSkills(
                prompt,
                skills.map(skill => skill.name),
              ).includes(skill.name)
            )
              onChoose('$' + skill.name + ' ' + prompt);
            onClose();
          }}
        />
      ))}
    </Sheet>
  );
}
