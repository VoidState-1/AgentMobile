import { AppError, publicError } from '@/core/errors';
import { Type, type TSchema } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import { contentLimits } from '@/core/agent/settings';

export const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
});
export const textLimit = contentLimits.toolTextCharacters;
export const revision = Type.Union([Type.String({ maxLength: 80 }), Type.Null()]);
export function assertRunning(signal?: AbortSignal) {
  if (signal?.aborted) throw new AppError('CANCELLED', '任务已取消');
}

export const defineTool = <T extends TSchema>(tool: ControlledTool<T>): ControlledTool<T> => ({
  ...tool,
  execute: async (...args) => {
    try {
      return await tool.execute(...args);
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: publicError(error).message }],
        details: {},
      };
    }
  },
});
