import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillService } from '@/application/skills/library';
import { explicitSkills, skillPath } from '../src/core/skills/rules';
import { GitSkillRepository } from '../src/adapters/skills/repository';
import { createSkillRun } from '../src/adapters/skills/run';
import { decodeSkillText, exportSkillPackage, importSkillPackage, parseSkill, validateBundle } from '../src/adapters/skills/package';
import { createWorkspace } from '../src/bootstrap/workspace';
import { startTestRun } from './agent-runtime';
import { testStorage } from './storage';
import { chatSnapshot, protocols, snapshot, toolEvents, answerEvents, sse } from './protocol-fixtures';
import { skillSource } from './skills-fixtures';

const skillBundle = (version = 'VERSION_ONE') => validateBundle([{ path: 'SKILL.md', bytes: Buffer.from(skillSource('note-workflow', version)) },
  { path: 'references/template.md', bytes: Buffer.from('RESOURCE_ONE: 来源、重点、待确认事项。') }]);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup() {
  const storage = await testStorage(); cleanups.push(storage.cleanup); const repository = new GitSkillRepository(createWorkspace(storage.files, storage.metadata, randomUUID, { namespace: 'skills' }));
  const service = new SkillService(storage.metadata, repository); await service.initialize(); return { ...storage, repository, service };
}
async function install(f: Awaited<ReturnType<typeof setup>>) {
  await f.service.install([skillBundle()], f.service.getSnapshot().commit); const skill = f.service.getSnapshot().skills[0];
  await f.service.grant('project', skill.name, true, skill.revision); return skill;
}
describe('标准技能包与受控资源', () => {
  it('YAML 块标量、可选元数据和 BOM/CRLF 可解析；重复/别名/错误类型拒绝', () => {
    expect(parseSkill('\uFEFF---\r\nname: sample\r\ndescription: >-\r\n  带有冒号: 的说明\r\n  第二行\r\nlicense: MIT\r\ncompatibility: mobile\r\nallowed-tools: Read Write\r\nmetadata:\r\n  version: "1"\r\n---\r\n正文')).toMatchObject({ name: 'sample', description: '带有冒号: 的说明 第二行', allowedTools: 'Read Write' });
    for (const yaml of ['name: BAD\ndescription: ok', 'name: sample\ndescription: true', 'name: sample\nname: sample\ndescription: ok', 'name: sample\ndescription: &x ok\nlicense: *x', 'name: sample\ndescription: ok\nmetadata:\n  version: 1']) expect(() => parseSkill('---\n' + yaml + '\n---\n正文')).toThrow();
  });
  it('ZIP 支持多技能、目录归一化、引用资源与导出再导入', () => {
    const zip = zipSync({ 'repo/skills/wrong/SKILL.md': Buffer.from(skillSource()), 'repo/skills/wrong/references/template.md': Buffer.from('reference'),
      'repo/skills/other/SKILL.md': Buffer.from(skillSource('other')), 'repo/.gitignore': Buffer.from('ignored') });
    const bundles = importSkillPackage('skills.zip', zip); expect(bundles.map((bundle) => bundle.name)).toEqual(['note-workflow', 'other']);
    expect(bundles[0].warnings.join(' ')).toContain('目录名'); expect(bundles[0].files).toHaveLength(2);
    const restored = importSkillPackage('export.zip', exportSkillPackage(bundles)); expect(restored[0].files.map((file) => file.path)).toEqual(bundles[0].files.map((file) => file.path));
  });
  it('路径越界、重复大小写路径、嵌套技能与解压超限不落入文件库', () => {
    for (const path of ['../secret', '/private', 'a\\b', '.git/HEAD', 'data.sqlite', '.env', 'x/../../other']) expect(() => skillPath(path)).toThrow();
    for (const files of [
      { '../escape/SKILL.md': Buffer.from(skillSource()) },
      { 'x/SKILL.md': Buffer.from(skillSource()), 'x/skill.MD': Buffer.from('duplicate') },
      { 'SKILL.md': Buffer.from(skillSource()), 'nested/SKILL.md': Buffer.from(skillSource('nested')) },
      { 'x/SKILL.md': Buffer.from(skillSource()), 'x/assets/bomb.bin': new Uint8Array(4 * 1024 * 1024 + 1) },
    ] as Record<string, Uint8Array>[]) expect(() => importSkillPackage('bad.zip', zipSync(files))).toThrow();
    expect(() => importSkillPackage('broken.zip', new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => decodeSkillText(new Uint8Array([0xff]))).toThrow();
  });
  it('显式提及去重，普通金额不误识别为技能', () => {
    expect(explicitSkills('$note-workflow 整理，$other。 $note-workflow 再用')).toEqual(['note-workflow', 'other']);
    expect(explicitSkills('预算 $100 和 $5。')).toEqual([]);
  });
  it('实际解压超限不受伪造 ZIP 大小字段影响', () => {
    const zip = zipSync({ 'note-workflow/SKILL.md': Buffer.from(skillSource()), 'note-workflow/assets/bomb.bin': new Uint8Array(4 * 1024 * 1024 + 1) });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let index = 0; index < zip.length - 46; index++) {
      const marker = view.getUint32(index, true);
      if (marker === 0x04034b50) view.setUint32(index + 22, 0, true);
      if (marker === 0x02014b50) view.setUint32(index + 24, 0, true);
    }
    expect(() => importSkillPackage('forged.zip', zip)).toThrow('最多');
  });
});
describe('Git 技能库、项目启用和恢复', () => {
  it('技能不进入项目列表；项目隔离、版本变化撤销启用，历史可恢复', async () => {
    const f = await setup(); const skill = await install(f);
    expect(await f.metadata.all('projects')).toHaveLength(0); expect((await f.service.capture('other', '整理')).skills).toHaveLength(0);
    await expect(f.service.capture('other', '$note-workflow 整理')).rejects.toThrow('尚未');
    const commit = f.service.getSnapshot().commit; await f.service.install([skillBundle('VERSION_TWO')], commit);
    expect(f.service.getSnapshot().grants.project).toEqual({});
    const versions = await f.repository.versions(skill.name); expect(versions.versions).toHaveLength(2);
    await f.service.install([await f.repository.bundle(versions.versions[1].commit, skill.name)], f.service.getSnapshot().commit);
    expect(f.service.getSnapshot().skills[0].revision).toBe(skill.revision);
    expect(decodeSkillText(await f.repository.read(f.service.getSnapshot().commit, skill.name, 'SKILL.md'))).toContain('VERSION_ONE');
    await expect(f.service.install([skillBundle()], commit)).rejects.toThrow('已变化');
  });
  it('任务固定旧 Git 版本，编辑、删除后仍能读取旧正文和资源', async () => {
    const f = await setup(); const skill = await install(f); const run = createSkillRun(f.repository, await f.service.capture('project', '整理'));
    const updated = skillBundle('VERSION_TWO'); updated.files[1].bytes = Buffer.from('RESOURCE_TWO'); await f.service.install([updated], f.service.getSnapshot().commit);
    await f.service.remove(skill.name, f.service.getSnapshot().commit);
    expect((await run.load(skill.name)).instructions).toContain('VERSION_ONE');
    expect(JSON.stringify(await run.read(skill.name, 'references/template.md', 0, 12000, false))).toContain('RESOURCE_ONE');
    expect(Object.isFrozen(run.snapshots[0].files)).toBe(true);
  });
  it('多文件应用中断由操作日志恢复；Git 已提交但配置未保存时重新扫描并撤销旧启用', async () => {
    const f = await setup(); await install(f); const write = f.files.write; let injected = false;
    f.files.write = async (path, bytes) => { if (!injected && path.endsWith('references/new.md')) { injected = true; throw new Error('模拟中断'); } await write(path, bytes); };
    const bundle = skillBundle('VERSION_TWO'); bundle.files.push({ path: 'references/new.md', bytes: Buffer.from('new') });
    await expect(f.service.install([bundle], f.service.getSnapshot().commit)).rejects.toThrow('未完成');
    await expect(f.service.capture('project', '继续')).rejects.toThrow('尚未完成'); f.files.write = write;
    const restarted = new SkillService(f.metadata, new GitSkillRepository(createWorkspace(f.files, f.metadata, randomUUID, { namespace: 'skills' }))); await restarted.initialize();
    expect(restarted.getSnapshot().skills[0].files).toHaveLength(3); expect(restarted.getSnapshot().grants.project).toEqual({});
    const put = f.metadata.put; f.metadata.put = async (bucket, id, value) => { if (bucket === 'skills') throw new Error('配置未保存'); await put(bucket, id, value); };
    await expect(restarted.install([skillBundle('VERSION_THREE')], restarted.getSnapshot().commit)).rejects.toThrow('未完成'); f.metadata.put = put;
    const again = new SkillService(f.metadata, new GitSkillRepository(createWorkspace(f.files, f.metadata, randomUUID, { namespace: 'skills' }))); await again.initialize();
    expect(decodeSkillText(await again.repository.read(again.getSnapshot().commit, 'note-workflow', 'SKILL.md'))).toContain('VERSION_THREE');
  });
  it('未激活资源、越界与未启用技能拒绝；分页及去重保持正确', async () => {
    const f = await setup(); const skill = await install(f); const run = createSkillRun(f.repository, await f.service.capture('project', '整理'));
    await expect(run.read(skill.name, 'references/template.md', 0, 5, false)).rejects.toThrow('尚未加载');
    await run.load(skill.name); expect((await run.load(skill.name)).alreadyLoaded).toBe(true);
    await expect(run.read(skill.name, '../other/SKILL.md', 0, 5, false)).rejects.toThrow(); await expect(run.load('other')).rejects.toThrow('未在');
    const result = await run.read(skill.name, 'references/template.md', 0, 5, false);
    expect(JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '')).toMatchObject({ text: 'RESOU', truncated: true, nextOffset: 5 });
  });
  it('名称和正文不一致、大小写路径更新在修改前拒绝，不冻结有效目录', async () => {
    const f = await setup(); await install(f);
    await expect(f.service.install([{ ...skillBundle(), name: 'wrong-name' }], f.service.getSnapshot().commit)).rejects.toThrow('不一致');
    const renamed = skillBundle(); renamed.files[1].path = 'references/TEMPLATE.md';
    await expect(f.service.install([renamed], f.service.getSnapshot().commit)).rejects.toThrow('大小写');
    expect((await f.service.capture('project', '继续')).skills).toHaveLength(1);
  });
});
describe('真实 Pi 任务中的技能', () => {
  for (const protocol of protocols) it(`${protocol}：目录 → 正文 → 资源 → Git 保存，只披露启用技能`, async () => {
    const f = await setup(); const workspace = createWorkspace(f.files, f.metadata, randomUUID); const project = await workspace.create('技能任务');
    await f.service.install([skillBundle(), validateBundle([{ path: 'SKILL.md', bytes: Buffer.from(skillSource('private-skill', 'DO_NOT_SEND')) }])], f.service.getSnapshot().commit);
    const skill = f.service.getSnapshot().skills.find((skill) => skill.name === 'note-workflow')!; await f.service.grant(project.id, skill.name, true, skill.revision);
    const run = createSkillRun(f.repository, await f.service.capture(project.id, '整理资料')); const requests: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body))); const events = requests.length === 1 ? toolEvents(protocol, 'load_skill', { name: skill.name }) : requests.length === 2 ?
        toolEvents(protocol, 'read_skill_resource', { name: skill.name, path: 'references/template.md' }) : requests.length === 3 ?
          toolEvents(protocol, 'write_text', { path: 'documents/skill-result.md', text: '来源、重点、待确认事项。', expectedRevision: null }) : answerEvents(protocol, '已按技能整理资料。');
      return new Response(sse(events), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const model = snapshot(protocol); const started = await startTestRun(workspace, project.id, '整理资料', { model: model, secret: 'fixture-key', skills: run });
    const task = await started.done; expect(task.state).toBe('completed'); expect(task.skillActivations).toMatchObject([{ name: skill.name, source: 'agent' }]);
    expect(JSON.stringify(requests[0])).toContain('note-workflow'); expect(JSON.stringify(requests[0])).not.toContain('VERSION_ONE');
    expect(JSON.stringify(requests[1])).toContain('VERSION_ONE'); expect(JSON.stringify(requests[1])).not.toContain('RESOURCE_ONE'); expect(JSON.stringify(requests[2])).toContain('RESOURCE_ONE');
    expect(JSON.stringify(requests)).not.toContain('DO_NOT_SEND'); expect(JSON.stringify(requests)).not.toContain('/workspaces/'); expect(task.finalCommit).toBe(task.baseCommit); expect(task.finalSnapshot).not.toBe(task.baseSnapshot);
  });
  it('用户 $技能明确调用在首个请求注入并保存轨迹，下一任务不携带旧技能正文', async () => {
    const f = await setup(); const workspace = createWorkspace(f.files, f.metadata, randomUUID); const project = await workspace.create('明确调用');
    await f.service.install([skillBundle()], f.service.getSnapshot().commit); const skill = f.service.getSnapshot().skills[0]; await f.service.grant(project.id, skill.name, true, skill.revision);
    const requests: any[] = []; vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return new Response(sse(answerEvents('chat-completions', '已使用技能。')), { headers: { 'Content-Type': 'text/event-stream' } }); });
    const run = createSkillRun(f.repository, await f.service.capture(project.id, '$note-workflow 整理'));
    const settings = chatSnapshot({ baseUrl: 'https://example.test', apiModelId: 'fixture' });
    const started = await startTestRun(workspace, project.id, '$note-workflow 整理', { model: settings, secret: 'fixture', skills: run });
    const task = await started.done; expect(task.trace?.[0]).toMatchObject({ tool: 'load_skill', target: 'note-workflow', state: 'completed' }); expect(task.skillActivations?.[0].source).toBe('explicit');
    expect(JSON.stringify(requests[0])).toContain('VERSION_ONE');
    const next = await startTestRun(workspace, project.id, '继续', { model: settings, secret: 'fixture', skills: createSkillRun(f.repository, await f.service.capture(project.id, '继续')) }); await next.done; expect(JSON.stringify(requests[1])).not.toContain('VERSION_ONE');
  });
});
