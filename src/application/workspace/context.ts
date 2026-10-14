import type { HostFileSystem, MetadataStore } from '@/core/storage/contracts';
import type { ContentCodec } from '@/core/storage/codec';
import type { GitPort } from '@/core/git/contracts';

export interface WorkspaceContext {
  fs: HostFileSystem;
  metadata: MetadataStore;
  git: GitPort;
  codec: ContentCodec;
  id(): string;
  changed?(): void;
  /** Internal skill-package versions; normal project saves never commit. */
  automaticCommits?: boolean;
}
