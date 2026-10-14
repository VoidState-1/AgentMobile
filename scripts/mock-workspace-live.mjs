import http from 'node:http';
import { Buffer } from 'node:buffer';
import { sse, toolEvents, answerEvents } from '../tests/protocol-fixtures.ts';

// Controlled local fixture: hold the task open after each real file write.
const gate = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
const update = gate(); const finish = gate(); let rounds = 0;
http.createServer(async (request, response) => {
  if (request.method === 'GET') {
    if (request.url === '/release/update') update.release();
    if (request.url === '/release/finish') finish.release();
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'live-model', display_name: 'Live' }] })); return;
  }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); const round = ++rounds;
  process.stdout.write('Workspace live fixture request ' + round + '\n');
  if (round === 2) await update.promise; if (round >= 3) await finish.promise;
  const previous = body.messages.filter((message) => message.role === 'tool').at(-1);
  const events = round <= 2 ? toolEvents('chat-completions', 'write_text', { path: 'documents/live.md',
    text: round === 1 ? '原生实时内容第一版。' : '原生实时内容第二版。', expectedRevision: round === 1 ? null : JSON.parse(previous.content).revision }) : answerEvents('chat-completions', '实时资料任务完成。');
  if (round <= 2) events[0].choices[0].delta.tool_calls[0].id = 'native-live-' + round;
  response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(sse(events));
}).listen(4181, '127.0.0.1', () => process.stdout.write('Workspace live fixture: 127.0.0.1:4181\n'));
