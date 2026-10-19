import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { contentCodec } from '../src/adapters/storage/codec';
import { workspaceTools } from '../src/application/tools/workspace';
import type { ToolResult } from '../src/core/agent/tools';
import { testStorage, readOperations } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const path = 'src/main.ts';
const source = '\uFEFFconst first = "旧值😀";\r\n// 保留缩进与换行\r\nconst second = 2;\r\n';
const edits = [
  { oldText: '旧值😀', newText: '新值😀' },
  { oldText: 'second = 2', newText: 'second = 3' },
];
const changed = source.replace('旧值😀', '新值😀').replace('second = 2', 'second = 3');
function data(result: ToolResult) {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}');
}
async function fixture(text = source) {
  const storage = await testStorage();
  cleanups.push(storage.cleanup);
  const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
  const project = await workspace.create('精确替换');
  await workspace.write(project.id, path, contentCodec.encodeText(text), null);
  const runId = 'edit-root';
  workspace.claim(project.id, runId);
  const baseline = await workspace.taskBaseline(project.id, runId);
  const task = {
    id: runId,
    projectId: project.id,
    prompt: '局部编辑',
    state: 'running' as const,
    response: '',
    createdAt: new Date().toISOString(),
    baseCommit: baseline.head ?? undefined,
    baseSnapshot: baseline.working,
    baseIndexSnapshot: baseline.index,
  };
  const tools = workspaceTools({
    workspace,
    projectId: project.id,
    runId,
    baseline,
    task,
    codec: contentCodec,
    settings: { imageInput: false },
    round: () => 1,
  });
  const revision = (await workspace.readText(project.id, path)).revision;
  return {
    ...storage,
    workspace,
    project,
    runId,
    task,
    tools,
    revision,
    edit: tools.find(tool => tool.name === 'edit_text')!,
    args: { path, expectedRevision: revision, edits },
  };
}

it('主工具一次写入整批、返回新修订与差异，回执重试不再改写后续内容，任务撤销保留原文', async () => {
  const f = await fixture();
  const before = await f.workspace.status(f.project.id);
  const result = data(await f.edit.execute('batch', f.args));
  expect(result).toMatchObject({
    saved: true,
    editCount: 2,
    changed: true,
    replayed: false,
    truncated: false,
  });
  expect(result.changes).toMatchObject([
    { edit: 1, line: 1, before: '旧值😀', after: '新值😀' },
    { edit: 2, line: 3 },
  ]);
  expect((await f.workspace.readText(f.project.id, path)).text).toBe(changed);
  expect((await f.workspace.status(f.project.id)).head).toBe(before.head);
  expect((await f.workspace.status(f.project.id)).indexRevision).toBe(before.indexRevision);
  const operationId = f.runId + '-1-batch';
  const receipt = (await f.workspace.journal.get(f.project.id, operationId))!;
  expect(receipt.changes).toHaveLength(1);
  expect(receipt.textEditFingerprint).toMatch(/^[0-9a-f]{40}$/);
  expect(
    await f.metadata.operation(f.workspace.journal.scope(f.project.id), operationId),
  ).not.toHaveProperty('textEditFingerprint');
  expect(data(await f.edit.execute('batch', f.args))).toEqual({ ...result, replayed: true });
  await f.workspace.write(
    f.project.id,
    path,
    contentCodec.encodeText(changed + '// 后续修改\r\n'),
    result.revision,
    { owner: f.runId },
  );
  const count = (await readOperations(f.metadata, f.project.id)).length;
  expect(data(await f.edit.execute('batch', f.args))).toEqual({ ...result, replayed: true });
  expect((await f.workspace.readText(f.project.id, path)).text).toBe(changed + '// 后续修改\r\n');
  expect(await readOperations(f.metadata, f.project.id)).toHaveLength(count);
  expect(
    (await f.edit.execute('batch', { ...f.args, edits: [{ oldText: '旧值😀', newText: '其他' }] }))
      .isError,
  ).toBe(true);
  const write = f.tools.find(tool => tool.name === 'write_text')!;
  expect(
    (await write.execute('batch', { path, text: changed, expectedRevision: f.revision })).isError,
  ).toBe(true);
  const final = await f.workspace.taskFinal(f.task);
  expect(final.changedPaths).toEqual([path]);
  f.workspace.release(f.project.id, f.runId);
  await f.workspace.undoTask(final);
  expect((await f.workspace.readText(f.project.id, path)).text).toBe(source);
});

