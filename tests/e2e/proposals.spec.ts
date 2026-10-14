import { test, expect } from '@playwright/test';
import { configureModel } from './model-helpers';
import { answerEvents, toolEvents, sse } from '../protocol-fixtures';

const text = (value: any) => Array.isArray(value) ? value.map((part: any) => part.text ?? '').join('') : String(value);
test('写作子 Agent 保留隔离候选，主 Agent 查看并合入，真实 index/HEAD 与整组撤销保留用户原改动', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('写作提案工作区'); await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await page.getByRole('tab', { name: '资料', exact: true }).click(); await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await page.getByLabel('正文', { exact: true }).fill('用户原有未提交资料');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('所有修改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭文件', exact: true }).click(); await page.getByRole('tab', { name: '会话', exact: true }).click(); await configureModel(page);
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; }); let candidateWritten = false; let proposalId = ''; let roots = 0;
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON(); const goal = text(body.messages.find((message: any) => message.role === 'user').content); const tools = body.messages.filter((message: any) => message.role === 'tool');
    let events: unknown[];
    if (goal.startsWith('WRITE_DRAFT')) {
      expect(body.tools.some((tool: any) => tool.function.name === 'write_text')).toBe(true);
      expect(body.tools.some((tool: any) => /^(git_|mcp_|spawn_agent)/.test(tool.function.name))).toBe(false);
      if (tools.length === 0) events = toolEvents('chat-completions', 'read_text', { path: 'documents/notes.md' });
      else if (tools.length === 1) events = toolEvents('chat-completions', 'write_text', { path: 'documents/notes.md', text: '提案改写后的资料', expectedRevision: JSON.parse(text(tools[0].content)).revision });
      else if (tools.length === 2) events = toolEvents('chat-completions', 'write_text', { path: 'documents/proposal.md', text: '隔离候选文稿', expectedRevision: null });
      else { candidateWritten = true; proposalId = JSON.parse(text(tools[2].content)).proposalId; await held; events = answerEvents('chat-completions', '写作提案已生成。'); }
    } else {
      roots++;
      if (roots === 1) events = toolEvents('chat-completions', 'spawn_agent', { role: 'writer', prompt: 'WRITE_DRAFT', paths: ['documents/notes.md', 'documents/proposal.md'], budget: { requests: 6, tools: 6 } });
      else if (roots === 2) events = answerEvents('chat-completions', '等待写作提案。');
      else if (roots === 3) events = toolEvents('chat-completions', 'get_proposal', { proposalId });
      else if (roots === 4) events = toolEvents('chat-completions', 'apply_proposal', { proposalId });
      else events = answerEvents('chat-completions', '已检查并合入写作提案，保存到工作区。');
    }
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(events) });
  });
  await page.getByLabel('任务目标', { exact: true }).fill('委派写作并检查合入'); await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect.poll(() => candidateWritten).toBe(true);
  await page.getByRole('button', { name: '查看隔离提案 WRITE_DRAFT', exact: true }).click(); await expect(page.getByText('隔离写作提案 · 编辑中', { exact: true })).toBeVisible();
  await expect(page.getByText('提案改写后的资料', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '资料', exact: true }).click(); await expect(page.getByRole('button', { name: '打开 documents/proposal.md', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click(); await expect(page.getByText('用户原有未提交资料', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '关闭文件', exact: true }).click();
  release(); await expect(page.getByRole('button', { name: '打开 documents/proposal.md', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '会话', exact: true }).click(); await expect(page.getByText('已完成', { exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: '版本', exact: true }).click(); await expect(page.getByText('提交历史 · 1', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '会话', exact: true }).click(); await page.getByRole('button', { name: '查看变化', exact: true }).click();
  await page.getByRole('button', { name: '撤销修改', exact: true }).click(); await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.getByRole('tab', { name: '资料', exact: true }).click(); await expect(page.getByRole('button', { name: '打开 documents/proposal.md', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '打开 documents/notes.md', exact: true }).click(); await expect(page.getByText('用户原有未提交资料', { exact: true })).toBeVisible();
});
