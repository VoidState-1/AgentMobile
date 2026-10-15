import { addReference, openProjectTree } from '../e2e/workbench-helpers';
import { readCurrentRuns } from '../e2e/current-records';
import fs from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { openModels, returnToWorkbench } from '../e2e/model-helpers';

const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
test.skip(!apiKey, '显式设置 DEEPSEEK_API_KEY 才会执行付费测试。');

async function readDocument(page: Page, path: string): Promise<string> {
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 ' + path, exact: true }).click({ timeout: 10000 });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const value = await page.getByLabel('正文', { exact: true }).inputValue();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  return value;
}

async function task(page: Page, prompt: string, completed: number) {
  process.stdout.write('真实任务 ' + completed + ' 开始。\n');
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.getByLabel('任务目标', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await Promise.race([
    expect(page.getByText('已完成', { exact: true })).toHaveCount(completed, { timeout: 145000 }),
    page
      .getByText('执行失败', { exact: true })
      .waitFor({ timeout: 145000 })
      .then(async () => {
        throw new Error(
          '真实任务失败：' +
            (await page.locator('body').innerText()).replaceAll(apiKey, '[redacted]').slice(-1800),
        );
      }),
  ]);
  process.stdout.write('真实任务 ' + completed + ' 已完成。\n');
}

test('DeepSeek 真实图文工作区：连接、整理、追问修改、撤销、看图和重开', async ({ page }) => {
  const balance = async () => {
    const response = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: 'Bearer ' + apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('余额查询返回 HTTP ' + response.status);
    const value = await response.json();
    return Number(
      value.balance_infos?.find((item: { currency: string }) => item.currency === 'CNY')
        ?.total_balance,
    );
  };
  const before = await balance();
  const calls: { status: number; request: unknown; usage?: unknown; tools: string[] }[] = [];
  const pending: Promise<void>[] = [];
  let requestCount = 0;
  // Cap the paid suite independently from each Agent run's own budget.
  await page.route('https://api.deepseek.com/chat/completions', async route => {
    requestCount++;
    if (requestCount > 20) await route.abort();
    else await route.continue();
  });
  page.on('response', response => {
    if (!response.url().endsWith('api.deepseek.com/chat/completions')) return;
    pending.push(
      (async () => {
        let events: {
          choices?: { delta?: { tool_calls?: { function?: { name?: string } }[] } }[];
          usage?: unknown;
        }[] = [];
        try {
          events = (await response.text())
            .split('\n')
            .filter(line => line.startsWith('data: '))
            .flatMap(line => {
              try {
                return [JSON.parse(line.slice(6))];
              } catch {
                return [];
              }
            });
        } catch {
          /* The app cancels a response after its completed stream. */
        }
        calls.push({
          status: response.status(),
          request: JSON.parse(response.request().postData() ?? '{}'),
          usage: events.filter(event => event.usage).at(-1)?.usage,
          tools: events
            .flatMap(
              event =>
                event.choices?.flatMap(
                  choice => choice.delta?.tool_calls?.map(call => call.function?.name ?? '') ?? [],
                ) ?? [],
            )
            .filter(Boolean),
        });
      })(),
    );
  });
  try {
    await page.goto('/');
    await openProjectTree(page);
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByLabel('项目名称', { exact: true }).fill('DeepSeek 图文实测');
    await page.getByRole('button', { name: '创建工作区', exact: true }).click();
    const original =
      '# 周六杭州行程\n\n9:00 到西湖，午饭吃素食，预算 300 元，不安排住宿。\n联系人称呼是小林。';
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('正文', { exact: true }).fill(original);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭文件', exact: true }).click();
    await openModels(page);
    await page.getByRole('button', { name: '添加连接', exact: true }).click();
    await page.getByRole('button', { name: 'DeepSeek', exact: true }).click();
    await page.getByLabel('API Key', { exact: true }).fill(apiKey);
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await page.getByRole('button', { name: '检测连接并发现模型', exact: true }).click();
    await expect(page.getByText(/目录检测通过/)).toBeVisible();
    await page.getByRole('button', { name: '编辑模型 deepseek-flash', exact: true }).click();
    await page.getByRole('switch', { name: '允许图片输入', exact: true }).click();
    await page.getByRole('button', { name: '保存模型', exact: true }).click();
    await page.getByRole('button', { name: '设为全局默认', exact: true }).click();
    await expect(page.getByRole('button', { name: '已为全局默认', exact: true })).toBeVisible();
    await returnToWorkbench(page);

    await task(
      page,
      '请读取 documents/notes.md，创建 documents/plan.md，用不超过 200 字整理成中文行程。准确保留时间、预算、饮食、住宿和联系人信息。实际保存文件，最后只说结果。',
      1,
    );
    const plan = await readDocument(page, 'documents/plan.md');
    expect(plan).toMatch(/9[:：]00|09[:：]00/);
    expect(plan).toContain('300');
    expect(plan).toContain('小林');
    expect(plan).toContain('素');
    await task(
      page,
      '把你刚才保存的行程预算改为 250 元，时间和联系人沿用刚才的信息。只修改原来的行程文件，不要修改源笔记。',
      2,
    );
    const revised = await readDocument(page, 'documents/plan.md');
    expect(revised).toContain('250');
    expect(revised).toContain('小林');
    expect(await readDocument(page, 'documents/notes.md')).toBe(original);
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.getByRole('button', { name: '查看变化', exact: true }).last().click();
    await expect(page.getByText('修改 · documents/plan.md', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '撤销修改', exact: true }).click();
    await page.getByRole('button', { name: '确认恢复', exact: true }).click();
    expect(await readDocument(page, 'documents/plan.md')).toBe(plan);

    // Image-only facts are omitted from the prompt, proving actual image reading.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 700;
      canvas.height = 460;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 700, 460);
      ctx.fillStyle = '#243A73';
      ctx.font = 'bold 44px Arial';
      ctx.fillText('MEETING NOTE', 45, 70);
      ctx.font = '36px Arial';
      ctx.fillText('ROOM B-17', 45, 170);
      ctx.fillText('TIME 14:30', 45, 260);
      ctx.fillText('PEOPLE 6', 45, 350);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入', exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: 'meeting.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(
      page.getByRole('button', { name: '打开 assets/meeting.png', exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await addReference(page);
    await page.getByRole('button', { name: '引用 assets/meeting.png', exact: true }).click();
    await task(
      page,
      '请通过图片工具阅读参考图片，把图中的房间、时间和人数用中文保存为 documents/image-note.md，不超过 80 字。不要根据文件名猜测，保留原图。',
      3,
    );
    const note = await readDocument(page, 'documents/image-note.md');
    expect(note).toContain('B-17');
    expect(note).toMatch(/14[:：]30/);
    expect(note).toMatch(/6|六/);
    await page.reload();
    expect(await readDocument(page, 'documents/image-note.md')).toBe(note);
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.screenshot({ path: 'work/deepseek-live-conversation.png', fullPage: true });
  } finally {
    await Promise.race([
      Promise.allSettled(pending),
      new Promise(resolve => setTimeout(resolve, 10000)),
    ]);
    const reportTasks = await readCurrentRuns(page);
    const usage = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('agent-mobile-prototype');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<any[]>((resolve, reject) => {
        const request = db
          .transaction('transcript_frames')
          .objectStore('transcript_frames')
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return rows
        .map(frame => frame.payload)
        .filter(message => message.role === 'assistant' && message.usage?.totalTokens)
        .map(message => message.usage);
    });
    const after = await balance();
    const report = {
      beforeCny: before,
      afterCny: after,
      spentCny: Number((before - after).toFixed(4)),
      requestCount,
      calls,
      tasks: reportTasks,
      usage,
    };
    const serialized = JSON.stringify(report, null, 2);
    if (serialized.includes(apiKey)) throw new Error('测试报告包含凭证。');
    await fs.mkdir('work', { recursive: true });
    await fs.writeFile('work/deepseek-live-report.json', serialized);
    process.stdout.write(
      JSON.stringify({
        requestCount,
        spentCny: report.spentCny,
        statuses: calls.map(call => call.status),
      }) + '\n',
    );
  }
});