it('缺少匹配、重叠、过期版本、越权路径和非法文本均不落操作意图，也不阻断下一次有效编辑', async () => {
  const f = await fixture();
  const count = (await readOperations(f.metadata, f.project.id)).length;
  const invalid = [
    { ...f.args, edits: [edits[0], { oldText: 'missing', newText: 'x' }] },
    {
      ...f.args,
      edits: [
        { oldText: 'const first', newText: 'x' },
        { oldText: 'first =', newText: 'y' },
      ],
    },
    { ...f.args, expectedRevision: 'stale' },
    { ...f.args, path: '.git/config' },
    { ...f.args, path: '../escape.ts' },
    { ...f.args, path: 'fake.png' },
    { ...f.args, path: 'missing.ts' },
    { ...f.args, edits: [{ oldText: '旧值😀', newText: '\0' }] },
  ];
  for (const [index, args] of invalid.entries()) {
    expect((await f.edit.execute('invalid-' + index, args)).isError).toBe(true);
    expect((await f.workspace.readText(f.project.id, path)).text).toBe(source);
    expect(await readOperations(f.metadata, f.project.id)).toHaveLength(count);
  }
  expect(f.workspace.needsRecovery(f.project.id)).toBe(false);
  data(await f.edit.execute('valid', f.args));
});

it('同一修订并发编辑只有一批生效，不因片段不同而自动重基', async () => {
  const f = await fixture();
  const results = await Promise.all([
    f.edit.execute('first', { ...f.args, edits: [edits[0]] }),
    f.edit.execute('second', { ...f.args, edits: [edits[1]] }),
  ]);
  expect(results.filter(result => result.isError)).toHaveLength(1);
  expect((await f.workspace.readText(f.project.id, path)).text).toBe(
    source.replace('旧值😀', '新值😀'),
  );
});

it('超出文件上限拒绝整批；大批量成功时只截断返回摘要，不截断实际替换', async () => {
  const large = await fixture('prefix\n' + 'a'.repeat(950000));
  expect(
    (
      await large.edit.execute('too-large', {
        path,
        expectedRevision: large.revision,
        edits: [{ oldText: 'prefix', newText: 'b'.repeat(150000) }],
      })
    ).isError,
  ).toBe(true);
  expect((await large.workspace.readText(large.project.id, path)).revision).toBe(large.revision);
  const replacements = Array.from({ length: 100 }, (_, index) => ({
    oldText: 'old-' + index + ';\n',
    newText: 'new-' + index + 'x'.repeat(400) + ';\n',
  }));
  const batch = await fixture(
    replacements.map(edit => edit.oldText).join('') + '// unchanged tail\n',
  );
  const outcome = data(
    await batch.edit.execute('large', {
      path,
      expectedRevision: batch.revision,
      edits: replacements,
    }),
  );
  expect(outcome).toMatchObject({ editCount: 100, truncated: true });
  expect(outcome.changes.length).toBeLessThanOrEqual(20);
  expect(JSON.stringify(outcome).length).toBeLessThan(10000);
  expect((await batch.workspace.readText(batch.project.id, path)).text).toBe(
    replacements.map(edit => edit.newText).join('') + '// unchanged tail\n',
  );
});

it.each(['applied', 'checkpointed', 'recorded'])(
  '%s 回执中断后恢复完整替换，原调用重试不会再次执行',
  async phase => {
    const f = await fixture();
    const writeBusiness = f.metadata.writeBusiness;
    let failed = false;
    f.metadata.writeBusiness = async batch => {
      if (!failed && batch.operations?.some(update => update.header.phase === phase)) {
        failed = true;
        throw new Error('edit receipt interrupted');
      }
      await writeBusiness(batch);
    };
    expect((await f.edit.execute('interrupted', f.args)).isError).toBe(true);
    const reopened = createWorkspace(f.files, f.metadata, randomUUID);
    await reopened.recover();
    expect(reopened.recoveryIssues).toEqual([]);
    reopened.claim(f.project.id, f.runId);
    const count = (await readOperations(f.metadata, f.project.id)).length;
    const outcome = await reopened.editText(f.project.id, path, edits, f.revision, {
      owner: f.runId,
      operationId: f.runId + '-1-interrupted',
    });
    expect(outcome.replayed).toBe(true);
    expect((await reopened.readText(f.project.id, path)).text).toBe(changed);
    expect(await readOperations(f.metadata, f.project.id)).toHaveLength(count);
  },
);
