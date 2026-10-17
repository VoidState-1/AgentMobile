import { AppError } from '@/core/errors';
import { Type } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import type { RunToolsContext } from './context';
import { defineTool, assertRunning, result, textLimit, revision } from './common';
import { isImage } from '@/core/workspace/path';
import { fileReadTools, scopedFileReader } from './file-read';
import { editTextDescription, editTextParameters, textEditResult } from './text-edit';

export function workspaceTools(context: RunToolsContext): ControlledTool[] {
  const { workspace, projectId, runId, codec, settings } = context;
  const reader = scopedFileReader(
    'live:' + projectId,
    async () => {
      const files = await workspace.files(projectId);
      return {
        files,
        version: await workspace.git.revision(
          codec.encodeText(JSON.stringify(files.map(file => [file.path, file.revision]))),
        ),
      };
    },
    path => workspace.read(projectId, path),
  );
  return [
    ...fileReadTools(reader, codec, settings.imageInput),

    defineTool({
      effect: 'workspace-write',
      name: 'edit_text',
      label: '精确修改文字',
      description: editTextDescription,
      parameters: editTextParameters,
      executionMode: 'sequential',
      execute: async (callId, args, signal) => {
        assertRunning(signal);
        const outcome = await workspace.editText(
          projectId,
          args.path,
          args.edits,
          args.expectedRevision,
          {
            owner: runId,
            operationId: runId + '-' + context.round() + '-' + callId,
          },
        );
        return textEditResult(args.path, outcome);
      },
    }),
    defineTool({
      effect: 'workspace-write',
      name: 'write_text',
      label: '写入全文',
      description:
        '新建或整体重写 UTF-8 文本，包括代码、配置及无扩展名文件，不执行代码。局部修改优先使用 edit_text，不能因精确替换失败而自动覆盖全文。整体重写必须读取完整原文并使用当前修订号；新建使用 null。',
      parameters: Type.Object(
        {
          path: Type.String({ maxLength: 220 }),
          text: Type.String({ maxLength: textLimit }),
          expectedRevision: revision,
        },
        { additionalProperties: false },
      ),
      executionMode: 'sequential',
      execute: async (callId, args, signal) => {
        assertRunning(signal);
        const path = String(args.path);
        if (isImage(path)) throw new AppError('VALIDATION', '文字工具不能写入图片文件。');
        await workspace.write(
          projectId,
          path,
          codec.encodeText(String(args.text)),
          args.expectedRevision as string | null,
          {
            owner: runId,
            operationId: runId + '-' + context.round() + '-' + callId,
            message: 'Agent 修改 ' + path,
          },
        );
        return result({
          path,
          saved: true,
          revision: (await workspace.readText(projectId, path)).revision,
        });
      },
    }),
    defineTool({
      effect: 'workspace-write',
      name: 'delete_file',
      label: '删除文件',
      description: '删除指定文件；必须使用当前修订号。只修改工作区，不自动提交。',
      parameters: Type.Object(
        { path: Type.String({ maxLength: 220 }), expectedRevision: Type.String() },
        { additionalProperties: false },
      ),
      executionMode: 'sequential',
      execute: async (_, args, signal) => {
        assertRunning(signal);
        await workspace.remove(projectId, String(args.path), String(args.expectedRevision), runId);
        return result({ path: args.path, saved: true });
      },
    }),
    defineTool({
      effect: 'workspace-write',
      name: 'move_file',
      label: '移动文件',
      description: '重命名或移动文件到尚不存在的相对路径。',
      parameters: Type.Object(
        { from: Type.String(), to: Type.String(), expectedRevision: Type.String() },
        { additionalProperties: false },
      ),
      executionMode: 'sequential',
      execute: async (_, args, signal) => {
        assertRunning(signal);
        await workspace.move(
          projectId,
          String(args.from),
          String(args.to),
          String(args.expectedRevision),
          runId,
        );
        return result({ from: args.from, to: args.to, saved: true });
      },
    }),
  ];
}
