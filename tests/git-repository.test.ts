import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { testStorage } from './storage';
import { initialEditorState } from '../src/core/documents/state';
import { AppError } from '../src/core/errors';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const storage = await testStorage();
  cleanups.push(storage.cleanup);
  const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
  const project = await workspace.create('仓库用例');
  return { ...storage, workspace, project };
}
async function remoteFixture() {
  const f = await fixture(),
    id = f.project.id,
    git = f.workspace.git;
  const secrets = new Map<string, string>();
  const credentials = {
    get: async (key: string) => secrets.get(key) ?? '',
    set: async (value: string, key: string) => {
      secrets.set(key, value);
    },
  };
  const info = git.repositoryInfo;
  git.repositoryInfo = async projectId => {
    const value = await info(projectId);
    return { ...value, capabilities: { ...value.capabilities, fetch: true, push: true } };
  };
  const workspace = createWorkspace(f.files, f.metadata, randomUUID, { git, credentials });
  await workspace.gitCommand(
    id,
    { method: 'remoteSave', name: 'origin', url: 'https://example.com/repo.git' },
    await workspace.status(id),
  );
  return { ...f, workspace, credentials, secrets };
}

it('克隆已发布但 SQLite 回执中断时，重启登记原仓库，不添加模板或额外提交', async () => {
  const f = await fixture(),
    git = f.workspace.git;
  const states = new Map<string, 'published'>();
  let clonedId = '',
    originalHead: string | null = null;
  git.clone = async id => {
    clonedId = id;
    await git.init(id);
    await f.files.write(git.dir(id) + '/README.md', Buffer.from('upstream content'));
    originalHead = await git.commit(id, ['README.md'], 'upstream commit');
    states.set(id, 'published');
  };
  git.cloneState = async id => states.get(id) ?? 'absent';
  const business = f.metadata.writeBusiness;
  let interrupt = true;
  f.metadata.writeBusiness = async batch => {
    if (interrupt && batch.metadata?.some(entry => entry.bucket === 'git-clones'))
      throw new Error('clone receipt interrupted');
    await business(batch);
  };
  const before = await f.workspace.projects();
  await expect(
    f.workspace.cloneProject({ name: '克隆项目', url: 'https://example.com/repo.git' }),
  ).rejects.toMatchObject({ uncertain: true });
  expect(f.workspace.needsRecovery(clonedId)).toBe(true);
  expect(await f.workspace.projects()).toEqual(before);
  interrupt = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git });
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect((await reopened.projects()).find(project => project.id === clonedId)?.name).toBe(
    '克隆项目',
  );
  expect(await reopened.git.head(clonedId)).toBe(originalHead);
  expect((await reopened.files(clonedId)).map(file => file.path)).toEqual(['README.md']);
  expect((await reopened.status(clonedId)).files).toEqual([]);
});

it('克隆中断只清理未发布的暂存目录；完整暂存仓库会在启动发布', async () => {
  const f = await fixture(),
    git = f.workspace.git;
  let stagedId = '',
    publishCount = 0,
    incompleteRemoved = 0,
    firstRead = true;
  git.clone = async id => {
    stagedId = id;
    await git.init(id);
    throw new Error('process stopped');
  };
  git.cloneState = async () => {
    if (firstRead) {
      firstRead = false;
      throw new Error('native process unavailable');
    }
    return 'ready';
  };
  git.publishClone = async () => {
    publishCount++;
  };
  git.discardClone = async () => {
    incompleteRemoved++;
  };
  await expect(
    f.workspace.cloneProject({ name: '待恢复克隆', url: 'https://example.com/repo.git' }),
  ).rejects.toThrow('process unavailable');
  expect((await f.workspace.projects()).some(project => project.id === stagedId)).toBe(false);
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git });
  await reopened.recover();
  expect(publishCount).toBe(1);
  expect(incompleteRemoved).toBe(0);
  expect((await reopened.projects()).some(project => project.id === stagedId)).toBe(true);
  git.cloneState = async () => 'incomplete';
  await expect(
    reopened.cloneProject({ name: '下载中断', url: 'https://example.com/repo.git' }),
  ).rejects.toThrow('process stopped');
  expect(incompleteRemoved).toBe(1);
});

