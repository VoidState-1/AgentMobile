import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { testStorage } from './storage';
import { RunRepository } from '../src/application/runs/repository';
import { builtinAgents } from '../src/core/agent/definitions';
import { defaultAgentSettings } from '../src/core/agent/settings';
import type { RunRecord } from '../src/core/runs/records';
import type { ExecutionView } from '../src/core/runs/types';
import type { ContentTrace } from '../src/core/trace';

async function fixture() {
  const storage = await testStorage();
  const repository = new RunRepository(storage.metadata);
  const id = randomUUID();
  const run: RunRecord = {
    schemaVersion: 3,
    id,
    projectId: 'project',
    conversationId: 'conversation',
    rootRunId: id,
    kind: 'root',
    depth: 0,
    agentDefinitionId: 'main',
    agentDefinitionRevision: 1,
    launchSnapshotRef: id,
    state: 'running',
    mode: 'demo',
    prompt: 'test',
    response: '',
    createdAt: new Date().toISOString(),
  };
  await repository.save(run, { id, agent: builtinAgents[0], settings: defaultAgentSettings() });
  const node: ContentTrace = {
    id: id + ':text',
    runId: id,
    rootRunId: id,
    runSequence: 1,
    groupSequence: 1,
    round: 1,
    contentIndex: 0,
    kind: 'text',
    text: '',
    startedAt: run.createdAt,
    state: 'running',
  };
  return { ...storage, repository, run, node };
}

it('持续刷新只追加新增文本块，重复刷新不改旧块；摘要分页不读取正文', async () => {
  const f = await fixture();
  try {
    f.node.text = '第一段';
    await f.repository.saveCheckpoint({ ...f.run, trace: [f.node] }, [f.node], [], false);
    const first = await f.metadata.traceChunks(f.node.id, -1, 100);
    f.node.text += '第二段';
    await f.repository.saveCheckpoint({ ...f.run, trace: [f.node] }, [f.node], [], false);
    const next = await f.metadata.traceChunks(f.node.id, -1, 100);
    expect(next[0]).toEqual(first[0]);
    expect(next[1]).toMatchObject({ ordinal: 1, offset: 3, text: '第二段' });
    await f.repository.saveCheckpoint({ ...f.run, trace: [f.node] }, [f.node], [], false);
    expect(await f.metadata.traceChunks(f.node.id, -1, 100)).toEqual(next);
    f.metadata.traceChunks = async () => {
      throw new Error('summary body read');
    };
    f.metadata.traceTextRange = async () => {
      throw new Error('summary body read');
    };
    expect((await f.repository.listTrace(f.run.id)).nodes).toMatchObject([
      { textCharacters: 6, textChunks: 2 },
    ]);
  } finally {
    await f.cleanup();
  }
});

it('UTF-16 文本分页不切开代理对，跳过已读块，并拒绝中间偏移', async () => {
  const f = await fixture();
  try {
    f.node.text = 'A'.repeat(11999) + '😀' + 'B'.repeat(20000);
    await f.repository.saveCheckpoint({ ...f.run, trace: [f.node] }, [f.node], [], false);
    const first = await f.repository.readTraceText(f.node.id);
    expect(first.text).toHaveLength(11999);
    const second = await f.repository.readTraceText(f.node.id, first.nextOffset);
    expect(second.text.startsWith('😀')).toBe(true);
    await expect(f.repository.readTraceText(f.node.id, 12000)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(first.text + second.text).toBe(f.node.text.slice(0, 23999));
  } finally {
    await f.cleanup();
  }
});

it('终态与最后节点/文本/消息帧同批保存，旧进度不能复活；同键不同帧被拒绝', async () => {
  const f = await fixture();
  try {
    f.node.text = '已完成';
    f.node.state = 'completed';
    f.node.endedAt = new Date().toISOString();
    const frame = {
      runId: f.run.id,
      ordinal: 0,
      schemaVersion: 1 as const,
      payload: { role: 'assistant', content: '已完成' },
    };
    await f.repository.saveCheckpoint(
      { ...f.run, state: 'completed', response: f.node.text, trace: [f.node] },
      [f.node],
      [frame],
      true,
    );
    await f.repository.saveCheckpoint(
      { ...f.run, state: 'running' } as ExecutionView,
      [{ ...f.node, state: 'running' }],
      [],
      true,
    );
    expect((await f.repository.get(f.run.id))?.state).toBe('completed');
    expect((await f.metadata.traceNode(f.node.id))?.state).toBe('completed');
    expect(await f.repository.transcript(f.run.id)).toEqual([frame]);
    await expect(
      f.metadata.writeBusiness({ trace: { frames: [{ ...frame, payload: { changed: true } }] } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  } finally {
    await f.cleanup();
  }
});
