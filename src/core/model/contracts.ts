export interface ModelCapabilities {
  toolCalling: boolean;
  imageInput: boolean;
}

export type ModelInputPart =
  | { type: 'text'; text: string }
  | { type: 'image'; assetId: string; mimeType: string };

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  parts: readonly ModelInputPart[];
  toolCalls?: readonly {
    callId: string;
    name: string;
    arguments: unknown;
  }[];
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  model: string;
  messages: readonly ModelMessage[];
  tools: readonly ToolDefinition[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export type ModelEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; callId: string; name: string; arguments: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'length' };

/** Implementations resolve image assets and credentials outside the core. */
export interface ModelPort {
  readonly capabilities: ModelCapabilities;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}
