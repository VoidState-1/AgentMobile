import type { McpServerSnapshot, McpTool } from './types';
import type { ToolResult } from '../agent/tools';

/** Opaque host bindings. Credentials and SDK sessions stay in the adapter. */
export interface McpRunPort {
  snapshots: McpServerSnapshot[];
  tools: {
    alias: string;
    label: string;
    tool: McpTool;
    execute(
      taskId: string,
      traceId: string,
      args: Record<string, unknown>,
      allowImages: boolean,
      signal?: AbortSignal,
      progress?: (text: string) => void,
    ): Promise<ToolResult>;
  }[];
  sanitize<T>(value: T): T;
  close(): Promise<void>;
}
