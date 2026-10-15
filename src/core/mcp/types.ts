export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  readOnlyHint?: boolean;
  fingerprint: string;
  unavailableReason?: string;
}
export interface McpServer {
  id: string;
  name: string;
  url: string;
  auth: 'none' | 'bearer';
  enabled: boolean;
  credentialRef?: string;
  revision: number;
  timeoutMs: number;
  tools: McpTool[];
  catalogAt?: string;
  serverInfo?: string;
  protocolVersion?: string;
  check?: { status: 'passed' | 'failed'; message: string; at: string };
}
export interface McpConfiguration {
  schemaVersion: 1;
  revision: number;
  servers: McpServer[];
  /** Explicit tool grants, scoped to a project and descriptor fingerprint. */
  grants: Record<string, Record<string, Record<string, string>>>;
}
export type McpServerInput = Pick<McpServer, 'name' | 'url' | 'auth' | 'enabled' | 'timeoutMs'> & {
  id?: string;
};
export type McpServerSnapshot = Omit<McpServer, 'credentialRef' | 'check' | 'catalogAt'>;
export interface McpLease {
  snapshot: McpServerSnapshot;
  secret: string;
  release(): Promise<void>;
}
export interface McpAttempt {
  id: string;
  taskId: string;
  traceId: string;
  serverId: string;
  serverName: string;
  url: string;
  tool: string;
  argsHash: string;
  preview: string;
  state: 'prepared' | 'dispatched' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  createdAt: string;
  endedAt?: string;
  retryAllowedAt?: string;
}
export const emptyMcpConfiguration = (): McpConfiguration => ({
  schemaVersion: 1,
  revision: 0,
  servers: [],
  grants: {},
});
