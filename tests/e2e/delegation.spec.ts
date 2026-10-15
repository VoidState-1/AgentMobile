import { readCurrentRuns } from './current-records';
import { test, expect } from '@playwright/test';
import { configureModel } from './model-helpers';
import { answerEvents, toolEvents, sse } from '../protocol-fixtures';

for (const explicitWait of [false, true])
  test(
    explicitWait
      ? 'wait_agents 显式等待，UI 定向取消一个子 Agent 后另一个继续完成'
      : '主 Agent 异步委派两个只读子任务，等待期间释放请求槽，汇总后再完成，轨迹和结果重启保留',
    async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
      await page.getByLabel('项目名称', { exact: true }).fill('子任务工作区');
      await page.getByRole('button', { name: '创建工作区', exact: true }).click();
      await configureModel(page);
      const childBodies: any[] = [];
      const rootBodies: any[] = [];
      let release!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      await page.route('https://example.test/v1/chat/completions', async route => {
        const body = route.request().postDataJSON();
        const content = body.messages.find((message: any) => message.role === 'user').content;
        const user = Array.isArray(content)
          ? content.map((part: any) => part.text ?? '').join('')
          : String(content);
        if (String(user).startsWith('子任务')) {
          childBodies.push(body);
          expect(
            body.tools.every((tool: any) =>
              ['list_files', 'read_text', 'search_text'].includes(tool.function.name),
            ),
          ).toBe(true);
          expect(JSON.stringify(body)).not.toContain('主任务私密说明');
          if (!body.messages.some((message: any) => message.role === 'tool'))
            await route.fulfill({
              status: 200,
              contentType: 'text/event-stream',
              body: sse(
                toolEvents('chat-completions', 'read_text', { path: 'documents/notes.md' }),
              ),
            });
          else {
            await held;
            await route.fulfill({
              status: 200,
              contentType: 'text/event-stream',
              body: sse(
                answerEvents(
                  'chat-completions',
                  user.startsWith('子任务A')
                    ? '分析A完成，引用 notes.md。'
                    : '审阅B完成，引用 notes.md。',
                ),
              ),
            });
          }
        } else {
          rootBodies.push(body);
          if (rootBodies.length === 1) {
            const calls = ['A', 'B'].map((name, index) => ({
              index,
              id: 'spawn-' + name,
              type: 'function',
              function: {
                name: 'spawn_agent',
                arguments: JSON.stringify({
                  role: name === 'A' ? 'reader' : 'reviewer',
                  prompt: '子任务' + name,
                  paths: ['documents/notes.md'],
                  budget: { requests: 4, tools: 4 },
                }),
              },
            }));
            await route.fulfill({
              status: 200,
              contentType: 'text/event-stream',
              body: sse([
                {
                  choices: [
                    { delta: { role: 'assistant', tool_calls: calls }, finish_reason: null },
                  ],
                },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
              ]),
            });
          } else if (explicitWait && rootBodies.length === 2) {
            const runIds = body.messages
              .filter((message: any) => message.role === 'tool')
              .map((message: any) => {
                const content = message.content;
                const text =
                  typeof content === 'string'
                    ? content
                    : content.map((part: any) => part.text ?? '').join('');
                return JSON.parse(text).runId;
              });
            await route.fulfill({
              status: 200,
              contentType: 'text/event-stream',
              body: sse(
                toolEvents('chat-completions', 'wait_agents', { runIds, timeoutMs: 60000 }),
              ),
            });
          } else
            await route.fulfill({
              status: 200,
              contentType: 'text/event-stream',
              body: sse(
                answerEvents(
                  'chat-completions',
                  rootBodies.length === 2
                    ? '等待分析收束。'
                    : explicitWait
                      ? '审阅B结果已整合；分析A已停止。'
                      : '综合完成，分析A和审阅B的结果已整合。',
                ),
              ),
            });
        }
      });
      await page
        .getByLabel('任务目标', { exact: true })
        .fill('主任务私密说明：并行阅读和审阅 notes.md');
      await page.getByRole('button', { name: '发送任务', exact: true }).click();
      await expect
        .poll(
          () =>
            childBodies.filter(body =>
              body.messages.some((message: any) => message.role === 'tool'),
            ).length,
        )
        .toBe(2);
      await expect(page.getByTestId('child-trace')).toHaveCount(2);
      await expect(
        page.getByTestId('conversation-scroll').getByText('等待子任务', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('已完成', { exact: true })).toHaveCount(0);
      if (explicitWait) {
        await page.getByRole('button', { name: '停止子 Agent 子任务A', exact: true }).click();
        await expect(page.getByText('子 Agent · 已停止', { exact: true })).toBeVisible();
      }
      release();
      await expect(page.getByText('已完成', { exact: true })).toHaveCount(1);
      expect(rootBodies).toHaveLength(3);
      expect(JSON.stringify(rootBodies[2])).toContain(explicitWait ? 'cancelled' : '分析A完成');
      expect(JSON.stringify(rootBodies[2])).toContain('审阅B完成');
      if (!explicitWait) {
        await page.getByRole('button', { name: '展开子 Agent 子任务A', exact: true }).click();
        await expect(page.getByText('分析A完成，引用 notes.md。', { exact: true })).toBeVisible();
      }
      await page.reload();
      await expect(page.getByTestId('child-trace')).toHaveCount(2);
      await page.getByRole('button', { name: '展开子 Agent 子任务B', exact: true }).click();
      await expect(page.getByText('审阅B完成，引用 notes.md。', { exact: true })).toBeVisible();
      const records = await readCurrentRuns(page);
      expect(records).toHaveLength(3);
      expect(
        records
          .filter(record => record.kind === 'child')
          .map(record => record.state)
          .sort(),
      ).toEqual(explicitWait ? ['cancelled', 'completed'] : ['completed', 'completed']);
      expect(
        new Set(
          records.filter(record => record.kind === 'child').map(record => record.inputSnapshotRef),
        ).size,
      ).toBe(1);
    },
  );
