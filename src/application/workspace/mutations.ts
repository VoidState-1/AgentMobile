import type { WorkspaceContext } from './context';
import type { Project } from '@/core/projects/types';
import type { Operation, WorkspaceChange } from '@/core/workspace/types';
import type { WorkspaceReader } from './reader';

/** The only owner of project queues, mutation journals and recovery. */
export class MutationCoordinator {
  readonly recoveryIssues: string[] = [];
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly owners = new Map<string, string>();
  private readonly blocked = new Set<string>();
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  constructor(private readonly context: WorkspaceContext, private readonly reader: WorkspaceReader) {}
  query<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(projectId) ?? Promise.resolve()).catch(() => {}).then(action);
    this.queues.set(projectId, next); return next;
  }
  subscribe = (listener: (change: WorkspaceChange) => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };

  notify(change: WorkspaceChange) {
    const value = Object.freeze({ ...change, paths: Object.freeze([...change.paths]) });
    // View failures must not turn a committed operation into a recovery issue.
    try { this.context.changed?.(); } catch { /* Legacy observer is isolated. */ }
    for (const listener of this.listeners) { try { listener(value); } catch { /* Observers do not own writes. */ } }
  }

  claim(projectId: string, owner: string) {
    if (this.owners.has(projectId)) throw new Error('工作区正在执行任务');
    if (this.blocked.has(projectId)) throw new Error('工作区需要修复，请保留本地数据');
    this.owners.set(projectId, owner);
  }

  release(projectId: string, owner: string) {
    if (this.owners.get(projectId) === owner) this.owners.delete(projectId);
  }

  needsRecovery(projectId: string) {
    return this.blocked.has(projectId);
  }

  serial<T>(projectId: string, owner: string | undefined, action: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(projectId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (this.blocked.has(projectId)) throw new Error('恢复未完成，工作区写入已禁用');
      const active = this.owners.get(projectId);
      if (active && active !== owner) throw new Error('请等待或取消当前任务后再修改文件');
      if (!await this.context.metadata.get<Project>('projects', projectId)) throw new Error('工作区不存在');
      return action();
    });
    this.queues.set(projectId, next);
    return next;
  }

  async prepare(projectId: string, changes: Operation['changes'], message: string, id: string, runId?: string, attribution?: Pick<Operation, 'actorRunId' | 'proposalId' | 'mergedByRunId'>) {
    const operation: Operation = {
      kind: this.context.automaticCommits ? undefined : 'files',
      id, projectId, runId, ownerRootRunId: runId, actorRunId: runId, ...attribution, expectedHead: await this.context.git.head(projectId), changes, message,
      phase: 'prepared', createdAt: new Date().toISOString(),
      sequence: await this.nextSequence(projectId),
    };
    await this.context.metadata.put('operations', id, operation);
    return this.apply(operation);
  }

  async apply(operation: Operation): Promise<string> {
    if (operation.kind) return this.applySeparated(operation);
    if (operation.phase === 'recorded' && operation.commit) return operation.commit;
    try {
      const found = await this.context.git.findOperation(operation.projectId, operation.id);
      if (found) operation.commit = found;
      else {
        if (await this.context.git.head(operation.projectId) !== operation.expectedHead) throw new Error('恢复基线不匹配');
        for (const change of operation.changes) {
          const current = await this.reader.bytesOrNull(operation.projectId, change.path);
          const value = current ? this.context.codec.encodeBase64(current) : null;
          if (value !== change.before && value !== change.after) throw new Error('文件内容与恢复记录不匹配');
          if (value === change.after) continue;
          if (change.after === null) await this.context.fs.remove(this.reader.internal(operation.projectId, change.path));
          else await this.context.fs.write(this.reader.internal(operation.projectId, change.path), this.context.codec.decodeBase64(change.after));
        }
        operation.phase = 'applied';
        await this.context.metadata.put('operations', operation.id, operation);
        operation.commit = await this.context.git.commit(operation.projectId, operation.changes.map((change) => change.path),
          operation.message + '\n\nAgentMobile-Operation: ' + operation.id);
      }
      operation.phase = 'committed';
      await this.context.metadata.put('operations', operation.id, operation);
      const project = await this.context.metadata.get<Project>('projects', operation.projectId);
      if (project) await this.context.metadata.put('projects', project.id, { ...project, updatedAt: new Date().toISOString() });
      operation.phase = 'recorded';
      await this.context.metadata.put('operations', operation.id, operation);
      this.notify({ projectId: operation.projectId, paths: operation.changes.map((change) => change.path), commit: operation.commit! });
      return operation.commit!;
    } catch (error) {
      this.blocked.add(operation.projectId);
      throw error;
    }
  }

  async recover() {
    const operations = (await this.context.metadata.all<Operation>('operations'))
      .filter((operation) => operation.phase !== 'recorded').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.sequence ?? 0) - (b.sequence ?? 0));
    for (const operation of operations) {
      try { await this.apply(operation); } catch {
        this.recoveryIssues.push('项目 ' + operation.projectId.slice(0, 8) + ' 的修改需要恢复，已暂停写入。');
      }
    }
  }

  async nextSequence(projectId: string) {
    return 1 + (await this.context.metadata.all<Operation>('operations')).filter((operation) => operation.projectId === projectId).reduce((max, operation) => Math.max(max, operation.sequence ?? 0), 0);
  }

  async indexTree(projectId: string) {
    const tree: Record<string, Uint8Array> = Object.create(null);
    for (const [path, oid] of Object.entries(await this.context.git.index(projectId))) tree[path] = await this.context.git.blob(projectId, oid);
    return tree;
  }

  async applySeparated(operation: Operation): Promise<string> {
    if (operation.phase === 'recorded') return operation.kind === 'commit' ? operation.commit! : operation.checkpoint!;
    const projectId = operation.projectId;
    try {
      if (operation.kind === 'commit') {
        const found = await this.context.git.findOperation(projectId, operation.id);
        operation.commit = found ?? await this.context.git.commitSnapshot(projectId, operation.checkpoint!, operation.message + '\n\nAgentMobile-Operation: ' + operation.id, operation.expectedHead);
        operation.phase = 'committed';
      } else {
        if (await this.context.git.head(projectId) !== operation.expectedHead) throw new Error('恢复基线不匹配');
        for (const change of operation.changes) {
          const current = await this.reader.bytesOrNull(projectId, change.path); const value = current ? this.context.codec.encodeBase64(current) : null;
          if (value !== change.before && value !== change.after) throw new Error('文件内容与恢复记录不匹配');
          if (value === change.after) continue;
          if (change.after === null) await this.context.fs.remove(this.reader.internal(projectId, change.path));
          else await this.context.fs.write(this.reader.internal(projectId, change.path), this.context.codec.decodeBase64(change.after));
        }
        const index = await this.context.git.index(projectId);
        for (const change of operation.indexChanges ?? []) {
          const value = index[change.path] ?? null;
          if (value !== change.before && value !== change.after) throw new Error('暂存区与恢复记录不匹配');
          if (value !== change.after) await this.context.git.setIndex(projectId, { [change.path]: change.after });
        }
        operation.phase = 'applied'; await this.context.metadata.put('operations', operation.id, operation);
        operation.checkpoint = await this.context.git.checkpoint(projectId, await this.reader.workingTree(projectId), 'operations/' + this.context.codec.encodeHex(this.context.codec.encodeText(operation.id)), operation.expectedHead);
        operation.phase = 'checkpointed';
      }
      await this.context.metadata.put('operations', operation.id, operation);
      const project = await this.context.metadata.get<Project>('projects', projectId);
      if (project) await this.context.metadata.put('projects', projectId, { ...project, updatedAt: new Date().toISOString() });
      operation.phase = 'recorded'; await this.context.metadata.put('operations', operation.id, operation);
      this.notify({ projectId, paths: [...new Set([...operation.changes.map((change) => change.path), ...(operation.indexChanges ?? []).map((change) => change.path)])], commit: await this.context.git.head(projectId) });
      return operation.kind === 'commit' ? operation.commit! : operation.checkpoint!;
    } catch (error) { this.blocked.add(projectId); throw error; }
  }

  async journalIndex(projectId: string, changes: NonNullable<Operation['indexChanges']>, message: string, owner?: string, files: Operation['changes'] = []) {
    const id = this.context.id(); const head = await this.context.git.head(projectId); const before = await this.indexTree(projectId); const after = { ...before };
    for (const change of changes) { if (change.after) after[change.path] = await this.context.git.blob(projectId, change.after); else delete after[change.path]; }
    const operation: Operation = { id, projectId, runId: owner, ownerRootRunId: owner, actorRunId: owner, kind: files.length ? 'files' : 'index', expectedHead: head, changes: files, indexChanges: changes,
      indexBefore: await this.context.git.checkpoint(projectId, before, 'index/' + id + '/before', head),
      indexAfter: await this.context.git.checkpoint(projectId, after, 'index/' + id + '/after', head),
      message, phase: 'prepared', createdAt: new Date().toISOString(), sequence: await this.nextSequence(projectId) };
    await this.context.metadata.put('operations', id, operation); return this.apply(operation);
  }
}
