import type { AppServices } from '@/application/services';
import { publicError } from '@/core/errors';
import type { Project } from '@/core/projects';
import { useEffect, useState } from 'react';
import { useWorkbenchUi } from './workbench-state';

export function useProjectSelection(runtime?: AppServices) {
  const selected = useWorkbenchUi(state => state.projectId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!runtime) return;
    let current = true;
    void Promise.all([runtime.workspace.projects(), runtime.preferences.getWorkbench()])
      .then(([list, preference]) => {
        if (!current) return;
        setProjects(list);
        if (!selected) setChoice(preference?.projectId ?? list[0]?.id ?? '');
      })
      .catch(reason => {
        if (current) setError(publicError(reason).message);
      });
    return () => {
      current = false;
    };
  }, [runtime, selected]);
  return { projects, projectId: choice || selected || '', setProjectId: setChoice, error };
}
