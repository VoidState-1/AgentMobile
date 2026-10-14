import http from 'node:http';
import { Buffer } from 'node:buffer';
import { answerEvents, toolEvents, sse } from '../tests/protocol-fixtures.ts';

// Local-only deterministic protocol fixture. Never contacts a paid provider.
const server = http.createServer(async (request, response) => {
  const protocol = request.url.includes('streamGenerateContent') ? 'gemini' : request.url.endsWith('/messages') ? 'anthropic-messages' : 'chat-completions';
  if (request.method === 'GET') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url.includes('pageSize') ? { models: [{ name: 'models/mock-model', displayName: 'Mock', supportedGenerationMethods: ['generateContent'] }] } :
      { data: [{ id: 'mock-model', display_name: 'Mock' }], has_more: false })); return;
  }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (raw.length > 2 * 1024 * 1024) { response.writeHead(413).end(); return; }
  let events;
  if (raw.includes('MOBILE_OK')) events = answerEvents(protocol, 'MOBILE_OK');
  else if (raw.includes('四个色块')) events = answerEvents(protocol, 'red,green,blue,yellow');
  else if (raw.includes('diagnostic_echo')) {
    const marker = raw.match(/host_[a-z0-9]+/)?.[0]; events = marker ? answerEvents(protocol, marker) : toolEvents(protocol, 'diagnostic_echo');
  } else if (raw.includes('tool_result') || raw.includes('functionResponse') || raw.includes('"role":"tool"')) events = answerEvents(protocol, '原生模拟任务完成。');
  else events = toolEvents(protocol, 'write_text', { path: 'documents/' + protocol + '.md', text: 'Android native tool loop passed: ' + protocol, expectedRevision: null });
  if (process.env.AGENT_MOBILE_MOCK_TRACE === '1' && !raw.includes('MOBILE_OK') && !raw.includes('diagnostic_echo') && !raw.includes('四个色块')) {
    if (protocol === 'chat-completions') events.unshift({ choices: [{ delta: { reasoning_content: '先核对现有资料。' } }] }, { choices: [{ delta: { content: '先确认项目资料，再保存整理结果。' } }] });
    if (protocol === 'gemini') events[0].candidates[0].content.parts.unshift({ thought: true, text: '先核对现有资料。', thoughtSignature: 'private-mock-signature' }, { text: '先确认项目资料，再保存整理结果。' });
    if (protocol === 'anthropic-messages' && events.some((event) => event.content_block?.type === 'tool_use')) {
      for (const event of events) if (event.index === 1) event.index = 2;
      events.splice(5, 0, { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '先确认项目资料，再保存整理结果。' } }, { type: 'content_block_stop', index: 1 });
    }
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (process.env.AGENT_MOBILE_MOCK_TRACE === '1' && raw.includes('PAUSE')) {
    response.write(sse(protocol === 'gemini' ? [{ candidates: [{ content: { parts: [{ thought: true, text: '进程中断前的公开摘要。' }] } }] }] :
      [{ choices: [{ delta: { reasoning_content: '进程中断前的公开摘要。' } }] }]));
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  for (const event of events) { response.write(sse([event])); await new Promise((resolve) => setTimeout(resolve, 25)); }
  response.end();
});
server.listen(4181, '127.0.0.1', () => process.stdout.write('Mock model server listening on 127.0.0.1:4181\n'));
