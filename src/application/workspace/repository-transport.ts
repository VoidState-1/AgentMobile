import { AppError } from '@/core/errors';
import type {
  GitCredentialInput,
  GitTransferState,
  GitTransportOptions,
} from '@/core/git/repository';
import type { WorkspaceContext } from './context';
import type { MutationCoordinator } from './mutations';
import { validateGitCredential } from '@/core/git/validation';

interface CredentialRecord {
  reference: string;
  url: string;
  username: string;
  ready: boolean;
}

/** Secrets never enter Git configuration, SQLite operation bodies or progress events. */
export class RepositoryTransport {
  private readonly jobs = new Map<string, AbortController>();
  private readonly states = new Map<string, GitTransferState>();
  private latest?: GitTransferState;
  private readonly listeners = new Set<(value: GitTransferState) => void>();
  constructor(
    private readonly context: WorkspaceContext,
    private readonly mutations: MutationCoordinator,
  ) {}
  state(projectId?: string) {
    return projectId ? this.states.get(projectId) : this.latest;
  }
  subscribe(listener: (value: GitTransferState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  cancel(projectId: string) {
    this.jobs.get(projectId)?.abort();
  }
  private emit(value: GitTransferState) {
    value = Object.freeze({ ...value });
    this.states.set(value.projectId, value);
    this.latest = value;
    for (const listener of this.listeners) {
      try {
        listener({ ...value });
      } catch {
        /* Progress observers cannot own transfer effects. */
      }
    }
  }
  private key(projectId: string, name: string) {
    return projectId + ':' + name;
  }
  async username(projectId: string, name: string, url: string): Promise<string | undefined> {
    const record = await this.context.metadata.get<CredentialRecord>(
      'git-credentials',
      this.key(projectId, name),
    );
    return record?.ready &&
      record.url === url &&
      (await this.context.credentials?.get(record.reference))
      ? record.username
      : undefined;
  }
  save(projectId: string, name: string, url: string, input: GitCredentialInput | null) {
    return this.mutations.serial(projectId, undefined, async () => {
      const store = this.context.credentials;
      if (!store) throw new AppError('VALIDATION', '当前实例没有配置安全凭证存储。');
      if (input) validateGitCredential(input);
      const remote = (await this.context.git.repositoryInfo(projectId)).remotes.find(
        remote => remote.name === name,
      );
      if (!remote || remote.url !== url)
        throw new AppError('CONFLICT', '远程地址已变化，请刷新后重新配置认证。');
      const key = this.key(projectId, name);
      const previous = await this.context.metadata.get<CredentialRecord>('git-credentials', key);
      const record: CredentialRecord = {
        reference: previous?.reference ?? 'git-' + this.context.id(),
        url,
        username: input?.username.trim() ?? '',
        ready: false,
      };
      await this.context.metadata.put('git-credentials', key, record);
      await store.set(input?.token ?? '', record.reference);
      await this.context.metadata.put('git-credentials', key, { ...record, ready: input !== null });
    });
  }
  async run<T>(
    projectId: string,
    method: GitTransferState['method'],
    name: string,
    url: string,
    operationId: string,
    action: (options: GitTransportOptions) => Promise<T>,
    credential?: GitCredentialInput,
  ): Promise<T> {
    if (this.jobs.has(projectId)) throw new AppError('CONFLICT', '项目已有 Git 传输正在执行。');
    const controller = new AbortController();
    this.jobs.set(projectId, controller);
    let value: GitTransferState = {
      projectId,
      method,
      name,
      state: 'running',
      phase: 'connecting',
      completed: 0,
      total: 0,
      bytes: 0,
    };
    this.emit(value);
    let last = 0;
    try {
      const record = await this.context.metadata.get<CredentialRecord>(
        'git-credentials',
        this.key(projectId, name),
      );
      const password =
        credential?.token ??
        (record?.ready && record.url === url
          ? await this.context.credentials?.get(record.reference)
          : undefined);
      const result = await action({
        operationId,
        signal: controller.signal,
        ...(password && (credential || record)
          ? { credential: { username: credential?.username ?? record!.username, password } }
          : {}),
        progress: progress => {
          const now = Date.now();
          if (now - last < 100 && progress.phase === value.phase) return;
          last = now;
          value = { ...value, ...progress };
          this.emit(value);
        },
      });
      this.emit({ ...value, state: 'completed' });
      return result;
    } catch (error) {
      this.emit({
        ...value,
        state:
          error instanceof AppError && error.uncertain
            ? 'unknown'
            : error instanceof AppError && error.code === 'CANCELLED'
              ? 'cancelled'
              : 'failed',
      });
      throw error;
    } finally {
      this.jobs.delete(projectId);
    }
  }
}