it('分支切换支持同一路径从文件变成目录，再变回文件', async () => {
  const f = await fixture(),
    id = f.project.id;
  const saveAndCommit = async (paths: string[]) => {
    const status = await f.workspace.status(id);
    await f.workspace.stage(id, paths, {
      ...status,
      revisions: Object.fromEntries(status.files.map(file => [file.path, file.workingRevision])),
    });
    return f.workspace.commitStaged(id, 'shape change', await f.workspace.status(id));
  };
  await f.workspace.writeText(id, 'shape', Buffer.from('flat file'), null);
  const flat = await saveAndCommit(['shape']);
  await f.workspace.gitCommand(
    id,
    { method: 'branchCreate', name: 'flat' },
    await f.workspace.status(id),
  );
  await f.workspace.remove(id, 'shape', (await f.workspace.readText(id, 'shape')).revision);
  await f.workspace.writeText(id, 'shape/nested.txt', Buffer.from('nested file'), null);
  await saveAndCommit(['shape', 'shape/nested.txt']);
  await f.workspace.gitCommand(
    id,
    { method: 'checkout', name: 'flat' },
    await f.workspace.status(id),
  );
  expect((await f.workspace.readText(id, 'shape')).text).toBe('flat file');
  expect((await f.workspace.status(id)).files).toEqual([]);
  await f.workspace.gitCommand(
    id,
    { method: 'checkout', name: 'main' },
    await f.workspace.status(id),
  );
  expect((await f.workspace.readText(id, 'shape/nested.txt')).text).toBe('nested file');
  expect((await f.workspace.status(id)).files).toEqual([]);
  await f.workspace.restore(id, flat, await f.workspace.git.head(id));
  expect((await f.workspace.readText(id, 'shape')).text).toBe('flat file');
  const restored = await f.workspace.status(id);
  await f.workspace.discard(
    id,
    restored.files.map(file => file.path),
    restored,
  );
  expect((await f.workspace.readText(id, 'shape/nested.txt')).text).toBe('nested file');
  expect((await f.workspace.status(id)).files).toEqual([]);
});

it('Git 令牌仅进凭证存储，认证绑定具体远程地址，修改地址后不会复用', async () => {
  const f = await remoteFixture(),
    id = f.project.id;
  await f.workspace.saveGitCredential(id, 'origin', 'https://example.com/repo.git', {
    username: 'mobile',
    token: 'private-token-fixture',
  });
  expect([...f.secrets.values()]).toContain('private-token-fixture');
  expect(JSON.stringify(await f.metadata.all('git-credentials'))).not.toContain(
    'private-token-fixture',
  );
  expect((await f.workspace.repository(id)).remotes[0].credentialUsername).toBe('mobile');
  let received: unknown;
  const command = f.workspace.git.repositoryCommand;
  f.workspace.git.repositoryCommand = async (projectId, input, guard, transport) => {
    if (input.method === 'fetch') received = transport?.credential;
    else await command(projectId, input, guard, transport);
  };
  await f.workspace.gitCommand(
    id,
    { method: 'fetch', name: 'origin' },
    await f.workspace.status(id),
  );
  expect(received).toEqual({ username: 'mobile', password: 'private-token-fixture' });
  expect(JSON.stringify(await f.metadata.all('git-operations'))).not.toContain(
    'private-token-fixture',
  );
  await f.workspace.gitCommand(
    id,
    { method: 'remoteSave', name: 'origin', url: 'https://example.com/other.git' },
    await f.workspace.status(id),
  );
  expect((await f.workspace.repository(id)).remotes[0].credentialUsername).toBeUndefined();
  await f.workspace.gitCommand(
    id,
    { method: 'fetch', name: 'origin' },
    await f.workspace.status(id),
  );
  expect(received).toBeUndefined();
});

it('未知推送结果跨重启保留，重复推送被阻止，显式核对后才继续', async () => {
  const f = await remoteFixture(),
    id = f.project.id,
    git = f.workspace.git;
  let actual: string | null = null;
  git.remoteHead = async () => actual;
  const command = git.repositoryCommand;
  git.repositoryCommand = async (projectId, input, guard, transport) => {
    if (input.method === 'push') {
      expect(guard.remoteHead).toBe(null);
      actual = guard.head;
      throw new AppError('UNKNOWN', 'response lost', true);
    }
    await command(projectId, input, guard, transport);
  };
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'push', name: 'origin', branch: 'main' },
      await f.workspace.status(id),
    ),
  ).rejects.toMatchObject({ uncertain: true });
  expect(f.workspace.gitTransfer(id)?.state).toBe('unknown');
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, {
    git,
    credentials: f.credentials,
  });
  await reopened.recover();
  const pending = (await reopened.repository(id)).pendingPushes!;
  expect(pending).toHaveLength(1);
  await expect(
    reopened.gitCommand(
      id,
      { method: 'push', name: 'origin', branch: 'main' },
      await reopened.status(id),
    ),
  ).rejects.toThrow('尚未确认');
  await reopened.gitCommand(
    id,
    { method: 'verifyPush', id: pending[0].id },
    await reopened.status(id),
  );
  expect((await reopened.repository(id)).pendingPushes).toEqual([]);
  expect((await f.metadata.all<{ state: string }>('git-operations')).at(-1)?.state).toBe(
    'completed',
  );
});

