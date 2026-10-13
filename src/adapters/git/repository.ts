import * as git from 'isomorphic-git';
import type { HostFileSystem } from '@/core/storage/contracts';
import type { Version } from '@/core/prototype/types';
import type { GitPort } from '@/core/git/contracts';
import { gitFileSystem } from './filesystem';

export function createGitRepository(host: HostFileSystem): GitPort {
  const fs = gitFileSystem(host);
  const dir = (projectId: string) => '/workspaces/' + projectId + '/repository';
  const options = (projectId: string) => ({ fs, dir: dir(projectId) });
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
        oid, message: commit.message.trim(), timestamp: commit.author.timestamp * 1000,
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
  };
}
