import { Type } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import type { RunToolsContext } from './context';
import { defineTool, assertRunning, result } from './common';

export function skillsTools(context: RunToolsContext): ControlledTool[] {
  const { task, settings, skillRun } = context;
  return [
    ...(skillRun?.snapshots.length
      ? [
          defineTool({
            effect: 'read',
            name: 'load_skill',
            label: '加载技能',
            description:
              '按需加载已在本项目启用的 Agent Skill 完整说明和资源目录。重复加载不会重复注入。',
            parameters: Type.Object(
              { name: Type.Union(skillRun.snapshots.map(skill => Type.Literal(skill.name))) },
              { additionalProperties: false },
            ),
            execute: async (_, { name }, signal) => {
              assertRunning(signal);
              const loaded = await skillRun.load(String(name));
              if (!loaded.alreadyLoaded)
                task.skillActivations!.push({
                  name: String(name),
                  revision: loaded.revision,
                  source: 'agent',
                  at: new Date().toISOString(),
                });
              return result(loaded);
            },
          }),
          defineTool({
            effect: 'read',
            name: 'read_skill_resource',
            label: '读取技能资源',
            description:
              '只读已加载技能的相对资源路径。文本可分页，图片需模型开启图片输入。脚本只能阅读，不会执行。',
            parameters: Type.Object(
              {
                name: Type.Union(skillRun.snapshots.map(skill => Type.Literal(skill.name))),
                path: Type.String({ maxLength: 220 }),
                offset: Type.Optional(Type.Integer({ minimum: 0 })),
                length: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
              },
              { additionalProperties: false },
            ),
            execute: async (_, args, signal) => {
              assertRunning(signal);
              return skillRun.read(
                String(args.name),
                args.path,
                args.offset ?? 0,
                args.length ?? 12_000,
                settings.imageInput && settings.mode !== 'demo',
                signal,
              );
            },
          }),
        ]
      : []),
  ];
}
