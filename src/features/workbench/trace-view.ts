import type { DisplayTrace } from '@/core/runs/queries';
import type { TraceNode } from '@/core/runs/trace-storage';

export function traceView(node: TraceNode): DisplayTrace {
  return node.kind === 'tool' ? node : { ...node, text: node.textPreview };
}
