import type {
  CapabilityName,
  CapabilityEvidence,
  ModelProtocol,
  ProviderPresetId,
  ProviderConnection,
} from './types';

export interface ProviderPreset {
  id: ProviderPresetId;
  name: string;
  protocol: ModelProtocol;
  baseUrl: string;
  compatibility: ProviderConnection['compatibility'];
  apiVersion: string;
  iconHosts?: readonly string[];
}

function compatibleProvider(
  id: ProviderPresetId,
  name: string,
  baseUrl: string,
  iconHosts?: readonly string[],
): ProviderPreset {
  return {
    id,
    name,
    baseUrl,
    protocol: 'chat-completions',
    compatibility: 'standard',
    apiVersion: '',
    iconHosts,
  };
}

export const providerPresets: ProviderPreset[] = [
  compatibleProvider('openai', 'OpenAI', 'https://api.openai.com/v1'),
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'chat-completions',
    baseUrl: 'https://api.deepseek.com',
    compatibility: 'deepseek',
    apiVersion: '',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    compatibility: 'standard',
    apiVersion: '2023-06-01',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    compatibility: 'standard',
    apiVersion: '',
  },
  compatibleProvider('qwen', '通义千问 Qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', [
    'dashscope-intl.aliyuncs.com',
    'dashscope-us.aliyuncs.com',
  ]),
  compatibleProvider('kimi', 'Kimi', 'https://api.moonshot.cn/v1', ['api.moonshot.ai']),
  compatibleProvider('zhipu', '智谱 GLM', 'https://open.bigmodel.cn/api/paas/v4', ['api.z.ai']),
  compatibleProvider('doubao', '豆包 Doubao', 'https://ark.cn-beijing.volces.com/api/v3'),
  compatibleProvider('minimax', 'MiniMax', 'https://api.minimax.io/v1', ['api.minimaxi.com']),
  compatibleProvider('siliconflow', '硅基流动', 'https://api.siliconflow.cn/v1', [
    'api.siliconflow.com',
  ]),
  compatibleProvider('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'),
  compatibleProvider('groq', 'Groq', 'https://api.groq.com/openai/v1'),
  compatibleProvider('mistral', 'Mistral', 'https://api.mistral.ai/v1'),
  compatibleProvider('xai', 'xAI', 'https://api.x.ai/v1'),
  compatibleProvider('custom', '自定义服务', ''),
];

export function getProviderPreset(id: string): ProviderPreset {
  return (
    providerPresets.find(preset => preset.id === id) ??
    providerPresets.find(preset => preset.id === 'custom')!
  );
}

/** Brand matching is only for display; it never selects an API protocol or capabilities. */
export function resolveProviderBrand(
  presetId?: string,
  baseUrl?: string,
): ProviderPresetId | undefined {
  if (presetId && presetId !== 'custom' && providerPresets.some(preset => preset.id === presetId))
    return presetId as ProviderPresetId;
  if (!baseUrl) return;
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return;
  }
  return providerPresets.find(
    preset =>
      preset.id !== 'custom' &&
      (new URL(preset.baseUrl).hostname === hostname || preset.iconHosts?.includes(hostname)),
  )?.id;
}
export const protocolNames: Record<ModelProtocol, string> = {
  'chat-completions': 'Chat Completions',
  'anthropic-messages': 'Anthropic Messages',
  gemini: 'Gemini 原生',
};
export function presetModelEvidence(
  preset: ProviderPresetId,
  apiId: string,
): Partial<Record<CapabilityName, CapabilityEvidence>> {
  // Explicit known IDs, not name/host heuristics. Unknown catalog entries remain unknown.
  if (preset !== 'deepseek' || !['deepseek-flash', 'deepseek-v4-pro'].includes(apiId)) return {};
  return {
    tools: { support: 'supported', source: 'preset' },
    reasoning: { support: 'supported', source: 'preset' },
    images: { support: apiId === 'deepseek-flash' ? 'supported' : 'unsupported', source: 'preset' },
  };
}
