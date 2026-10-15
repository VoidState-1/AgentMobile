import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { testStorage } from './storage';
import { GitSkillRepository } from '../src/adapters/skills/repository';
import { SkillService } from '../src/application/skills/library';
import { skillSource } from './skills-fixtures';

it('快照和运行归属不读取历史正文，序号在摘要/正文同事务准备且重复 ID 不分配新序号', async () => {
  const storage = await testStorage();
  try {
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('摘要查询');
    const runId = 'root';
    workspace.claim(project.id, runId);
    const baseline = await workspace.taskBaseline(project.id, runId);
    await workspace.write(project.id, 'a.md', Buffer.from('A'), null, {
      owner: runId,
      operationId: 'id',
    });
    await workspace.write(project.id, 'a.md', Buffer.from('A'), null, {
      owner: runId,
      operationId: 'id',
    });
    await workspace.write(project.id, 'b.md', Buffer.from('B'), null, { owner: runId });
    const rows = await storage.metadata.operations({
      scope: workspace.journal.scope(project.id),
      limit: 100,
    });
    expect(rows.map(header => header.sequence)).toEqual([2, 1]);
    storage.metadata.operationBody = async () => {
      throw new Error('摘要不应读取正文');
    };
    expect(
      (await workspace.snapshot(project.id)).operations.map(header => header.changedPaths),
    ).toEqual([['b.md'], ['a.md']]);
    const task = await workspace.taskFinal(
      {
        id: runId,
        projectId: project.id,
        prompt: '',
        response: '',
        state: 'completed',
        mode: 'demo',
        createdAt: new Date().toISOString(),
        baseCommit: baseline.head,
        baseSnapshot: baseline.working,
        baseIndexSnapshot: baseline.index,
      },
      true,
    );
    expect(task.changedPaths?.sort()).toEqual(['a.md', 'b.md']);
    const status = await workspace.status(project.id);
    await workspace.stage(
      project.id,
      ['a.md'],
      {
        ...status,
        revisions: { 'a.md': status.files.find(file => file.path === 'a.md')!.workingRevision },
      },
      runId,
      baseline,
    );
    workspace.release(project.id, runId);
  } finally {
    await storage.cleanup();
  }
});

it('日志回执不能改序号、正文指纹或倒退阶段；失败不写入同批项目元数据', async () => {
  const storage = await testStorage();
  try {
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('意图校验');
    await workspace.write(project.id, 'a.md', Buffer.from('A'), null);
    const header = (
      await storage.metadata.operations({ scope: workspace.journal.scope(project.id), limit: 1 })
    )[0];
    await expect(
      storage.metadata.writeBusiness({
        operations: [
          {
            header: { ...header, phase: 'prepared', revision: header.revision + 1 },
            expectedRevision: header.revision,
          },
        ],
        metadata: [{ bucket: 'fixture', id: 'invalid', value: true }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await storage.metadata.get('fixture', 'invalid')).toBeUndefined();
  } finally {
    await storage.cleanup();
  }
});

it('技能提交成功但回执失败时冻结操作，重开确认原提交而不会生成第二个版本', async () => {
  const storage = await testStorage();
  try {
    const create = () =>
      new SkillService(
        storage.metadata,
        new GitSkillRepository(
          createWorkspace(storage.files, storage.metadata, randomUUID, { namespace: 'skills' }),
        ),
      );
    const service = create();
    await service.initialize();
    const before = service.getSnapshot().commit;
    const write = storage.metadata.writeBusiness;
    let failed = false;
    storage.metadata.writeBusiness = async batch => {
      if (
        !failed &&
        batch.operations?.some(
          update => update.header.kind === 'files_commit' && update.header.phase === 'committed',
        )
      ) {
        failed = true;
        throw new Error('Git success, receipt loss');
      }
      await write(batch);
    };
    const bundle = {
      name: 'note-workflow',
      description: '整理资料',
      warnings: [],
      files: [{ path: 'SKILL.md', bytes: Buffer.from(skillSource()) }],
    };
    await expect(service.install([bundle], before)).rejects.toMatchObject({ code: 'STORAGE' });
    const repository = service.repository as GitSkillRepository;
    const committed = await repository.workspace.git.head('agent-skills-library');
    expect(committed).not.toBe(before);
    await expect(service.capture('project', '继续')).rejects.toMatchObject({ code: 'STORAGE' });
    storage.metadata.writeBusiness = write;
    const reopened = create();
    await reopened.initialize();
    await reopened.initialize();
    expect(reopened.getSnapshot().commit).toBe(committed);
    const headers = await storage.metadata.operations({
      scope: { namespace: 'skills', projectId: 'agent-skills-library' },
      limit: 100,
    });
    expect(headers).toMatchObject([{ kind: 'files_commit', phase: 'recorded', commit: committed }]);
  } finally {
    await storage.cleanup();
  }
});
