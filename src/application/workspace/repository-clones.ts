import { AppError } from '@/core/errors';
import type { Project } from '@/core/projects';
import type { GitCloneInput, GitCredentialInput } from '@/core/git/repository';
import { gitHttpsUrl, validateGitCredential } from '@/core/git/validation';
import type { WorkspaceContext } from './context';
import type { MutationCoordinator } from './mutations';
import type { RepositoryTransport } from './repository-transport';

interface CloneRecord {
  project: Project;
  operationId: string;
  url: string;
  state: 'prepared' | 'completed' | 'failed';
}

/** Downloads are unpublished; the final directory rename and SQLite receipt are reconciled. */
export class RepositoryClones {
  constructor(
    private readonly context: WorkspaceContext,
    private readonly mutations: MutationCoordinator,
    private readonly transport: RepositoryTransport,
  ) {}
  private async register(record: CloneRecord): Promise<Project> {
    const projectId = record.project.id;
    const commit = await this.context.git.head(projectId);
    await this.context.metadata.writeBusiness({
      metadata: [
        { bucket: this.context.projectBucket, id: projectId, value: record.project },
        { bucket: 'git-clones', id: projectId, value: { ...record, state: 'completed' } },
      ],
    });
    this.mutations.notify({ projectId, paths: [], commit });
    return record.project;
  }
  async clone(input: GitCloneInput, credential?: GitCredentialInput): Promise<Project> {
    if (this.context.projectBucket !== 'projects')
      throw new AppError('VALIDATION', '技能库不支持项目克隆入口。');
    const url = gitHttpsUrl(input.url);
    if (!input.name.trim() || input.name.trim().length > 60)
      throw new AppError('VALIDATION', '请输入 1–60 字的项目名称。');
    if (credential) validateGitCredential(credential);
    const now = new Date().toISOString(),
      project = { id: this.context.id(), name: input.name.trim(), createdAt: now, updatedAt: now };
    const record: CloneRecord = { project, operationId: this.context.id(), url, state: 'prepared' };
    return this.mutations.query(project.id, async () => {
      if (await this.context.metadata.get(this.context.projectBucket, project.id))
        throw new AppError('CONFLICT', '克隆项目标识已存在。');
      await this.context.metadata.put('git-clones', project.id, record);
      const register = async () => {
        try {
          return await this.register(record);
        } catch {
          this.mutations.block(
            project.id,
            '项目“' + project.name + '”的克隆登记需要恢复，请保留本地数据。',
          );
          throw new AppError(
            'STORAGE',
            '仓库已下载，项目登记需要恢复。请重新打开应用，避免重复克隆。',
            true,
          );
        }
      };
      return this.transport.run(
        project.id,
        'clone',
        project.name,
        url,
        record.operationId,
        async options => {
          try {
            await this.context.git.clone(project.id, url, options);
          } catch (error) {
            const state = await this.context.git.cloneState(project.id, url, record.operationId);
            if (state === 'published') return register();
            await this.context.git.discardClone(project.id);
            await this.context.metadata.put('git-clones', project.id, {
              ...record,
              state: 'failed',
            });
            throw error;
          }
          return register();
        },
        credential,
      );
    });
  }
  async recover() {
    for (const record of await this.context.metadata.all<CloneRecord>('git-clones')) {
      if (record.state !== 'prepared') continue;
      const id = record.project.id;
      try {
        let state = await this.context.git.cloneState(id, record.url, record.operationId);
        if (state === 'ready') {
          await this.context.git.publishClone(id, record.url, record.operationId);
          state = 'published';
        }
        if (state === 'published') await this.register(record);
        else {
          await this.context.git.discardClone(id);
          await this.context.metadata.put('git-clones', id, { ...record, state: 'failed' });
        }
      } catch {
        this.mutations.block(
          id,
          '项目“' + record.project.name + '”的克隆发布需要恢复，请保留本地数据。',
        );
      }
    }
  }
}
