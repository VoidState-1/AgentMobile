import type { HostFileSystem } from '@/core/storage/contracts';
import { createGitRepository as createBrowserRepository } from './repository';

/** Browser/Node adapter. React Native resolves platform.native.ts. */
export function createGitRepository(host: HostFileSystem) {
  return createBrowserRepository(host);
}
