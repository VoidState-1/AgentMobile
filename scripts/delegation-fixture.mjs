import http from 'node:http';
import { Buffer } from 'node:buffer';
import { answerEvents, toolEvents, sse } from '../tests/protocol-fixtures.ts';

let active = 0; let maximum = 0; const seen = []; const waiting = new Set();
const server = http.createServer(async (request, response) => {
  if (request.url === '/stats') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ active, maximum, seen, waiting: waiting.size })); return; }
  if (request.url === '/release') { for (const release of waiting) release(); response.end('released'); return; }
  if (request.method !== 'POST') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'r3-fixture', display_name: 'R3 Fixture' }] })); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString());
  const content = body.messages.find((message) => message.role === 'user').content;
  const user = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : String(content);
  const child = user.startsWith('Child'); const hasTools = body.messages.some((message) => message.role === 'tool');
  active++; maximum = Math.max(maximum, active); seen.push({ kind: child ? 'child' : 'root', stage: hasTools ? 'result' : 'start' });
  try {
    let events;
    if (child) {
      if (!body.tools.every((tool) => ['list_files', 'read_text', 'search_text'].includes(tool.function.name))) throw new Error('Child grant leaked');
      if (!hasTools) events = toolEvents('chat-completions', 'read_text', { path: 'documents/notes.md' });
      else {
        await new Promise((resolve) => { const done = () => { waiting.delete(done); resolve(); }; waiting.add(done); response.once('close', done); });
        events = answerEvents('chat-completions', user.startsWith('ChildA') ? 'Native child A result.' : 'Native child B result.');
      }
    } else if (!hasTools) {
      const calls = ['A', 'B'].map((name, index) => ({ index, id: 'spawn-' + name, type: 'function', function: { name: 'spawn_agent',
        arguments: JSON.stringify({ role: name === 'A' ? 'reader' : 'reviewer', prompt: 'Child' + name + ': ' + user, paths: ['documents/notes.md'], budget: { requests: 4, tools: 4 } }) } }));
      events = [{ choices: [{ delta: { tool_calls: calls }, finish_reason: 'tool_calls' }] }];
    } else events = answerEvents('chat-completions', body.messages.filter((message) => message.role === 'user').length > 1 ? 'Native root summary complete.' : 'Waiting for children.');
    if (!response.destroyed) response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(sse(events));
  } catch { response.writeHead(500).end(); }
  finally { active--; }
});
server.listen(4181, '127.0.0.1', () => process.stdout.write('Local delegation fixture on 4181\n'));
