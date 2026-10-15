export const fixtureTools = [
  {
    name: 'lookup',
    title: '资料查询',
    description: '返回用于保存到项目的测试资料。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'side_effect',
    description: '修改远端测试状态。',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
  },
];
export const mcpSse = (messages: unknown[]) =>
  messages.map(message => 'event: message\ndata: ' + JSON.stringify(message) + '\n\n').join('');
export function mcpFixture(
  options: { modern?: boolean; sse?: boolean; paginated?: boolean; token?: string } = {},
) {
  const requests: { method: string; params?: Record<string, any>; headers: Headers }[] = [];
  let tools = structuredClone(fixtureTools);
  let calls = 0;
  let callStatus = 200;
  let result: any = {
    content: [{ type: 'text', text: '远程资料：MCP 查询成功。' }],
    structuredContent: { source: 'fixture' },
  };
  const handle = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'GET' || init?.method === 'DELETE')
      return new Response(null, { status: 405 });
    const headers = new Headers(init?.headers);
    if (options.token && headers.get('authorization') !== 'Bearer ' + options.token)
      return new Response('Unauthorized', { status: 401 });
    const body = JSON.parse(String(init?.body));
    requests.push({ ...body, headers });
    const complete = (value: any) =>
      options.modern && body.method !== 'server/discover'
        ? {
            ...value,
            resultType: 'complete',
            ...(body.method === 'tools/list' ? { ttlMs: 0, cacheScope: 'private' } : {}),
          }
        : value;
    const response = (value: unknown) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: complete(value) }), {
        headers: {
          'Content-Type': 'application/json',
          ...(options.modern ? {} : { 'Mcp-Session-Id': 'fixture-session' }),
        },
      });
    if (body.method === 'server/discover')
      return options.modern
        ? response({
            supportedVersions: ['2026-07-28'],
            capabilities: { tools: {} },
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Fixture', version: '1' } },
          })
        : new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              error: { code: -32601, message: 'Method not found' },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
    if (body.method === 'initialize')
      return response({
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'Fixture', version: '1' },
      });
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === 'tools/list') {
      const value =
        options.paginated && tools.length > 1
          ? body.params?.cursor
            ? { tools: tools.slice(1) }
            : { tools: tools.slice(0, 1), nextCursor: 'page2' }
          : { tools };
      return options.sse
        ? new Response(mcpSse([{ jsonrpc: '2.0', id: body.id, result: complete(value) }]), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        : response(value);
    }
    if (body.method === 'tools/call') {
      calls++;
      if (callStatus !== 200) return new Response('rejected', { status: callStatus });
      const progressToken = body.params?._meta?.progressToken;
      return options.sse
        ? new Response(
            mcpSse([
              {
                jsonrpc: '2.0',
                method: 'notifications/progress',
                params: { progressToken, progress: 1, total: 2, message: '正在查询远端资料' },
              },
              { jsonrpc: '2.0', id: body.id, result: complete(result) },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
        : response(result);
    }
    return response({});
  };
  return {
    handle,
    requests,
    get calls() {
      return calls;
    },
    setTools: (value: typeof tools) => {
      tools = value;
    },
    setResult: (value: unknown) => {
      result = value;
    },
    setStatus: (value: number) => {
      callStatus = value;
    },
  };
}
