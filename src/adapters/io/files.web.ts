import type { WorkspaceService } from '@/adapters/workspace/service';

export async function pickFile(): Promise<{ name: string; bytes: Uint8Array } | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.txt,.md,.png,.jpg,.jpeg,.webp';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (file && file.size > 5 * 1024 * 1024) { reject(new Error('导入文件暂限 5 MB')); return; }
        resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined);
      } catch { reject(new Error('无法读取选择的文件')); }
    };
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

export async function exportFile(workspace: WorkspaceService, projectId: string, path: string) {
  const { bytes } = await workspace.read(projectId, path);
  const buffer = new Uint8Array(bytes).buffer;
  const url = URL.createObjectURL(new Blob([buffer]));
  const link = document.createElement('a');
  link.href = url; link.download = path.split('/').pop()!;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
