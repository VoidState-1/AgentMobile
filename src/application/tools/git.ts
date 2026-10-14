import { Type } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import type { RunToolsContext } from './context';
import { defineTool, assertRunning, result, textLimit, revision } from './common';
import { isImage } from '@/core/workspace/path';

export function gitTools(context: RunToolsContext): ControlledTool[] {
  const { workspace, projectId, runId, baseline } = context;
  return [
defineTool({ name: 'git_status', label: '查看 Git 状态', description: '查看 HEAD、暂存区指纹及文件的已暂存/未暂存状态和修订号。保存文件不等于提交。',
        parameters: Type.Object({}, { additionalProperties: false }),
        execute: async (_, __, signal) => { assertRunning(signal); return result(await workspace.status(projectId)); } }),
defineTool({ name: 'git_diff', label: '查看 Git 差异', description: '查看 staged（HEAD 对比暂存区）或 unstaged（暂存区对比工作区）差异。图片仅返回变化类型，使用 inspect_image 查看图片。',
        parameters: Type.Object({ area: Type.Union([Type.Literal('staged'), Type.Literal('unstaged')]), paths: Type.Optional(Type.Array(Type.String({ maxLength: 220 }), { minItems: 1, maxItems: 2000 })) }, { additionalProperties: false }),
        execute: async (_, args, signal) => {
          assertRunning(signal); const changes = await workspace.diff(projectId, args.area, args.paths); let remaining = textLimit;
          return result({ files: changes.slice(0, 200).map((file) => { const limit = Math.max(0, Math.min(12000, Math.floor(remaining / 2))); remaining -= limit * 2;
            return isImage(file.path) ? { path: file.path, kind: file.kind, image: true } : { ...file, before: file.before.slice(0, limit), after: file.after.slice(0, limit), truncated: file.before.length > limit || file.after.length > limit }; }), truncated: changes.length > 200 });
        } }),
defineTool({ name: 'git_stage', label: '暂存文件', description: '暂存本任务修改、且任务开始前干净的文件。使用 git_status 的 HEAD、indexRevision 和每个文件的 workingRevision（删除为 null）。不提交已有用户改动。',
        parameters: Type.Object({ paths: Type.Array(Type.String({ maxLength: 220 }), { minItems: 1, maxItems: 2000 }), expectedHead: Type.String({ maxLength: 80 }), indexRevision: Type.String({ maxLength: 80 }), revisions: Type.Record(Type.String(), revision) }, { additionalProperties: false }),
        executionMode: 'sequential', execute: async (_, args, signal) => { assertRunning(signal);
          await workspace.stage(projectId, args.paths, { head: args.expectedHead, indexRevision: args.indexRevision, revisions: args.revisions }, runId, baseline); return result(await workspace.status(projectId)); } }),
defineTool({ name: 'git_unstage', label: '取消暂存', description: '取消本任务文件的暂存，工作区内容不变。使用最新 git_status 指纹。',
        parameters: Type.Object({ paths: Type.Array(Type.String({ maxLength: 220 }), { minItems: 1, maxItems: 2000 }), expectedHead: Type.String({ maxLength: 80 }), indexRevision: Type.String({ maxLength: 80 }) }, { additionalProperties: false }),
        executionMode: 'sequential', execute: async (_, args, signal) => { assertRunning(signal);
          await workspace.unstage(projectId, args.paths, { head: args.expectedHead, indexRevision: args.indexRevision }, runId, baseline); return result(await workspace.status(projectId)); } }),
defineTool({ name: 'git_commit', label: '提交更改', description: '用户要求提交时，明确提交本任务已暂存文件。必须提供说明、选定 paths 和最新 git_status 指纹。提交暂存版本，不包括之后的编辑；保留其他已暂存文件。',
        parameters: Type.Object({ message: Type.String({ minLength: 1, maxLength: 4000 }), paths: Type.Array(Type.String({ maxLength: 220 }), { minItems: 1, maxItems: 2000 }), expectedHead: Type.String({ maxLength: 80 }), indexRevision: Type.String({ maxLength: 80 }) }, { additionalProperties: false }),
        executionMode: 'sequential', execute: async (_, args, signal) => { assertRunning(signal);
          return result({ commit: await workspace.commitStaged(projectId, args.message, { head: args.expectedHead, indexRevision: args.indexRevision }, args.paths, runId, baseline) }); } })
  ];
}