it('服务器确认推送后业务存储报错，仍保留待核对记录，核对差异不会误报推送成功', async () => {
  const f = await remoteFixture(),
    id = f.project.id,
    git = f.workspace.git;
  const command = git.repositoryCommand;
  git.repositoryCommand = async (projectId, input, guard, options) => {
    if (input.method !== 'push') await command(projectId, input, guard, options);
  };
  git.remoteHead = async () => null;
  const put = f.metadata.put;
  f.metadata.put = async (bucket, key, value) => {
    if (
      bucket === 'git-operations' &&
      (value as { command: { method: string }; state: string }).command.method === 'push' &&
      (value as { state: string }).state === 'completed'
    )
      throw new AppError('STORAGE', 'receipt failed');
    return put(bucket, key, value);
  };
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'push', name: 'origin', branch: 'main' },
      await f.workspace.status(id),
    ),
  ).rejects.toMatchObject({ uncertain: true });
  const pending = (await f.workspace.repository(id)).pendingPushes!;
  expect(pending).toHaveLength(1);
  const verified = await f.workspace.gitCommand(
    id,
    { method: 'verifyPush', id: pending[0].id },
    await f.workspace.status(id),
  );
  expect(verified).toEqual({
    verification: { matched: false, actual: null, target: pending[0].oid },
  });
  expect((await f.workspace.repository(id)).pendingPushes).toEqual([]);
});

it('传输进度独立于项目写队列更新，取消可中断传输并释放写入占用', async () => {
  const f = await remoteFixture(),
    id = f.project.id;
  let started!: () => void;
  const ready = new Promise<void>(resolve => {
    started = resolve;
  });
  const command = f.workspace.git.repositoryCommand;
  f.workspace.git.repositoryCommand = async (projectId, input, guard, options) => {
    if (input.method !== 'fetch') return command(projectId, input, guard, options);
    options?.progress?.({ phase: 'transfer', completed: 2, total: 5, bytes: 1024 });
    await new Promise<void>((_resolve, reject) => {
      options!.signal!.addEventListener(
        'abort',
        () => reject(new AppError('CANCELLED', 'cancelled')),
        { once: true },
      );
      started();
    });
  };
  const observed: string[] = [];
  const unsubscribe = f.workspace.subscribeGitTransfer(value => observed.push(value.state));
  const transfer = f.workspace.gitCommand(
    id,
    { method: 'fetch', name: 'origin' },
    await f.workspace.status(id),
  );
  await ready;
  expect(f.workspace.gitTransfer(id)).toMatchObject({ state: 'running', completed: 2, total: 5 });
  f.workspace.cancelGitTransfer(id);
  await expect(transfer).rejects.toMatchObject({ code: 'CANCELLED' });
  unsubscribe();
  expect(observed.at(-1)).toBe('cancelled');
  await f.workspace.writeText(id, 'after-cancel.txt', Buffer.from('available'), null);
});
async function divergentBranches() {
  const f = await fixture(),
    id = f.project.id;
  const save = async (path: string, value: string) => {
    const current = await f.workspace.git.workingTree(id, [path]);
    await f.workspace.writeText(id, path, Buffer.from(value), current[path]?.revision ?? null);
  };
  const commit = async () => {
    const status = await f.workspace.status(id),
      paths = ['a.txt', 'b.txt'];
    await f.workspace.stage(id, paths, {
      ...status,
      revisions: Object.fromEntries(status.files.map(file => [file.path, file.workingRevision])),
    });
    await f.workspace.commitStaged(id, 'branch files', await f.workspace.status(id));
  };
  await save('a.txt', 'main-a');
  await save('b.txt', 'main-b');
  await commit();
  await f.workspace.gitCommand(
    id,
    { method: 'branchCreate', name: 'feature' },
    await f.workspace.status(id),
  );
  await f.workspace.gitCommand(
    id,
    { method: 'checkout', name: 'feature' },
    await f.workspace.status(id),
  );
  await save('a.txt', 'feature-a');
  await save('b.txt', 'feature-b');
  await commit();
  await f.workspace.gitCommand(
    id,
    { method: 'checkout', name: 'main' },
    await f.workspace.status(id),
  );
  return f;
}

