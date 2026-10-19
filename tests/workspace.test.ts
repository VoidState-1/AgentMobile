import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { safePath } from '../src/core/workspace/path';
import { validateImage } from '../src/core/workspace/image';
import { testStorage, readOperations } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const storage = await testStorage();
  cleanups.push(storage.cleanup);
  const service = createWorkspace(storage.files, storage.metadata, randomUUID);
  const project = await service.create('测试资料');
  return { ...storage, service, project };
}

describe('受控路径', () => {
  it.each([
    '../secret',
    '/secret',
    'C:\\secret',
    'a/../../x',
    '.git/config',
    'a/.GIT/HEAD',
    'https://x',
    'a//b',
    'a/./b',
    'a\0b',
    'a/CON.txt',
    'x.',
  ])('拒绝 %s', input => {
    expect(() => safePath(input)).toThrow('INVALID_PATH');
  });
  it('保留合法的 Unicode 相对路径', () =>
    expect(safePath('documents/旅行笔记.md')).toBe('documents/旅行笔记.md'));
  it('不把完整仓库的深层目录限制在 220 字符内', () => {
    const path = Array(30).fill('directory').join('/') + '/readme.md';
    expect(safePath(path)).toBe(path);
  });
  it('拒绝伪装图片和过大像素尺寸', () => {
    expect(() => validateImage('bad.png', Buffer.from('<html>'))).toThrow('图片不是');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=',
      'base64',
    );
    expect(() => validateImage('valid.png', png)).not.toThrow();
    png.writeUInt32BE(30000, 16);
    expect(() => validateImage('large.png', png)).toThrow('图片尺寸过大');
  });
});

describe('真实 Git 和工作区一致性', () => {
  it('保存只创建内部检查点，检查版本冲突，重复操作不重复记录', async () => {
    const { service, project, resolve } = await fixture();
    const file = await service.readText(project.id, 'documents/notes.md');
    const id = randomUUID();
    const next = await service.write(
      project.id,
      'documents/notes.md',
      Buffer.from('更新后的内容'),
      file.revision,
      { operationId: id },
    );
    expect(
      execFileSync(
        'git',
        ['-C', resolve(service.git.dir(project.id)), 'show', next + ':documents/notes.md'],
        { encoding: 'utf8' },
      ),
    ).toBe('更新后的内容');
    expect(
      await service.write(
        project.id,
        'documents/notes.md',
        Buffer.from('更新后的内容'),
        file.revision,
        { operationId: id },
      ),
    ).toBe(next);
    expect((await service.git.historyPage(project.id, { limit: 100 })).versions).toHaveLength(1);
    await expect(
      service.write(project.id, 'documents/notes.md', Buffer.from('陈旧内容'), file.revision),
    ).rejects.toThrow('VERSION_CONFLICT');
    await expect(
      service.write(project.id, 'documents/notes.md', Buffer.from('另一个内容'), file.revision, {
        operationId: id,
      }),
    ).rejects.toThrow('不匹配');
  });

  it('移动、删除和恢复保留原来的历史，并拒绝任务期间的其他写入', async () => {
    const { service, project } = await fixture();
    const original = (await service.git.head(project.id))!;
    const file = await service.readText(project.id, 'documents/notes.md');
    await service.move(project.id, 'documents/notes.md', 'documents/moved.md', file.revision);
    await expect(service.readText(project.id, 'documents/notes.md')).rejects.toThrow();
    await service.remove(project.id, 'documents/moved.md', file.revision);
    service.claim(project.id, 'run-1');
    await expect(service.write(project.id, 'new.md', Buffer.from('x'), null)).rejects.toThrow(
      '等待或取消',
    );
    service.release(project.id, 'run-1');
    let status = await service.status(project.id);
    await expect(service.restore(project.id, original, status.head)).rejects.toThrow('未提交');
    await service.stage(project.id, ['documents/notes.md'], {
      ...status,
      revisions: { 'documents/notes.md': null },
    });
    status = await service.status(project.id);
    await service.commitStaged(project.id, '删除笔记', status);
    await service.restore(project.id, original, await service.git.head(project.id));
    expect((await service.readText(project.id, 'documents/notes.md')).revision).toBe(file.revision);
    expect((await service.git.historyPage(project.id, { limit: 100 })).versions).toHaveLength(2);
    expect((await service.status(project.id)).files[0].unstaged).toBe('added');
  });

  it('内部检查点已写入而数据库未记录时，重启补记且不产生提交', async () => {
    const { service, project, files, metadata } = await fixture();
    let failed = false;
    const writeBusiness = metadata.writeBusiness;
    metadata.writeBusiness = async batch => {
      if (batch.operations?.some(update => update.header.phase === 'checkpointed') && !failed) {
        failed = true;
        throw new Error('模拟数据库中断');
      }
      await writeBusiness(batch);
    };
    await expect(
      service.write(project.id, 'documents/new.md', Buffer.from('恢复后保留'), null),
    ).rejects.toThrow('模拟数据库中断');
    const reopened = createWorkspace(files, metadata, randomUUID);
    await reopened.recover();
    expect(reopened.recoveryIssues).toEqual([]);
    expect((await reopened.readText(project.id, 'documents/new.md')).text).toBe('恢复后保留');
    expect((await reopened.git.historyPage(project.id, { limit: 100 })).versions).toHaveLength(1);
    expect((await readOperations(metadata, project.id))[0].phase).toBe('recorded');
  });

  it('移动中断后恢复未完成的文件批次', async () => {
    const { service, project, files, metadata } = await fixture();
    const file = await service.readText(project.id, 'documents/notes.md');
    let failed = false;
    const moveFile = files.moveFile;
    files.moveFile = async (from, to) => {
      if (to.endsWith('/moved.md') && !failed) {
        failed = true;
        throw new Error('模拟原生移动中断');
      }
      await moveFile(from, to);
    };
    await expect(
      service.move(project.id, 'documents/notes.md', 'documents/moved.md', file.revision),
    ).rejects.toThrow('模拟');
    const reopened = createWorkspace(files, metadata, randomUUID);
    await reopened.recover();
    expect(reopened.recoveryIssues).toEqual([]);
    expect((await reopened.readText(project.id, 'documents/moved.md')).revision).toBe(
      file.revision,
    );
    expect((await reopened.git.historyPage(project.id, { limit: 100 })).versions).toHaveLength(1);
  });

  it('不明的部分写入不会被盲目覆盖，并保留恢复记录', async () => {
    const { service, project, files, metadata } = await fixture();
    const current = await service.readText(project.id, 'documents/notes.md');
    const write = files.write;
    let failed = false;
    files.write = async (path, bytes) => {
      if (path.endsWith('/notes.md') && !failed) {
        failed = true;
        await write(path, bytes.slice(0, 2));
        throw new Error('模拟部分写入');
      }
      await write(path, bytes);
    };
    await expect(
      service.write(
        project.id,
        'documents/notes.md',
        Buffer.from('new long content'),
        current.revision,
      ),
    ).rejects.toThrow();
    const reopened = createWorkspace(files, metadata, randomUUID);
    await reopened.recover();
    expect(reopened.needsRecovery(project.id)).toBe(true);
    expect(reopened.recoveryIssues).toHaveLength(1);
    expect((await readOperations(metadata, project.id))[0].changes[0].before).not.toBeNull();
    await expect(reopened.write(project.id, 'another.md', Buffer.from('x'), null)).rejects.toThrow(
      '恢复未完成',
    );
  });
});
