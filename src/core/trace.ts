export type TraceState = 'running' | 'completed' | 'error' | 'cancelled' | 'interrupted' | 'unknown';
interface TraceBase {
  id: string;
  round: number;
  startedAt: string;
  endedAt?: string;
  state: TraceState;
  /** Assigned by the recorder before persistence; never derived from timestamps. */
  runId?: string;
  rootRunId?: string;
  parentRunId?: string;
  runSequence?: number;
  groupSequence?: number;
}
export interface ContentTrace extends TraceBase {
  kind: 'text' | 'reasoning';
  contentIndex: number;
  text: string;
  visibility?: 'reasoning' | 'summary' | 'unavailable';
}
export interface ToolTrace extends TraceBase {
  kind: 'tool';
  callId: string;
  tool: string;
  label?: string;
  target?: string;
  input: string;
  output?: string;
  durationMs?: number;
  childRunIds?: string[];
}
export type TraceItem = ContentTrace | ToolTrace;

/** Upsert by provider content index, preserving first-observed order. */
export function recordContent(trace: TraceItem[], item: Omit<ContentTrace, 'startedAt' | 'state'>,
  now: string, ended = false): void {
  const previous = trace.find((entry): entry is ContentTrace => entry.kind !== 'tool' && entry.id === item.id);
  if (previous) {
    previous.text = item.text;
    previous.visibility = item.visibility;
    if (ended) { previous.state = 'completed'; previous.endedAt = now; }
  } else trace.push({ ...item, startedAt: now, state: ended ? 'completed' : 'running', ...(ended ? { endedAt: now } : {}) });
}
export function finishTool(trace: TraceItem[], round: number, callId: string, output: string, error: boolean, now: string, durationMs?: number): void {
  const item = trace.find((entry): entry is ToolTrace => entry.kind === 'tool' && entry.round === round && entry.callId === callId);
  if (item) { item.output = output; item.state = error ? 'error' : 'completed'; item.endedAt = now; item.durationMs = durationMs; }
}
/** Also used during startup recovery; finished steps are never rewritten. */
export function settleTrace(trace: TraceItem[] | undefined, state: Exclude<TraceState, 'running'>, now: string): TraceItem[] | undefined {
  return trace?.map((item) => item.state === 'running' ? { ...item, state, endedAt: now } : { ...item });
}
