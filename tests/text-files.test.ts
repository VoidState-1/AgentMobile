import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { contentCodec } from '../src/adapters/storage/codec';
import { workspaceTools } from '../src/application/tools/workspace';
import { validateText } from '../src/core/workspace/text';
import { contentLimits } from '../src/core/agent/settings';
import { testStorage, readOperations } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const storage = await testStorage();
  cleanups.push(storage.cleanup);
  const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
  const project = await workspace.create('通用文本');
  return { ...storage, workspace, project };
}

it('文本校验保留 UTF-8 BOM、中文、emoji、换行和控制台转义，不限制扩展名', () => {
  for (const text of ['', '\uFEFF# 中文😀\r\n\t内容\n', '\u001b[31merror\u001b[0m'])
    expect(() => validateText(contentCodec.encodeText(text))).not.toThrow();
  expect(() => validateText(new Uint8Array(contentLimits.textFileBytes + 1))).toThrow('1 MB');
});

it('仓库自己的 project.json 可正常编辑和版本管理，项目元数据保存在业务库', async () => {
  const f = await fixture();
  expect((await f.workspace.files(f.project.id)).some(file => file.path === 'project.json')).toBe(
    false,
  );
  await f.workspace.writeText(
    f.project.id,
    'project.json',
    contentCodec.encodeText('{"tool":"custom"}\n'),
    null,
  );
  const status = await f.workspace.status(f.project.id);
  const file = status.files.find(value => value.path === 'project.json')!;
  expect(file.unstaged).toBe('added');
  await f.workspace.stage(f.project.id, ['project.json'], {
    ...status,
    revisions: { 'project.json': file.workingRevision },
  });
  const staged = await f.workspace.status(f.project.id);
  await f.workspace.commitStaged(f.project.id, '添加仓库配置', staged);
  expect((await f.workspace.status(f.project.id)).files).toEqual([]);
  const current = await f.workspace.readText(f.project.id, 'project.json');
  await f.workspace.remove(f.project.id, 'project.json', current.revision);
  expect((await f.workspace.projects())[0].name).toBe('通用文本');
  await expect(f.workspace.readText(f.project.id, '.git/config')).rejects.toMatchObject({
    code: 'VALIDATION',
  });
});

it.each([
  [0],
  [0xff, 0xfe, 0x41, 0],
  [0x80],
  [0xc0, 0xaf],
  [0xc2],
  [0xe0, 0x80, 0x80],
  [0xed, 0xa0, 0x80],
  [0xe4, 0x20, 0xad],
  [0xf0, 0x80, 0x80, 0x80],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf0, 0x9f, 0x98],
])('拒绝 NUL、其他编码及无效 UTF-8 字节 %j', (...bytes) => {
  expect(() => validateText(new Uint8Array(bytes))).toThrow('UTF-8');
});

