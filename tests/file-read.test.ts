import { expect, it } from 'vitest';
import { scopedFileReader, fileReadTools } from '../src/application/tools/file-read';
import { contentCodec } from '../src/adapters/storage/codec';
import { AppError } from '../src/core/errors';

it('同一读取算法按来源分页，跨页版本变化拒绝；快照不能扩大 grant', async () => {
  let version = 'base'; const files = Array.from({ length: 220 }, (_, index) => ({ path: 'file-' + index + '.md', revision: String(index) }));
  const reader = scopedFileReader('snapshot:base', async () => ({ version, files }), async path => {
    const file = files.find(file => file.path === path); if (!file) throw new AppError('VALIDATION', 'path denied');
    return { revision: file.revision, bytes: contentCodec.encodeText('read ' + path) };
  });
  const first = await reader.list(); expect(first.files).toHaveLength(200);
  expect((await reader.list({ cursor: first.cursor })).files).toHaveLength(20);
  version = 'changed'; await expect(reader.list({ cursor: first.cursor })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(reader.read('outside.md')).rejects.toMatchObject({ code: 'VALIDATION' });
  const tools = fileReadTools(reader, contentCodec, false);
  expect(tools.every(tool => tool.effect === 'read')).toBe(true); expect(tools.some(tool => tool.name === 'inspect_image')).toBe(false);
});

it('搜索跨页且达到上限立即停止，返回实际修订号；取消不再读后续文件', async () => {
  let reads = 0; const files = Array.from({ length: 230 }, (_, index) => ({ path: index + '.md', revision: 'r' + index }));
  const reader = scopedFileReader('proposal:one', async () => ({ version: 'candidate', files }), async path => {
    reads++; const index = Number.parseInt(path, 10); return { revision: 'r' + index, bytes: contentCodec.encodeText(index < 200 ? 'none' : 'needle') };
  });
  const search = fileReadTools(reader, contentCodec, false).find(tool => tool.name === 'search_text')!;
  const result = await search.execute('search', { query: 'needle' }); const data = JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}');
  expect(data.matches).toHaveLength(30); expect(data.matches[0]).toMatchObject({ path: '200.md', revision: 'r200', line: 1 });
  const abort = new AbortController(); abort.abort(); const before = reads;
  expect((await search.execute('cancelled', { query: 'needle' }, abort.signal)).isError).toBe(true); expect(reads).toBe(before);
});
