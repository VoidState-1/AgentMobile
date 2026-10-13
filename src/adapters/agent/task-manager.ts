import type { ModelConfigurationService } from '@/core/models/service';
import type { ModelRunLease } from '@/core/models/types';
import { mainSessionId } from '@/core/models/rules';
import type { TaskRecord } from '@/core/prototype/types';
import { defaultSettings } from '@/core/prototype/types';
import type { WorkspaceService } from '@/adapters/workspace/service';
import { startAgent } from './runner';

/** Runtime owns execution; view subscriptions never own cancellation. */
export class TaskManager {
  private state: { active?: TaskRecord; completed?: TaskRecord; error?: string; starting: boolean } = { starting: false };
  private listeners = new Set<() => void>();
  private cancellation?: () => void;
  constructor(private workspace: WorkspaceService, private models: ModelConfigurationService, private id: () => string, private web = false) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: typeof this.state) { this.state = value; this.listeners.forEach((listener) => listener()); }
  cancel = () => this.cancellation?.();
  async start(projectId: string, prompt: string, imageAttached = false): Promise<void> {
    if (this.state.starting || this.state.active) throw new Error('请等待当前任务完成。');
    this.publish({ ...this.state, starting: true, error: undefined }); let lease: ModelRunLease | undefined;
    try {
      const mode = this.models.getSnapshot().mode;
      if (mode === 'remote') lease = await this.models.acquireSelection(projectId, mainSessionId(projectId));
      if (imageAttached && mode === 'remote' && !lease?.snapshot.parameters.allowImages) throw new Error('所选模型配置未开启图片输入。请开启图片输入，或移除图片后发送；草稿已保留。');
      const settings = lease ? { mode, baseUrl: lease.snapshot.baseUrl, model: lease.snapshot.apiModelId, imageInput: lease.snapshot.parameters.allowImages } : defaultSettings;
      const started = await startAgent(this.workspace, projectId, prompt, settings, lease?.secret ?? '', this.id,
        (task) => this.publish({ ...this.state, active: task }), lease?.snapshot, this.web);
      this.cancellation = started.cancel; this.publish({ ...this.state, starting: false, active: started.task });
      const held = lease; lease = undefined;
      void started.done.then(async (task) => { await held?.release(); this.cancellation = undefined; this.publish({ starting: false, completed: task }); }).catch(async () => {
        await held?.release(); this.cancellation = undefined; this.publish({ starting: false, error: '任务状态保存失败，请重新打开应用恢复。' });
      });
    } catch (error) {
      await lease?.release(); this.publish({ ...this.state, starting: false }); throw error;
    }
  }
}
