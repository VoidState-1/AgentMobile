import { test, expect, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { zipSync, unzipSync } from 'fflate';
import fs from 'node:fs/promises';
import { skillSource } from '../skills-fixtures';
import { toolEvents, answerEvents, sse } from '../protocol-fixtures';
import { configureModel, returnToWorkbench } from './model-helpers';

async function project(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('技能项目');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}
async function openSkills(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'Agent Skills', exact: true }).click();
}
async function createSkill(page: Page) {
  await openSkills(page);
  await page.getByRole('button', { name: '新建技能', exact: true }).click();
  await page.getByLabel('SKILL.md 内容', { exact: true }).fill(skillSource());
  await page.getByRole('button', { name: '保存技能', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }),
  ).toBeVisible();
}
async function importZip(page: Page, files: Record<string, Uint8Array>) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入 SKILL.md / ZIP', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'skills.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync(files)),
  });
  await expect(page.getByText('导入技能预览', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '安装技能包', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }),
  ).toBeVisible();
}
test('Skills 导入、按需加载、明确调用和工作区 Git 结果', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests: any[] = [];
  await project(page);
  await configureModel(page);
  await openSkills(page);
  await importZip(page, {
    'note-workflow/SKILL.md': Buffer.from(skillSource()),
    'note-workflow/references/template.md': Buffer.from('RESOURCE_ONE: 来源、重点、待确认事项。'),
  });
  await expect(
    page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }).click();
  await returnToWorkbench(page);
  await page.route('https://example.test/v1/chat/completions', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const count = body.messages.filter((message: any) => message.role === 'tool').length;
    const explicit = JSON.stringify(
      body.messages.findLast((message: any) => message.role === 'user')?.content,
    ).includes('$note-workflow');
    const stage = count + (explicit ? 1 : 0);
    const events =
      stage === 0
        ? toolEvents('chat-completions', 'load_skill', { name: 'note-workflow' })
        : stage === 1
          ? toolEvents('chat-completions', 'read_skill_resource', {
              name: 'note-workflow',
              path: 'references/template.md',
            })
          : stage === 2
            ? toolEvents('chat-completions', 'write_text', {
                path: explicit ? 'documents/skill-explicit.md' : 'documents/skill-auto.md',
                text: '来源、重点、待确认事项。',
                expectedRevision: null,
              })
            : answerEvents('chat-completions', '已按技能整理资料。');
    await route.fulfill({ contentType: 'text/event-stream', body: sse(events) });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('整理资料');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已按技能整理资料。', { exact: true })).toBeVisible();
  expect(JSON.stringify(requests[0])).not.toContain('VERSION_ONE');
  expect(JSON.stringify(requests[1])).toContain('VERSION_ONE');
  expect(JSON.stringify(requests[2])).toContain('RESOURCE_ONE');
  await page
    .getByRole('button', { name: '查看工具详情 加载技能 note-workflow', exact: true })
    .click();
  await expect(page.getByText(/VERSION_ONE/).first()).toBeVisible();
  await page.getByRole('button', { name: '选择技能', exact: true }).click();
  await page.getByRole('button', { name: '使用技能 note-workflow', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('$note-workflow ');
  await page.getByLabel('任务目标', { exact: true }).fill('$note-workflow 再次整理');
  const nextIndex = requests.length;
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已按技能整理资料。', { exact: true })).toHaveCount(2);
  expect(JSON.stringify(requests[nextIndex])).toContain('VERSION_ONE');
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开 documents/skill-auto.md', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '打开 documents/skill-explicit.md', exact: true }),
  ).toBeVisible();
  await page.reload();
  await openSkills(page);
  await expect(
    page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }),
  ).toBeChecked();
  expect(errors).toEqual([]);
});
test('Skills 编辑、资源、启用撤销、历史恢复、导出、未保存与深浅主题', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await project(page);
  await createSkill(page);
  await page.getByRole('button', { name: '添加文字资源', exact: true }).click();
  await page.getByLabel('技能资源路径', { exact: true }).fill('references/template.md');
  await page.getByLabel('技能资源内容', { exact: true }).fill('RESOURCE_ONE');
  await page.getByRole('button', { name: '应用资源到草稿', exact: true }).click();
  await page.getByRole('button', { name: '保存技能', exact: true }).click();
  await expect(page.getByText('技能已保存；内容变化后请重新启用。', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }).click();
  await page
    .getByLabel('SKILL.md 内容', { exact: true })
    .fill(skillSource('note-workflow', 'VERSION_TWO'));
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByText('有尚未保存的配置', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存技能', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: '查看技能版本', exact: true }).click();
  await page
    .getByRole('button', { name: /^预览技能版本 / })
    .first()
    .click();
  await expect(page.getByText('预览历史技能', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复此技能版本', exact: true }).click();
  await expect(page.getByLabel('SKILL.md 内容', { exact: true })).toHaveValue(skillSource());
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出技能 ZIP', exact: true }).click();
  const exported = await download;
  const files = unzipSync(new Uint8Array(await fs.readFile((await exported.path())!)));
  expect(Buffer.from(files['note-workflow/references/template.md']).toString()).toBe(
    'RESOURCE_ONE',
  );
  await page.getByLabel('SKILL.md 内容', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'work/skills-mobile-light.png' });
  await returnToWorkbench(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: 'Agent Skills', exact: true }).click();
  await page.getByRole('button', { name: '管理技能 note-workflow', exact: true }).click();
  await expect(page.getByTestId('config-dark').last()).toBeVisible();
  await page.screenshot({ path: 'work/skills-mobile-dark.png' });
  await page.setViewportSize({ width: 360, height: 500 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByRole('button', { name: '保存技能', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除技能', exact: true }).click();
  await page.getByRole('button', { name: '确认删除技能', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '管理技能 note-workflow', exact: true }),
  ).toHaveCount(0);
});
test('Skills 运行中更新与删除不改变已启动版本，未启用的明确调用保留草稿', async ({ page }) => {
  await project(page);
  await configureModel(page);
  await openSkills(page);
  await importZip(page, {
    'note-workflow/SKILL.md': Buffer.from(skillSource()),
    'note-workflow/references/template.md': Buffer.from('RESOURCE_ONE'),
  });
  await page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }).click();
  await returnToWorkbench(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const requests: any[] = [];
  await page.route('https://example.test/v1/chat/completions', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 1) await held;
    const events =
      requests.length === 1
        ? toolEvents('chat-completions', 'load_skill', { name: 'note-workflow' })
        : requests.length === 2
          ? toolEvents('chat-completions', 'read_skill_resource', {
              name: 'note-workflow',
              path: 'references/template.md',
            })
          : answerEvents('chat-completions', '旧版本任务完成。');
    await route.fulfill({ contentType: 'text/event-stream', body: sse(events) });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('整理资料');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await openSkills(page);
  await page.getByRole('button', { name: '管理技能 note-workflow', exact: true }).click();
  await page
    .getByLabel('SKILL.md 内容', { exact: true })
    .fill(skillSource('note-workflow', 'VERSION_TWO'));
  await page.getByRole('button', { name: '保存技能', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: '启用技能 note-workflow', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: '删除技能', exact: true }).click();
  await page.getByRole('button', { name: '确认删除技能', exact: true }).click();
  await returnToWorkbench(page);
  release();
  await expect(page.getByText('旧版本任务完成。', { exact: true })).toBeVisible();
  expect(JSON.stringify(requests)).toContain('VERSION_ONE');
  expect(JSON.stringify(requests)).not.toContain('VERSION_TWO');
  await page.getByLabel('任务目标', { exact: true }).fill('$note-workflow 再次调用');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(
    page.getByText('技能 $note-workflow 尚未在此项目启用，请先在 Agent Skills 中启用。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('$note-workflow 再次调用');
  expect(requests).toHaveLength(3);
});
