import { afterEach, expect, it } from 'vitest';
import { RunRepository } from '../src/application/runs/repository';
import type { RunRecord } from '../src/core/runs/records';
import type { ExecutionView } from '../src/core/runs/types';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const runFixture = (id: string, createdAt = '2026-10-14T00:00:00Z'): ExecutionView => ({
  id,
  projectId: 'project',
  conversationId: 'conversation',
  prompt: '当前目标',
  response: '当前结果',
  mode: 'demo',
  state: 'completed',
  baseCommit: 'head',
  createdAt,
});
const rootRun = (): RunRecord => ({
  ...runFixture('root'),
  conversationId: 'conversation',
  schemaVersion: 3,
  rootRunId: 'root',
  kind: 'root',
  depth: 0,
  state: 'running',
  agentDefinitionId: 'main',
  agentDefinitionRevision: 1,
  launchSnapshotRef: 'root',
});
async function fixture() {
  const f = await testStorage();
  cleanups.push(f.cleanup);
  return f;
}

it('子创建与回执同批提交，重复调用返回原子任务，参数变化或跨项目委派被拒绝', async () => {
  const f = await fixture();
  const repo = new RunRepository(f.metadata);
  const parent = rootRun();
  await repo.save(parent, { id: 'root' });
  const child: RunRecord = {
    ...parent,
    id: 'child',
    kind: 'child',
    parentRunId: 'root',
    depth: 1,
    state: 'queued',
    agentDefinitionId: 'reader',
    launchSnapshotRef: 'child',
  };
  const receipt = {
    id: 'root:call',
    parentRunId: 'root',
    childRunId: 'child',
    fingerprint: 'original',
  };
  const writeBusiness = f.metadata.writeBusiness;
  let fail = true;
  f.metadata.writeBusiness = async batch => {
    if (fail) {
      fail = false;
      throw new Error('模拟创建中断');
    }
    await writeBusiness(batch);
  };
  await expect(repo.createChild(receipt, child, { id: 'child' })).rejects.toThrow('创建中断');
  expect(await repo.get('child')).toBeUndefined();
  expect(await f.metadata.get('run-delegations', receipt.id)).toBeUndefined();
  expect(await repo.createChild(receipt, child, { id: 'child' })).toBe('child');
  expect(
    await repo.createChild(
      { ...receipt, childRunId: 'unused' },
      { ...child, id: 'unused', launchSnapshotRef: 'unused' },
      { id: 'unused' },
    ),
  ).toBe('child');
  expect((await repo.group('root')).map(run => run.id)).toEqual(['root', 'child']);
  expect((await repo.list('project')).runs.map(run => run.id)).toEqual(['root']);
  await expect(
    repo.createChild({ ...receipt, fingerprint: 'changed' }, child, { id: 'child' }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    repo.createChild(
      { ...receipt, id: 'other' },
      { ...child, id: 'outside', projectId: 'other' },
      { id: 'child' },
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION' });
});

it('摘要分页只读 header，固定序号高水位；新增、同时间和时钟回拨不改变后续页面', async () => {
  const f = await fixture();
  const repo = new RunRepository(f.metadata);
  for (let index = 0; index < 40; index++)
    await repo.save({
      ...rootRun(),
      id: 'run-' + index,
      rootRunId: 'run-' + index,
      launchSnapshotRef: 'run-' + index,
      createdAt: index === 39 ? '2000-01-01' : '2026-10-14',
      prompt: '目标 ' + index,
      response: '正文'.repeat(6000),
      state: 'completed',
    });
  const first = await repo.list('project', 'conversation', undefined, 10);
  expect(first.runs.map(run => run.id)).toEqual(
    Array.from({ length: 10 }, (_, index) => 'run-' + (39 - index)),
  );
  await repo.save({
    ...rootRun(),
    id: 'new',
    rootRunId: 'new',
    launchSnapshotRef: 'new',
    createdAt: '1990-01-01',
  });
  f.metadata.runInput = async () => {
    throw new Error('列表不能读取输入');
  };
  f.metadata.runResult = async () => {
    throw new Error('列表不能读取结果');
  };
  f.metadata.get = async () => {
    throw new Error('列表不能读取 trace/launch/索引数组');
  };
  const second = await repo.list('project', 'conversation', first.cursor, 10);
  expect(second.runs.map(run => run.id)).toEqual(
    Array.from({ length: 10 }, (_, index) => 'run-' + (29 - index)),
  );
  expect(second.runs.every(run => run.responsePreview.length <= 1200 && !('response' in run))).toBe(
    true,
  );
  await expect(repo.list('project', 'other-conversation', first.cursor)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  const other = await fixture();
  const rebuilt = new RunRepository(other.metadata);
  await expect(rebuilt.list('project', 'conversation', first.cursor)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
});

it('准入失败时运行/正文/序号/草稿回执一起回滚，重试后身份与输入保持不变', async () => {
  const f = await fixture();
  const repo = new RunRepository(f.metadata);
  const write = f.metadata.writeBusiness;
  f.metadata.writeBusiness = async () => {
    throw new Error('admission failed');
  };
  const run = { ...rootRun(), draftRevision: 3 };
  await expect(repo.save(run)).rejects.toThrow('admission failed');
  expect(await f.metadata.run(run.id)).toBeUndefined();
  expect(await f.metadata.runInput(run.id)).toBeUndefined();
  expect(await repo.acceptedDraft('project', 'conversation', 3)).toBe(false);
  f.metadata.writeBusiness = write;
  await repo.save(run);
  expect((await f.metadata.run(run.id))?.admissionSequence).toBe(1);
  expect(await repo.acceptedDraft('project', 'conversation', 3)).toBe(true);
  await expect(repo.save({ ...run, prompt: '替换冻结目标' })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  await expect(repo.save({ ...run, conversationId: 'another' })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
});

it('公共详情只读当前 header/input/result，不加载冻结供应商/工具或 opaque 历史', async () => {
  const f = await fixture();
  const repo = new RunRepository(f.metadata);
  const run = rootRun();
  await repo.save(run);
  f.metadata.get = async () => {
    throw new Error('详情不得读取 launch/旧 KV 历史');
  };
  f.metadata.traceNodes = async () => {
    throw new Error('详情不得递归加载轨迹');
  };
  f.metadata.transcriptFrames = async () => {
    throw new Error('详情不得读取 opaque provider 消息');
  };
  expect(await repo.getDetail(run.id)).toMatchObject({
    id: run.id,
    prompt: run.prompt,
    response: run.response,
  });
});
