import { selectProject, openProjectTree } from './workbench-helpers';
import { test, expect, type Page } from '@playwright/test';
import { configureModel } from './model-helpers';

async function createProject(page: Page, name: string) {
  await openProjectTree(page);
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
}

async function openNote(page: Page) {
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
}

test('切换项目后新查询被阻塞，旧项目的文件和对话也不进入新视图', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '范围 A');
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await page.getByLabel('文件名称', { exact: true }).fill('alpha-only.md');
  await page.getByLabel('正文', { exact: true }).fill('仅属于 A');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.getByLabel('任务目标', { exact: true }).fill('Alpha 独立任务');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await createProject(page, '范围 B');
  await page.getByLabel('任务目标', { exact: true }).fill('Beta 独立任务');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await selectProject(page, '范围 A');
  await expect(page.getByTestId('task-trace')).toHaveCount(1);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('agent-mobile-prototype');
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(['files', 'run_headers'], 'readwrite');
    let held = true;
    (window as any).releaseScopeQuery = () => {
      held = false;
    };
    const pump = () => {
      transaction.objectStore('run_headers').get('scope-lock').onsuccess = () => {
        if (held) pump();
      };
    };
    transaction.oncomplete = () => db.close();
    pump();
  });
  await selectProject(page, '范围 B');
  await expect(page.getByTestId('task-trace')).toHaveCount(0);
  await expect(
    page.getByTestId('conversation-scroll').getByText('Alpha 独立任务', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开 documents/alpha-only.md', exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseScopeQuery());
  await expect(
    page.getByRole('button', { name: '打开 documents/notes.md', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(page.getByTestId('task-trace')).toHaveCount(1);
  await expect(
    page.getByTestId('conversation-scroll').getByText('Alpha 独立任务', { exact: true }),
  ).toHaveCount(0);
});

test('保存期间继续输入，旧回执只更新保存基线，新输入与未保存状态保留', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '保存竞态');
  await openNote(page);
  await page.getByLabel('正文', { exact: true }).fill('本次保存的内容');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('agent-mobile-prototype');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(
      ['operation_headers', 'operation_bodies', 'operation_counters'],
      'readwrite',
    );
    let held = true;
    (window as any).releaseEditorSave = () => {
      held = false;
    };
    const pump = () => {
      transaction.objectStore('operation_headers').get('fixture-lock').onsuccess = () => {
        if (held) pump();
      };
    };
    transaction.oncomplete = () => db.close();
    pump();
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByLabel('正文', { exact: true }).fill('保存过程中输入的新内容');
  await page.evaluate(() => (window as any).releaseEditorSave());
  await expect(
    page.getByText('文件已保存，可在 Git 面板暂存并提交。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('保存过程中输入的新内容');
  await expect(page.getByText('未保存的修改', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await page.reload();
  await openNote(page);
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('保存过程中输入的新内容');
});

test('编辑、会话、逐行变化、恢复和刷新持久化', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await createProject(page, '旅行资料');
  await openNote(page);
  await page.getByLabel('正文', { exact: true }).fill('# 杭州旅行\n\n周末去西湖，带上相机。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.getByRole('button', { name: '整理资料', exact: true }).click();
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: /^查看产物差异 / })
    .first()
    .click();
  await expect(page.getByText('documents/summary.md', { exact: true })).toBeVisible();
  await expect(page.getByText('## 原始资料摘录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销修改', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByText('内容已恢复，历史记录已保留。')).toBeVisible();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 documents/summary.md' })).toHaveCount(0);
  await page.reload();
  await openNote(page);
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(
    '# 杭州旅行\n\n周末去西湖，带上相机。',
  );
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  expect(errors).toEqual([]);
});

test('未保存保护、独立编辑器和文件搜索', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '工作笔记');
  await openNote(page);
  await page.getByLabel('正文', { exact: true }).fill('这份草稿需要保留。');
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await expect(page.getByText('有尚未保存的修改', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('这份草稿需要保留。');
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('button', { name: '保存后离开', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭文件', exact: true })).toHaveCount(0);
  await page.getByLabel('搜索文件', { exact: true }).fill('does-not-exist');
  await expect(page.getByText('没有匹配的文件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除文件搜索' }).click();
  await page.getByRole('button', { name: '打开 documents/notes.md' }).click();
  await expect(page.getByText('这份草稿需要保留。', { exact: true })).toBeVisible();
});

test('未保存编辑切换项目，保存或放弃后都执行原来的导航动作', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '编辑项目');
  await createProject(page, '目标项目');
  await selectProject(page, '编辑项目');
  await openNote(page);
  await page.getByLabel('正文', { exact: true }).fill('保存后应切换项目。');
  await selectProject(page, '目标项目');
  await page.getByRole('button', { name: '保存后离开', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
  await selectProject(page, '编辑项目');
  await openNote(page);
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('保存后应切换项目。');
  await page.getByLabel('正文', { exact: true }).fill('应放弃的内容。');
  await selectProject(page, '目标项目');
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
  await selectProject(page, '编辑项目');
  await openNote(page);
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('保存后应切换项目。');
});

test('深浅外观、项目切换和草稿保留', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '项目一');
  await page.getByLabel('任务目标').fill('第一份未发送的任务');
  await createProject(page, '项目二');
  await selectProject(page, '项目一');
  await expect(page.getByLabel('任务目标', { exact: true })).toHaveValue('第一份未发送的任务');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.getByTestId('workbench-dark')).toBeVisible();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('workbench-dark')).toBeVisible();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await expect(page.getByTestId('workbench-light')).toBeVisible();
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('workbench-dark')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByTestId('workbench-light')).toBeVisible();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
});

test('360px 手机：输入区固定、全屏编辑、短视口无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await createProject(page, '随身笔记');
  await page.getByRole('button', { name: '整理资料', exact: true }).click();
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  const composer = await page.getByTestId('composer').boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(740);
  await page.setViewportSize({ width: 360, height: 500 });
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'work/workbench-mobile-light.png' });
  await openNote(page);
  await page.getByLabel('正文', { exact: true }).fill('手机上的新内容');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('所有修改已保存')).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.screenshot({ path: 'work/workbench-mobile-dark.png' });
});

