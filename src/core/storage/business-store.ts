import type { MetadataEntry, MetadataStore } from './contracts';
import type {
  JournalScope,
  OperationBody,
  OperationDraft,
  OperationHeader,
  OperationQuery,
} from '../workspace/journal';
import type { RunHeader, RunInput, RunResult, RunWrite } from '../runs/records';
import type { RunHeaderQuery } from '../runs/queries';
import type { TraceNode, TraceTextChunk, TranscriptFrame, TraceWrite } from '../runs/trace-storage';

export const CURRENT_DATA_FORMAT = 'agent-mobile-f7';
export interface BusinessWriteBatch {
  metadata?: readonly MetadataEntry[];
  operations?: readonly { header: OperationHeader; expectedRevision: number }[];
  runs?: readonly RunWrite[];
  trace?: TraceWrite;
}
/** Typed same-database writes. Git, files and credentials are outside this transaction. */
export interface BusinessStore extends MetadataStore {
  readonly dataInstanceId: string;
  batch(entries: readonly MetadataEntry[]): Promise<void>;
  prepareOperation(draft: OperationDraft, body: OperationBody): Promise<OperationHeader>;
  operation(scope: JournalScope, id: string): Promise<OperationHeader | undefined>;
  operationBody(scope: JournalScope, id: string): Promise<OperationBody | undefined>;
  operations(query: OperationQuery): Promise<OperationHeader[]>;
  writeBusiness(batch: BusinessWriteBatch): Promise<void>;
  run(id: string): Promise<RunHeader | undefined>;
  runInput(id: string): Promise<RunInput | undefined>;
  runResult(id: string): Promise<RunResult | undefined>;
  runs(query: RunHeaderQuery): Promise<RunHeader[]>;
  traceNode(nodeId: string): Promise<TraceNode | undefined>;
  traceNodes(runId: string, afterSequence: number, limit: number): Promise<TraceNode[]>;
  traceChunks(nodeId: string, afterOrdinal: number, limit: number): Promise<TraceTextChunk[]>;
  traceTextRange(nodeId: string, offset: number, limit: number): Promise<TraceTextChunk[]>;
  transcriptFrames(runId: string, afterOrdinal: number, limit: number): Promise<TranscriptFrame[]>;
}
