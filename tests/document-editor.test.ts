import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import {
  initialEditorState,
  normalizeText,
  textLineEnding,
  validateEditorState,
  type EditorDraft,
  type TextEditorState,
} from '@/core/documents/state';
import { createWorkspace } from '@/bootstrap/workspace';
import { openedEditor, confirmedEditorSave } from '@/features/workbench/editor-model';
import { resolveProjectPath } from '@/features/document/image-path';
import { markdownRenderer } from '@/features/document/render';
import { safeImageData, externalLink } from '@/features/document/resources';
import { contentCodec } from '@/adapters/storage/codec';
import { testStorage } from './storage';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function fixture() {
  const storage = await testStorage();
  cleanup.push(storage.cleanup);
  const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
  const project = await workspace.create('文件编辑');
  return { workspace, project, storage };
}
function draft(state: TextEditorState, revision: string | null = null): EditorDraft {
  return {
    format: 1,
    name: 'notes.md',
    fresh: false,
    baseRevision: revision,
    lineEnding: '\n',
    state,
  };
}

it('编辑状态严格验证原文投影、范围、选区及全文模式，拒绝隐式改写只读正文', () => {
  const state = initialEditorState('第一段😀\n\n第二段');
  state.regions = [{ id: 'block-1', from: 0, to: 5, baseFrom: 0, baseTo: 5, original: '第一段😀' }];
  validateEditorState(state);
  for (const invalid of [
    { ...state, text: state.text + '只读区篡改' },
    { ...state, selection: { anchor: -1, head: 0 } },
    { ...state, mode: 'full' },
    { ...state, regions: [...state.regions, state.regions[0]] },
    { ...state, base: 'bad\r\n' },
  ])
    expect(() => validateEditorState(invalid)).toThrow('编辑状态无效');
});

it('Markdown-it 完整语法与安全策略共享，原始 HTML 和外部图片不执行或自动加载', () => {
  const html = markdownRenderer.render(
    '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n  - **nested**\n\n<script>alert(1)</script>\n\n![image](https://example.com/x.png)\n\n[x](javascript:alert(1))',
  );
  expect(html).toContain('<table>');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('<strong>nested</strong>');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href="javascript:');
  expect(safeImageData('data:image/svg+xml;base64,AAAA')).toBe(false);
  expect(externalLink('file:///secret')).toBe(false);
  expect(externalLink('https://example.com')).toBe(true);
  expect(resolveProjectPath('documents/notes.md', '../assets/a.png')).toBe('assets/a.png');
  for (const target of [
    '../../private',
    'https://example.com/a',
    '%2Fsecret',
    '../.git/config',
    '\\secret',
  ])
    expect(() => resolveProjectPath('documents/notes.md', target)).toThrow();
});

it('草稿是元数据，版本校验和清理墓碑阻止延迟写入复活已放弃内容', async () => {
  const { workspace, project } = await fixture();
  const original = await workspace.read(project.id, 'documents/notes.md');
  const record = await workspace.saveEditorDraft(
    project.id,
    'documents/notes.md',
    draft(initialEditorState('草稿', true)),
    0,
  );
  expect(await workspace.read(project.id, 'documents/notes.md')).toEqual(original);
  expect((await workspace.editorDraft(project.id, 'documents/notes.md')).draft?.state.text).toBe(
    '草稿',
  );
  await workspace.saveEditorDraft(project.id, 'documents/notes.md', null, record.revision);
  await expect(
    workspace.saveEditorDraft(project.id, 'documents/notes.md', record.draft, record.revision),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await workspace.editorDraft(project.id, 'documents/notes.md')).draft).toBeNull();
  await expect(workspace.editorDraft('missing', 'a.md')).rejects.toThrow('项目不存在');
  await expect(workspace.editorDraft(project.id, '.git/config')).rejects.toThrow();
});

