import { AppError } from '@/core/errors';
import { skillLimits } from '@/core/skills/rules';

export async function pickSkillPackage(): Promise<{ name: string; bytes: Uint8Array } | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.md,.zip';
    input.onchange = async () => {
      try { const file = input.files?.[0]; if (file && file.size > skillLimits.archiveBytes) throw new AppError('VALIDATION', '技能导入文件最多 20 MB。');
        resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined);
      } catch (error) { reject(error instanceof AppError ? error : new AppError('VALIDATION', '技能文件无法读取。')); }
    }; input.oncancel = () => resolve(undefined); input.click();
  });
}
export async function shareSkillPackage(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer])); const link = document.createElement('a');
  link.href = url; link.download = name + '.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
