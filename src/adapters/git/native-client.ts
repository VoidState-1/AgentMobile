import NativeGit from '../../../modules/agent-mobile-git';
import { randomUUID } from 'expo-crypto';
import { AppError, type AppErrorCode } from '@/core/errors';
import type { GitTransportOptions } from '@/core/git/repository';

export async function nativeGit<T>(
  projectId: string,
  method: string,
  input: Record<string, unknown> = {},
  transport?: GitTransportOptions,
): Promise<T> {
  if (transport?.signal?.aborted) throw new AppError('CANCELLED', 'Git 操作已取消');
  const operationId = transport?.operationId ?? randomUUID();
  const subscription = transport?.progress
    ? NativeGit.addListener('onProgress', event => {
        if (event.runId === operationId)
          transport.progress?.({
            phase: event.phase,
            completed: event.completed,
            total: event.total,
            bytes: event.bytes,
          });
      })
    : undefined;
  const cancel = () => NativeGit.cancel(operationId);
  transport?.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = JSON.parse(
      await NativeGit.execute(
        projectId,
        operationId,
        JSON.stringify({
          ...input,
          method,
          ...(transport?.credential ? { credential: transport.credential } : {}),
        }),
      ),
      (_key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value))
          Object.setPrototypeOf(value, null);
        return value;
      },
    ) as
      | { ok: true; value: T }
      | { ok: false; code: AppErrorCode | 'ENOENT'; message: string; uncertain?: boolean };
    if (!response.ok) {
      if (response.code === 'ENOENT')
        throw Object.assign(new Error('文件不存在'), { code: 'ENOENT' });
      throw new AppError(response.code, response.message, response.uncertain);
    }
    return response.value;
  } finally {
    subscription?.remove();
    transport?.signal?.removeEventListener('abort', cancel);
  }
}
