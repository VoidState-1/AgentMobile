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
  const child = user.startsWith('Child') || user.startsWith('DraftWriter:'); const hasTools = body.messages.some((message) => message.role === 'tool');
  active++; maximum = Math.max(maximum, active); seen.push({ kind: child ? 'child' : 'root', stage: hasTools ? 'result' : 'start' });
  try {
    let events;
    if (user.startsWith('DraftWriter:')) {
      const results = body.messages.filter((message) => message.role === 'tool').map((message) => {
        const content = Array.isArray(message.content) ? message.content.map((part) => part.text ?? '').join('') : message.content; try { return JSON.parse(content); } catch { return {}; }
      });
      if (!body.tools.every((tool) => ['list_files', 'read_text', 'write_text', 'move_file', 'delete_file'].includes(tool.function.name))) throw new Error('Writer grant leaked');
      if (results.length === 0) events = toolEvents('chat-completions', 'read_text', { path: 'documents/notes.md' });
      else if (results.length === 1) events = toolEvents('chat-completions', 'write_text', { path: 'documents/notes.md', text: 'Native isolated notes.', expectedRevision: results[0].revision });
      else if (results.length === 2) events = toolEvents('chat-completions', 'write_text', { path: 'documents/proposal.md', text: 'Native isolated draft.', expectedRevision: null });
      else { await new Promise((resolve) => { const done = () => { waiting.delete(done); resolve(); }; waiting.add(done); response.once('close', done); }); events = answerEvents('chat-completions', 'Native isolated proposal ready.'); }
    } else if (user.startsWith('Native R5')) {
      if (!hasTools) events = toolEvents('chat-completions', 'spawn_agent', { role: 'writer', prompt: 'DraftWriter: ' + user, paths: ['documents/notes.md', 'documents/proposal.md'], budget: { requests: 6, tools: 6 } });
      else if (body.messages.filter((message) => message.role === 'user').length === 1) events = answerEvents('chat-completions', 'Waiting for proposal.');
      else if (!body.messages.some((message) => message.tool_calls?.some((call) => call.function.name === 'apply_proposal'))) {
        const content = body.messages.filter((message) => message.role === 'user').at(-1).content;
        const summary = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : content;
        const children = JSON.parse(summary.slice(summary.indexOf('\n') + 1)); events = toolEvents('chat-completions', 'apply_proposal', { proposalId: children[0].proposal.id });
      } else events = answerEvents('chat-completions', 'Native proposal merge processed.');
    } else if (user.startsWith('Native R4')) {
      if (!hasTools) events = toolEvents('chat-completions', 'write_text', { path: 'documents/parallel.md', text: user, expectedRevision: null });
      else {
        await new Promise((resolve) => { const done = () => { waiting.delete(done); resolve(); }; waiting.add(done); response.once('close', done); });
        events = answerEvents('chat-completions', 'Parallel root complete: ' + user);
      }
    } else if (child) {
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
