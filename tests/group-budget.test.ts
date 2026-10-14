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
