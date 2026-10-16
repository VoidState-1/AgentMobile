import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
const baseURL = 'http://127.0.0.1:4180';
const output = 'Report/frontend-audit-2026-10-16-evidence';
await fs.mkdir(output, { recursive: true });
const button = (page, name) => page.getByRole('button', { name, exact: true });
const label = (page, name) => page.getByLabel(name, { exact: true });
const tab = (page, name) => page.getByRole('tab', { name, exact: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(name, work) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    baseURL,
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const result = await work(page, context);
    results.push({ name, ...result });
  } catch (error) {
    results.push({ name, error: error.message });
  } finally {
    await context.close();
  }
  process.stdout.write(JSON.stringify(results.at(-1)) + '\n');
}
async function createProject(page) {
  await page.goto('/');
  await button(page, '新建项目').click();
  await label(page, '项目名称').fill('审计隔离实例');
  await button(page, '创建工作区').click();
  await label(page, '任务目标').waitFor();
}
await run('IME composing Enter', async page => {
  await createProject(page);
  const input = label(page, '任务目标');
  await input.fill('nihao');
  await button(page, '发送任务').waitFor();
  while (!(await button(page, '发送任务').isEnabled())) await pause(20);
  await input.dispatchEvent('compositionstart', { data: 'nihao' });
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  await page.getByTestId('task-trace').waitFor();
  await page.screenshot({ path: output + '/ime-submitted.png' });
  return {
    runs: await page.getByTestId('task-trace').count(),
    inputAfter: await input.inputValue(),
  };
});
for (const route of ['/models', '/mcp', '/skills', '/settings/agent']) {
  await run('bootstrap failure ' + route, async (page, context) => {
    await context.addInitScript(() => {
      indexedDB.open = () => {
        throw new DOMException('audit fixture storage unavailable');
      };
    });
    await page.goto(route);
    await pause(700);
    const body = await page.locator('body').innerText();
    await page.screenshot({ path: output + '/startup-' + route.replaceAll('/', '-') + '.png' });
    return {
      visibleFailure: /读取失败/.test(body),
      body,
      spinners: await page.getByRole('progressbar').count(),
    };
  });
}
await run('theme reload configuration route', async page => {
  await page.goto('/');
  await tab(page, '设置').click();
  await button(page, '深色').click();
  await page.getByTestId('workbench-dark').waitFor();
  await pause(150);
  await page.goto('/settings/agent');
  await button(page, '保存 Agent 设置').waitFor();
  const preference = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('agent-mobile-prototype');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const value = await new Promise((resolve, reject) => {
      const r = db.transaction('records').objectStore('records').get('preferences/workbench');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value;
  });
  return {
    preference,
    lightPages: await page.getByTestId('config-light').count(),
    darkPages: await page.getByTestId('config-dark').count(),
  };
});
await run('short touch targets and keyboard menu', async page => {
  await createProject(page);
  await button(page, '项目与对话').click();
  const row = page.getByRole('button', { name: /^切换对话 / }).first();
  const project = page.getByRole('button', { name: /^展开项目 / }).first();
  const bounds = { conversation: await row.boundingBox(), project: await project.boundingBox() };
  await row.focus();
  await row.press('Shift+F10');
  const menu = await page.getByRole('button', { name: /^归档对话 / }).count();
  await page.screenshot({ path: output + '/short-targets.png' });
  await button(page, '收起侧栏').click();
  await tab(page, '文件').click();
  await tab(page, '全部').focus();
  await tab(page, '全部').press('ArrowRight');
  const selectedFileType = await page
    .getByRole('tablist', { name: '文件类型', exact: true })
    .getByRole('tab', { selected: true })
    .innerText();
  await page.screenshot({ path: output + '/tabs-arrow-key.png' });
  return {
    bounds,
    keyboardManagementButtons: menu,
    selectedFileTypeAfterArrowRight: selectedFileType,
  };
});
await run('late diff only prefix displayed', async page => {
  await createProject(page);
  const prefix = ('相同正文'.repeat(20) + '\n').repeat(150);
  await tab(page, '文件').click();
  await button(page, '打开 documents/notes.md').click();
  await button(page, '编辑').click();
  await label(page, '正文').fill(prefix + '旧尾部\n');
  await button(page, '保存').click();
  await button(page, '编辑').waitFor();
  await button(page, '关闭文件').click();
  await tab(page, 'Git').click();
  await button(page, '全部暂存').click();
  await label(page, '提交说明').fill('审计差异基线');
  await button(page, '提交已暂存').click();
  await page.getByText('已提交暂存更改。', { exact: true }).waitFor();
  await tab(page, '文件').click();
  await button(page, '打开 documents/notes.md').click();
  await button(page, '编辑').click();
  await label(page, '正文').fill(prefix + '新尾部\n');
  await button(page, '保存').click();
  await button(page, '编辑').waitFor();
  await button(page, '关闭文件').click();
  await tab(page, 'Git').click();
  await button(page, '查看未暂存差异 documents/notes.md').click();
  await page
    .getByText('较长内容仅预览前 12,000 字符，完整内容可在文件中查看。', { exact: true })
    .waitFor();
  const shown = await page.locator('body').innerText();
  return {
    prefixCharacters: prefix.length,
    hasNewTail: shown.includes('新尾部'),
    hasOldTail: shown.includes('旧尾部'),
    truncationWarning: shown.includes('12,000'),
  };
});
await run('unclosed Markdown inline markers', async page => {
  await createProject(page);
  await tab(page, '文件').click();
  await button(page, '打开 documents/notes.md').click();
  await button(page, '编辑').click();
  await label(page, '正文').fill('**尚未闭合\n`尚未闭合\n[链接](https://example.test)');
  await button(page, '保存').click();
  await button(page, '编辑').waitFor();
  const body = await page.locator('body').innerText();
  await page.screenshot({ path: output + '/markdown-unclosed.png' });
  return {
    hasOriginalBold: body.includes('**尚未闭合'),
    hasOriginalCode: body.includes('`尚未闭合'),
    body,
  };
});
await run('per-keystroke draft writes', async page => {
  await createProject(page);
  await page.evaluate(() => {
    window.auditDraftWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'records' && key === 'conversations/state') window.auditDraftWrites++;
      return put.call(this, value, key);
    };
  });
  await label(page, '任务目标').pressSequentially('abcdefghijklmnopqrst', { delay: 15 });
  await pause(250);
  return {
    charactersTyped: 20,
    persistedWrites: await page.evaluate(() => window.auditDraftWrites),
  };
});
await run('normal dirty configuration browser back', async page => {
  await createProject(page);
  await tab(page, '设置').click();
  await button(page, 'Agent 设置').click();
  await label(page, '系统提示词').fill('未保存的系统提示词');
  await page.evaluate(() => window.history.back());
  await pause(500);
  return {
    urlAfterBack: page.url(),
    unsavedGuardVisible: await page.getByText('有尚未保存的配置', { exact: true }).isVisible(),
    editorVisible: await label(page, '系统提示词').isVisible(),
  };
});
await run('failed skill delete then browser back', async page => {
  await createProject(page);
  await tab(page, '设置').click();
  await button(page, 'Agent Skills').click();
  await button(page, '新建技能').click();
  const source = '---\nname: audit-skill\ndescription: 用于审计隔离测试的技能内容\n---\n\n# 正文\n';
  await label(page, 'SKILL.md 内容').fill(source);
  await button(page, '保存技能').click();
  await button(page, '删除技能').waitFor();
  await label(page, 'SKILL.md 内容').fill(source + '未保存修改');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.auditRestorePut = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'operation_headers') throw new DOMException('audit injected write failure');
      return put.call(this, value, key);
    };
  });
  await button(page, '删除技能').click();
  await button(page, '确认删除技能').click();
  await page.getByText('技能删除未完成，请重新打开应用恢复。', { exact: true }).first().waitFor();
  const activeDialog = await page.getByRole('dialog').innerText();
  await page.screenshot({ path: output + '/failed-delete-modal.png' });
  await button(page, '关闭').click();
  await page.evaluate(() => {
    window.auditRestorePut();
    window.history.back();
  });
  await pause(500);
  return {
    activeDialog,
    errorInActiveDialog: activeDialog.includes('技能删除未完成'),
    urlAfterBack: page.url(),
    unsavedGuardVisible: await page.getByText('有尚未保存的配置', { exact: true }).isVisible(),
    editorVisible: await label(page, 'SKILL.md 内容').isVisible(),
  };
});
await browser.close();
await fs.writeFile(
  output +
    (process.argv[2]
      ? '/supplementary-' + process.argv[2].replaceAll(' ', '-') + '.json'
      : '/results.json'),
  JSON.stringify(results, null, 2) + '\n',
);
