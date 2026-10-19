import type { GitIndexState } from './merge';
import type { FileChange } from '../workspace/types';

export interface GitRebaseCommit {
  oid: string;
  message: string;
  parent: string | null;
  author: { name: string; email: string; time: number; offset: number };
}
export interface GitRebasePlan {
  kind: 'up-to-date' | 'fast-forward' | 'replay';
  onto: string;
  commits: GitRebaseCommit[];
}
export interface GitRebaseStep {
  changes: FileChange[];
  index: GitIndexState;
}
export interface GitRebaseSessionInfo {
  id: string;
  branch: string | null;
  ontoName: string;
  ontoOid: string;
  position: number;
  total: number;
  phase: 'ready' | 'conflicts';
  current?: { oid: string; message: string };
}
export interface GitBranchGuard {
  name: string;
  oid: string;
}