it('启动先恢复引擎锁，再重放文件意图；锁恢复失败时阻断该项目写入', async () => {
  const f = await fixture(),
    id = f.project.id;
  const git = f.workspace.git;
  const calls: string[] = [];
  git.recoverLocks = async projectId => {
    calls.push(projectId);
    throw new Error('engine lock unavailable');
  };
  const reopened = createWorkspace(f.files, f.metadata, randomUUID, { git });
  await reopened.recover();
  expect(calls).toEqual([id]);
  expect(reopened.needsRecovery(id)).toBe(true);
  expect(reopened.recoveryIssues).toHaveLength(1);
  await expect(
    reopened.writeText(id, 'new.txt', Buffer.from('must not write'), null),
  ).rejects.toThrow('恢复未完成');
});

it('分支切换写入一半中断，重启仅继续剩余文件，然后更新索引和 HEAD', async () => {
  const f = await divergentBranches(),
    id = f.project.id;
  const write = f.files.write;
  let interrupt = true;
  f.files.write = async (path, bytes) => {
    if (path.endsWith('/b.txt') && interrupt) throw new Error('切换中断');
    await write(path, bytes);
  };
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'checkout', name: 'feature' },
      await f.workspace.status(id),
    ),
  ).rejects.toThrow('切换中断');
  expect((await f.workspace.repository(id)).head.branch).toBe('main');
  expect((await f.workspace.readText(id, 'a.txt')).text).toBe('feature-a');
  interrupt = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID);
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect((await reopened.repository(id)).head.branch).toBe('feature');
  expect((await reopened.status(id)).files).toEqual([]);
  expect((await reopened.readText(id, 'b.txt')).text).toBe('feature-b');
});

it('切换中断后发现第三种内容，整批恢复拒绝覆盖，保留用户文件并阻断写入', async () => {
  const f = await divergentBranches(),
    id = f.project.id;
  const write = f.files.write;
  let interrupt = true;
  f.files.write = async (path, bytes) => {
    if (path.endsWith('/b.txt') && interrupt) throw new Error('切换中断');
    await write(path, bytes);
  };
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'checkout', name: 'feature' },
      await f.workspace.status(id),
    ),
  ).rejects.toThrow('切换中断');
  interrupt = false;
  await write(f.workspace.git.dir(id) + '/b.txt', Buffer.from('unknown-user-edit'));
  const reopened = createWorkspace(f.files, f.metadata, randomUUID);
  await reopened.recover();
  expect(reopened.needsRecovery(id)).toBe(true);
  expect((await reopened.repository(id)).head.branch).toBe('main');
  expect((await reopened.readText(id, 'b.txt')).text).toBe('unknown-user-edit');
});

it('HEAD 已完成切换但回执中断，恢复确认引用效果，不重放覆盖后续用户内容', async () => {
  const f = await divergentBranches(),
    id = f.project.id;
  const business = f.metadata.writeBusiness;
  let fail = true;
  f.metadata.writeBusiness = async batch => {
    if (
      fail &&
      batch.operations?.some(
        update => update.header.kind === 'checkout' && update.header.phase === 'recorded',
      )
    )
      throw new Error('回执中断');
    await business(batch);
  };
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'checkout', name: 'feature' },
      await f.workspace.status(id),
    ),
  ).rejects.toThrow('回执中断');
  expect((await f.workspace.repository(id)).head.branch).toBe('feature');
  await f.files.write(f.workspace.git.dir(id) + '/a.txt', Buffer.from('later-user-edit'));
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID);
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  expect((await reopened.readText(id, 'a.txt')).text).toBe('later-user-edit');
  expect((await reopened.repository(id)).head.branch).toBe('feature');
});