test('图片导入与真实模型协议、文件结果直达', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '模型协议验证');
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: '打开 assets/sample.png' }).click();
  await expect(page.getByText('图片预览', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  await configureModel(page, { key: 'test-only-no-real-secret' });
  let rounds = 0;
  await page.route('https://example.test/v1/chat/completions', async route => {
    rounds++;
    const event =
      rounds === 1
        ? {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'test-call',
                      function: {
                        name: 'write_text',
                        arguments: JSON.stringify({
                          path: 'documents/remote.md',
                          text: '兼容服务工具调用成功',
                          expectedRevision: null,
                        }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          }
        : { choices: [{ delta: { content: '已创建 remote.md。' }, finish_reason: 'stop' }] };
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'data: ' + JSON.stringify(event) + '\n\ndata: [DONE]\n\n',
    });
  });
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.getByLabel('任务目标', { exact: true }).fill('创建一份新文档');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  expect(rounds).toBe(2);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开 documents/remote.md' }).click();
  await expect(page.getByText('兼容服务工具调用成功', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.screenshot({ path: 'work/workbench-desktop-editor-light.png' });
});

test('键盘输入、快捷保存、新建重命名与删除', async ({ page }) => {
  await page.goto('/');
  await createProject(page, '日常资料');
  const input = page.getByLabel('任务目标', { exact: true });
  await input.fill('第一行');
  await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeEnabled();
  await input.press('Enter');
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await page.getByLabel('文件名称', { exact: true }).fill('ideas.md');
  await page.getByLabel('正文', { exact: true }).fill('# 新想法\n\n需要保存的内容。');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重命名文件', exact: true }).click();
  await page.getByLabel('文件名称', { exact: true }).fill('notes-v2.md');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开 documents/notes-v2.md', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '删除文件', exact: true }).click();
  await page.getByRole('button', { name: '删除文件', exact: true }).last().click();
  await expect(
    page.getByRole('button', { name: '打开 documents/notes-v2.md', exact: true }),
  ).toHaveCount(0);
});
