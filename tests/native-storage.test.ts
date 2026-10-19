import { expect, it, vi } from 'vitest';
import { createNativeFileSystem } from '../src/adapters/storage/native-files';

it('原生正文接口拒绝工作区外、Git 私有路径和跨项目移动，拒绝发生在原生调用之前', async () => {
  const called = vi.fn();
  const call = async <T>(...args: unknown[]): Promise<T> => {
    called(...args);
    return undefined as T;
  };
  const fs = createNativeFileSystem(call);
  for (const path of [
    '/',
    '/credentials/key',
    '/workspaces/id/repository/.git/config',
    '/workspaces/id/repository/../escape',
    '/workspaces/id/repository/folder/.GIT/config',
  ])
    await expect(fs.read(path)).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(
    fs.moveFile('/workspaces/a/repository/file', '/workspaces/b/repository/file'),
  ).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(called).not.toHaveBeenCalled();
});

it('原生正文接口只传项目标识与相对路径，并保留真实 Unicode 表示', async () => {
  const requests: { projectId: string; method: string; input: Record<string, unknown> }[] = [];
  const call = async <T>(
    projectId: string,
    method: string,
    input: Record<string, unknown> = {},
  ): Promise<T> => {
    requests.push({ projectId, method, input });
    return (method === 'fileRead' ? 'aGVsbG8=' : undefined) as T;
  };
  const fs = createNativeFileSystem(call);
  const path = 'e\u0301/文档😀.txt';
  expect(new TextDecoder().decode(await fs.read('/workspaces/project/repository/' + path))).toBe(
    'hello',
  );
  expect(requests[0]).toMatchObject({ projectId: 'project', input: { path } });
  expect(JSON.stringify(requests)).not.toContain('/workspaces/');
});
