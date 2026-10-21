import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunsApi } from '@/application/services';
import type { RunSummary } from '@/core/runs/queries';
import { clearRunViewCache, loadRunView } from '@/features/workbench/run-view-cache';

afterEach(clearRunViewCache);

const summary = (id: string, revision: number): RunSummary =>
  ({ id, revision, promptPreview: '任务', responsePreview: '', kind: 'root' }) as RunSummary;

function api() {
  return {
    getDetail: vi.fn(async id => ({
      id,
      projectId: 'project',
      conversationId: 'conversation',
      kind: 'root' as const,
      state: 'completed' as const,
      prompt: '任务',
      response: '完成',
      createdAt: '2026-10-21T00:00:00.000Z',
    })),
    listTrace: vi.fn(async () => ({ nodes: [] })),
    listChildren: vi.fn(async () => ({ runs: [] })),
  } as unknown as RunsApi & {
    getDetail: ReturnType<typeof vi.fn>;
    listTrace: ReturnType<typeof vi.fn>;
    listChildren: ReturnType<typeof vi.fn>;
  };
}

describe('运行详情展示缓存', () => {
  it('同一运行修订并发读取共享请求，返回公开详情、轨迹和子任务', async () => {
    const service = api();
    const row = summary('run-1', 3);
    const first = loadRunView(service, row);
    const second = loadRunView(service, row);
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({
      id: 'run-1',
      response: '完成',
      trace: [],
      children: [],
    });
    expect(service.getDetail).toHaveBeenCalledTimes(1);
    expect(service.listTrace).toHaveBeenCalledTimes(1);
    expect(service.listChildren).toHaveBeenCalledTimes(1);
  });

  it('修订变化生成新视图键，最旧项在容量外被淘汰', async () => {
    const service = api();
    await loadRunView(service, summary('run-1', 1));
    await loadRunView(service, summary('run-1', 2));
    for (let index = 0; index < 50; index++)
      await loadRunView(service, summary('run-' + (index + 2), 1));
    await loadRunView(service, summary('run-1', 1));
    expect(service.getDetail).toHaveBeenCalledTimes(53);
  });
});
