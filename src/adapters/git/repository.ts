import { AppError } from '@/core/errors';
import { Buffer } from 'buffer';
import * as git from 'isomorphic-git';
import type { HostFileSystem } from '@/core/storage/contracts';
import type { Version } from '@/core/git/types';
import {
  gitHistoryLimits,
  type GitPort,
  type GitHistoryQuery,
  type GitHistoryPage,
} from '@/core/git/contracts';
import { safePath } from '@/core/workspace/path';
import { gitFileSystem } from './filesystem';
import {
  gitModes,
  sameEntry,
  storageMode,
  cloneTree,
  type GitTree,
  type GitEntry,
} from '@/core/git/objects';
import { sameHead } from '@/core/git/repository';
import type {
  GitRepositoryInfo,
  GitRepositoryCommand,
  GitRepositoryGuard,
} from '@/core/git/repository';

export function createGitRepository(host: HostFileSystem): GitPort {
  const fs = gitFileSystem(host);
  const dir = (projectId: string) => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(projectId))
      throw new AppError('VALIDATION', '工作区标识无效。');
    return '/workspaces/' + projectId + '/repository';
  };
  const options = (projectId: string) => ({ fs, dir: dir(projectId) });
  const identity = async (projectId: string) => ({
    name: (await git.getConfig({ ...options(projectId), path: 'user.name' })) ?? 'Agent Mobile',
    email:
      (await git.getConfig({ ...options(projectId), path: 'user.email' })) ??
      'local@agentmobile.invalid',
  });
  const repositoryInfo = async (projectId: string): Promise<GitRepositoryInfo> => {
    const opts = options(projectId);
    const branch = (await git.currentBranch({ ...opts, fullname: false })) ?? null;
    const oid = await git.resolveRef({ ...opts, ref: 'HEAD' }).catch(() => null);
    const names = await git.listBranches(opts);
    return {
      engine: 'isomorphic-git',
      version: '1.44.2',
      head: { kind: !oid ? 'unborn' : branch ? 'branch' : 'detached', oid, branch },
      branches: await Promise.all(
        names.map(async name => ({
          name,
          oid: await git.resolveRef({ ...opts, ref: 'refs/heads/' + name }),
          remote: false,
          current: name === branch,
        })),
      ),
      remotes: (await git.listRemotes(opts)).map(remote => ({
        name: remote.remote,
        url: remote.url,
      })),
      tags: await Promise.all(
        (await git.listTags(opts)).map(async name => ({
          name,
          oid: await git.resolveRef({ ...opts, ref: 'refs/tags/' + name }),
        })),
      ),
      state: 'none',
      conflicts: [],
      identity: await identity(projectId),
      capabilities: {
        fetch: false,
        push: false,
        clone: false,
        merge: false,
        rebase: false,
      },
    };
  };
  const repositoryCommand = async (
    projectId: string,
    command: Exclude<GitRepositoryCommand, { method: 'checkout' }>,
    guard: GitRepositoryGuard,
  ) => {
    const opts = options(projectId);
    const before = await repositoryInfo(projectId);
    if (guard.head !== before.head.oid || guard.branch !== before.head.branch)
      throw new AppError('CONFLICT', 'VERSION_CONFLICT：当前分支或提交已变化');
    switch (command.method) {
      case 'identity':
        await git.setConfig({ ...opts, path: 'user.name', value: command.name });
        await git.setConfig({ ...opts, path: 'user.email', value: command.email });
        return;
      case 'branchCreate':
        await git.branch({ ...opts, ref: command.name, object: command.ref });
        return;
      case 'branchDelete': {
        const info = await repositoryInfo(projectId);
        if (info.head.branch === command.name) throw new AppError('VALIDATION', '不能删除当前分支');
        const target = await git.resolveRef({ ...opts, ref: 'refs/heads/' + command.name });
        if (
          target !== info.head.oid &&
          !(await git.isDescendent({ ...opts, oid: info.head.oid!, ancestor: target }))
        )
          throw new AppError('VALIDATION', '分支尚未合入当前分支');
        await git.deleteBranch({ ...opts, ref: command.name });
        return;
      }
      case 'tagCreate':
        await git.tag({ ...opts, ref: command.name });
        return;
      case 'tagDelete':
        await git.deleteTag({ ...opts, ref: command.name });
        return;
      case 'remoteSave': {
        const exists = (await git.listRemotes(opts)).some(remote => remote.remote === command.name);
        if (exists)
          await git.setConfig({ ...opts, path: `remote.${command.name}.url`, value: command.url });
        else await git.addRemote({ ...opts, remote: command.name, url: command.url });
        return;
      }
      case 'fetch':
      case 'push':
      case 'verifyPush':
        throw new AppError('VALIDATION', '浏览器版暂不支持远程 Git 传输，请使用原生应用');
      case 'upstream': {
        if (!before.branches.some(branch => branch.name === command.name && !branch.remote))
          throw new AppError('VALIDATION', '本地分支不存在。');
        if (command.upstream === null) {
          await git.setConfig({ ...opts, path: `branch.${command.name}.remote`, value: undefined });
          await git.setConfig({ ...opts, path: `branch.${command.name}.merge`, value: undefined });
        } else {
          const remote = before.remotes.find(remote =>
            command.upstream!.startsWith(remote.name + '/'),
          );
          if (!remote) throw new AppError('VALIDATION', '远程分支不存在。');
          await git.setConfig({
            ...opts,
            path: `branch.${command.name}.remote`,
            value: remote.name,
          });
          await git.setConfig({
            ...opts,
            path: `branch.${command.name}.merge`,
            value: 'refs/heads/' + command.upstream.slice(remote.name.length + 1),
          });
        }
        return;
      }
    }
  };
  const checkpointBlob = async (projectId: string, bytes: Uint8Array): Promise<string> => {
    const { oid } = await git.hashBlob({ object: bytes });
    try {
      const existing = await git.readBlob({ ...options(projectId), oid });
      if (
        existing.blob.length !== bytes.length ||
        !bytes.every((value, index) => value === existing.blob[index])
      )
        throw new AppError('STORAGE', 'Git 对象内容校验失败，请保留数据并核对工作区。');
      return oid;
    } catch (error) {
      if ((error as { code?: string }).code === 'NotFoundError')
        return git.writeBlob({ ...options(projectId), blob: bytes });
      if (error instanceof AppError) throw error;
      throw new AppError('STORAGE', 'Git 对象无法读取，请保留数据并核对工作区。');
    }
  };
  const checkpointRef = (key: string) => {
    if (!/^[a-zA-Z0-9/-]+$/.test(key) || key.includes('..') || key.includes('//'))
      throw new AppError('VALIDATION', '工作区检查点标识无效');
    return 'refs/agent-mobile/checkpoints/' + key;
  };
  const historyPage = async (
    projectId: string,
    query: GitHistoryQuery = {},
  ): Promise<GitHistoryPage> => {
    const limit = query.limit ?? gitHistoryLimits.page;
    if (!Number.isInteger(limit) || limit < 1 || limit > gitHistoryLimits.maxPage)
      throw new AppError('VALIDATION', 'Git 历史每页需要 1–100 条。');
    let position: { projectId: string; head: string; offset: number } | undefined;
    if (query.cursor) {
      try {
        position = JSON.parse(query.cursor);
      } catch {
        throw new AppError('CONFLICT', 'Git 历史游标无效，请重新读取。');
      }
      if (
        !position ||
        position.projectId !== projectId ||
        (query.head && query.head !== position.head) ||
        !/^[a-f0-9]{40}$/.test(position.head) ||
        !Number.isSafeInteger(position.offset) ||
        position.offset < 0
      )
        throw new AppError('CONFLICT', 'Git 历史游标不属于此项目或固定版本。');
    }
    const head =
      position?.head ??
      query.head ??
      (await git.resolveRef({ ...options(projectId), ref: 'HEAD' }).catch(() => null));
    if (!head) return { head: null, versions: [] };
    if (!/^[a-f0-9]{40}$/.test(head))
      throw new AppError('VALIDATION', 'Git 历史需要明确的提交 OID。');
    const offset = position?.offset ?? 0;
    const commits: Awaited<ReturnType<typeof git.readCommit>>[] = [];
    const pending = [await git.readCommit({ ...options(projectId), oid: head })];
    const queued = new Set([head]);
    let shallow = new Set<string>();
    try {
      shallow = new Set(
        Buffer.from(await host.read(dir(projectId) + '/.git/shallow'))
          .toString('utf8')
          .trim()
          .split(/\s+/),
      );
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
    while (pending.length && commits.length < offset + limit + 1) {
      pending.sort(
        (a, b) =>
          b.commit.committer.timestamp - a.commit.committer.timestamp || a.oid.localeCompare(b.oid),
      );
      const entry = pending.shift()!;
      commits.push(entry);
      if (shallow.has(entry.oid)) continue;
      for (const parent of entry.commit.parent)
        if (!queued.has(parent)) {
          queued.add(parent);
          pending.push(await git.readCommit({ ...options(projectId), oid: parent }));
        }
    }
    const versions: Version[] = commits.slice(offset, offset + limit).map(entry => ({
      oid: entry.oid,
      parents: entry.commit.parent,
      message: entry.commit.message.trim(),
      timestamp: entry.commit.author.timestamp * 1000,
      author: { name: entry.commit.author.name, email: entry.commit.author.email },
      committer: { name: entry.commit.committer.name, email: entry.commit.committer.email },
    }));
    return {
      head,
      versions,
      cursor:
        commits.length > offset + limit
          ? JSON.stringify({ projectId, head, offset: offset + limit })
          : undefined,
    };
  };
  const repository: GitPort = {
    indexState: async id => ({ entries: await repository.index(id), conflicts: [] }),
    setIndexState: async (id, entries, before, after) => {
      if (before.length || after.length)
        throw new AppError('VALIDATION', '当前平台尚未支持三方冲突索引。');
      await repository.setIndex(id, entries);
    },
    gitState: async () => ({
      MERGE_HEAD: null,
      MERGE_MSG: null,
      MERGE_MODE: null,
      ORIG_HEAD: null,
    }),
    applyGitState: async () => {
      throw new AppError('VALIDATION', '当前平台尚未支持合并状态。');
    },
    operationReceipt: async () => undefined,
    completeOperation: async () => {
      throw new AppError('VALIDATION', '当前平台尚未支持合并操作。');
    },
    mergePlan: async () => {
      throw new AppError('VALIDATION', '合并请使用原生应用。');
    },
    rebasePlan: async () => {
      throw new AppError('VALIDATION', '变基请使用原生应用。');
    },
    rebaseStep: async () => {
      throw new AppError('VALIDATION', '变基请使用原生应用。');
    },
    rebaseCommit: async () => {
      throw new AppError('VALIDATION', '变基请使用原生应用。');
    },
    mergeCommit: async () => {
      throw new AppError('VALIDATION', '合并请使用原生应用。');
    },
    filterEntries: async () => {
      throw new AppError('VALIDATION', '当前平台尚未支持冻结属性过滤。');
    },
    // This adapter does not create persistent libgit2 lockfiles.
    recoverLocks: async () => {},
    clone: async () => {
      throw new AppError('VALIDATION', '浏览器版暂不支持克隆，请使用原生应用。');
    },
    cloneState: async () => 'absent',
    publishClone: async () => {
      throw new AppError('VALIDATION', '浏览器版暂不支持克隆。');
    },
    discardClone: async () => {},
    remoteHead: async () => {
      throw new AppError('VALIDATION', '浏览器版暂不支持远程 Git 传输。');
    },
    repositoryInfo,
    repositoryCommand,
    dir,
    async switchPlan(projectId, target) {
      const head = await repository.head(projectId),
        committed = await repository.tree(projectId, head),
        wanted = await repository.tree(projectId, target);
      const paths = [...new Set([...Object.keys(committed), ...Object.keys(wanted)])];
      const working = await repository.workingTree(projectId);
      const changes = [];
      for (const path of paths) {
        const before = working[path] ?? null,
          after = wanted[path] ?? null;
        if (!committed[path] && before && !sameEntry(before, after))
          throw new AppError('CONFLICT', '目标分支会覆盖现有文件：' + path);
        if (after && after.mode !== gitModes.file && after.mode !== before?.mode)
          throw new AppError('VALIDATION', '当前平台不支持创建此文件模式：' + path);
        if (!sameEntry(before, after)) changes.push({ path, before, after });
      }
      return { changes, index: wanted };
    },
    async changeHead(projectId, before, after, branchGuard) {
      if (branchGuard) throw new AppError('VALIDATION', '当前平台尚未支持变基分支更新。');
      const opts = options(projectId);
      const current = {
        oid: await repository.head(projectId),
        branch: await repository.branch(projectId),
      };
      if (sameHead(current, after)) return;
      if (!sameHead(current, before))
        throw new AppError('CONFLICT', '当前分支或提交与切换意图不匹配。');
      if (after.branch) {
        const ref = 'refs/heads/' + after.branch;
        const target = await git.resolveRef({ ...opts, ref }).catch(() => null);
        if (target !== after.oid) {
          if (after.branch !== before.branch || target !== before.oid || !after.oid)
            throw new AppError('CONFLICT', '目标分支已变化。');
          await git.writeRef({ ...opts, ref, value: after.oid, force: target !== null });
        }
        await git.writeRef({ ...opts, ref: 'HEAD', value: ref, force: true, symbolic: true });
      } else {
        if (!after.oid) throw new AppError('VALIDATION', '分离 HEAD 需要明确提交。');
        await git.writeRef({ ...opts, ref: 'HEAD', value: after.oid, force: true });
      }
    },
    async init(projectId) {
      await host.mkdir(dir(projectId));
      await git.init({ ...options(projectId), defaultBranch: 'main' });
    },
    head: projectId =>
      git.resolveRef({ ...options(projectId), ref: 'HEAD' }).catch(error => {
        if (error.code === 'NotFoundError') return null;
        throw error;
      }),
    branch: async projectId =>
      (await git.currentBranch({ ...options(projectId), fullname: false })) ?? null,
    revision: async bytes => (await git.hashBlob({ object: bytes })).oid,
    writeBlob: checkpointBlob,
    async commit(projectId, paths, message) {
      await repository.setIndex(projectId, await repository.stageEntries(projectId, paths));
      return git.commit({ ...options(projectId), message, author: await identity(projectId) });
    },
    historyPage,
    async findOperation(projectId, operationId) {
      let cursor: string | undefined;
      do {
        const page = await historyPage(projectId, { cursor, limit: 100 });
        const found = page.versions.find(version =>
          version.message.split(/\r?\n/).includes('AgentMobile-Operation: ' + operationId),
        );
        if (found) return found.oid;
        cursor = page.cursor;
      } while (cursor);
      return undefined;
    },
    async entries(projectId, ref) {
      if (!ref) return [];
      const entries = await git.walk({
        ...options(projectId),
        trees: [git.TREE({ ref })],
        map: async (path, [entry]) =>
          entry && (await entry.type()) !== 'tree'
            ? { path: safePath(path), revision: await entry.oid(), mode: await entry.mode() }
            : undefined,
      });
      return entries.filter(
        (entry: ({ path: string } & GitEntry) | undefined): entry is { path: string } & GitEntry =>
          !!entry,
      );
    },
    async tree(projectId, ref) {
      return cloneTree(
        Object.fromEntries(
          (await repository.entries(projectId, ref)).map(({ path, ...entry }) => [path, entry]),
        ),
      );
    },
    readAt: async (projectId, ref, filepath) =>
      new Uint8Array(
        (await git.readBlob({ ...options(projectId), oid: ref, filepath: safePath(filepath) }))
          .blob,
      ),
    blob: async (projectId, oid) => {
      try {
        return new Uint8Array((await git.readBlob({ ...options(projectId), oid })).blob);
      } catch {
        throw new AppError('STORAGE', 'Git 对象无法读取，请保留数据并核对仓库。');
      }
    },
    blobInfo: async (projectId, oid) => ({ size: (await repository.blob(projectId, oid)).length }),
    async index(projectId) {
      const entries = await git.walk({
        ...options(projectId),
        trees: [git.STAGE()],
        map: async (path, [entry]) =>
          entry && (await entry.type()) !== 'tree'
            ? [safePath(path), { revision: await entry.oid(), mode: await entry.mode() }]
            : undefined,
      });
      return cloneTree(Object.fromEntries(entries.filter(Boolean)));
    },
    async setIndex(projectId, entries) {
      for (const [path, entry] of Object.entries(entries)) {
        if (entry)
          await git.updateIndex({
            ...options(projectId),
            filepath: safePath(path),
            oid: entry.revision,
            mode: entry.mode,
            add: true,
          });
        else
          await git.updateIndex({
            ...options(projectId),
            filepath: safePath(path),
            remove: true,
            force: true,
          });
      }
    },
    async workingTree(projectId, selected) {
      const tree: GitTree = Object.create(null);
      const add = async (path: string) => {
        safePath(path);
        try {
          const info = await host.stat(dir(projectId) + '/' + path);
          if (info.kind === 'directory') return;
          tree[path] = {
            revision: await checkpointBlob(projectId, await host.read(dir(projectId) + '/' + path)),
            mode: storageMode(info),
          };
        } catch (error) {
          if (
            (error as { code?: string }).code !== 'ENOENT' &&
            (error as { code?: string }).code !== 'ENOTDIR'
          )
            throw error;
        }
      };
      if (selected) for (const path of selected) await add(path);
      else {
        const visit = async (prefix: string) => {
          for (const name of await host.list(dir(projectId) + (prefix ? '/' + prefix : ''))) {
            if (name.toLowerCase() === '.git') continue;
            const path = safePath(prefix ? prefix + '/' + name : name);
            const info = await host.stat(dir(projectId) + '/' + path);
            if (info.kind === 'directory') await visit(path);
            else await add(path);
          }
        };
        await visit('');
      }
      return tree;
    },
    async stageEntries(projectId, paths) {
      const tracked = await repository.index(projectId),
        working = await repository.workingTree(projectId, paths);
      const output: Record<string, GitEntry | null> = Object.create(null);
      for (const path of paths) {
        if (
          !tracked[path] &&
          (await git.isIgnored({ ...options(projectId), filepath: safePath(path) }))
        )
          throw new AppError('VALIDATION', '文件被 .gitignore 忽略。');
        output[path] = working[path] ?? null;
      }
      return output;
    },
    async applyWorktree(projectId, changes, move) {
      const current = await repository.workingTree(projectId);
      const target = cloneTree(current);
      for (const change of changes) {
        safePath(change.path);
        if (
          !sameEntry(current[change.path], change.before) &&
          !sameEntry(current[change.path], change.after)
        )
          throw new AppError('CONFLICT', '文件与恢复意图不匹配，未覆盖当前内容。');
        if (
          change.after &&
          change.after.mode !== gitModes.file &&
          change.after.mode !== change.before?.mode
        )
          throw new AppError('VALIDATION', '当前平台不能创建符号链接或改变执行权限。');
        if (change.after) {
          await repository.blobInfo(projectId, change.after.revision);
          target[change.path] = change.after;
        } else delete target[change.path];
      }
      for (const path of Object.keys(target)) {
        const parts = path.split('/');
        parts.pop();
        while (parts.length) {
          if (target[parts.join('/')])
            throw new AppError('CONFLICT', '文件与目录路径冲突，未覆盖现有内容。');
          parts.pop();
        }
      }
      const pending = changes
        .filter(change => !sameEntry(current[change.path], change.after))
        .sort((left, right) =>
          left.after === null && right.after !== null
            ? -1
            : left.after !== null && right.after === null
              ? 1
              : left.after === null
                ? right.path.length - left.path.length
                : left.path.length - right.path.length,
        );
      if (move && pending.length === 2) {
        if (
          changes.length !== 2 ||
          changes[0].path !== move.from ||
          changes[0].after !== null ||
          changes[1].path !== move.to ||
          changes[1].before !== null ||
          !sameEntry(changes[0].before, changes[1].after)
        )
          throw new AppError('STORAGE', '移动意图不匹配。');
        await host.moveFile(
          dir(projectId) + '/' + safePath(move.from),
          dir(projectId) + '/' + safePath(move.to),
        );
      } else
        for (const change of pending) {
          const path = dir(projectId) + '/' + safePath(change.path);
          if (!change.after) await host.remove(path);
          else {
            const removeEmpty = async (directory: string): Promise<void> => {
              for (const name of await host.list(directory)) {
                const child = directory + '/' + name;
                if ((await host.stat(child)).kind !== 'directory')
                  throw new AppError('CONFLICT', '目标目录仍有未处理内容。');
                await removeEmpty(child);
              }
              await host.remove(directory);
            };
            try {
              if ((await host.stat(path)).kind === 'directory') await removeEmpty(path);
            } catch (error) {
              if (
                (error as { code?: string }).code !== 'ENOENT' &&
                (error as { code?: string }).code !== 'ENOTDIR'
              )
                throw error;
            }
            await host.write(path, await repository.blob(projectId, change.after.revision));
          }
        }
      const result = await repository.workingTree(projectId);
      if (changes.some(change => !sameEntry(result[change.path], change.after)))
        throw new AppError('STORAGE', '文件写入结果与恢复意图不匹配。');
    },
    async status(projectId, descriptors) {
      const head = await repository.head(projectId),
        committed = await repository.tree(projectId, head),
        index = await repository.index(projectId);
      const working: GitTree = descriptors
        ? cloneTree(
            Object.fromEntries(
              descriptors.map(file => [
                file.path,
                { revision: file.revision, mode: file.mode ?? gitModes.file },
              ]),
            ),
          )
        : await repository.workingTree(projectId);
      const files = [];
      const change = (before: GitEntry | undefined, after: GitEntry | undefined) =>
        sameEntry(before, after)
          ? undefined
          : !before
            ? ('added' as const)
            : !after
              ? ('deleted' as const)
              : ('modified' as const);
      for (const path of [
        ...new Set([...Object.keys(committed), ...Object.keys(index), ...Object.keys(working)]),
      ].sort()) {
        if (
          !committed[path] &&
          !index[path] &&
          (await git.isIgnored({ ...options(projectId), filepath: path }))
        )
          continue;
        const staged = change(committed[path], index[path]),
          unstaged = change(index[path], working[path]);
        if (staged || unstaged)
          files.push({
            path,
            headRevision: committed[path]?.revision ?? null,
            indexRevision: index[path]?.revision ?? null,
            workingRevision: working[path]?.revision ?? null,
            headMode: committed[path]?.mode ?? null,
            indexMode: index[path]?.mode ?? null,
            workingMode: working[path]?.mode ?? null,
            staged,
            unstaged,
          });
      }
      const fingerprint = (tree: GitTree) =>
        repository.revision(
          Buffer.from(JSON.stringify(Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)))),
        );
      return {
        head,
        branch: await repository.branch(projectId),
        state: 'none',
        files,
        indexRevision: await fingerprint(index),
        workingRevision: await fingerprint(working),
      };
    },
    async uncommittedPaths(projectId, head, indexSnapshot, workingSnapshot, paths) {
      const committed = await repository.tree(projectId, head),
        index = await repository.tree(projectId, indexSnapshot),
        working = await repository.tree(projectId, workingSnapshot);
      return paths.filter(
        path => !sameEntry(committed[path], index[path]) || !sameEntry(index[path], working[path]),
      );
    },
    checkpointRef: async (projectId, key) =>
      git.resolveRef({ ...options(projectId), ref: checkpointRef(key) }).catch(() => undefined),
    async checkpoint(projectId, files, key, parent) {
      const ref = checkpointRef(key),
        existing = await git.resolveRef({ ...options(projectId), ref }).catch(() => undefined);
      if (existing) return existing;
      interface Directory {
        children: Map<string, Directory | GitEntry>;
      }
      const root: Directory = { children: new Map() };
      for (const [path, entry] of Object.entries(files)) {
        const parts = safePath(path).split('/');
        let folder = root;
        for (const part of parts.slice(0, -1)) {
          let child = folder.children.get(part);
          if (!child) {
            child = { children: new Map() };
            folder.children.set(part, child);
          }
          if (!('children' in child)) throw new AppError('VALIDATION', '工作区路径与文件冲突');
          folder = child;
        }
        if (entry.mode !== gitModes.gitlink) {
          const bytes = await repository.blob(projectId, entry.revision);
          if ((await repository.revision(bytes)) !== entry.revision)
            throw new AppError('STORAGE', 'Git 对象内容校验失败。');
        }
        folder.children.set(parts.at(-1)!, entry);
      }
      const writeTree = async (folder: Directory): Promise<string> =>
        git.writeTree({
          ...options(projectId),
          tree: await Promise.all(
            [...folder.children].map(async ([path, child]) =>
              'children' in child
                ? { path, mode: '040000', type: 'tree' as const, oid: await writeTree(child) }
                : {
                    path,
                    mode: child.mode.toString(8),
                    type: child.mode === gitModes.gitlink ? ('commit' as const) : ('blob' as const),
                    oid: child.revision,
                  },
            ),
          ),
        });
      const oid = await git.commit({
        ...options(projectId),
        tree: await writeTree(root),
        parent: parent ? [parent] : [],
        noUpdateBranch: true,
        message: 'Agent Mobile internal checkpoint ' + key,
        author: { name: 'Agent Mobile', email: 'local@agentmobile.invalid' },
      });
      await git.writeRef({ ...options(projectId), ref, value: oid, force: true });
      return oid;
    },
    async commitSnapshot(projectId, snapshot, message, expectedHead) {
      if ((await repository.head(projectId)) !== expectedHead)
        throw new AppError('CONFLICT', 'VERSION_CONFLICT：提交基线已变化');
      const { commit } = await git.readCommit({ ...options(projectId), oid: snapshot });
      return git.commit({
        ...options(projectId),
        tree: commit.tree,
        parent: expectedHead ? [expectedHead] : [],
        message,
        author: await identity(projectId),
      });
    },
  };
  return repository;
}
