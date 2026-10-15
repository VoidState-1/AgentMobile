import { expect, it } from 'vitest';
import { SerialQueue } from '../src/core/serial-queue';

it('失败只返回给自身调用者，后续命令仍依序取得各自结果', async () => {
  const queue = new SerialQueue(); const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const failed = queue.run(async () => { order.push('first'); await held; throw new Error('first failed'); });
  const rejection = expect(failed).rejects.toThrow('first failed');
  const second = queue.run(async () => { order.push('second'); return 2; });
  const third = queue.run(async () => { order.push('third'); return 3; });
  await Promise.resolve(); expect(order).toEqual(['first']); release();
  await rejection; expect(await Promise.all([second, third])).toEqual([2, 3]);
  expect(order).toEqual(['first', 'second', 'third']);
});
