import { AppError } from '@/core/errors';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { WorkspaceApplication } from '@/application/workspace/service';
import { contentLimits } from '@/core/agent/settings';

export async function pickFile(kind?: 'image') {
  const result = await DocumentPicker.getDocumentAsync({
    type: kind === 'image' ? ['image/png', 'image/jpeg', 'image/webp'] : '*/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled) return;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  if (file.size > contentLimits.fileBytes) throw new AppError('VALIDATION', '导入文件暂限 20 MB');
  return { name: asset.name, bytes: await file.bytes() };
}

export async function exportFile(workspace: WorkspaceApplication, projectId: string, path: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw new AppError('VALIDATION', '当前设备不支持系统分享');
  const { bytes } = await workspace.read(projectId, path);
  const file = new File(Paths.cache, path.split('/').pop()!);
  file.write(bytes);
  await Sharing.shareAsync(file.uri);
}
