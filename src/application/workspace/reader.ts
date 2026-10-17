import { AppError } from '@/core/errors';
import type { WorkspaceContext } from './context';
import type { Project } from '@/core/projects';
import type { ProjectFile } from '@/core/workspace/types';
import { safePath } from '@/core/workspace/path';
import { workspaceLimits } from '@/core/workspace/limits';
import { validateTextContent, describeContent } from '@/core/workspace/content';
import { previewContent } from './content';
import type { FilePreview } from '@/application/services';
import type { StorageStat } from '@/core/storage/contracts';
import type { Operation } from '@/core/workspace/journal';

const MAX_FILE_BYTES = workspaceLimits.fileOperationBytes;
export class WorkspaceReader {
  private readonly descriptors = new Map<string, { file: ProjectFile; stamp: string }>();
  constructor(private readonly context: WorkspaceContext) {}
  invalidate(projectId?: string): void {
    for (const key of this.descriptors.keys())
      if (!projectId || key.startsWith(projectId + '/')) this.descriptors.delete(key);
  }
  async record(operation: Operation): Promise<void> {
    const projectId = operation.scope.projectId;
    for (const change of operation.changes) {
      const key = projectId + '/' + change.path;
      this.descriptors.delete(key);
      if (change.after !== null) {
        const bytes = this.context.codec.decodeBase64(change.after);
        const expected = await this.context.git.revision(bytes);
        const actual = await this.read(projectId, change.path);
        if (actual.revision !== expected) this.descriptors.delete(key);
      }
    }
  }
  private stamp(projectId: string, path: string, info: StorageStat): Promise<string | undefined> {
    return info.contentVersion !== undefined
      ? Promise.resolve(info.contentVersion)
      : (this.context.fs.contentStamp?.(this.internal(projectId, path)) ??
          Promise.resolve(undefined));
  }
  async projects() {
    return (await this.context.metadata.all<Project>(this.context.projectBucket)).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  internal(projectId: string, path: string) {
    return this.context.git.dir(projectId) + '/' + safePath(path);
  }

  async bytesOrNull(projectId: string, path: string) {
    try {
      return await this.context.fs.read(this.internal(projectId, path));
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async walk(
    projectId: string,
    visit: (path: string, info: StorageStat) => Promise<void>,
  ): Promise<void> {
    const walk = async (path: string) => {
      for (const name of await this.context.fs.list(
        this.context.git.dir(projectId) + (path ? '/' + path : ''),
      )) {
        if (name.toLowerCase() === '.git') continue;
        const relative = safePath(path ? path + '/' + name : name);
        const info = await this.context.fs.stat(this.internal(projectId, relative));
        if (info.kind === 'directory') await walk(relative);
        else await visit(relative, info);
      }
    };
    await walk('');
  }
  async view(projectId: string, openPath?: string) {
    const files: ProjectFile[] = [];
    const seen = new Set<string>();
    let preview: (FilePreview & { path: string }) | undefined;
    await this.walk(projectId, async (path, info) => {
      const key = projectId + '/' + path;
      seen.add(key);
      const stamp = await this.stamp(projectId, path, info);
      const cached = this.descriptors.get(key);
      if (
        path !== openPath &&
        stamp !== undefined &&
        cached?.stamp === stamp &&
        cached.file.size === info.size
      ) {
        files.push({ ...cached.file });
        return;
      }
      const { bytes, revision } = await this.read(projectId, path);
      files.push({ path, revision, size: bytes.length, ...describeContent(path, bytes) });
      if (path === openPath)
        preview = {
          path,
          revision,
          size: bytes.length,
          ...previewContent(path, bytes, this.context.codec),
        };
    });
    for (const key of this.descriptors.keys())
      if (key.startsWith(projectId + '/') && !seen.has(key)) this.descriptors.delete(key);
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)), preview };
  }
  async files(projectId: string): Promise<ProjectFile[]> {
    return (await this.view(projectId)).files;
  }

  async read(projectId: string, path: string) {
    path = safePath(path);
    const key = projectId + '/' + path;
    const info = await this.context.fs.stat(this.internal(projectId, path));
    const before = await this.stamp(projectId, path, info);
    const bytes = await this.context.fs.read(this.internal(projectId, path));
    if (bytes.length > MAX_FILE_BYTES) throw new AppError('LIMIT', '文件超过 20 MB 限制');
    const afterInfo = await this.context.fs.stat(this.internal(projectId, path));
    const after = await this.stamp(projectId, path, afterInfo);
    if (before !== after || info.size !== afterInfo.size) {
      this.descriptors.delete(key);
      throw new AppError('CONFLICT', '读取期间文件已变化，请重新读取。');
    }
    const revision = await this.context.git.revision(bytes);
    if (after !== undefined)
      this.descriptors.set(key, {
        stamp: after,
        file: { path, revision, size: bytes.length, ...describeContent(path, bytes) },
      });
    return { bytes, revision };
  }

  async readText(projectId: string, path: string) {
    const { bytes, revision } = await this.read(projectId, path);
    validateTextContent(bytes);
    return { text: this.context.codec.decodeText(bytes), revision };
  }

  async preview(projectId: string, path: string) {
    const { bytes, revision } = await this.read(projectId, path);
    return { revision, size: bytes.length, ...previewContent(path, bytes, this.context.codec) };
  }

  async workingTree(projectId: string) {
    const tree: Record<string, Uint8Array> = Object.create(null);
    await this.walk(projectId, async path => {
      tree[path] = await this.context.fs.read(this.internal(projectId, path));
    });
    return tree;
  }
}