it('跨存储中断：先记保存意图，文件写入后未清理草稿时按实际字节恢复剩余编辑块', async () => {
  const { workspace, project } = await fixture();
  const path = 'documents/recovery.md';
  await workspace.writeText(project.id, path, contentCodec.encodeText('A\n\nB'), null);
  const original = await workspace.preview(project.id, path);
  const state: TextEditorState = {
    base: 'A\n\nB',
    text: 'AA\n\nBB',
    mode: 'blocks',
    selection: { anchor: 5, head: 5 },
    regions: [
      { id: 'a', from: 0, to: 2, baseFrom: 0, baseTo: 1, original: 'A' },
      { id: 'b', from: 2, to: 6, baseFrom: 1, baseTo: 4, original: '\n\nB' },
    ],
  };
  const next: TextEditorState = {
    ...state,
    base: 'AA\n\nB',
    regions: [{ ...state.regions[1], baseFrom: 2, baseTo: 5 }],
  };
  const intent = {
    ...draft(state, original.revision),
    pendingSave: next,
    saveOperationId: 'editor-operation',
    savePath: path,
  };
  const record = await workspace.saveEditorDraft(project.id, path, intent, 0);
  const before = openedEditor(project.id, path, original, record);
  expect(before.savedText).toBe(state.base);
  expect(before.text).toBe(state.text);
  const first = await workspace.writeText(
    project.id,
    path,
    contentCodec.encodeText(next.base),
    original.revision,
    { operationId: intent.saveOperationId },
  );
  // Same operation retries reuse the journal receipt, never double-apply.
  expect(
    await workspace.writeText(
      project.id,
      path,
      contentCodec.encodeText(next.base),
      original.revision,
      { operationId: intent.saveOperationId },
    ),
  ).toBe(first);
  const actual = await workspace.preview(project.id, path);
  const recovered = openedEditor(
    project.id,
    path,
    actual,
    await workspace.editorDraft(project.id, path),
  );
  expect(recovered.savedText).toBe(next.base);
  expect(recovered.text).toBe(state.text);
  expect(recovered.editState.regions).toEqual(next.regions);
  expect(recovered.revision).toBe(actual.revision);
  expect(recovered.pendingSave).toBeUndefined();
  expect(recovered.externalChanged).toBe(false);
});

it('外部修改保留草稿及旧基线，不自动覆盖；换行符约定可还原 CRLF 字节', async () => {
  const { workspace, project } = await fixture();
  const path = 'documents/notes.md';
  const original = await workspace.preview(project.id, path);
  const state = initialEditorState(normalizeText(original.content), true);
  state.text += '草稿';
  state.regions[0].to = state.text.length;
  const record = await workspace.saveEditorDraft(
    project.id,
    path,
    draft(state, original.revision),
    0,
  );
  await workspace.writeText(
    project.id,
    path,
    contentCodec.encodeText('外部内容\r\n'),
    original.revision,
  );
  const actual = await workspace.preview(project.id, path);
  const recovered = openedEditor(project.id, path, actual, record);
  expect(recovered.externalChanged).toBe(true);
  expect(recovered.revision).toBe(original.revision);
  expect(recovered.text).toBe(state.text);
  expect(normalizeText(actual.content).replace(/\n/g, textLineEnding(actual.content))).toBe(
    actual.content,
  );
});

it('已记录的保存回执不会掩盖之后的外部修改，确认实际内容后才推进编辑基线', async () => {
  const { workspace, project } = await fixture();
  const path = 'documents/notes.md';
  const before = await workspace.preview(project.id, path);
  await workspace.writeText(
    project.id,
    path,
    contentCodec.encodeText('用户保存'),
    before.revision,
    { operationId: 'editor-save-once' },
  );
  const saved = await workspace.preview(project.id, path);
  confirmedEditorSave(saved, '用户保存');
  await workspace.writeText(
    project.id,
    path,
    contentCodec.encodeText('之后的外部修改'),
    saved.revision,
  );
  await workspace.writeText(
    project.id,
    path,
    contentCodec.encodeText('用户保存'),
    before.revision,
    { operationId: 'editor-save-once' },
  );
  const actual = await workspace.preview(project.id, path);
  expect(actual.content).toBe('之后的外部修改');
  expect(() => confirmedEditorSave(actual, '用户保存')).toThrow('文件在保存后又有变化');
});

it('外部只改变换行字节也保持旧基础版本，不因规范化后的文本相同而悄悄覆盖', async () => {
  const { workspace, project } = await fixture();
  const path = 'documents/eol.md';
  await workspace.writeText(project.id, path, contentCodec.encodeText('A\r\nB'), null);
  const original = await workspace.preview(project.id, path);
  const state = initialEditorState('A\nB', true);
  state.text += '草稿';
  state.regions[0].to = state.text.length;
  const record = await workspace.saveEditorDraft(
    project.id,
    path,
    { ...draft(state, original.revision), lineEnding: '\r\n' },
    0,
  );
  await workspace.writeText(project.id, path, contentCodec.encodeText('A\nB'), original.revision);
  const actual = await workspace.preview(project.id, path);
  const recovered = openedEditor(project.id, path, actual, record);
  expect(recovered.externalChanged).toBe(true);
  expect(recovered.revision).toBe(original.revision);
  expect(recovered.text).toBe(state.text);
});
