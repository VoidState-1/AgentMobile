import { defaultOutputTokens } from '../agent/settings';
export type ModelProtocol = 'chat-completions' | 'anthropic-messages' | 'gemini';
export type ProviderPresetId = 'deepseek' | 'anthropic' | 'gemini' | 'custom';
export type ModelSupport = 'supported' | 'unsupported' | 'unknown';
export type CapabilityName = 'tools' | 'images' | 'reasoning';
export type EvidenceSource = 'preset' | 'discovery' | 'user' | 'verified';
export type CheckKind = 'connection' | 'text' | 'tools' | 'images';

export interface CapabilityEvidence {
  support: ModelSupport;
  source: EvidenceSource;
  checkedAt?: string;
}
export interface ModelParameters {
  maxOutputTokens: number;
  temperature?: number;
  allowImages: boolean;
  reasoning: 'off' | 'provider-default' | 'on';
  reasoningBudget?: number;
  /** Explicit provider dialect; never inferred from a model ID. */
  reasoningStrategy?: 'budget' | 'adaptive' | 'level';
  reasoningEffort?: 'low' | 'medium' | 'high';
  reasoningDisplay?: 'reasoning' | 'summary';
}
export interface DiagnosticResult {
  status: 'passed' | 'failed' | 'cancelled';
  message: string;
  at: string;
  fingerprint: string;
  platform: 'web' | 'native' | 'android' | 'ios';
  requests?: number;
  totalTokens?: number;
}
export interface ProviderConnection {
  id: string;
  name: string;
  presetId: ProviderPresetId;
  protocol: ModelProtocol;
  baseUrl: string;
  auth: 'key' | 'none';
  credentialRef?: string;
  compatibility: 'standard' | 'deepseek';
  apiVersion: string;
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  check?: DiagnosticResult;
  checkHistory?: DiagnosticResult[];
  catalogAt?: string;
}
export interface ModelEntry {
  id: string;
  connectionId: string;
  apiId: string;
  name: string;
  enabled: boolean;
  favorite: boolean;
  revision: number;
  capabilities: Record<CapabilityName, CapabilityEvidence>;
  parameters: ModelParameters;
  limits?: { contextTokens?: number; outputTokens?: number; maxTemperature?: number };
  catalog: { source: 'manual' | 'preset' | 'discovered'; lastSeenAt?: string; missing: boolean };
  checks: Partial<Record<Exclude<CheckKind, 'connection'>, DiagnosticResult>>;
  checkHistory?: Partial<Record<Exclude<CheckKind, 'connection'>, DiagnosticResult[]>>;
  createdAt: string;
  updatedAt: string;
}
export interface ModelConfiguration {
  schemaVersion: 1;
  revision: number;
  mode: 'demo' | 'remote';
  sessionModes?: Record<string, 'demo' | 'remote'>;
  connections: ProviderConnection[];
  models: ModelEntry[];
  defaults: { global?: string; projects: Record<string, string>; sessions: Record<string, string> };
  recent: string[];
}
export interface DiscoveredModel {
  apiId: string;
  name: string;
  capabilities?: Partial<Record<CapabilityName, ModelSupport>>;
  limits?: ModelEntry['limits'];
}
/** Persisted task provenance. Credential references and values are excluded. */
export interface ModelRunSnapshot {
  connectionId: string;
  connectionName: string;
  connectionRevision: number;
  modelEntryId: string;
  modelName: string;
  modelRevision: number;
  apiModelId: string;
  protocol: ModelProtocol;
  baseUrl: string;
  compatibility: ProviderConnection['compatibility'];
  apiVersion: string;
  auth: ProviderConnection['auth'];
  parameters: ModelParameters;
  contextTokens: number;
}
/** Host-only lease; secret is never serialized into configuration or task data. */
export interface ModelRunLease {
  snapshot: ModelRunSnapshot;
  secret: string;
  release(): Promise<void>;
}

export function emptyModelConfiguration(): ModelConfiguration {
  return { schemaVersion: 1, revision: 0, mode: 'demo', connections: [], models: [],
    defaults: { projects: {}, sessions: {} }, recent: [] };
}
export const defaultModelParameters: ModelParameters = { maxOutputTokens: defaultOutputTokens, allowImages: false, reasoning: 'off' };
export function unknownCapabilities(): ModelEntry['capabilities'] {
  return { tools: { support: 'unknown', source: 'user' }, images: { support: 'unknown', source: 'user' },
    reasoning: { support: 'unknown', source: 'user' } };
}

export type ConnectionInput = Omit<ProviderConnection, 'id' | 'credentialRef' | 'revision' | 'createdAt' | 'updatedAt' | 'check' | 'checkHistory' | 'catalogAt'> & { id?: string };
export interface ModelInput {
  id?: string; connectionId: string; apiId: string; name: string; enabled: boolean; favorite: boolean;
  capabilities: Record<CapabilityName, ModelSupport>; parameters: ModelEntry['parameters'];
}
