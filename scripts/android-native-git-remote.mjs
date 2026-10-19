import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const serial = process.argv[2];
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!serial || !sdk) throw new Error('Set ANDROID_HOME and pass the test device serial.');
const adbPath = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adb = async (...args) =>
  (await execute(adbPath, ['-s', serial, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout;
const output = path.join(root, 'work/native-git');
await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(output, 'remote-fixture-'));
const gitCore = (await execute('git', ['--exec-path'])).stdout.trim();
const gitBackend = path.join(
  gitCore,
  'git-http-backend' + (process.platform === 'win32' ? '.exe' : ''),
);
const openssl =
  process.platform === 'win32' ? path.resolve(gitCore, '../../../usr/bin/openssl.exe') : 'openssl';
const password = randomUUID();
const authorization = 'Basic ' + Buffer.from('mobile:' + password).toString('base64');
const requests = [];
let port;
const server = https.createServer;
let listener;
try {
  await execute(openssl, [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    path.join(temporary, 'fixture.key'),
    '-out',
    path.join(temporary, 'fixture.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ]);
  await execute('git', [
    'init',
    '--bare',
    '--initial-branch=main',
    path.join(temporary, 'repo.git'),
  ]);
  await execute('git', [
    'init',
    '--bare',
    '--initial-branch=main',
    path.join(temporary, 'empty.git'),
  ]);
  await execute('git', [
    '--git-dir',
    path.join(temporary, 'repo.git'),
    'config',
    'http.receivepack',
    'true',
  ]);
  listener = server(
    {
      key: await fs.readFile(path.join(temporary, 'fixture.key')),
      cert: await fs.readFile(path.join(temporary, 'fixture.pem')),
    },
    (request, response) => {
      if (request.headers.authorization !== authorization) {
        requests.push({ method: request.method, status: 401 });
        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="local-git-fixture"' });
        response.end();
        return;
      }
      const url = new URL(request.url, 'https://127.0.0.1');
      const drop = url.pathname.startsWith('/drop.git/');
      const backend = spawn(gitBackend, [], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: temporary,
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: url.pathname.replace('/drop.git/', '/repo.git/'),
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: request.method,
          CONTENT_TYPE: request.headers['content-type'] ?? '',
          CONTENT_LENGTH: request.headers['content-length'] ?? '',
          REMOTE_USER: 'mobile',
          REMOTE_ADDR: '127.0.0.1',
          SERVER_PROTOCOL: 'HTTP/1.1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      request.pipe(backend.stdin);
      backend.stdin.on('error', () => {});
      const chunks = [];
      backend.stdout.on('data', chunk => chunks.push(chunk));
      backend.stderr.resume();
      backend.on('error', () => {
        response.writeHead(500);
        response.end();
      });
      backend.on('close', code => {
        if (drop && request.method === 'POST') {
          requests.push({ method: 'POST', status: 'response-dropped', backendExit: code });
          request.socket.destroy();
          return;
        }
        const bytes = Buffer.concat(chunks);
        const boundary = bytes.indexOf('\r\n\r\n');
        if (boundary < 0) {
          response.writeHead(500);
          response.end();
          return;
        }
        const headers = {};
        let status = 200;
        for (const line of bytes.subarray(0, boundary).toString().split('\r\n')) {
          const colon = line.indexOf(':');
          if (colon < 0) continue;
          const key = line.slice(0, colon).toLowerCase(),
            value = line.slice(colon + 1).trim();
          if (key === 'status') status = Number.parseInt(value, 10);
          else headers[key] = value;
        }
        requests.push({ method: request.method, status });
        response.writeHead(status, headers);
        response.end(bytes.subarray(boundary + 4));
      });
    },
  );
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  port = listener.address().port;
  await adb('reverse', `tcp:${port}`, `tcp:${port}`);
  const pem = (await fs.readFile(path.join(temporary, 'fixture.pem'), 'utf8')).replace(
    /-----[^-]+-----|\s/g,
    '',
  );
  const log = await adb(
    'shell',
    'am',
    'instrument',
    '-w',
    '-r',
    '-e',
    'class',
    'expo.modules.agentmobile.git.GitRemoteTest',
    '-e',
    'fixtureCertificate',
    pem,
    '-e',
    'fixturePort',
    String(port),
    '-e',
    'fixturePassword',
    password,
    'com.agentmobile.git.validation/androidx.test.runner.AndroidJUnitRunner',
  );
  await fs.writeFile(path.join(output, 'remote-device.log'), log);
  if (!log.includes('OK (1 test)') || log.includes('FAILURES!!!')) throw new Error(log);
  const report = JSON.parse(log.match(/INSTRUMENTATION_STATUS: gitRemoteReport=(.*)/)?.[1] ?? '{}');
  const head = (
    await execute('git', [
      '--git-dir',
      path.join(temporary, 'repo.git'),
      'rev-parse',
      'refs/heads/main',
    ])
  ).stdout.trim();
  if (
    report.head !== head ||
    !requests.some(request => request.status === 'response-dropped') ||
    !requests.some(request => request.status === 401)
  )
    throw new Error('Standard Git or network fault verification failed.');
  await execute('git', ['--git-dir', path.join(temporary, 'repo.git'), 'fsck', '--full']);
  await fs.writeFile(
    path.join(output, 'remote-summary.json'),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        device: serial,
        head,
        progressEvents: report.progressEvents,
        requests,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    'Native authenticated HTTPS push, fetch, upstream, version checks and unknown-result verification passed.\n',
  );
} finally {
  if (port) await adb('reverse', '--remove', `tcp:${port}`).catch(() => {});
  listener?.closeAllConnections();
  await new Promise(resolve => (listener ? listener.close(resolve) : resolve()));
  const relative = path.relative(output, temporary);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Invalid test cleanup directory.');
  await fs.rm(temporary, { recursive: true, force: true });
}
