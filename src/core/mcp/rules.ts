import { AppError } from '@/core/errors';
import type { McpServerInput, McpTool } from './types';
export function mcpEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new AppError('VALIDATION', '请输入有效的 MCP 端点地址。'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new AppError('VALIDATION', 'MCP 地址需要 HTTPS；本机开发地址可使用 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw new AppError('VALIDATION', '端点不能包含凭证、查询参数或片段，请单独填写 Token。');
  return url.href;
}
export function validateMcpServer(value: McpServerInput): void {
  mcpEndpoint(value.url);
  if (!value.name.trim() || value.name.length > 80) throw new AppError('VALIDATION', 'MCP 名称需要 1–80 个字符。');
  if (!['none', 'bearer'].includes(value.auth)) throw new AppError('VALIDATION', '当前支持无需认证或 Bearer Token。');
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 5000 || value.timeoutMs > 600_000) throw new AppError('VALIDATION', 'MCP 超时应为 5–600 秒。');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export function scrub(value: string, secret: string): string { return secret ? value.split(secret).join('[凭证已隐藏]') : value; }
export function toolFingerprint(tool: Omit<McpTool, 'fingerprint' | 'unavailableReason'>): string { return canonical(tool); }
export function schemaIssue(schema: unknown, depth = 0): string | undefined {
  if (depth > 16) return '输入定义嵌套过深';
  if (!schema || typeof schema !== 'object') return undefined;
  for (const [key, value] of Object.entries(schema)) {
    if (['$ref', '$dynamicRef', '__proto__', 'prototype', 'constructor'].includes(key)) return '当前不支持引用或特殊属性的输入定义';
    const issue = schemaIssue(value, depth + 1); if (issue) return issue;
  }
  return undefined;
}
