import { expect, it } from 'vitest';
import { applyTextEdits, validateTextEdits, textEditLimits } from '../src/core/workspace/edits';

it('乱序提交的多处替换均匹配原文，新文本不参与后续匹配，保留 BOM/CRLF/中文与 emoji', () => {
  const source = '\uFEFFalpha\r\n保留😀\r\nbeta\r\n删除这一行\r\n';
  const result = applyTextEdits(source, [
    { oldText: 'beta', newText: 'gamma\r\n插入内容' },
    { oldText: 'alpha', newText: 'beta' },
    { oldText: '删除这一行\r\n', newText: '' },
  ]);
  expect(result.text).toBe('\uFEFFbeta\r\n保留😀\r\ngamma\r\n插入内容\r\n');
  expect(result.changes.map(change => [change.edit, change.line])).toEqual([
    [2, 1],
    [1, 3],
    [3, 4],
  ]);
});

it.each([
  ['找不到', 'alpha', [{ oldText: 'missing', newText: 'x' }], '没有匹配'],
  ['重复原文', 'same same', [{ oldText: 'same', newText: 'x' }], '匹配多处'],
  ['自身重叠的重复', 'aaa', [{ oldText: 'aa', newText: 'x' }], '匹配多处'],
  [
    '范围相交',
    'abcdef',
    [
      { oldText: 'abc', newText: 'x' },
      { oldText: 'bcd', newText: 'y' },
    ],
    '范围重叠',
  ],
  [
    '重复项',
    'alpha',
    [
      { oldText: 'alpha', newText: 'x' },
      { oldText: 'alpha', newText: 'y' },
    ],
    '范围重叠',
  ],
  ['不规范化换行', 'a\r\nb', [{ oldText: 'a\nb', newText: 'x' }], '没有匹配'],
  ['不忽略缩进', '  value', [{ oldText: '\tvalue', newText: 'x' }], '没有匹配'],
  ['不规范化 Unicode', 'caf\u00e9', [{ oldText: 'cafe\u0301', newText: 'x' }], '没有匹配'],
] as const)('%s 时拒绝整批', (_, source, edits, message) => {
  expect(() => applyTextEdits(source, edits)).toThrow(message);
});

it('允许相邻范围、完整 Unicode 字符、空替换和无变化替换', () => {
  expect(
    applyTextEdits('a😀bc', [
      { oldText: 'a😀', newText: '甲' },
      { oldText: 'b', newText: '' },
      { oldText: 'c', newText: 'c' },
    ]).text,
  ).toBe('甲c');
});

it('拒绝空锚点、NUL、不完整 Unicode、过多替换与累计超限；复制可变输入', () => {
  for (const edit of [
    { oldText: '', newText: 'insert' },
    { oldText: 'x', newText: '\0' },
    { oldText: '\ud83d', newText: 'x' },
    { oldText: 'x', newText: '\udc00' },
  ])
    expect(() => validateTextEdits([edit])).toThrow();
  expect(() => validateTextEdits([])).toThrow('1–100');
  expect(() =>
    validateTextEdits(Array.from({ length: 101 }, () => ({ oldText: 'x', newText: 'y' }))),
  ).toThrow('1–100');
  expect(() =>
    validateTextEdits([{ oldText: 'x', newText: 'y'.repeat(textEditLimits.characters) }]),
  ).toThrow('240,000');
  const original = [{ oldText: 'x', newText: 'y' }];
  const copied = validateTextEdits(original);
  original[0].newText = 'changed';
  expect(copied).toEqual([{ oldText: 'x', newText: 'y' }]);
});
