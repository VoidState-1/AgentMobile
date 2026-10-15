import http from 'node:http';
import { Buffer } from 'node:buffer';
import { mcpFixture, mcpSse } from '../tests/mcp-fixtures.ts';
import { sourceModule } from './source-module.mjs';
const { answerEvents, toolEvents, sse } = await import(
  await sourceModule('tests/protocol-fixtures.ts')
);

// Local-only fixture for Android and browser verification, with no paid service.
const fixtures = {
  '/mcp-legacy': mcpFixture({ sse: true, paginated: true, token: 'fixture-mcp-token' }),
  '/mcp-modern': mcpFixture({
    modern: true,
    sse: true,
    paginated: true,
    token: 'fixture-mcp-token',
  }),
  '/mcp-hold': mcpFixture({ modern: true, sse: true, token: 'fixture-mcp-token' }),
};
let heldCalls = 0;
http
  .createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'content-type,authorization,mcp-session-id,mcp-protocol-version,last-event-id',
    );
    response.setHeader('Access-Control-Allow-Methods', 'POST,GET,DELETE,OPTIONS');
    response.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url, 'http://127.0.0.1:4181');
    if (url.pathname === '/stats') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          heldCalls,
          legacyCalls: fixtures['/mcp-legacy'].calls,
          modernCalls: fixtures['/mcp-modern'].calls,
        }),
      );
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const fixture = fixtures[url.pathname];
    if (fixture) {
      const body = raw ? JSON.parse(raw) : {};
      if (
        url.pathname === '/mcp-hold' &&
        body.method === 'tools/call' &&
        request.headers.authorization === 'Bearer fixture-mcp-token'
      ) {
        heldCalls++;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
          mcpSse([
            {
              jsonrpc: '2.0',
              method: 'notifications/progress',
              params: {
                progressToken: body.params?._meta?.progressToken,
                progress: 1,
                total: 2,
                message: '远端正在执行，等待核对',
              },
            },
          ]),
        );
        return;
      }
      const value = await fixture.handle(url, {
        method: request.method,
        headers: request.headers,
        body: raw || undefined,
      });
      response.writeHead(value.status, Object.fromEntries(value.headers));
      response.end(await value.text());
      return;
    }
    if (url.pathname === '/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'mcp-model', display_name: 'MCP Fixture' }] }));
      return;
    }
    if (url.pathname !== '/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const body = JSON.parse(raw);
    const toolResults = body.messages.filter(message => message.role === 'tool');
    const mcp = body.tools?.find(tool => tool.function.name.startsWith('mcp_'));
    if (!mcp) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(sse(answerEvents('chat-completions', '未授权 MCP 工具，未调用远端服务。')));
      return;
    }
    const events =
      !toolResults.length && mcp
        ? toolEvents('chat-completions', mcp.function.name, {
            query: raw.includes('HOLD') ? 'wait' : 'notes',
          })
        : toolResults.length === 1 && !toolResults[0].content.includes('未知')
          ? toolEvents('chat-completions', 'write_text', {
              path: raw.includes('Legacy') ? 'documents/mcp-legacy.md' : 'documents/mcp.md',
              text: '远程资料：MCP 查询成功。',
              expectedRevision: null,
            })
          : answerEvents(
              'chat-completions',
              toolResults[0]?.content.includes('未知')
                ? '远端结果未知，请先核对 MCP 服务器。'
                : '已保存远程资料。',
            );
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(sse(events));
  })
  .listen(4181, '127.0.0.1', () => process.stdout.write('MCP and model fixture: 127.0.0.1:4181\n'));
