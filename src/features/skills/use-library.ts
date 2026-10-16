import { emptySkillConfiguration } from '@/core/skills/types';
import { useAction } from '@/shared/use-action';
import { useAppServices } from '@/shared/use-app-services';
import { useProjectSelection } from '@/shared/use-project-selection';
import { useServiceSnapshot } from '@/shared/use-service-snapshot';

export function useSkillLibrary() {
  const { runtime, error: loadError } = useAppServices();
  const operation = useAction();
  const config = useServiceSnapshot(runtime?.skills, emptySkillConfiguration);
  const project = useProjectSelection(runtime);
  return {
    runtime,
    config,
    ...project,
    ...operation,
    error: operation.error || project.error || loadError,
  };
}
