import { afterEach, expect, it } from 'vitest';
import { GroupBudget } from '../src/application/runs/budget';
import { defaultAgentLimits } from '../src/core/agent/settings';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() { const f = await testStorage(); cleanups.push(f.cleanup); return f; }

it('并发子请求共享总额度且保留两次父汇总请求，不因并发突破预算', async () => {
  const f = await fixture(); const budget = new GroupBudget(f.metadata, 'root', { ...defaultAgentLimits, maxModelRounds: 5, maxToolCalls: 3 });
  await budget.start();
  for (let index = 0; index < 3; index++) await budget.allocate('child-' + index, { requests: 1, tools: 1 }, (group) => f.metadata.put('run-groups', 'root', group));
  const children = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => budget.reserve('child-' + index, 'requests', true)));
  expect(children.filter((item) => item.status === 'fulfilled')).toHaveLength(3);
  expect(budget.error).toBeUndefined(); await budget.reserve('root', 'requests'); await budget.reserve('root', 'requests');
  await expect(budget.reserve('root', 'requests')).rejects.toMatchObject({ code: 'LIMIT' });
  expect(budget.snapshot().requests).toBe(5); expect((await f.metadata.get<any>('run-groups', 'root')).requests).toBe(5);
});

it('额度预留保存失败不派发；截止时间从实际启动算，重读不会延长', async () => {
  const f = await fixture(); let now = Date.now(); const budget = new GroupBudget(f.metadata, 'root', { ...defaultAgentLimits }, () => now);
  const first = await budget.start(); const put = f.metadata.put;
  f.metadata.put = async (bucket, id, value) => { if (bucket === 'run-groups') throw new Error('disk failed'); await put(bucket, id, value); };
  await expect(budget.reserve('root', 'tools')).rejects.toMatchObject({ code: 'STORAGE' }); expect(budget.snapshot().tools).toBe(0);
  f.metadata.put = put; now += defaultAgentLimits.maxRuntimeMs;
  const restarted = new GroupBudget(f.metadata, 'root', { ...defaultAgentLimits }, () => now); expect((await restarted.start()).deadlineAt).toBe(first.deadlineAt);
  await expect(restarted.reserve('root', 'requests')).rejects.toMatchObject({ code: 'LIMIT' }); expect(restarted.snapshot().requests).toBe(0);
});

it('子预算分配不得超出整组剩余，单个子上限耗尽仍允许父任务使用保留额度', async () => {
  const f = await fixture(); const budget = new GroupBudget(f.metadata, 'root', { ...defaultAgentLimits, maxModelRounds: 5, maxToolCalls: 5 }); await budget.start();
  await budget.reserve('root', 'requests'); await budget.allocate('child', { requests: 2, tools: 2 }, (group) => f.metadata.put('run-groups', 'root', group));
  await expect(budget.allocate('overflow', { requests: 1, tools: 1 }, async () => {})).rejects.toMatchObject({ code: 'LIMIT' });
  await budget.reserve('child', 'requests', true); await budget.reserve('child', 'requests', true);
  await expect(budget.reserve('child', 'requests', true)).rejects.toMatchObject({ code: 'LIMIT' }); expect(budget.error).toBeUndefined();
  await budget.reserve('root', 'requests'); await budget.reserve('root', 'requests'); expect(budget.snapshot().requests).toBe(5);
  await budget.releaseAllocation('child'); expect(budget.snapshot().allocations).toEqual({});
});
