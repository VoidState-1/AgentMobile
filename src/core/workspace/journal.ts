import type { FileChange } from './types';
import { AppError } from '../errors';

export interface JournalScope {
  namespace: 'projects' | 'skills';
  projectId: string;
}
export type OperationKind = 'files' | 'index' | 'commit' | 'files_commit';
export interface IndexChange {
  path: string;
  before: string | null;
  after: string | null;
}
export interface OperationBody {
  changes: FileChange[];
  indexChanges?: IndexChange[];
}
export interface OperationHeader {
  schemaVersion: 2;
  id: string;
  scope: JournalScope;
  sequence: number;
  revision: number;
  kind: OperationKind;
  phase: 'prepared' | 'applied' | 'checkpointed' | 'committed' | 'recorded';
  ownerRootRunId?: string;
  actorRunId?: string;
  proposalId?: string;
  mergedByRunId?: string;
  expectedHead: string;
  changedPaths: string[];
  bodyFingerprint: string;
  checkpoint?: string;
  indexBefore?: string;
  indexAfter?: string;
  commit?: string;
  message: string;
  createdAt: string;
}
export type OperationDraft = Omit<OperationHeader, 'sequence' | 'revision'>;
/** Hydrated only for one mutation/recovery. Never stored as a metadata record. */
export type Operation = OperationHeader & OperationBody;
export interface OperationQuery {
  scope?: JournalScope;
  namespace?: JournalScope['namespace'];
  ownerRootRunId?: string;
  pending?: boolean;
  beforeSequence?: number;
  limit: number;
}

export function sameOperation(previous: OperationHeader, draft: OperationDraft): boolean {
  return (
    previous.bodyFingerprint === draft.bodyFingerprint &&
    previous.kind === draft.kind &&
    previous.expectedHead === draft.expectedHead &&
    previous.message === draft.message &&
    previous.ownerRootRunId === draft.ownerRootRunId &&
    previous.actorRunId === draft.actorRunId &&
    previous.proposalId === draft.proposalId &&
    previous.mergedByRunId === draft.mergedByRunId
  );
}

export function assertOperationUpdate(
  previous: OperationHeader | undefined,
  next: OperationHeader,
  expectedRevision: number,
): void {
  const phases: OperationHeader['phase'][] = [
    'prepared',
    'applied',
    'checkpointed',
    'committed',
    'recorded',
  ];
  if (
    !previous ||
    previous.revision !== expectedRevision ||
    next.revision !== expectedRevision + 1 ||
    !sameOperation(previous, next) ||
    previous.phase === 'recorded' ||
    phases.indexOf(next.phase) < phases.indexOf(previous.phase) ||
    previous.sequence !== next.sequence ||
    previous.createdAt !== next.createdAt ||
    previous.schemaVersion !== next.schemaVersion ||
    previous.indexBefore !== next.indexBefore ||
    previous.indexAfter !== next.indexAfter ||
    (previous.checkpoint !== undefined && previous.checkpoint !== next.checkpoint) ||
    (previous.commit !== undefined && previous.commit !== next.commit) ||
    JSON.stringify(previous.changedPaths) !== JSON.stringify(next.changedPaths)
  )
    throw new AppError('CONFLICT', '操作回执版本或不可变意图已变化。');
}
