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
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const event of events) { response.write(sse([event])); await new Promise((resolve) => setTimeout(resolve, 25)); }
  response.end();
});
server.listen(4181, '127.0.0.1', () => process.stdout.write('Mock model server listening on 127.0.0.1:4181\n'));
