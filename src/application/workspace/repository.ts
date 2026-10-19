import type { WorkspaceContext } from './context';
import type { MutationCoordinator } from './mutations';
import type { GitService } from './git';
import type { EditorDrafts } from './editor-drafts';
import type { GitStatus } from '@/core/git/contracts';
import type {
  GitRepositoryCommand,
  GitRepositoryGuard,
  GitRepositoryInfo,
  GitCommandResult,
} from '@/core/git/repository';
import { AppError } from '@/core/errors';
import { sameEntry } from '@/core/git/objects';
import { RepositoryTransport } from './repository-transport';
import { gitHttpsUrl } from '@/core/git/validation';
import type { MergeService } from './merges';
import type { RebaseService } from './rebases';

interface RepositoryOperation {
  id: string;
  projectId: string;
  command: Exclude<GitRepositoryCommand, { method: 'checkout' }>;
  guard: GitRepositoryGuard;
  target?: string;
  state: 'prepared' | 'completed' | 'needs-review' | 'failed' | 'reconciled';
  verifiedRemote?: string | null;
  remoteUrl?: string;
}

/** User Git commands share the workspace write lease and durable intent tracking. */
export class RepositoryService {
  readonly transport: RepositoryTransport;
  constructor(
    private readonly context: WorkspaceContext,
    private readonly mutations: MutationCoordinator,
    private readonly versions: GitService,
    private readonly drafts: EditorDrafts,
    private readonly merges: MergeService,
    private readonly rebases: RebaseService,
  ) {
    this.transport = new RepositoryTransport(context, mutations);
  }
  info(projectId: string): Promise<GitRepositoryInfo> {
    return this.mutations.query(projectId, () => this.infoValue(projectId));
  }
  async infoValue(projectId: string): Promise<GitRepositoryInfo> {
    const info = await this.context.git.repositoryInfo(projectId);
    const operations = await this.context.metadata.all<RepositoryOperation>('git-operations');
    return {
      ...info,
      merge: await this.merges.sessionInfo(projectId),
      rebase: await this.rebases.sessionInfo(projectId),
      remotes: await Promise.all(
        info.remotes.map(async remote => ({
          ...remote,
          credentialUsername: await this.transport.username(projectId, remote.name, remote.url),
        })),
      ),
      pendingPushes: operations
        .filter(
          record =>
            record.projectId === projectId &&
            record.command.method === 'push' &&
            ['prepared', 'needs-review'].includes(record.state),
        )
        .map(record => ({
          id: record.id,
          name: (record.command as Extract<GitRepositoryCommand, { method: 'push' }>).name,
          branch: (record.command as Extract<GitRepositoryCommand, { method: 'push' }>).branch,
          oid: record.target!,
        })),
    };
  }
  private validate(command: GitRepositoryCommand) {
    if (
      !command ||
      ![
        'identity',
        'branchCreate',
        'branchDelete',
        'checkout',
        'tagCreate',
        'tagDelete',
        'remoteSave',
        'fetch',
        'push',
        'verifyPush',
        'upstream',
      ].includes(command.method)
    )
      throw new AppError('VALIDATION', '不支持的 Git 操作。');
    if (
      command.method === 'push' &&
      (!command.branch || command.branch.length > 200 || /[\r\n\0]/.test(command.branch))
    )
      throw new AppError('VALIDATION', '远程分支名称无效。');
    if (command.method === 'identity') {
      if (
        !command.name.trim() ||
        !/^[^\s<>@]+@[^\s<>@]+$/.test(command.email) ||
        /[\r\n\0<>]/.test(command.name)
      )
        throw new AppError('VALIDATION', '请输入有效的提交姓名和邮箱。');
    } else if (
      'name' in command &&
      (!command.name || command.name.length > 200 || /[\r\n\0]/.test(command.name))
    )
      throw new AppError('VALIDATION', 'Git 名称无效。');
    if (command.method === 'remoteSave') {
      gitHttpsUrl(command.url);
      if (!/^[a-zA-Z0-9_-]+$/.test(command.name))
        throw new AppError('VALIDATION', '远程名称只允许字母、数字、连字符和下划线。');
    }
  }
  command(
    projectId: string,
    input: GitRepositoryCommand,
    expected: GitStatus,
  ): Promise<GitCommandResult | void> {
    return this.mutations.serial(projectId, undefined, async () => {
      this.validate(input);
      const command =
        input.method === 'remoteSave' ? { ...input, url: gitHttpsUrl(input.url) } : input;
      const status = await this.versions.statusValue(projectId);
      if (
        status.head !== expected.head ||
        status.branch !== expected.branch ||
        status.indexRevision !== expected.indexRevision ||
        status.workingRevision !== expected.workingRevision
      )
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：仓库已变化，请刷新后重试。');
      const before = await this.context.git.repositoryInfo(projectId);
      if (before.state !== 'none')
        throw new AppError('CONFLICT', '请先完成或中止正在进行的 Git 操作。');
      if (command.method === 'verifyPush') {
        const record = await this.context.metadata.get<RepositoryOperation>(
          'git-operations',
          command.id,
        );
        if (
          !record ||
          record.projectId !== projectId ||
          record.command.method !== 'push' ||
          !['prepared', 'needs-review'].includes(record.state)
        )
          throw new AppError('VALIDATION', '没有待核对的推送。');
        const pending = record.command;
        const remote = before.remotes.find(remote => remote.name === pending.name);
        if (!remote || remote.url !== record.remoteUrl)
          throw new AppError('VALIDATION', '请先恢复原远程地址，再核对推送。');
        const actual = await this.transport.run(
          projectId,
          'verifyPush',
          pending.name,
          remote.url,
          this.context.id(),
          async options => {
            const actual = await this.context.git.remoteHead(
              projectId,
              pending.name,
              pending.branch,
              options,
            );
            await this.context.metadata.put('git-operations', record.id, {
              ...record,
              state: actual === record.target ? 'completed' : 'reconciled',
              verifiedRemote: actual,
            });
            return actual;
          },
        );
        this.mutations.notify({ projectId, paths: [], commit: status.head });
        return {
          verification: { matched: actual === record.target, actual, target: record.target! },
        };
      }
      if (command.method === 'checkout') {
        if (status.files.length) throw new AppError('CONFLICT', '请先处理未提交更改，再切换分支。');
        if (await this.drafts.hasUnsaved(projectId))
          throw new AppError('CONFLICT', '项目中有未保存的文件草稿，请先保存或放弃。');
        const target = before.branches.find(
          branch => !branch.remote && branch.name === command.name,
        );
        if (!target) throw new AppError('VALIDATION', '目标分支不存在。');
        if (before.head.branch === target.name && before.head.oid === target.oid) return;
        const plan = await this.context.git.switchPlan(projectId, target.oid);
        const index = await this.context.git.index(projectId);
        const paths = [...new Set([...Object.keys(index), ...Object.keys(plan.index)])];
        const indexChanges = paths
          .filter(path => !sameEntry(index[path], plan.index[path]))
          .map(path => ({ path, before: index[path] ?? null, after: plan.index[path] ?? null }));
        await this.mutations.prepare(
          projectId,
          plan.changes,
          '切换分支 ' + target.name,
          this.context.id(),
          undefined,
          undefined,
          'checkout',
          {
            indexChanges,
            headChange: {
              before: { branch: before.head.branch, oid: before.head.oid },
              after: { branch: target.name, oid: target.oid },
            },
          },
        );
        return;
      }
      if (
        (command.method === 'fetch' && !before.capabilities.fetch) ||
        (command.method === 'push' && !before.capabilities.push)
      )
        throw new AppError('VALIDATION', '当前平台尚未支持远程 Git 传输。');
      if (command.method === 'push') {
        if (!before.head.oid) throw new AppError('VALIDATION', '没有可以推送的提交。');
        if (
          (await this.infoValue(projectId)).pendingPushes?.some(
            push => push.name === command.name && push.branch === command.branch,
          )
        )
          throw new AppError('CONFLICT', '上次推送结果尚未确认，请先核对远程分支。');
      }
      const id = this.context.id();
      const record: RepositoryOperation = {
        id,
        projectId,
        command,
        state: 'prepared',
        guard: { operationId: id, head: before.head.oid, branch: before.head.branch },
        target:
          command.method === 'branchCreate'
            ? (command.ref ?? before.head.oid ?? undefined)
            : (before.head.oid ?? undefined),
        ...(command.method === 'fetch' || command.method === 'push'
          ? { remoteUrl: before.remotes.find(remote => remote.name === command.name)?.url }
          : {}),
      };
      const execute = async (transport?: import('@/core/git/repository').GitTransportOptions) => {
        if (command.method === 'push')
          record.guard.remoteHead = await this.context.git.remoteHead(
            projectId,
            command.name,
            command.branch,
            transport!,
          );
        await this.context.metadata.put('git-operations', id, record);
        let confirmed = false;
        try {
          await this.context.git.repositoryCommand(projectId, command, record.guard, transport);
          confirmed = true;
          await this.context.metadata.put('git-operations', id, { ...record, state: 'completed' });
        } catch (error) {
          if (await this.completed(record)) {
            await this.context.metadata.put('git-operations', id, {
              ...record,
              state: 'completed',
            });
          } else {
            const uncertain =
              command.method === 'push' &&
              (confirmed ||
                !(error instanceof AppError) ||
                error.uncertain ||
                error.code === 'STORAGE' ||
                error.code === 'UNKNOWN');
            await this.context.metadata.put('git-operations', id, {
              ...record,
              state: uncertain ? 'needs-review' : 'failed',
            });
            if (uncertain)
              throw new AppError('UNKNOWN', '推送回执尚未确认，请先核对远程分支。', true);
            throw error;
          }
        }
      };
      if (command.method === 'fetch' || command.method === 'push') {
        const remote = before.remotes.find(remote => remote.name === command.name);
        if (!remote) throw new AppError('VALIDATION', '远程仓库不存在。');
        await this.transport.run(projectId, command.method, command.name, remote.url, id, execute);
      } else await execute();
      this.mutations.notify({
        projectId,
        paths: [],
        commit: await this.context.git.head(projectId),
      });
    });
  }
  private async completed(record: RepositoryOperation): Promise<boolean> {
    const info = await this.context.git.repositoryInfo(record.projectId);
    const command = record.command;
    switch (command.method) {
      case 'identity':
        return info.identity.name === command.name && info.identity.email === command.email;
      case 'branchCreate':
        return info.branches.some(
          branch => !branch.remote && branch.name === command.name && branch.oid === record.target,
        );
      case 'branchDelete':
        return !info.branches.some(branch => !branch.remote && branch.name === command.name);
      case 'tagCreate':
        return info.tags.some(tag => tag.name === command.name && tag.oid === record.target);
      case 'tagDelete':
        return !info.tags.some(tag => tag.name === command.name);
      case 'remoteSave':
        return info.remotes.some(
          remote => remote.name === command.name && remote.url === command.url,
        );
      case 'fetch':
      case 'push':
      case 'verifyPush':
        return false;
      case 'upstream':
        return (
          (info.branches.find(branch => !branch.remote && branch.name === command.name)?.upstream ??
            null) === command.upstream
        );
    }
  }
  async recover() {
    for (const record of await this.context.metadata.all<RepositoryOperation>('git-operations')) {
      if (record.state !== 'prepared') continue;
      if (this.mutations.needsRecovery(record.projectId)) continue;
      if (await this.completed(record)) {
        await this.context.metadata.put('git-operations', record.id, {
          ...record,
          state: 'completed',
        });
      } else {
        await this.context.metadata.put('git-operations', record.id, {
          ...record,
          state: 'needs-review',
        });
      }
    }
  }
}
