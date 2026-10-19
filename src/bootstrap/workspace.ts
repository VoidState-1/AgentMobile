import type { HostFileSystem, CredentialStore } from '@/core/storage/contracts';
import type { BusinessStore } from '@/core/storage/business-store';
import type { GitPort } from '@/core/git/contracts';
import type { JournalScope } from '@/core/workspace/journal';
import { WorkspaceApplication } from '@/application/workspace/service';
import { OperationJournal } from '@/application/workspace/journal';
import { createGitRepository } from '@/adapters/git/platform';
import { contentCodec } from '@/adapters/storage/codec';

export function createWorkspace(
  fs: HostFileSystem,
  metadata: BusinessStore,
  id: () => string,
  options: {
    namespace?: JournalScope['namespace'];
    changed?: () => void;
    git?: GitPort;
    credentials?: CredentialStore;
  } = {},
): WorkspaceApplication {
  const git = options.git ?? createGitRepository(fs);
  const namespace = options.namespace ?? 'projects';
  return new WorkspaceApplication({
    fs,
    metadata,
    id,
    git,
    credentials: options.credentials,
    codec: contentCodec,
    changed: options.changed,
    projectBucket: namespace === 'skills' ? 'skill-projects' : 'projects',
    journal: new OperationJournal(metadata, namespace, git, contentCodec),
  });
}
