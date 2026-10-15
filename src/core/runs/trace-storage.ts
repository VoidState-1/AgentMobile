import { AppError } from '../errors';
import type { TraceItem } from '../trace';

export type TraceNode = (
  | Omit<
      Extract<TraceItem, { kind: 'tool' }>,
      'runId' | 'rootRunId' | 'runSequence' | 'groupSequence'
    >
  | Omit<
      Extract<TraceItem, { kind: 'text' | 'reasoning' }>,
      'text' | 'runId' | 'rootRunId' | 'runSequence' | 'groupSequence'
    >
) & {
  runId: string;
  rootRunId: string;
  runSequence: number;
  groupSequence: number;
  revision: number;
  textPreview: string;
  textCharacters: number;
  textChunks: number;
};
export interface TraceTextChunk {
  nodeId: string;
  ordinal: number;
  offset: number;
  text: string;
  characters: number;
}
export interface TranscriptFrame {
  runId: string;
  ordinal: number;
  schemaVersion: 1;
  payload: unknown;
}
export interface TraceWrite {
  nodes?: readonly { node: TraceNode; expectedRevision: number }[];
  chunks?: readonly TraceTextChunk[];
  frames?: readonly TranscriptFrame[];
}
export const traceLimits = {
  nodes: 50,
  maxNodes: 100,
  textCharacters: 12000,
  maxTextCharacters: 48000,
  chunkCharacters: 4000,
  previewCharacters: 200,
} as const;
export interface TracePage {
  nodes: TraceNode[];
  cursor?: string;
}
export interface TextPage {
  text: string;
  offset: number;
  totalCharacters: number;
  nextOffset?: number;
}
export function textEnd(text: string, offset: number, size: number): number {
  let end = Math.min(text.length, offset + size);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  return end;
}
export function assertTraceUpdate(
  previous: TraceNode | undefined,
  node: TraceNode,
  expectedRevision: number,
): void {
  if (
    (previous?.revision ?? 0) !== expectedRevision ||
    node.revision !== expectedRevision + 1 ||
    (previous &&
      (previous.runId !== node.runId ||
        previous.rootRunId !== node.rootRunId ||
        previous.kind !== node.kind ||
        previous.runSequence !== node.runSequence ||
        previous.groupSequence !== node.groupSequence ||
        node.textCharacters < previous.textCharacters ||
        node.textChunks < previous.textChunks ||
        (previous.state !== 'running' && previous.state !== node.state)))
  )
    throw new AppError('CONFLICT', '轨迹节点版本、归属或终态已变化。');
}
export function assertTraceAppend(
  previous: TraceNode | undefined,
  node: TraceNode,
  chunks: readonly TraceTextChunk[],
): void {
  const fresh = chunks
    .filter(chunk => chunk.nodeId === node.id && chunk.ordinal >= (previous?.textChunks ?? 0))
    .sort((a, b) => a.ordinal - b.ordinal);
  let offset = previous?.textCharacters ?? 0;
  let ordinal = previous?.textChunks ?? 0;
  for (const chunk of fresh) {
    if (
      node.kind === 'tool' ||
      chunk.ordinal !== ordinal++ ||
      chunk.offset !== offset ||
      chunk.characters !== chunk.text.length ||
      chunk.characters < 1
    )
      throw new AppError('CONFLICT', '轨迹文本块必须连续追加。');
    offset += chunk.characters;
  }
  if (offset !== node.textCharacters || ordinal !== node.textChunks)
    throw new AppError('CONFLICT', '轨迹正文与节点长度不一致。');
}
