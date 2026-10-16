import { expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import { PiEngineAdapter } from '../src/adapters/agent/pi-engine';
import { fixtureTransport } from './fixture-transport';
import { RequestScheduler, type RequestPermit } from '../src/application/runs/request-scheduler';
import { defineTool, result } from '../src/application/tools/common';

it('Pi 在工具等待前释放模型请求槽，正常结束和传输失败都不会泄漏槽', async () => {
  const scheduler = new RequestScheduler(1, 1);
  let permit: RequestPermit | undefined;
  const entered = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const transport = fixtureTransport(round =>
    round === 1 ? { calls: [{ name: 'list_files', arguments: {} }] } : { text: 'done' },
  );
  const tools = [
    defineTool({
      effect: 'read',
      name: 'list_files',
      label: 'list',
      description: 'list',
      parameters: Type.Object({}),
      async execute() {
        expect(scheduler.getSnapshot().active).toBe(0);
        entered.resolve();
        await waiting.promise;
        return result([]);
      },
    }),
  ];
  const controls = {
    beforeRequest: async (signal?: AbortSignal) => {
      permit = await scheduler.acquire('root', 'provider', signal);
    },
    afterRequest: () => {
      permit?.release();
      permit = undefined;
    },
  };
  const session = new PiEngineAdapter(transport).create(
    { prompt: 'test', history: [], tools, systemPrompt: '', reasoning: false },
    () => {},
    controls,
  );
  const execution = session.execute();
  await entered.promise;
  const other = await scheduler.acquire('other', 'provider');
  other.release();
  waiting.resolve();
  await execution;
  expect(scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 0 });
  const failing = new PiEngineAdapter({
    model: transport.model,
    streamFn: () => {
      throw new Error('transport failed');
    },
  }).create(
    { prompt: 'test', history: [], tools: [], systemPrompt: '', reasoning: false },
    () => {},
    controls,
  );
  await failing.execute().catch(() => {});
  expect(scheduler.getSnapshot().active).toBe(0);
});

it('取消尚在请求池排队的 Pi 实例会移除请求，不影响正在使用槽的其他运行', async () => {
  const scheduler = new RequestScheduler(1, 1);
  const held = await scheduler.acquire('other', 'provider');
  let permit: RequestPermit | undefined;
  const session = new PiEngineAdapter(fixtureTransport(() => ({ text: 'done' }))).create(
    { prompt: 'test', history: [], tools: [], systemPrompt: '', reasoning: false },
    () => {},
    {
      beforeRequest: async signal => {
        permit = await scheduler.acquire('root', 'provider', signal);
      },
      afterRequest: () => {
        permit?.release();
        permit = undefined;
      },
    },
  );
  const done = session.execute();
  await vi.waitFor(() => expect(scheduler.getSnapshot().queued).toBe(1));
  session.cancel();
  await done.catch(() => {});
  expect(scheduler.getSnapshot()).toMatchObject({ active: 1, queued: 0 });
  held.release();
  expect(scheduler.getSnapshot().active).toBe(0);
});
