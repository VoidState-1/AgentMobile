import type { ControlledTool } from '@/core/agent/tools';
import type { GitPort } from '@/core/git/contracts';
import type { ContentCodec } from '@/core/storage/codec';
import { safePath } from '@/core/workspace/path';
import { AppError } from '@/core/errors';
import { fileReadTools, scopedFileReader } from './file-read';

export async function snapshotTools(git: GitPort, codec: ContentCodec, projectId: string, snapshot: string, paths: readonly string[], allowImages: boolean): Promise<ControlledTool[]> {
  const grant = new Set(paths.map(path => safePath(path)));
  const files = (await git.entries(projectId, snapshot)).filter(file => grant.has(file.path) && file.path.toLowerCase() !== 'project.json');
  if (files.length !== grant.size) throw new AppError('VALIDATION', '子任务资料范围包含不存在或受保护的路径。');
  const reader = scopedFileReader('snapshot:' + snapshot, async () => ({ version: snapshot, files }), async path => {
    const file = files.find(file => file.path === path);
    if (!file) throw new AppError('VALIDATION', '文件未在子任务授权范围中。');
    return { revision: file.revision, bytes: await git.readAt(projectId, snapshot, path) };
  });
  return fileReadTools(reader, codec, allowImages);
}
