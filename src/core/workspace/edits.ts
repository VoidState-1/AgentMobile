import { contentLimits } from '@/core/agent/settings';
import { AppError } from '@/core/errors';

export interface TextEdit {
  oldText: string;
  newText: string;
}
export const textEditLimits = { edits: 100, characters: contentLimits.toolTextCharacters } as const;
export interface TextEditChange extends TextEdit {
  edit: number;
  line: number;
}
export interface TextEditOutcome {
  revision: string;
  changed: boolean;
  replayed: boolean;
  changes: TextEditChange[];
}

function validUnicode(text: string) {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Copies mutable tool input before the first await; never normalizes source or edits. */
export function validateTextEdits(edits: readonly TextEdit[]): TextEdit[] {
  if (!Array.isArray(edits) || !edits.length || edits.length > textEditLimits.edits)
    throw new AppError('VALIDATION', 'edits 需要包含 1–100 项精确替换。');
  let characters = 0;
  return edits.map((edit, index) => {
    if (
      !edit ||
      typeof edit.oldText !== 'string' ||
      !edit.oldText ||
      typeof edit.newText !== 'string'
    )
      throw new AppError(
        'VALIDATION',
        `第 ${index + 1} 项需要非空 oldText 和字符串 newText；删除使用空 newText。`,
      );
    if (
      !validUnicode(edit.oldText) ||
      !validUnicode(edit.newText) ||
      edit.oldText.includes('\0') ||
      edit.newText.includes('\0')
    )
      throw new AppError('VALIDATION', `第 ${index + 1} 项包含 NUL 或不完整 Unicode 字符。`);
    characters += edit.oldText.length + edit.newText.length;
    if (characters > textEditLimits.characters)
      throw new AppError('LIMIT', '整批 oldText/newText 合计最多 240,000 个 UTF-16 单位。');
    return { oldText: edit.oldText, newText: edit.newText };
  });
}

/** Every match is located in the original source, including overlapping occurrences. */
export function applyTextEdits(source: string, edits: readonly TextEdit[]) {
  const matches = validateTextEdits(edits)
    .map((edit, index) => {
      const start = source.indexOf(edit.oldText);
      if (start < 0)
        throw new AppError(
          'CONFLICT',
          `第 ${index + 1} 项 oldText 没有匹配。请重新读取原文并保留空格、缩进和换行。`,
        );
      if (source.indexOf(edit.oldText, start + 1) >= 0)
        throw new AppError(
          'CONFLICT',
          `第 ${index + 1} 项 oldText 匹配多处。请增加相邻原文，使其唯一。`,
        );
      return { ...edit, edit: index + 1, start, end: start + edit.oldText.length };
    })
    .sort((a, b) => a.start - b.start);
  for (let index = 1; index < matches.length; index++)
    if (matches[index].start < matches[index - 1].end)
      throw new AppError(
        'CONFLICT',
        `第 ${matches[index - 1].edit} 项与第 ${matches[index].edit} 项范围重叠，请合并为一次替换。`,
      );
  const parts: string[] = [];
  const changes: TextEditChange[] = [];
  let offset = 0;
  let line = 1;
  for (const match of matches) {
    const prefix = source.slice(offset, match.start);
    parts.push(prefix, match.newText);
    line += prefix.split('\n').length - 1;
    changes.push({ edit: match.edit, line, oldText: match.oldText, newText: match.newText });
    line += match.oldText.split('\n').length - 1;
    offset = match.end;
  }
  parts.push(source.slice(offset));
  return { text: parts.join(''), changes };
}
