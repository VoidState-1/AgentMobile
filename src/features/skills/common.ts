import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppServices as getRuntime } from '@/bootstrap';
import type { AppServices as Runtime } from '@/application/services';
import { emptySkillConfiguration } from '@/core/skills/types';
import { publicError } from '@/core/errors';
import type { Project } from '@/core/projects';
import { useWorkbenchUi } from '@/shared/workbench-state';

export function useSkills() {
  const [runtime, setRuntime] = useState<Runtime>(); const [config, setConfig] = useState(emptySkillConfiguration());
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const working = useRef(false);
  const [projects, setProjects] = useState<Project[]>([]); const selected = useWorkbenchUi((state) => state.projectId); const [choice, setChoice] = useState('');
  useEffect(() => {
    let current = true; let unsubscribe: (() => void) | undefined;
    void getRuntime().then(async (value) => {
      if (!current) return; setRuntime(value); setConfig(value.skills.getSnapshot()); unsubscribe = value.skills.subscribe(() => setConfig(value.skills.getSnapshot()));
      const [list, preference] = await Promise.all([value.workspace.projects(), value.preferences.getWorkbench()]);
      if (current) { setProjects(list); if (!selected) setChoice(preference?.projectId ?? list[0]?.id ?? ''); }
    }).catch(() => { if (current) setError('技能库读取失败，请保留数据并重新打开应用。'); });
    return () => { current = false; unsubscribe?.(); };
  }, [selected]);
  const action = useCallback(async (work: () => Promise<void>) => {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { await work(); } catch (reason) { setError(publicError(reason).message); }
    finally { working.current = false; setBusy(false); }
  }, []);
  return { runtime, config, error, busy, action, projects, projectId: choice || selected || '', setProjectId: setChoice };
}
