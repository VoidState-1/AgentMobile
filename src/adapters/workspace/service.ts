import type { HostFileSystem, MetadataStore } from '@/core/storage/contracts';
import type { GitPort } from '@/core/git/contracts';
import { WorkspaceApplication } from '@/application/workspace/service';
import { createGitRepository } from '@/adapters/git/repository';
import { contentCodec } from '@/adapters/storage/codec';
export type { WorkspaceChange } from '@/core/workspace/types';

/** Compatibility construction for host callers; all use cases live in application. */
export class WorkspaceService extends WorkspaceApplication {
  constructor(fs: HostFileSystem, metadata: MetadataStore, id: () => string, changed: () => void = () => {}, git?: GitPort, automaticCommits = false) {
    super({ fs, metadata, id, changed, git: git ?? createGitRepository(fs), codec: contentCodec, automaticCommits });
  }
}
