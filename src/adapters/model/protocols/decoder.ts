import type { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ModelRunSnapshot } from '@/core/models/types';
import type { NativeAssistant, PublicThinking, Wire } from './shared';

export interface DecoderState {
  reason: string; terminal: boolean; began: boolean;
  calls: Map<number, { id: string; name: string; json: string }>;
  blocks: Map<number, { type: string; index: number; json: string; closed: boolean }>;
}
export const decoderState = (): DecoderState => ({ reason: '', terminal: false, began: false, calls: new Map(), blocks: new Map() });
export interface DecoderContext {
  config: ModelRunSnapshot; message: NativeAssistant; stream: ReturnType<typeof createAssistantMessageEventStream>; requestId: number;
  visibility: PublicThinking['visibility'];
  closeContent(index: number): void;
  append(kind: 'text' | 'thinking', delta: string, visibility?: PublicThinking['visibility']): void;
  text(delta: string): void;
}
export interface ProtocolDecoder { consume(event: Wire, context: DecoderContext, state: DecoderState): void; finish(context: DecoderContext, state: DecoderState): void }
