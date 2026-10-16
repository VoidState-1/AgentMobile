import { testNotifications } from './notifications';
import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { expect, it } from 'vitest';
import { authorizedTools, builtinAgents } from '../src/core/agent/definitions';
import type { ControlledTool } from '../src/core/agent/tools';
import { defineTool } from '../src/application/tools/common';
import { startRun } from '../src/application/runs/controller';
import { RunStopController } from '../src/core/runs/termination';
import { defaultAgentSettings } from '../src/core/agent/settings';
import { createWorkspace } from '../src/bootstrap/workspace';
import { contentCodec } from '../src/adapters/storage/codec';
import { testStorage } from './storage';

it('每个工具必须显式声明 effect，mayDelegate 不因 effect 列表而被绕过', () => {
  const base = {
    name: 'tool',
    label: '测试',
    description: '',
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
  };
  // @ts-expect-error effect is mandatory at the tool-definition boundary.
  defineTool(base);
  const tools: ControlledTool[] = [
    { ...base, effect: 'read' },
    { ...base, name: 'spawn_agent', effect: 'delegate' },
  ];
  expect(
    authorizedTools({ ...builtinAgents[0], mayDelegate: false }, tools).map(tool => tool.name),
  ).toEqual(['tool']);
  // @ts-expect-error Deliberately malformed runtime input also fails closed.
  expect(() => authorizedTools(builtinAgents[0], [base])).toThrow('显式声明');
});

it('根运行只构建冻结角色允许的工具，伪造未授权派发会失败', async () => {
  const storage = await testStorage();
  try {
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('只读授权');
    const runId = randomUUID();
    const stop = new RunStopController(runId);
    let built: string[] = [];
    const started = await startRun(
      workspace,
      {
        runId,
        projectId: project.id,
        conversationId: 'conversation',
        prompt: '阅读资料',

        imageInput: false,
        agent: { ...builtinAgents[0], allowedEffects: ['read'], mayDelegate: false },
        agentSettings: defaultAgentSettings(),
        contextTokens: 16000,
        outputTokens: 4000,
      },
      {
        create(input, _receive, controls) {
          built = input.tools.map(tool => tool.name);
          return {
            round: 0,
            cancel() {},
            async execute() {
              expect(
                await controls.beforeTool?.({
                  callId: 'unauthorized',
                  tool: 'write_text',
                  args: {},
                  round: 1,
                }),
              ).toMatchObject({ block: true, terminate: true });
              return { stopReason: 'stop' };
            },
          };
        },
      },
      {
        codec: contentCodec,
        notifications: testNotifications,
        execution: {
          stop,
          admission: {
            checkStop() {},
            timeout() {},
            remainingMs: () => 60_000,
            acquire: async () => ({ release() {} }),
            reserve: async () => {},
            fail: error => {
              stop.fail(error);
            },
          },
          persistence: { history: async () => [], saveCheckpoint: async () => {} },
        },
      },
      () => {},
    );
    expect((await started.done).state).toBe('failed');
    expect(built).toContain('read_text');
    expect(built).not.toEqual(expect.arrayContaining(['write_text', 'git_commit', 'spawn_agent']));
    expect(built.some(name => /write|delete|move|stage|commit|spawn/.test(name))).toBe(false);
  } finally {
    await storage.cleanup();
  }
});
