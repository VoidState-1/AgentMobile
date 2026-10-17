import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { contentCodec } from '../src/adapters/storage/codec';
import { workspaceTools } from '../src/application/tools/workspace';
import { fileReadTools, scopedFileReader } from '../src/application/tools/file-read';
import { safePath } from '../src/core/workspace/path';
import { storagePath } from '../src/adapters/storage/path';
import { summarizeChanges } from '../src/adapters/git/change-summary';
import { testStorage, readOperations } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const f = await testStorage();
  cleanups.push(f.cleanup);
  const workspace = createWorkspace(f.files, f.metadata, randomUUID);
  const project = await workspace.create('原始文件');
  return { ...f, workspace, project };
}
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=',
  'base64',
);

it('普通 Git 配置与目录可存储和提交，真实 .git、越界存储路径和恶意项目身份仍被拒绝', async () => {
  const f = await fixture();
  for (const path of ['.gitignore', '.gitattributes', '.github/workflows/build.yaml']) {
    expect(safePath(path)).toBe(path);
    await f.workspace.writeText(f.project.id, path, Buffer.from('value\n'), null);
  }
  for (const path of ['.git/config', 'nested/.GIT/HEAD', '../outside'])
    expect(() => safePath(path)).toThrow('INVALID_PATH');
  for (const path of [
    '/workspaces/../../secret',
    '/a/./b',
    'file:///secret',
    '/a\\..\\b',
    '//outside',
  ])
    expect(() => storagePath(path)).toThrow();
  expect(storagePath('/workspaces/project/.git/config')).toEqual([
    'workspaces',
    'project',
    '.git',
    'config',
  ]);
  await expect(f.workspace.read('../other-project', 'notes.md')).rejects.toMatchObject({
    code: 'VALIDATION',
  });
  const files = await f.workspace.files(f.project.id);
  const paths = files.filter(file => file.path.startsWith('.git')).map(file => file.path);
  const state = await f.workspace.status(f.project.id);
  await f.workspace.stage(f.project.id, paths, {
    ...state,
    revisions: Object.fromEntries(files.map(file => [file.path, file.revision])),
  });
  const commit = await f.workspace.commitStaged(
    f.project.id,
    'Git 配置',
    await f.workspace.status(f.project.id),
  );
  expect(
    await f.workspace.git.readAt(f.project.id, commit, '.github/workflows/build.yaml'),
  ).toEqual(contentCodec.encodeText('value\n'));
});

