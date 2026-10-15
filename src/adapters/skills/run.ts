import { AppError } from '@/core/errors';
import { Buffer } from 'buffer';
import type { SkillRepository, SkillSummary } from '@/core/skills/types';
import { skillLimits, skillPath } from '@/core/skills/rules';
import { decodeSkillText } from './package';
import { mimeFor } from '@/core/workspace/path';
import { validateImage } from '@/core/workspace/image';

export function createSkillRun(repository: SkillRepository, capture: { skills: readonly SkillSummary[]; explicit: readonly string[] }) {
  const loaded = new Set<string>(); let characters = 0;
  const find = (name: string) => { const skill = capture.skills.find((skill) => skill.name === name); if (!skill) throw new AppError('VALIDATION', '技能未在此任务启用。'); return skill; };
  return {
    snapshots: capture.skills, explicit: capture.explicit,
    async load(name: string) {
      const skill = find(name);
      if (loaded.has(name)) return { name, revision: skill.revision, alreadyLoaded: true, message: '技能说明已在本次任务上下文中，无需重复加载。' };
      const source = decodeSkillText(await repository.read(skill.commit, name, 'SKILL.md'));
      if (characters + source.length > skillLimits.activationCharacters) throw new AppError('VALIDATION', '技能正文累计超过 120,000 字符，请缩小本次任务的技能范围。');
      characters += source.length; loaded.add(name);
      return { name, revision: skill.revision, instructions: source, resources: skill.files.filter((file) => file.path !== 'SKILL.md').map(({ path, kind }) => ({ path, kind })),
        scope: '相对路径以此技能为根；read_skill_resource 只读。脚本不可执行，allowed-tools 不增加宿主或 MCP 权限。' };
    },
    async read(name: string, input: string, offset: number, length: number, allowImages: boolean, signal?: AbortSignal) {
      if (signal?.aborted) throw new AppError('VALIDATION', '技能读取已取消。');
      const skill = find(name); const path = skillPath(input);
      if (!loaded.has(name)) throw new AppError('VALIDATION', '技能尚未加载，请先调用 load_skill。');
      const file = skill.files.find((file) => file.path === path); if (!file) throw new AppError('VALIDATION', '技能资源不存在。');
      if (file.kind === 'binary') throw new AppError('VALIDATION', '技能二进制资源暂不支持交给模型；可从管理页导出。');
      if (path === 'SKILL.md') return { content: [{ type: 'text' as const, text: JSON.stringify({ alreadyLoaded: true, message: 'SKILL.md 已加载，请使用上下文中的完整说明。' }) }], details: {} };
      if (file.kind === 'image' && !allowImages) throw new AppError('VALIDATION', '技能图片需要模型开启图片输入。');
      const bytes = await repository.read(skill.commit, name, path);
      if (signal?.aborted) throw new AppError('VALIDATION', '技能读取已取消。');
      if (file.kind === 'image') {
        if (bytes.length > skillLimits.imageBytes) throw new AppError('VALIDATION', '技能图片超过 4 MB。'); validateImage(path, bytes);
        return { content: [{ type: 'text' as const, text: '技能 ' + name + ' 的资源：' + path }, { type: 'image' as const, data: Buffer.from(bytes).toString('base64'), mimeType: mimeFor(path) }], details: {} };
      }
      if (bytes.length > skillLimits.textBytes) throw new AppError('VALIDATION', '技能资源超过 1 MB。');
      const text = decodeSkillText(bytes); const end = Math.min(text.length, offset + length);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ name, path, text: text.slice(offset, end), offset, totalCharacters: text.length, truncated: end < text.length, nextOffset: end < text.length ? end : null }) }], details: {} };
    },
  };
}
