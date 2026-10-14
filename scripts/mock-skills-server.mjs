import http from 'node:http';
import { Buffer } from 'node:buffer';
import { toolEvents, answerEvents, sse } from '../tests/protocol-fixtures.ts';

const requests = [];
http.createServer(async (request, response) => {
  if (request.url === '/stats') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ count: requests.length, seenInstructions: requests.some((body) => JSON.stringify(body).includes('VERSION_ONE')),
    seenResource: requests.some((body) => JSON.stringify(body).includes('RESOURCE_ONE')), seenUpdatedResource: requests.some((body) => JSON.stringify(body).includes('mobile info v2')) })); return; }
  if (request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'skills-model', display_name: 'Skills Fixture' }] })); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
  const tools = body.messages.filter((message) => message.role === 'tool'); const explicit = JSON.stringify(body.messages.findLast((message) => message.role === 'user')?.content).includes('$note-workflow');
  const stage = tools.length + (explicit ? 1 : 0);
  const events = stage === 0 ? toolEvents('chat-completions', 'load_skill', { name: 'note-workflow' }) : stage === 1 ?
    toolEvents('chat-completions', 'read_skill_resource', { name: 'note-workflow', path: 'references/template.md' }) : stage === 2 ?
      toolEvents('chat-completions', 'write_text', { path: explicit ? 'documents/skill-explicit.md' : 'documents/skill-auto.md', text: 'Skill workflow: RESOURCE_ONE', expectedRevision: null }) : answerEvents('chat-completions', '技能任务完成。');
  response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(sse(events));
}).listen(4181, '127.0.0.1', () => process.stdout.write('Skills fixture: 127.0.0.1:4181\n'));
