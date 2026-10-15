import { AppError } from '@/core/errors';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { skillLimits } from '@/core/skills/rules';

export async function pickSkillPackage() {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) return;
  const asset = result.assets[0]; const file = new File(asset.uri);
  if (file.size > skillLimits.archiveBytes) throw new AppError('VALIDATION', '技能导入文件最多 20 MB。');
  return { name: asset.name, bytes: await file.bytes() };
}
export async function shareSkillPackage(name: string, bytes: Uint8Array) {
  if (!await Sharing.isAvailableAsync()) throw new AppError('VALIDATION', '当前设备不支持系统分享。');
  const file = new File(Paths.cache, name + '.zip'); file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', dialogTitle: '导出 Agent Skill' });
}
