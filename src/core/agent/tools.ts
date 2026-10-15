import type { Static, TSchema } from 'typebox';

export type ToolEffect =
  'read' | 'workspace-write' | 'git-index' | 'git-commit' | 'remote-effect' | 'delegate';
export interface ToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  details: Record<string, unknown>;
  isError?: boolean;
}
export interface ControlledTool<T extends TSchema = TSchema> {
  name: string;
  label: string;
  description: string;
  parameters: T;
  effect: ToolEffect;
  executionMode?: 'sequential' | 'parallel';
  execute(
    callId: string,
    args: Static<T>,
    signal?: AbortSignal,
    onUpdate?: (result: ToolResult) => void,
  ): Promise<ToolResult>;
}
