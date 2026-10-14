import type { WorkspaceApplication } from '@/application/workspace/service';
import type { GitBaseline } from '@/core/git/contracts';
import type { TaskRecord } from '@/core/runs/types';
import type { ContentCodec } from '@/core/storage/codec';
import type { McpRunPort } from '@/core/mcp/run';
import type { SkillRunPort } from '@/core/skills/run';

export interface RunToolsContext {
  workspace: WorkspaceApplication;
  projectId: string;
  runId: string;
  baseline: GitBaseline;
  task: TaskRecord;
  codec: ContentCodec;
  settings: { mode: 'demo' | 'remote'; imageInput: boolean };
  round(): number;
  mcpRun?: McpRunPort;
  skillRun?: SkillRunPort;
}
