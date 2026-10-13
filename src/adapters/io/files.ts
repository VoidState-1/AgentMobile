import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { WorkspaceService } from '@/adapters/workspace/service';

export async function pickFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  if (file.size > 5 * 1024 * 1024) throw new Error('导入文件暂限 5 MB');
  return { name: asset.name, bytes: await file.bytes() };
}

export async function exportFile(workspace: WorkspaceService, projectId: string, path: string) {
  if (!await Sharing.isAvailableAsync()) throw new Error('当前设备不支持系统分享');
  const { bytes } = await workspace.read(projectId, path);
  const file = new File(Paths.cache, path.split('/').pop()!);
  file.write(bytes);
  await Sharing.shareAsync(file.uri);
}
