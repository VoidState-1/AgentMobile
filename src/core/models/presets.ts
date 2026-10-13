import type { CapabilityName, CapabilityEvidence, ModelProtocol, ProviderPresetId, ProviderConnection } from './types';

export interface ProviderPreset {
  id: ProviderPresetId;
  name: string;
  protocol: ModelProtocol;
  baseUrl: string;
  compatibility: ProviderConnection['compatibility'];
  apiVersion: string;
}
export const providerPresets: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com', compatibility: 'deepseek', apiVersion: '' },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', compatibility: 'standard', apiVersion: '2023-06-01' },
  { id: 'gemini', name: 'Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', compatibility: 'standard', apiVersion: '' },
  { id: 'custom', name: '自定义服务', protocol: 'chat-completions', baseUrl: '', compatibility: 'standard', apiVersion: '' },
];
export const protocolNames: Record<ModelProtocol, string> = { 'chat-completions': 'Chat Completions', 'anthropic-messages': 'Anthropic Messages', gemini: 'Gemini 原生' };
export function presetModelEvidence(preset: ProviderPresetId, apiId: string): Partial<Record<CapabilityName, CapabilityEvidence>> {
  // Explicit known IDs, not name/host heuristics. Unknown catalog entries remain unknown.
  if (preset !== 'deepseek' || !['deepseek-flash', 'deepseek-v4-pro'].includes(apiId)) return {};
  return { tools: { support: 'supported', source: 'preset' }, reasoning: { support: 'supported', source: 'preset' },
    images: { support: apiId === 'deepseek-flash' ? 'supported' : 'unsupported', source: 'preset' } };
}
