import { AppError } from '@/core/errors';

export function geminiResource(id: string): string {
  const name = id.replace(/^models\//, '');
  if (!/^[a-zA-Z0-9._-]{1,180}$/.test(name))
    throw new AppError('REMOTE', 'Gemini 模型 ID 应为 models/名称或模型名称。');
  return 'models/' + encodeURIComponent(name);
}
