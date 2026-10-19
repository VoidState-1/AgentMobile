import type { GitTree } from './objects';
import type { FileChange } from '../workspace/types';
export interface GitIdentity {
  name: string;
  email: string;
}
export interface GitBranch {
  name: string;
  oid: string;
  remote: boolean;
  current: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}
export interface GitConflictEntry {
  path: string;
  oid: string;
  mode: number;
}
export interface GitConflict {
  path: string;
  base: GitConflictEntry | null;
  ours: GitConflictEntry | null;
  theirs: GitConflictEntry | null;
}
export interface GitRepositoryInfo {
  merge?: import('./merge').GitMergeSessionInfo;
  rebase?: import('./rebase').GitRebaseSessionInfo;
  pendingPushes?: { id: string; name: string; branch: string; oid: string }[];
  engine: 'libgit2' | 'isomorphic-git';
  version: string;
  head: { kind: 'unborn' | 'branch' | 'detached'; oid: string | null; branch: string | null };
  branches: GitBranch[];
  remotes: { name: string; url: string; credentialUsername?: string }[];
  tags: { name: string; oid: string }[];
  state: 'none' | 'merge' | 'rebase' | 'other';
  conflicts: GitConflict[];
  identity: GitIdentity;
  capabilities: {
    fetch: boolean;
    push: boolean;
    clone: boolean;
    merge: boolean;
    rebase: boolean;
  };
}
export type GitRepositoryCommand =
  | { method: 'identity'; name: string; email: string }
  | { method: 'branchCreate'; name: string; ref?: string }
  | { method: 'branchDelete'; name: string }
  | { method: 'checkout'; name: string }
  | { method: 'tagCreate'; name: string }
  | { method: 'tagDelete'; name: string }
  | { method: 'remoteSave'; name: string; url: string }
  | { method: 'fetch'; name: string }
  | { method: 'push'; name: string; branch: string }
  | { method: 'verifyPush'; id: string }
  | { method: 'upstream'; name: string; upstream: string | null };
export interface GitCommandResult {
  verification?: { matched: boolean; actual: string | null; target: string };
}
export interface GitRepositoryGuard {
  operationId: string;
  head: string | null;
  branch: string | null;
  remoteHead?: string | null;
}
export interface GitTransferProgress {
  phase: string;
  completed: number;
  total: number;
  bytes: number;
}
export interface GitTransportOptions {
  operationId: string;
  signal?: AbortSignal;
  progress?: (value: GitTransferProgress) => void;
  credential?: { username: string; password: string };
}
export interface GitTransferState extends GitTransferProgress {
  projectId: string;
  method: 'fetch' | 'push' | 'verifyPush' | 'clone';
  name: string;
  state: 'running' | 'completed' | 'cancelled' | 'failed' | 'unknown';
}
export interface GitCredentialInput {
  username: string;
  token: string;
}
export interface GitCloneInput {
  name: string;
  url: string;
}
export type GitCloneState = 'absent' | 'incomplete' | 'ready' | 'published';
export interface GitRefState {
  branch: string | null;
  oid: string | null;
}
export interface GitSwitchPlan {
  changes: FileChange[];
  index: GitTree;
}
export function sameHead(left: GitRefState, right: GitRefState): boolean {
  return left.branch === right.branch && left.oid === right.oid;
}
