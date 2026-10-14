import type { ModelConfigurationService } from '@/application/models/configuration';
import type { ModelRunLease } from '@/core/models/types';
import { mainSessionId, selectedModelMode } from '@/core/models/rules';
import type { ConversationService } from '@/application/conversations/service';
import type { TaskRecord } from '@/core/runs/types';
import { defaultSettings } from '@/core/legacy/model-settings';
import type { WorkspaceService } from '@/adapters/workspace/service';
import { startAgent } from './runner';
import { defaultAgentSettings } from '@/core/agent/settings';
import { type AgentSettingsService } from '@/application/settings/agent';
import type { McpRuntime, McpRun } from '@/adapters/mcp/runtime';
import type { SkillService } from '@/application/skills/library';
import { createSkillRun } from '@/adapters/skills/run';
import { Signal } from '@/core/events/signal';

/** Runtime owns execution; view subscriptions never own cancellation. */
export class TaskManager {
  private state: { active?: TaskRecord; completed?: TaskRecord; error?: string; starting: boolean } = { starting: false };
  private readonly signal = new Signal();
  private cancellation?: () => void;
  constructor(private workspace: WorkspaceService, private models: ModelConfigurationService, private id: () => string, private web = false, private conversations?: ConversationService, private settings?: AgentSettingsService, private mcp?: McpRuntime, private skills?: SkillService) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => this.signal.subscribe(listener);
  private publish(value: typeof this.state) { this.state = value; this.signal.publish(); }
  cancel = () => this.cancellation?.();
  async start(projectId: string, prompt: string, imageAttached = false, conversationId = mainSessionId(projectId), draftRevision?: number): Promise<void> {
    if (this.state.starting || this.state.active) throw new Error('请等待当前任务完成。');
    this.publish({ ...this.state, starting: true, error: undefined }); let lease: ModelRunLease | undefined;
    const agentSettings = this.settings?.getSnapshot() ?? defaultAgentSettings();
    let conversationLease: Awaited<ReturnType<ConversationService['acquireRun']>> | undefined;
    let mcpRun: McpRun | undefined;
    try {
      if (this.conversations) {
        await this.conversations.ensureProject(projectId);
        conversationLease = await this.conversations.acquireRun(conversationId, projectId, prompt.split('\n\n参考文件：')[0]);
      }
      const mode = selectedModelMode(this.models.getSnapshot(), conversationId);
      const skillRun = this.skills ? createSkillRun(this.skills.repository, await this.skills.capture(projectId, prompt)) : undefined;
      if (mode === 'remote') lease = await this.models.acquireSelection(projectId, conversationId);
      if (mode === 'remote' && this.mcp) mcpRun = this.mcp.createRun(await this.mcp.configuration.acquireProject(projectId));
      if (imageAttached && mode === 'remote' && !lease?.snapshot.parameters.allowImages) throw new Error('所选模型配置未开启图片输入。请开启图片输入，或移除图片后发送；草稿已保留。');
      const settings = lease ? { mode, baseUrl: lease.snapshot.baseUrl, model: lease.snapshot.apiModelId, imageInput: lease.snapshot.parameters.allowImages } : defaultSettings;
      const started = await startAgent(this.workspace, projectId, prompt, settings, lease?.secret ?? '', this.id,
        (task) => this.publish({ ...this.state, active: task }), lease?.snapshot, this.web, conversationId, draftRevision, agentSettings, mcpRun, skillRun);
      this.cancellation = started.cancel; this.publish({ ...this.state, starting: false, active: started.task });
      const held = lease; lease = undefined;
      const heldMcp = mcpRun; mcpRun = undefined;
      const heldConversation = conversationLease; conversationLease = undefined;
      void started.done.then(async (task) => { await heldMcp?.close(); await held?.release(); heldConversation?.release(); this.cancellation = undefined; this.publish({ starting: false, completed: task }); }).catch(async () => {
        await heldMcp?.close(); await held?.release(); heldConversation?.release(); this.cancellation = undefined; this.publish({ starting: false, error: '任务状态保存失败，请重新打开应用恢复。' });
      });
      await this.conversations?.acknowledgeSubmission(conversationId, draftRevision).catch(() => {
        this.publish({ ...this.state, error: '任务已启动，草稿清理尚未完成；重开时将根据任务记录修复。' });
      });
    } catch (error) {
      await mcpRun?.close(); await lease?.release(); conversationLease?.release(); this.publish({ ...this.state, starting: false }); throw error;
    }
  }
}
