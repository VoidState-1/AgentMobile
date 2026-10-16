import { AppError } from '@/core/errors';
import { Type } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import type { RunToolsContext } from './context';
import { defineTool, assertRunning, result, textLimit, revision } from './common';
import { canAgentWriteText } from '@/core/workspace/path';
import { fileReadTools, scopedFileReader } from './file-read';

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
      name: 'write_text',
      label: '修改文字',
      description: '创建或修改 UTF-8 文本。修改必须使用读取时的修订号；创建使用 null。',
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
        if (!canAgentWriteText(path)) throw new AppError('VALIDATION', '只允许写入 .md 或 .txt');
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
