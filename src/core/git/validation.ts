import { AppError } from '@/core/errors';
import type { GitCredentialInput } from './repository';

export function gitHttpsUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('VALIDATION', '仓库地址无效。');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\r\n\0\\]/.test(input)
  )
    throw new AppError('VALIDATION', '请使用不含凭证和查询参数的 HTTPS 仓库地址。');
  return url.toString();
}
export function validateGitCredential(input: GitCredentialInput) {
  if (
    !input.username.trim() ||
    !input.token ||
    input.username.length > 200 ||
    input.token.length > 16000 ||
    /[\r\n\0]/.test(input.username + input.token)
  )
    throw new AppError('VALIDATION', '请输入有效的 Git 用户名和访问令牌。');
}