it('仓库用例管理分支、作者和标签，保留基线校验与 Agent 项目占用', async () => {
  const f = await fixture(),
    id = f.project.id;
  const status = await f.workspace.status(id);
  await f.workspace.gitCommand(id, { method: 'branchCreate', name: 'feature' }, status);
  await f.workspace.gitCommand(
    id,
    { method: 'identity', name: '开发者', email: 'user@example.invalid' },
    status,
  );
  await f.workspace.gitCommand(id, { method: 'checkout', name: 'feature' }, status);
  const info = await f.workspace.repository(id);
  expect(info.head.branch).toBe('feature');
  expect(info.identity).toEqual({ name: '开发者', email: 'user@example.invalid' });
  await expect(
    f.workspace.gitCommand(id, { method: 'tagCreate', name: 'stale' }, status),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const current = await f.workspace.status(id);
  await f.workspace.gitCommand(id, { method: 'tagCreate', name: 'v1' }, current);
  expect((await f.workspace.repository(id)).tags).toContainEqual({ name: 'v1', oid: current.head });
  await f.workspace.gitCommand(id, { method: 'tagDelete', name: 'v1' }, current);
  expect((await f.workspace.repository(id)).tags).toEqual([]);
  f.workspace.claim(id, 'root');
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'identity', name: 'Other', email: 'other@example.invalid' },
      current,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await f.workspace.repository(id)).identity.name).toBe('开发者');
});

it('切换分支同时检查已落盘修改与其他文件的持久化草稿，且不阻塞其他项目', async () => {
  const f = await fixture(),
    id = f.project.id;
  await f.workspace.gitCommand(
    id,
    { method: 'branchCreate', name: 'feature' },
    await f.workspace.status(id),
  );
  await f.workspace.writeText(id, 'dirty.txt', Buffer.from('dirty'), null);
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'checkout', name: 'feature' },
      await f.workspace.status(id),
    ),
  ).rejects.toThrow('未提交');
  await f.workspace.discard(id, ['dirty.txt'], await f.workspace.status(id));
  const draft = {
    format: 1 as const,
    name: 'draft.md',
    fresh: true,
    baseRevision: null,
    lineEnding: '\n' as const,
    state: initialEditorState('draft'),
  };
  const record = await f.workspace.saveEditorDraft(id, 'draft.md', draft, 0);
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'checkout', name: 'feature' },
      await f.workspace.status(id),
    ),
  ).rejects.toThrow('草稿');
  await f.workspace.saveEditorDraft(id, 'draft.md', null, record.revision);
  const other = await f.workspace.create('其他项目');
  await f.workspace.saveEditorDraft(other.id, 'draft.md', draft, 0);
  await f.workspace.gitCommand(
    id,
    { method: 'checkout', name: 'feature' },
    await f.workspace.status(id),
  );
  expect((await f.workspace.repository(id)).head.branch).toBe('feature');
});

it('Git 引用已创建但业务回执中断，重启按实际目标核对，不重复执行', async () => {
  const f = await fixture(),
    id = f.project.id;
  const put = f.metadata.put;
  let fail = true;
  f.metadata.put = async (bucket, key, value) => {
    if (bucket === 'git-operations' && (value as { state: string }).state === 'completed' && fail)
      throw new Error('回执中断');
    await put(bucket, key, value);
  };
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'branchCreate', name: 'durable' },
      await f.workspace.status(id),
    ),
  ).rejects.toThrow('回执中断');
  expect(
    (await f.workspace.repository(id)).branches.some(branch => branch.name === 'durable'),
  ).toBe(true);
  fail = false;
  const reopened = createWorkspace(f.files, f.metadata, randomUUID);
  await reopened.recover();
  expect(
    (await reopened.repository(id)).branches.filter(branch => branch.name === 'durable'),
  ).toHaveLength(1);
  expect(
    (await f.metadata.all<{ state: string }>('git-operations')).map(operation => operation.state),
  ).toEqual(['completed']);
});

it('远程地址拒绝携带凭证，浏览器不会伪装已支持原生网络能力', async () => {
  const f = await fixture(),
    id = f.project.id;
  const status = await f.workspace.status(id);
  await expect(
    f.workspace.gitCommand(
      id,
      { method: 'remoteSave', name: 'origin', url: 'https://user:secret@example.com/repo' },
      status,
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await f.metadata.all('git-operations')).toEqual([]);
  await f.workspace.gitCommand(
    id,
    { method: 'remoteSave', name: 'origin', url: 'https://example.com/repo.git' },
    status,
  );
  const info = await f.workspace.repository(id);
  expect(info.remotes).toEqual([{ name: 'origin', url: 'https://example.com/repo.git' }]);
  expect(info.capabilities.fetch).toBe(false);
  await expect(
    f.workspace.gitCommand(id, { method: 'fetch', name: 'origin' }, status),
  ).rejects.toThrow('平台');
});
