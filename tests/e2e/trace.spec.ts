import { test, expect } from '@playwright/test';
import { protocols, snapshot, answerEvents, toolEvents, sse } from '../protocol-fixtures';
import { openModels, addConnection, addModel, returnToWorkbench } from './model-helpers';
import { readCurrentRuns } from './current-records';

test('超过一页的工作轨迹独立展示最终回答，并按需展开长回答', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('长轨迹');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await page.getByLabel('任务目标', { exact: true }).fill('整理笔记');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  const run = (await readCurrentRuns(page))[0];
  await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('agent-mobile-prototype');
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(['run_headers', 'run_results', 'trace_nodes'], 'readwrite');
    const headers = transaction.objectStore('run_headers');
    const traces = transaction.objectStore('trace_nodes');
    const response = '最终长回答\n' + '内容'.repeat(7000) + '\n回答尾部';
    headers.get(id).onsuccess = event => {
      const header = (event.target as IDBRequest).result;
      headers.put(
        {
          ...header,
          revision: header.revision + 1,
          responsePreview: response.slice(0, 200),
          responseCharacters: response.length,
        },
        id,
      );
    };
    transaction.objectStore('run_results').put({ response }, id);
    traces.getAll().onsuccess = event => {
      for (const node of (event.target as IDBRequest).result)
        if (node.runId === id) traces.delete(node.id);
      for (let step = 1; step <= 62; step++) {
        const node = {
          id: id + '-step-' + step,
          runId: id,
          rootRunId: id,
          runSequence: step,
          groupSequence: step,
          round: step,
          kind: 'tool',
          state: 'completed',
          revision: 1,
          tool: 'list_files',
          callId: String(step),
          input: '{}',
          output: '{}',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          textPreview: '',
          textCharacters: 0,
          textChunks: 0,
        };
        traces.put(node, node.id);
      }
    };
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, run.id);
  await page.reload();
  await expect(page.getByRole('button', { name: '加载更多工作步骤', exact: true })).toBeVisible();
  await expect(page.getByTestId('run-response')).toContainText('最终长回答');
  await expect(page.getByTestId('run-response')).not.toContainText('回答尾部');
  await page.getByRole('button', { name: '展开更多回答', exact: true }).click();
  await expect(page.getByTestId('run-response')).toContainText('回答尾部');
  await expect(page.getByTestId('trace-tool')).toHaveCount(50);
  await page.getByRole('button', { name: '加载更多工作步骤', exact: true }).click();
  await expect(page.getByTestId('trace-tool')).toHaveCount(62);
});

