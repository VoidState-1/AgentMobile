import { AppError } from '@/core/errors';
import { Buffer } from 'buffer';
import { parseDocument } from 'yaml';
import { Unzip, UnzipInflate, unzipSync, zipSync } from 'fflate';
import { validateImage } from '@/core/workspace/image';
import type { SkillBundle, SkillMetadata } from '@/core/skills/types';
import { resourceKind, skillLimits, skillPath, validateSkillMetadata } from '@/core/skills/rules';

export function decodeSkillText(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(Buffer.from(bytes)) || text.includes('\0'))
    throw new AppError('VALIDATION', '技能文本必须为有效 UTF-8，且不能包含空字符。');
  return text;
}
export function parseSkill(source: string): SkillMetadata {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match || Buffer.from(match[1]).length > 8192)
    throw new AppError('VALIDATION', 'SKILL.md 需要以 YAML frontmatter 开始，元数据最多 8 KB。');
  let values: unknown;
  try {
    const document = parseDocument(match[1], { uniqueKeys: true, schema: 'core', merge: false });
    if (document.errors.length || document.warnings.length) throw new Error();
    values = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new AppError(
      'VALIDATION',
      'SKILL.md 的 YAML 元数据无效；请检查重复字段、引号、类型或别名。',
    );
  }
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new AppError('VALIDATION', 'SKILL.md 元数据必须为字段映射。');
  const value = values as Record<string, unknown>;
  if (typeof value.name !== 'string' || typeof value.description !== 'string')
    throw new AppError('VALIDATION', 'SKILL.md 必须包含字符串 name 和 description。');
  for (const key of ['license', 'compatibility', 'allowed-tools'])
    if (value[key] !== undefined && typeof value[key] !== 'string')
      throw new AppError('VALIDATION', '技能 ' + key + ' 字段必须为字符串。');
  if (
    value.metadata !== undefined &&
    (!value.metadata ||
      typeof value.metadata !== 'object' ||
      Array.isArray(value.metadata) ||
      Object.values(value.metadata).some(item => typeof item !== 'string'))
  )
    throw new AppError('VALIDATION', '技能 metadata 必须为字符串键值映射。');
  const metadata: SkillMetadata = {
    name: value.name,
    description: value.description,
    license: value.license as string | undefined,
    compatibility: value.compatibility as string | undefined,
    allowedTools: value['allowed-tools'] as string | undefined,
    metadata: value.metadata as Record<string, string> | undefined,
  };
  validateSkillMetadata(metadata);
  if (!text.slice(match[0].length).trim())
    throw new AppError('VALIDATION', 'SKILL.md 需要包含技能正文说明。');
  return metadata;
}
export function validateBundle(
  files: { path: string; bytes: Uint8Array }[],
  folderName?: string,
): SkillBundle {
  if (!files.length || files.length > skillLimits.packageFiles)
    throw new AppError('VALIDATION', '技能包需要 1–512 个文件。');
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    const path = skillPath(file.path);
    const key = path.toLowerCase();
    if (path !== file.path || names.has(key))
      throw new AppError('VALIDATION', '技能包包含重复或未规范化路径。');
    names.add(key);
    total += file.bytes.length;
    const kind = resourceKind(path);
    const max =
      path === 'SKILL.md'
        ? skillLimits.instructionBytes
        : kind === 'image'
          ? skillLimits.imageBytes
          : skillLimits.textBytes;
    if (file.bytes.length > max)
      throw new AppError(
        'VALIDATION',
        '技能文件超过限制：SKILL.md 64 KB、图片 4 MB、其他资源 1 MB。',
      );
    if (kind === 'text') decodeSkillText(file.bytes);
    else if (kind === 'image') validateImage(path, file.bytes);
  }
  if (total > skillLimits.archiveBytes)
    throw new AppError('VALIDATION', '技能包展开后最多 20 MB。');
  const source = files.find(file => file.path === 'SKILL.md');
  if (!source) throw new AppError('VALIDATION', '技能包缺少根目录 SKILL.md。');
  const metadata = parseSkill(decodeSkillText(source.bytes));
  const warnings: string[] = [];
  if (folderName && folderName !== metadata.name)
    warnings.push('导入目录名与 name 不同，已按 name 整理。');
  if (files.some(file => file.path.startsWith('scripts/')))
    warnings.push('包含脚本：本版本可阅读，不执行。');
  if (metadata.allowedTools) warnings.push('allowed-tools 仅作兼容说明，工具授权由应用管理。');
  if (metadata.compatibility) warnings.push('环境要求：' + metadata.compatibility);
  return {
    ...metadata,
    files: files.map(file => ({ path: file.path, bytes: new Uint8Array(file.bytes) })),
    warnings,
  };
}
export function importSkillPackage(name: string, bytes: Uint8Array): SkillBundle[] {
  if (bytes.length > skillLimits.archiveBytes)
    throw new AppError('VALIDATION', '技能导入文件最多 20 MB。');
  if (!/\.zip$/i.test(name)) {
    if (!/\.md$/i.test(name))
      throw new AppError('VALIDATION', '请选择 SKILL.md 或包含技能目录的 ZIP。');
    return [validateBundle([{ path: 'SKILL.md', bytes }])];
  }
  const files: Record<string, Uint8Array> = Object.create(null);
  let total = 0;
  const seen = new Set<string>();
  let entries = 0;
  let pending = 0;
  let skipped = false;
  try {
    // Validate the central directory without inflating data; the stream below enforces actual output limits.
    let headers = 0;
    unzipSync(bytes, {
      filter: () => {
        if (++headers > skillLimits.packageFiles)
          throw new AppError('VALIDATION', 'ZIP 最多包含 512 项。');
        return false;
      },
    });
    const unzip = new Unzip(entry => {
      if (++entries > skillLimits.packageFiles)
        throw new AppError('VALIDATION', 'ZIP 最多包含 512 项。');
      const raw = entry.name.replace(/\/$/, '');
      if (
        !raw ||
        raw.startsWith('/') ||
        /[\\:\u0000-\u001f]/.test(raw) ||
        raw.split('/').some(part => !part || part === '.' || part === '..')
      )
        throw new AppError('VALIDATION', 'ZIP 包含越界或无效路径。');
      if (
        raw
          .split('/')
          .some(part => part.startsWith('.') || part === 'node_modules' || part === '__MACOSX')
      ) {
        skipped = true;
        return;
      }
      const path = skillPath(entry.name.replace(/\/$/, ''));
      const key = path.toLowerCase();
      if (seen.has(key)) throw new AppError('VALIDATION', 'ZIP 包含重复路径。');
      seen.add(key);
      if (entry.name.endsWith('/')) return;
      if ((entry.originalSize ?? 0) > skillLimits.imageBytes)
        throw new AppError('VALIDATION', 'ZIP 单个文件最多 4 MB。');
      let size = 0;
      const chunks: Uint8Array[] = [];
      pending++;
      entry.ondata = (error, chunk, final) => {
        if (error) throw error;
        size += chunk.length;
        total += chunk.length;
        if (size > skillLimits.imageBytes || total > skillLimits.archiveBytes)
          throw new AppError('VALIDATION', 'ZIP 展开后最多 20 MB，单个文件最多 4 MB。');
        chunks.push(chunk);
        if (final) {
          const value = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) {
            value.set(part, offset);
            offset += part.length;
          }
          files[path] = value;
          pending--;
        }
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    // Limit inflater output per input chunk even if the ZIP size headers are forged.
    for (let offset = 0; offset < bytes.length; offset += 4096)
      unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
    if (pending || !entries) throw new AppError('VALIDATION', 'ZIP 不完整或未包含文件。');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION', '无法读取 ZIP，可能已损坏、加密或格式不支持。');
  }
  if (Object.values(files).reduce((sum, value) => sum + value.length, 0) > skillLimits.archiveBytes)
    throw new AppError('VALIDATION', 'ZIP 展开后超过 20 MB。');
  const roots = Object.keys(files)
    .filter(path => path === 'SKILL.md' || path.endsWith('/SKILL.md'))
    .map(path => path.slice(0, -'SKILL.md'.length));
  if (!roots.length) throw new AppError('VALIDATION', 'ZIP 中未找到 SKILL.md。');
  if (roots.some(root => roots.some(other => root !== other && root.startsWith(other))))
    throw new AppError('VALIDATION', 'ZIP 中技能目录不能互相嵌套。');
  const bundles = roots.map(root =>
    validateBundle(
      Object.entries(files)
        .filter(([path]) => path.startsWith(root))
        .map(([path, value]) => ({ path: path.slice(root.length), bytes: value })),
      root ? root.split('/').at(-2) : undefined,
    ),
  );
  if (skipped) bundles.forEach(bundle => bundle.warnings.push('ZIP 的隐藏文件或依赖目录未导入。'));
  if (new Set(bundles.map(bundle => bundle.name)).size !== bundles.length)
    throw new AppError('VALIDATION', 'ZIP 中存在同名技能，请分开导入。');
  return bundles;
}
export const exportSkillPackage = (bundles: SkillBundle[]) =>
  zipSync(
    Object.fromEntries(
      bundles.flatMap(bundle =>
        bundle.files.map(file => [bundle.name + '/' + file.path, file.bytes]),
      ),
    ),
    { level: 6 },
  );
