import { AppError } from '../errors';

export interface OpenTextRegion {
  id: string;
  from: number;
  to: number;
  baseFrom: number;
  baseTo: number;
  original: string;
  link?: string;
}
export interface TextEditorState {
  base: string;
  text: string;
  regions: OpenTextRegion[];
  mode: 'blocks' | 'full';
  selection: { anchor: number; head: number };
}
export interface EditorDraft {
  format: 1;
  name: string;
  fresh: boolean;
  baseRevision: string | null;
  lineEnding: '\n' | '\r\n' | '\r';
  state: TextEditorState;
  /** Persisted before the separate workspace write, reconciled against disk on reopen. */
  pendingSave?: TextEditorState;
  saveOperationId?: string;
  savePath?: string;
}
export interface EditorDraftRecord {
  revision: number;
  draft: EditorDraft | null;
}
export const editorCharacterLimit = 1024 * 1024;
export const normalizeText = (text: string) => text.replace(/\r\n?/g, '\n');
export const textLineEnding = (text: string): EditorDraft['lineEnding'] =>
  text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';

/** Validate the browser boundary and persisted drafts with the same contract. */
export function validateEditorState(value: unknown): asserts value is TextEditorState {
  const fail = () => {
    throw new AppError('VALIDATION', '编辑状态无效，修改未写入文件。');
  };
  if (!value || typeof value !== 'object') return fail();
  const state = value as TextEditorState;
  for (const text of [state.base, state.text])
    if (typeof text !== 'string' || text.length > editorCharacterLimit || /[\0\r]/.test(text))
      fail();
  if (
    !['blocks', 'full'].includes(state.mode) ||
    !Array.isArray(state.regions) ||
    state.regions.length > 10000
  )
    fail();
  if (
    !state.selection ||
    ![state.selection.anchor, state.selection.head].every(
      position => Number.isInteger(position) && position >= 0 && position <= state.text.length,
    )
  )
    fail();
  let end = 0;
  let baseEnd = 0;
  const ids = new Set<string>();
  for (const region of state.regions) {
    if (
      !region ||
      typeof region !== 'object' ||
      typeof region.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(region.id) ||
      ids.has(region.id) ||
      (region.link !== undefined &&
        (typeof region.link !== 'string' || !/^[\w-]{1,100}$/.test(region.link))) ||
      ![region.from, region.to, region.baseFrom, region.baseTo].every(Number.isInteger) ||
      region.from < end ||
      region.to < region.from ||
      region.to > state.text.length ||
      region.baseFrom < baseEnd ||
      region.baseTo < region.baseFrom ||
      region.baseTo > state.base.length ||
      region.original !== state.base.slice(region.baseFrom, region.baseTo)
    )
      fail();
    ids.add(region.id);
    end = region.to;
    baseEnd = region.baseTo;
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const region of state.regions) {
    parts.push(state.base.slice(cursor, region.baseFrom), state.text.slice(region.from, region.to));
    cursor = region.baseTo;
  }
  parts.push(state.base.slice(cursor));
  if (parts.join('') !== state.text) fail();
  if (
    state.mode === 'full' &&
    (state.regions.length !== 1 ||
      state.regions[0].from !== 0 ||
      state.regions[0].to !== state.text.length ||
      state.regions[0].baseFrom !== 0 ||
      state.regions[0].baseTo !== state.base.length)
  )
    fail();
}

export function initialEditorState(text: string, full = false): TextEditorState {
  return {
    base: text,
    text,
    mode: full ? 'full' : 'blocks',
    selection: { anchor: 0, head: 0 },
    regions: full
      ? [
          {
            id: 'full-initial',
            from: 0,
            to: text.length,
            baseFrom: 0,
            baseTo: text.length,
            original: text,
          },
        ]
      : [],
  };
}