for (const protocol of protocols)
  test(protocol + '：推理与工具交错、配置生效、详情和刷新', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
    await page.getByLabel('项目名称', { exact: true }).fill('轨迹工作区');
    await page.getByRole('button', { name: '创建工作区', exact: true }).click();
    await expect(page.getByLabel('任务目标', { exact: true })).toBeVisible();
    await openModels(page);
    await addConnection(page, '轨迹模拟服务', protocol);
    await addModel(page, '轨迹模拟模型', snapshot(protocol).apiModelId);
    if (protocol !== 'chat-completions') {
      await page.getByRole('button', { name: '推理模式：开启', exact: true }).click();
      await page.getByLabel('推理预算 tokens', { exact: true }).fill('2048');
      await page.getByRole('button', { name: '保存模型', exact: true }).click();
      await expect(page.getByText('模型配置已保存。', { exact: true })).toBeVisible();
    } else {
      await page.getByRole('button', { name: '推理模式：服务默认', exact: true }).click();
      await page.getByRole('button', { name: '保存模型', exact: true }).click();
    }
    await page.getByRole('button', { name: '设为全局默认', exact: true }).click();
    await returnToWorkbench(page);
    const initial = toolEvents(protocol, 'list_files') as any[];
    if (protocol === 'chat-completions')
      initial.unshift(
        { choices: [{ delta: { reasoning_content: '先确认现有资料，再核对项目文件。' } }] },
        { choices: [{ delta: { content: '我先查看项目文件。' } }] },
      );
    if (protocol === 'gemini')
      initial[0].candidates[0].content.parts.unshift(
        {
          thought: true,
          text: '先确认现有资料，再核对项目文件。',
          thoughtSignature: 'never-display-signature',
        },
        { text: '我先查看项目文件。' },
      );
    if (protocol === 'anthropic-messages') {
      for (const event of initial) if (event.index === 1) event.index = 2;
      initial.splice(
        5,
        0,
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '我先查看项目文件。' },
        },
        { type: 'content_block_stop', index: 1 },
      );
    }
    let requests = 0;
    await page.route('https://example.test/v1/**', async route => {
      const body = route.request().postDataJSON();
      requests++;
      if (protocol === 'anthropic-messages')
        expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
      if (protocol === 'gemini')
        expect(body.generationConfig.thinkingConfig).toEqual({
          includeThoughts: true,
          thinkingBudget: 2048,
        });
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse(
          requests === 1 ? initial : answerEvents(protocol, '项目文件已核对，可继续整理笔记。'),
        ),
      });
    });
    await page.getByLabel('任务目标', { exact: true }).fill('核对项目资料');
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await expect(page.getByText('已完成', { exact: true })).toBeVisible();
    const trace = page.getByTestId('task-trace');
    await expect(
      trace.locator(
        '[data-testid="trace-reasoning"], [data-testid="trace-tool"], [data-testid="trace-text"]',
      ),
    ).toHaveCount(4);
    expect(
      await trace
        .locator(
          '[data-testid="trace-reasoning"], [data-testid="trace-tool"], [data-testid="trace-text"]',
        )
        .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid'))),
    ).toEqual(['trace-reasoning', 'trace-text', 'trace-tool', 'trace-text']);
    const reasoningLabel = protocol === 'chat-completions' ? '思考过程' : '推理摘要';
    await page.getByRole('button', { name: '展开' + reasoningLabel, exact: true }).click();
    await expect(
      trace.getByText('服务返回的' + (protocol === 'chat-completions' ? '公开内容' : '摘要'), {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: '查看工具详情 浏览项目文件', exact: true }).click();
    await expect(trace.getByText('结果', { exact: true })).toBeVisible();
    await expect(trace.getByText(/documents\/notes.md/)).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('never-display-signature');
    await page.getByRole('button', { name: '查看工具详情 浏览项目文件', exact: true }).click();
    await page.screenshot({ path: 'work/trace-mobile-' + protocol + '-light.png' });
    await page.getByRole('button', { name: '查看工作轨迹', exact: true }).click();
    await expect(page.getByTestId('trace-tool')).toHaveCount(0);
    await expect(
      trace.getByText('项目文件已核对，可继续整理笔记。', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '查看工作轨迹', exact: true }).click();
    await page.reload();
    await expect(page.getByText('我先查看项目文件。', { exact: true })).toBeVisible();
    await expect(page.getByTestId('trace-reasoning')).toHaveCount(1);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByTestId('workbench-dark')).toBeVisible();
    await page.getByRole('button', { name: '展开' + reasoningLabel, exact: true }).click();
    await page.screenshot({ path: 'work/trace-mobile-' + protocol + '-dark.png' });
    await page.setViewportSize({ width: 360, height: 500 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeVisible();
    expect(requests).toBe(2);
    expect(errors).toEqual([]);
  });

test('重启收束正在生成的轨迹，并保留收到的推理摘要', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('轨迹恢复');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await page.getByRole('button', { name: '整理资料', exact: true }).click();
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('agent-mobile-prototype');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>(resolve => {
      const tx = db.transaction(['trace_nodes', 'trace_text_chunks', 'run_headers'], 'readwrite');
      const request = tx.objectStore('run_headers').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value.kind === 'root') {
          const task = cursor.value;
          task.state = 'running';
          task.active = 1;
          cursor.update(task);
          const text = '中断前已收到的摘要。';
          const id = 'interrupted-thought';
          tx.objectStore('trace_nodes').put(
            {
              id,
              runId: task.id,
              rootRunId: task.id,
              runSequence: 99,
              groupSequence: 99,
              revision: 1,
              round: 5,
              contentIndex: 0,
              kind: 'reasoning',
              visibility: 'summary',
              state: 'running',
              startedAt: task.createdAt,
              textPreview: text,
              textCharacters: text.length,
              textChunks: 1,
            },
            id,
          );
          tx.objectStore('trace_text_chunks').put(
            { nodeId: id, ordinal: 0, offset: 0, text, characters: text.length },
            [id, 0],
          );
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByText('已中断', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展开推理摘要', exact: true }).click();
  await expect(page.getByText('服务返回的摘要 · 未完整结束', { exact: true })).toBeVisible();
  await expect(page.getByText('中断前已收到的摘要。', { exact: true })).toBeVisible();
});
