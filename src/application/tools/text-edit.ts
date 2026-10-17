import { Type } from 'typebox';
import { textEnd } from '@/core/runs/trace-storage';
import { textEditLimits, type TextEditOutcome } from '@/core/workspace/edits';
import { result } from './common';

export const editTextDescription =
  '局部修改已有 UTF-8 文本。edits 中每项 oldText 必须在同一原始修订中精确且唯一匹配，范围互不重叠；整批通过才写入。空 newText 表示删除，插入需包含唯一原文锚点。保留空格、缩进和换行，不模糊匹配。使用读取时的 expectedRevision，失败后重新读取并规划；不自动改为全文重写。返回新修订号和有界差异摘要；replayed=true 表示原调用回执，继续修改前须读取当前修订。';

export const editTextParameters = Type.Object(
  {
    path: Type.String({ maxLength: 220 }),
    expectedRevision: Type.String({ minLength: 1, maxLength: 80 }),
    edits: Type.Array(
      Type.Object(
        {
          oldText: Type.String({ minLength: 1, maxLength: textEditLimits.characters }),
          newText: Type.String({ maxLength: textEditLimits.characters }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: textEditLimits.edits },
    ),
  },
  { additionalProperties: false },
);

export function textEditResult(path: string, outcome: TextEditOutcome, proposalId?: string) {
  let remaining = 6000;
  const changes = [];
  for (const change of outcome.changes) {
    if (changes.length === 20 || remaining <= 0) break;
    const limit = Math.min(200, Math.floor(remaining / 2));
    const before = change.oldText.slice(0, textEnd(change.oldText, 0, limit));
    const after = change.newText.slice(0, textEnd(change.newText, 0, limit));
    remaining -= before.length + after.length;
    changes.push({
      edit: change.edit,
      line: change.line,
      before,
      after,
      truncated: before.length < change.oldText.length || after.length < change.newText.length,
    });
  }
  return result({
    path,
    saved: true,
    revision: outcome.revision,
    changed: outcome.changed,
    replayed: outcome.replayed,
    editCount: outcome.changes.length,
    changes,
    truncated: changes.length < outcome.changes.length || changes.some(change => change.truncated),
    ...(proposalId ? { proposalId, isolated: true } : {}),
  });
}
