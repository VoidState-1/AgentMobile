import { expect, it } from 'vitest';
import { RequestScheduler } from '../src/application/runs/request-scheduler';

it('请求并发和连接上限独立限制；释放请求而非父运行，子任务可以取得槽', async () => {
  const scheduler = new RequestScheduler(2, 1);
  const parent = await scheduler.acquire('group', 'model-a');
  const other = await scheduler.acquire('other', 'model-b');
  let started = false;
  const child = scheduler.acquire('group', 'model-a').then(permit => {
    started = true;
    return permit;
  });
  expect(scheduler.getSnapshot()).toMatchObject({ active: 2, queued: 1 });
  expect(started).toBe(false);
  parent.release();
  const permit = await child;
  expect(started).toBe(true);
  expect(scheduler.getSnapshot().active).toBe(2);
  permit.release();
  other.release();
  parent.release();
  expect(scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 0 });
});

it('排队在任务组间轮转，连接拥堵不会阻止其他连接，取消不会泄漏槽', async () => {
  const scheduler = new RequestScheduler(1, 1);
  const active = await scheduler.acquire('A', 'model');
  const order: string[] = [];
  const a = scheduler.acquire('A', 'model').then(permit => {
    order.push('A');
    return permit;
  });
  const b = scheduler.acquire('B', 'model').then(permit => {
    order.push('B');
    return permit;
  });
  const cancel = new AbortController();
  const cancelled = scheduler.acquire('C', 'other', cancel.signal);
  cancel.abort();
  await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
  active.release();
  const permitB = await b;
  expect(order).toEqual(['B']);
  permitB.release();
  const permitA = await a;
  permitA.release();
  expect(order).toEqual(['B', 'A']);
  expect(scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 0 });
});

it('切后台暂停新派发，已有请求可以收束；回到前台恢复队列', async () => {
  const scheduler = new RequestScheduler();
  const active = await scheduler.acquire('A', 'model');
  scheduler.setForeground(false);
  let started = false;
  const queued = scheduler.acquire('B', 'model').then(permit => {
    started = true;
    return permit;
  });
  active.release();
  expect(scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 1, suspended: true });
  expect(started).toBe(false);
  scheduler.setForeground(true);
  const permit = await queued;
  expect(started).toBe(true);
  permit.release();
});