it('字节写入/移动/Git/重开保留二进制，预览与行数统计不解码二进制', async () => {
  const f = await fixture();
  const bytes = new Uint8Array([0, 255, 1, 2]);
  await f.workspace.write(f.project.id, 'assets/data.txt', bytes, null);
  const original = await f.workspace.read(f.project.id, 'assets/data.txt');
  expect(await f.workspace.preview(f.project.id, 'assets/data.txt')).toMatchObject({
    kind: 'binary',
    content: '',
    unavailableReason: expect.any(String),
  });
  await expect(
    f.workspace.writeText(
      f.project.id,
      'assets/data.txt',
      Buffer.from('overwrite'),
      original.revision,
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION' });
  await f.workspace.move(f.project.id, 'assets/data.txt', 'assets/archive.zip', original.revision);
  const status = await f.workspace.status(f.project.id);
  await f.workspace.stage(f.project.id, ['assets/archive.zip'], {
    ...status,
    revisions: { 'assets/archive.zip': original.revision },
  });
  const commit = await f.workspace.commitStaged(
    f.project.id,
    '保存附件',
    await f.workspace.status(f.project.id),
  );
  expect(await f.workspace.git.readAt(f.project.id, commit, 'assets/archive.zip')).toEqual(bytes);
  const changes = await f.workspace.changes(f.project.id, undefined, commit);
  const binary = changes.find(file => file.path === 'assets/archive.zip')!;
  expect(binary).toMatchObject({
    kind: 'binary',
    before: '',
    after: '',
    beforeSize: null,
    afterSize: 4,
  });
  expect(summarizeChanges([binary])[0]).toMatchObject({ kind: 'binary' });
  expect(summarizeChanges([binary])[0].added).toBeUndefined();
  expect(
    (
      await createWorkspace(f.files, f.metadata, randomUUID).read(
        f.project.id,
        'assets/archive.zip',
      )
    ).bytes,
  ).toEqual(bytes);
});

it('类型由内容决定：改后缀不转码；大文本可以存储但受到文本工具和预览预算限制', async () => {
  const f = await fixture();
  await f.workspace.write(f.project.id, 'photo.data', image, null);
  expect(await f.workspace.preview(f.project.id, 'photo.data')).toMatchObject({
    kind: 'image',
    mimeType: 'image/png',
    content: expect.stringContaining('data:image/png'),
  });
  const file = await f.workspace.read(f.project.id, 'photo.data');
  await f.workspace.move(f.project.id, 'photo.data', 'photo.txt', file.revision);
  await expect(f.workspace.readText(f.project.id, 'photo.txt')).rejects.toThrow();
  await expect(
    f.workspace.writeText(f.project.id, 'photo.txt', Buffer.from('text'), file.revision),
  ).rejects.toThrow();
  const large = Buffer.alloc(1024 * 1024 + 1, 'a');
  await f.workspace.write(f.project.id, 'large.txt', large, null);
  expect(await f.workspace.preview(f.project.id, 'large.txt')).toMatchObject({
    kind: 'text',
    content: '',
    unavailableReason: expect.stringContaining('1 MB'),
  });
  expect(
    (await f.workspace.files(f.project.id)).find(file => file.path === 'large.txt'),
  ).toMatchObject({ kind: 'text', size: large.length });
});

it.each(['before', 'after', 'copy-only'])(
  '原生移动在 %s 中断，依据完整意图恢复且不重新覆盖目标',
  async phase => {
    const f = await fixture();
    const bytes = new Uint8Array([0, 1, 255]);
    await f.workspace.write(f.project.id, 'source.bin', bytes, null);
    const revision = (await f.workspace.read(f.project.id, 'source.bin')).revision;
    const move = f.files.moveFile;
    let failed = false;
    f.files.moveFile = vi.fn(async (from, to) => {
      if (!failed) {
        failed = true;
        if (phase === 'after') await move(from, to);
        if (phase === 'copy-only') await f.files.write(to, await f.files.read(from));
        throw new Error('native move interrupted');
      }
      await move(from, to);
    });
    await expect(
      f.workspace.move(f.project.id, 'source.bin', 'target.bin', revision),
    ).rejects.toThrow('interrupted');
    const recovered = createWorkspace(f.files, f.metadata, randomUUID);
    await recovered.recover();
    expect(recovered.recoveryIssues).toEqual([]);
    expect((await recovered.read(f.project.id, 'target.bin')).bytes).toEqual(bytes);
    await expect(recovered.read(f.project.id, 'source.bin')).rejects.toThrow();
    const operation = (await readOperations(f.metadata, f.project.id)).find(op => op.fileMove)!;
    expect(operation.phase).toBe('recorded');
    expect(await f.metadata.operation(operation.scope, operation.id)).not.toHaveProperty(
      'fileMove',
    );
    expect(f.files.moveFile).toHaveBeenCalledTimes(phase === 'before' ? 2 : 1);
  },
);

it('移动恢复遇到记录之外的目标内容时保留两端文件并阻止继续写入', async () => {
  const f = await fixture();
  const original = new Uint8Array([0, 1, 255]);
  const unexpected = new Uint8Array([0, 2, 254]);
  await f.workspace.write(f.project.id, 'source.bin', original, null);
  const revision = (await f.workspace.read(f.project.id, 'source.bin')).revision;
  f.files.moveFile = vi.fn(async () => {
    throw new Error('interrupted');
  });
  await expect(
    f.workspace.move(f.project.id, 'source.bin', 'target.bin', revision),
  ).rejects.toThrow('interrupted');
  await f.files.write(f.workspace.git.dir(f.project.id) + '/target.bin', unexpected);
  const recovered = createWorkspace(f.files, f.metadata, randomUUID);
  await recovered.recover();
  expect(recovered.needsRecovery(f.project.id)).toBe(true);
  expect(recovered.recoveryIssues).toHaveLength(1);
  expect((await recovered.read(f.project.id, 'source.bin')).bytes).toEqual(original);
  expect((await recovered.read(f.project.id, 'target.bin')).bytes).toEqual(unexpected);
  expect(f.files.moveFile).toHaveBeenCalledTimes(1);
  await expect(recovered.write(f.project.id, 'another.bin', original, null)).rejects.toThrow(
    '恢复未完成',
  );
});

it('图片工具按真实内容识别图片，即使文件使用非图片后缀', async () => {
  const f = await fixture();
  await f.workspace.write(f.project.id, 'photo.data', image, null);
  const reader = scopedFileReader(
    'test',
    async () => ({ files: await f.workspace.files(f.project.id), version: 'test' }),
    path => f.workspace.read(f.project.id, path),
  );
  const tools = fileReadTools(reader, contentCodec, true);
  const result = await tools
    .find(tool => tool.name === 'inspect_image')!
    .execute('image', {
      path: 'photo.data',
    });
  expect(result.isError).not.toBe(true);
  expect(result.content).toContainEqual({
    type: 'image',
    mimeType: 'image/png',
    data: image.toString('base64'),
  });
});

it('混合工作区搜索跳过二进制与超预算文本，不能因单个附件中断搜索', async () => {
  const f = await fixture();
  await f.workspace.write(f.project.id, 'binary.txt', new Uint8Array([0, 255]), null);
  await f.workspace.write(
    f.project.id,
    'large.txt',
    Buffer.from('needle'.padEnd(1024 * 1024 + 1, 'a')),
    null,
  );
  await f.workspace.writeText(
    f.project.id,
    '.github/notes.yaml',
    Buffer.from('needle: 中文'),
    null,
  );
  f.workspace.claim(f.project.id, 'run');
  const tools = workspaceTools({
    workspace: f.workspace,
    projectId: f.project.id,
    runId: 'run',
    baseline: await f.workspace.taskBaseline(f.project.id, 'run'),
    task: {
      id: 'run',
      projectId: f.project.id,
      prompt: '',
      response: '',
      state: 'running',
      createdAt: '',
    },
    codec: contentCodec,
    settings: { imageInput: true },
    round: () => 1,
  });
  const result = await tools
    .find(tool => tool.name === 'search_text')!
    .execute('search', { query: 'needle' });
  expect(result.isError).not.toBe(true);
  expect(
    JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}').matches,
  ).toMatchObject([{ path: '.github/notes.yaml' }]);
});
