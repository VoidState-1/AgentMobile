import { Type } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import type { GitPort } from '@/core/git/contracts';
import type { ContentCodec } from '@/core/storage/codec';
import { safePath, isImage, mimeFor } from '@/core/workspace/path';
import { contentLimits } from '@/core/agent/settings';
import { AppError } from '@/core/errors';
import { assertRunning, defineTool, result, textLimit } from './common';

/** A snapshot and exact path grant; no live-workspace or mutation port exists. */
export async function snapshotTools(git: GitPort, codec: ContentCodec, projectId: string, snapshot: string, paths: readonly string[], allowImages: boolean): Promise<ControlledTool[]> {
  const grant = new Set(paths.map((path) => safePath(path)));
  const files = (await git.entries(projectId, snapshot)).filter((file) => grant.has(file.path) && file.path !== 'project.json');
  if (files.length !== grant.size) throw new AppError('VALIDATION', '子任务资料范围包含不存在或受保护的路径。');
  const read = async (input: string) => {
    const path = safePath(input); const file = files.find((file) => file.path === path);
    if (!file) throw new AppError('VALIDATION', '文件未在子任务授权范围中。');
    return { ...file, bytes: await git.readAt(projectId, snapshot, path) };
  };
  const text = async (path: string) => {
    const file = await read(path);
    if (isImage(file.path) || file.bytes.length > contentLimits.textFileBytes) throw new AppError('VALIDATION', '快照文件不是可读取的文本，或超过限制。');
    return { path: file.path, revision: file.revision, text: codec.decodeText(file.bytes) };
  };
  return [
    defineTool({ name: 'list_files', label: '浏览授权快照', description: '列出子任务授权的固定版本资料及修订号。', parameters: Type.Object({}, { additionalProperties: false }),
      execute: async (_, __, signal) => { assertRunning(signal); return result(files.map((file) => ({ ...file, snapshotRef: snapshot }))); } }),
    defineTool({ name: 'read_text', label: '读取快照文字', description: '只读取授权路径的固定版本；分段查看 truncated/nextOffset。',
      parameters: Type.Object({ path: Type.String({ maxLength: 220 }), offset: Type.Optional(Type.Integer({ minimum: 0 })), length: Type.Optional(Type.Integer({ minimum: 1, maximum: textLimit })) }, { additionalProperties: false }),
      execute: async (_, args, signal) => { assertRunning(signal); const file = await text(args.path); const offset = args.offset ?? 0; const end = Math.min(file.text.length, offset + (args.length ?? 12000));
        return result({ ...file, text: file.text.slice(offset, end), snapshotRef: snapshot, offset, totalCharacters: file.text.length, truncated: end < file.text.length, nextOffset: end < file.text.length ? end : null }); } }),
    defineTool({ name: 'search_text', label: '搜索快照文字', description: '仅搜索授权固定版本资料，最多 100 条。', parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
      execute: async (_, args, signal) => { const matches: { path: string; revision: string; line: number; excerpt: string }[] = [];
        for (const file of files) { assertRunning(signal); if (isImage(file.path)) continue; const document = await text(file.path);
          for (const [line, value] of document.text.split('\n').entries()) { const at = value.toLocaleLowerCase().indexOf(args.query.toLocaleLowerCase());
            if (at >= 0) matches.push({ path: file.path, revision: file.revision, line: line + 1, excerpt: value.slice(Math.max(0, at - 100), at + 250) });
            if (matches.length >= 100) return result({ matches, snapshotRef: snapshot, limitReached: true }); }
        } return result({ matches, snapshotRef: snapshot, limitReached: false }); } }),
    ...(allowImages ? [defineTool({ name: 'inspect_image', label: '查看快照图片', description: '读取授权固定版本图片。', parameters: Type.Object({ path: Type.String({ maxLength: 220 }) }, { additionalProperties: false }),
      execute: async (_, args, signal) => { assertRunning(signal); const file = await read(args.path);
        if (!isImage(file.path) || file.bytes.length > contentLimits.modelImageBytes) throw new AppError('VALIDATION', '快照图片无效或超过模型输入限制。');
        return { content: [{ type: 'text' as const, text: file.path + ' · ' + file.revision }, { type: 'image' as const, data: codec.encodeBase64(file.bytes), mimeType: mimeFor(file.path) }], details: {} }; } })] : []),
  ];
}
