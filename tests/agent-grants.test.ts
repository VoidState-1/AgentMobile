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
import { workspaceTools } from '../src/application/tools/workspace';
import { snapshotTools } from '../src/application/tools/snapshot';

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

it('文件工具始终绑定原项目，伪造项目参数和受保护路径不能扩大权限', async () => {
  const storage = await testStorage();
  const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
  const runId = randomUUID();
  try {
    const a = await workspace.create('授权项目');
    const b = await workspace.create('其他项目');
    const path = 'documents/notes.md';
    const original = await workspace.readText(b.id, path);
    workspace.claim(a.id, runId);
    const tools = workspaceTools({
      workspace,
      projectId: a.id,
      runId,
      baseline: await workspace.taskBaseline(a.id, runId),
      task: {
        id: runId,
        projectId: a.id,
        conversationId: 'fixture',
        state: 'running',
        prompt: '修改当前项目',
        response: '',
        createdAt: new Date().toISOString(),
      },
      codec: contentCodec,
      settings: { imageInput: false },
      round: () => 1,
    });
    const write = tools.find(tool => tool.name === 'write_text')!;
    for (const target of [
      '../outside.txt',
      '/data/private.txt',
      '.git/config',
      'folder/.GIT/HEAD',
    ]) {
      const result = await write.execute('blocked-' + target, {
        path: target,
        text: 'forbidden',
        expectedRevision: null,
        projectId: b.id,
      });
      expect(result.isError).toBe(true);
    }
    // Deliberately bypass the model schema too: the callback itself cannot switch projects.
    const result = await write.execute('bound', {
      path,
      text: '当前项目的新内容',
      expectedRevision: original.revision,
      projectId: b.id,
    });
    expect(result.isError).not.toBe(true);
    expect((await workspace.readText(a.id, path)).text).toBe('当前项目的新内容');
    expect(await workspace.readText(b.id, path)).toEqual(original);
  } finally {
    for (const project of await workspace.projects()) workspace.release(project.id, runId);
    await storage.cleanup();
  }
});

it('快照读取与搜索只覆盖显式路径，额外快照和项目参数不能切换来源', async () => {
  const storage = await testStorage();
  try {
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('只读范围');
    await workspace.writeText(
      project.id,
      'private.txt',
      contentCodec.encodeText('hidden-secret'),
      null,
    );
    const snapshot = (await workspace.taskBaseline(project.id, 'fixture')).working;
    const tools = await snapshotTools(
      workspace.git,
      contentCodec,
      project.id,
      snapshot,
      ['documents/notes.md'],
      false,
    );
    const read = tools.find(tool => tool.name === 'read_text')!;
    for (const path of ['private.txt', '.git/config', '../private.txt'])
      expect((await read.execute('blocked', { path, snapshot, projectId: 'forged' })).isError).toBe(
        true,
      );
    const search = await tools
      .find(tool => tool.name === 'search_text')!
      .execute('search', {
        query: 'hidden-secret',
      });
    expect(search.content).toEqual([
      { type: 'text', text: JSON.stringify({ matches: [], limitReached: false }) },
    ]);
    expect(tools.some(tool => tool.effect !== 'read')).toBe(false);
  } finally {
    await storage.cleanup();
  }
});
