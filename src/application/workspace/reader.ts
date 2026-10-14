import type { WorkspaceContext } from './context';
import type { Project } from '@/core/projects/types';
import type { ProjectFile } from '@/core/workspace/types';
import { safePath, isImage, mimeFor } from '@/core/workspace/path';
import { contentLimits } from '@/core/agent/settings';

const MAX_FILE_BYTES = contentLimits.fileBytes;
export class WorkspaceReader {
  constructor(private readonly context: WorkspaceContext) {}
  async projects() {
    return (await this.context.metadata.all<Project>('projects')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  internal(projectId: string, path: string) {
    return this.context.git.dir(projectId) + '/' + safePath(path);
  }

  async bytesOrNull(projectId: string, path: string) {
    try { return await this.context.fs.read(this.internal(projectId, path)); } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    }
  }

  async files(projectId: string): Promise<ProjectFile[]> {
    const files: ProjectFile[] = [];
    const walk = async (path: string) => {
      for (const name of await this.context.fs.list(this.context.git.dir(projectId) + (path ? '/' + path : ''))) {
        if (name === '.git') continue;
        const relative = safePath(path ? path + '/' + name : name);
        const info = await this.context.fs.stat(this.internal(projectId, relative));
        if (info.kind === 'directory') await walk(relative);
        else {
          const bytes = await this.context.fs.read(this.internal(projectId, relative));
          files.push({ path: relative, revision: await this.context.git.revision(bytes), size: bytes.length, mimeType: mimeFor(relative) });
        }
      }
    };
    await walk('');
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(projectId: string, path: string) {
    const bytes = await this.context.fs.read(this.internal(projectId, path));
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 20 MB 限制');
    return { bytes, revision: await this.context.git.revision(bytes) };
  }

  async readText(projectId: string, path: string) {
    if (isImage(path)) throw new Error('图片请通过图片工具读取');
    const { bytes, revision } = await this.read(projectId, path);
    if (bytes.length > contentLimits.textFileBytes) throw new Error('文本超过 1 MB 限制');
    return { text: this.context.codec.decodeText(bytes), revision };
  }

  async preview(projectId: string, path: string) {
    const { bytes, revision } = await this.read(projectId, path);
    return { revision, content: isImage(path) ? 'data:' + mimeFor(path) + ';base64,' + this.context.codec.encodeBase64(bytes) : this.context.codec.decodeText(bytes) };
  }

  async workingTree(projectId: string) {
    const tree: Record<string, Uint8Array> = Object.create(null);
    for (const file of await this.files(projectId)) tree[file.path] = (await this.read(projectId, file.path)).bytes;
    return tree;
  }
}
