import * as git from 'isomorphic-git';
import type { HostFileSystem } from '@/core/storage/contracts';
import type { Version } from '@/core/git/types';
import type { GitPort } from '@/core/git/contracts';
import { safePath } from '@/core/workspace/path';
import { gitFileSystem } from './filesystem';

export function createGitRepository(host: HostFileSystem): GitPort {
  const fs = gitFileSystem(host);
  const dir = (projectId: string) => '/workspaces/' + projectId + '/repository';
  const options = (projectId: string) => ({ fs, dir: dir(projectId) });
  const checkpointRef = (key: string) => { if (!/^[a-zA-Z0-9/-]+$/.test(key) || key.includes('..') || key.includes('//')) throw new Error('工作区检查点标识无效'); return 'refs/agent-mobile/checkpoints/' + key; };
  return {
    dir,
    async init(projectId: string) {
      await host.mkdir(dir(projectId));
      await git.init({ ...options(projectId), defaultBranch: 'main' });
    },
    head: (projectId: string) => git.resolveRef({ ...options(projectId), ref: 'HEAD' }),
    revision: async (bytes: Uint8Array) => (await git.hashBlob({ object: bytes })).oid,
    async commit(projectId: string, paths: string[], message: string) {
      for (const path of paths) {
        try {
          await host.stat(dir(projectId) + '/' + path);
          await git.add({ ...options(projectId), filepath: path });
        } catch (error) {
          if ((error as { code?: string }).code !== 'ENOENT') throw error;
          await git.remove({ ...options(projectId), filepath: path });
        }
      }
      return git.commit({
        ...options(projectId), message,
        author: { name: 'Agent Mobile', email: 'local@agentmobile.invalid' },
      });
    },
    async log(projectId: string): Promise<Version[]> {
      const commits = await git.log(options(projectId));
      return commits.map(({ oid, commit }) => ({
        oid, parentOid: commit.parent[0], message: commit.message.trim(), timestamp: commit.author.timestamp * 1000,
      }));
    },
    async findOperation(projectId: string, operationId: string) {
      const commits = await git.log(options(projectId));
      return commits.find(({ commit }) => commit.message.includes('AgentMobile-Operation: ' + operationId))?.oid;
    },
    async tree(projectId: string, ref: string): Promise<Record<string, Uint8Array>> {
      const paths = await git.listFiles({ ...options(projectId), ref });
      const files: Record<string, Uint8Array> = Object.create(null);
      for (const path of paths) {
        const { blob } = await git.readBlob({ ...options(projectId), oid: ref, filepath: path });
        files[path] = blob;
      }
      return files;
    },
    async entries(projectId, ref) {
      const entries = await git.walk({ ...options(projectId), trees: [git.TREE({ ref })], map: async (filepath, [entry]) =>
        entry && await entry.type() === 'blob' ? { path: filepath, revision: await entry.oid() } : undefined });
      return entries.filter((entry: { path: string; revision: string } | undefined): entry is { path: string; revision: string } => !!entry);
    },
    readAt: async (projectId, ref, filepath) => new Uint8Array((await git.readBlob({ ...options(projectId), oid: ref, filepath })).blob),
    blob: async (projectId, oid) => new Uint8Array((await git.readBlob({ ...options(projectId), oid })).blob),
    async index(projectId) {
      const entries = await git.walk({ ...options(projectId), trees: [git.STAGE()], map: async (filepath, [entry]) =>
        entry && await entry.type() === 'blob' ? [safePath(filepath), await entry.oid()] : undefined });
      return Object.fromEntries(entries.filter(Boolean));
    },
    async setIndex(projectId, entries) {
      for (const [filepath, oid] of Object.entries(entries)) {
        if (oid) await git.updateIndex({ ...options(projectId), filepath: safePath(filepath), oid, add: true, mode: 0o100644 });
        else await git.updateIndex({ ...options(projectId), filepath: safePath(filepath), remove: true, force: true });
      }
    },
    checkpointRef: async (projectId, key) => git.resolveRef({ ...options(projectId), ref: checkpointRef(key) }).catch(() => undefined),
    async checkpoint(projectId, files, key, parent) {
      const ref = checkpointRef(key); const existing = await git.resolveRef({ ...options(projectId), ref }).catch(() => undefined);
      if (existing) return existing;
      interface Directory { children: Map<string, Directory | { oid: string }> }
      const root: Directory = { children: new Map() };
      for (const [filepath, bytes] of Object.entries(files)) {
        const parts = safePath(filepath).split('/'); let folder = root;
        for (const part of parts.slice(0, -1)) {
          let child = folder.children.get(part); if (!child) { child = { children: new Map() }; folder.children.set(part, child); }
          if (!('children' in child)) throw new Error('工作区路径与文件冲突'); folder = child;
        }
        const name = parts[parts.length - 1]; if (folder.children.has(name)) throw new Error('工作区路径重复');
        folder.children.set(name, { oid: await git.writeBlob({ ...options(projectId), blob: bytes }) });
      }
      const writeTree = async (folder: Directory): Promise<string> => git.writeTree({ ...options(projectId), tree: await Promise.all([...folder.children].map(async ([path, child]) =>
        'children' in child ? { path, mode: '040000', type: 'tree' as const, oid: await writeTree(child) } : { path, mode: '100644', type: 'blob' as const, oid: child.oid })) });
      const oid = await git.commit({ ...options(projectId), tree: await writeTree(root), parent: [parent], noUpdateBranch: true,
        message: 'Agent Mobile internal checkpoint ' + key, author: { name: 'Agent Mobile', email: 'local@agentmobile.invalid' } });
      await git.writeRef({ ...options(projectId), ref, value: oid, force: true }); return oid;
    },
    async commitSnapshot(projectId, snapshot, message, expectedHead) {
      if (await git.resolveRef({ ...options(projectId), ref: 'HEAD' }) !== expectedHead) throw new Error('VERSION_CONFLICT：提交基线已变化');
      const { commit } = await git.readCommit({ ...options(projectId), oid: snapshot });
      return git.commit({ ...options(projectId), tree: commit.tree, parent: [expectedHead], message,
        author: { name: 'Agent Mobile', email: 'local@agentmobile.invalid' } });
    },
  };
}