it('主 Agent 可创建代码、配置与无扩展名文本，版本检查和单次调用重试保持有效', async () => {
  const f = await fixture();
  const runId = 'text-root';
  f.workspace.claim(f.project.id, runId);
  const baseline = await f.workspace.taskBaseline(f.project.id, runId);
  const tools = workspaceTools({
    workspace: f.workspace,
    projectId: f.project.id,
    runId,
    baseline,
    task: {
      id: runId,
      projectId: f.project.id,
      prompt: '编写文件',
      state: 'running',
      response: '',
      createdAt: new Date().toISOString(),
    },
    codec: contentCodec,
    settings: { imageInput: false },
    round: () => 1,
  });
  const write = tools.find(tool => tool.name === 'write_text')!;
  const read = tools.find(tool => tool.name === 'read_text')!;
  const text = '\uFEFF# 原始文本，不按 Markdown 改写\r\n\t中文😀\r\n';
  const paths = [
    'src/main.ts',
    'run.py',
    'app.json',
    'app.yaml',
    'data.csv',
    'image.svg',
    '.env',
    'Dockerfile',
    'notes.custom',
  ];
  for (const path of paths) {
    const args = { path, text, expectedRevision: null };
    expect((await write.execute(path, args)).isError).not.toBe(true);
    expect((await write.execute(path, args)).isError).not.toBe(true);
    expect(await f.workspace.preview(f.project.id, path)).toMatchObject({ content: text });
    const result = await read.execute(path, { path });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}').text).toBe(
      text,
    );
  }
  expect(await readOperations(f.metadata, f.project.id)).toHaveLength(paths.length);
  const previous = await f.workspace.read(f.project.id, 'src/main.ts');
  expect(
    (
      await write.execute('update', {
        path: 'src/main.ts',
        text: 'export const value = 1;\n',
        expectedRevision: previous.revision,
      })
    ).isError,
  ).not.toBe(true);
  expect(
    (
      await write.execute('stale', {
        path: 'src/main.ts',
        text: 'stale',
        expectedRevision: previous.revision,
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await write.execute('binary', {
        path: 'archive.zip',
        text: 'PK\0\u0001',
        expectedRevision: null,
      })
    ).isError,
  ).toBe(true);
  expect(
    (await write.execute('image', { path: 'fake.png', text: 'text', expectedRevision: null }))
      .isError,
  ).not.toBe(true);
  expect(await f.workspace.preview(f.project.id, 'fake.png')).toMatchObject({
    kind: 'text',
    content: 'text',
  });
  expect(
    (await write.execute('protected', { path: '.git/config', text: '{}', expectedRevision: null }))
      .isError,
  ).toBe(true);
  expect(
    (await write.execute('escape', { path: '../escape.py', text: 'x', expectedRevision: null }))
      .isError,
  ).toBe(true);
  expect((await f.workspace.readText(f.project.id, 'src/main.ts')).text).toBe(
    'export const value = 1;\n',
  );
});

it('原始字节写入支持二进制，文本入口拒绝无效编码，预览明确不可用', async () => {
  const f = await fixture();
  for (const [index, bytes] of [
    new Uint8Array([0, 1, 2]),
    new Uint8Array([0xff, 0xfe]),
  ].entries()) {
    await expect(
      f.workspace.writeText(f.project.id, 'rejected.txt', bytes, null),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const path = 'file-' + index + '.txt';
    await f.workspace.write(f.project.id, path, bytes, null);
    expect((await f.workspace.read(f.project.id, path)).bytes).toEqual(bytes);
    await expect(f.workspace.readText(f.project.id, path)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(await f.workspace.preview(f.project.id, path)).toMatchObject({
      kind: 'binary',
      content: '',
      unavailableReason: expect.any(String),
    });
  }
});

it('任意扩展名文本的中断写入可恢复，随后重命名、暂存、提交并重开保留原始内容', async () => {
  const f = await fixture();
  const text = '\uFEFFexport const 名称 = "中文😀";\r\n';
  const writeBusiness = f.metadata.writeBusiness;
  let failed = false;
  f.metadata.writeBusiness = async batch => {
    if (!failed && batch.operations?.some(update => update.header.phase === 'checkpointed')) {
      failed = true;
      throw new Error('text receipt interrupted');
    }
    await writeBusiness(batch);
  };
  await expect(
    f.workspace.write(f.project.id, 'src/main.ts', contentCodec.encodeText(text), null),
  ).rejects.toThrow('interrupted');
  const reopened = createWorkspace(f.files, f.metadata, randomUUID);
  await reopened.recover();
  expect(reopened.recoveryIssues).toEqual([]);
  const file = await reopened.readText(f.project.id, 'src/main.ts');
  expect(file.text).toBe(text);
  await reopened.move(f.project.id, 'src/main.ts', 'src/main.png', file.revision);
  expect(await reopened.preview(f.project.id, 'src/main.png')).toMatchObject({
    kind: 'text',
    content: text,
  });
  await reopened.move(f.project.id, 'src/main.png', 'src/entry', file.revision);
  const status = await reopened.status(f.project.id);
  await reopened.stage(f.project.id, ['src/entry'], {
    ...status,
    revisions: { 'src/entry': file.revision },
  });
  const commit = await reopened.commitStaged(
    f.project.id,
    '提交源文件',
    await reopened.status(f.project.id),
  );
  expect(await reopened.git.readAt(f.project.id, commit, 'src/entry')).toEqual(
    contentCodec.encodeText(text),
  );
  expect(
    (await createWorkspace(f.files, f.metadata, randomUUID).preview(f.project.id, 'src/entry'))
      .content,
  ).toBe(text);
});
