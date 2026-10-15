import type { HostFileSystem } from '@/core/storage/contracts';
import type { BusinessStore } from '@/core/storage/business-store';
import type { ContentCodec } from '@/core/storage/codec';
import type { GitPort } from '@/core/git/contracts';
import type { OperationJournal } from './journal';

export interface WorkspaceContext {
  fs: HostFileSystem;
  metadata: BusinessStore;
  journal: OperationJournal;
  projectBucket: 'projects' | 'skill-projects';
  git: GitPort;
  codec: ContentCodec;
  id(): string;
  changed?(): void;
}
