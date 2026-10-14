import type { ControlledTool } from './tools';

export interface HistoryEntry { prompt: string; response: string; createdAt: string }
export type EngineEvent =
  | { type: 'assistant_start'; round: number }
  | { type: 'content'; round: number; index: number; kind: 'text' | 'reasoning'; text: string; visibility?: 'reasoning' | 'summary' | 'unavailable'; ended: boolean; response: string }
  | { type: 'tool_start'; round: number; callId: string; tool: string; args: unknown }
  | { type: 'tool_update'; round: number; callId: string; output: string }
  | { type: 'tool_end'; round: number; callId: string; output: string; error: boolean; unknown: boolean; durationMs?: number }
  | { type: 'assistant_end'; round: number; response: string; transcript: unknown };
export interface EngineInput { prompt: string; systemPrompt: string; history: HistoryEntry[]; tools: ControlledTool[]; reasoning: boolean }
export interface EngineControls {
  beforeRequest?(signal?: AbortSignal): void | Promise<void>;
  afterRequest?(): void;
  beforeTool?(invocation: { callId: string; tool: string; args: unknown; round: number }, signal?: AbortSignal): Promise<{ block: boolean; reason: string; terminate: boolean } | undefined>;
}
export interface EngineSession {
  readonly round: number;
  execute(): Promise<{ stopReason?: 'stop' | 'toolUse' | 'length' | 'error' | 'aborted'; error?: string }>;
  cancel(): void;
  continue?(prompt: string): ReturnType<EngineSession['execute']>;
}
/** Binding-specific model transport and credentials stay behind the adapter. */
export interface AgentEnginePort {
  create(input: EngineInput, receive: (event: EngineEvent) => void, controls: EngineControls): EngineSession;
}
