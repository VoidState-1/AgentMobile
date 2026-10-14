import { Type, type TSchema } from 'typebox';
import type { ControlledTool, ToolEffect } from '@/core/agent/tools';
import { publicError } from '@/core/errors';
import { contentLimits } from '@/core/agent/settings';

export const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
export const textLimit = contentLimits.toolTextCharacters;
export const revision = Type.Union([Type.String({ maxLength: 80 }), Type.Null()]);
export function assertRunning(signal?: AbortSignal) { if (signal?.aborted) throw new Error('任务已取消'); }

const effects: Record<string, ToolEffect> = {
  write_text: 'workspace-write', move_file: 'workspace-write', delete_file: 'workspace-write',
  git_stage: 'git-index', git_unstage: 'git-index', git_commit: 'git-commit',
};
export const defineTool = <T extends TSchema>(tool: Omit<ControlledTool<T>, 'effect'> & { effect?: ToolEffect }): ControlledTool<T> => ({
  ...tool, effect: tool.effect ?? effects[tool.name] ?? 'read',
  execute: async (...args) => {
    try { return await tool.execute(...args); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: publicError(error).message }], details: {} }; }
  },
});
