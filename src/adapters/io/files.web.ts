import { AppError } from '@/core/errors';
import type { WorkspaceApplication } from '@/application/workspace/service';
import { workspaceLimits } from '@/core/workspace/limits';

export async function pickFile(
  kind?: 'image',
): Promise<{ name: string; bytes: Uint8Array } | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (kind === 'image') input.accept = '.png,.jpg,.jpeg,.webp';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (file && file.size > workspaceLimits.fileOperationBytes) {
          reject(new AppError('VALIDATION', '导入文件暂限 20 MB'));
          return;
        }
        resolve(
          file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined,
        );
      } catch {
        reject(new AppError('STORAGE', '无法读取选择的文件'));
      }
    };
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

export async function exportFile(workspace: WorkspaceApplication, projectId: string, path: string) {
  const entry = (await workspace.git.workingTree(projectId, [path]))[path];
  if (!entry) throw new AppError('VALIDATION', '文件不存在。');
  const bytes = await workspace.git.blob(projectId, entry.revision);
  const buffer = new Uint8Array(bytes).buffer;
  const url = URL.createObjectURL(new Blob([buffer]));
  const link = document.createElement('a');
  link.href = url;
  link.download = path.split('/').pop()!;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
