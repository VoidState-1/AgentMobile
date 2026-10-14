import { AppError } from '@/core/errors';

export interface RequestPermit { release(): void }
interface Request {
  groupId: string; connectionId: string; signal?: AbortSignal;
  resolve(permit: RequestPermit): void; reject(error: AppError): void; abort?: () => void;
}

/** Limits in-flight requests, not living Agent instances or waiting parents. */
export class RequestScheduler {
  private active = 0;
  private readonly connections = new Map<string, number>();
  private readonly queues = new Map<string, Request[]>();
  private lastGroup?: string;
  private suspended = false;
  constructor(private readonly globalLimit = 2, private readonly connectionLimit = 2) {
    if (!Number.isInteger(globalLimit) || globalLimit < 1 || !Number.isInteger(connectionLimit) || connectionLimit < 1) throw new AppError('VALIDATION', '请求并发上限必须为正整数。');
  }
  acquire(groupId: string, connectionId: string, signal?: AbortSignal): Promise<RequestPermit> {
    if (signal?.aborted) return Promise.reject(new AppError('CANCELLED', '任务已取消'));
    return new Promise((resolve, reject) => {
      const request: Request = { groupId, connectionId, signal, resolve, reject };
      request.abort = () => {
        const queue = this.queues.get(groupId); const index = queue?.indexOf(request) ?? -1;
        if (index >= 0) queue!.splice(index, 1);
        if (!queue?.length) this.queues.delete(groupId);
        signal?.removeEventListener('abort', request.abort!); reject(new AppError('CANCELLED', '任务已取消')); this.pump();
      };
      signal?.addEventListener('abort', request.abort, { once: true });
      const queue = this.queues.get(groupId) ?? []; queue.push(request); this.queues.set(groupId, queue); this.pump();
    });
  }
  setForeground(foreground: boolean) { this.suspended = !foreground; if (foreground) this.pump(); }
  getSnapshot() { return { active: this.active, queued: [...this.queues.values()].reduce((sum, queue) => sum + queue.length, 0), suspended: this.suspended }; }
  private pump() {
    if (this.suspended) return;
    while (this.active < this.globalLimit) {
      const groups = [...this.queues.keys()]; if (!groups.length) return;
      const previous = groups.indexOf(this.lastGroup ?? ''); const ordered = previous < 0 ? groups : [...groups.slice(previous + 1), ...groups.slice(0, previous + 1)];
      let selected: Request | undefined;
      for (const group of ordered) {
        const queue = this.queues.get(group)!;
        const index = queue.findIndex((request) => (this.connections.get(request.connectionId) ?? 0) < this.connectionLimit);
        if (index < 0) continue;
        [selected] = queue.splice(index, 1); if (!queue.length) this.queues.delete(group); break;
      }
      if (!selected) return;
      const request = selected; request.signal?.removeEventListener('abort', request.abort!);
      this.lastGroup = request.groupId; this.active++; this.connections.set(request.connectionId, 1 + (this.connections.get(request.connectionId) ?? 0));
      let closed = false;
      request.resolve({ release: () => {
        if (closed) return; closed = true; this.active--;
        const count = (this.connections.get(request.connectionId) ?? 1) - 1;
        if (count) this.connections.set(request.connectionId, count); else this.connections.delete(request.connectionId);
        this.pump();
      } });
    }
  }
}
