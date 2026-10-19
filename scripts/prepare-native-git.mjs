import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const moduleRoot = path.join(root, 'modules/agent-mobile-git');
const lock = JSON.parse(
  await fs.readFile(path.join(moduleRoot, 'native-dependencies.json'), 'utf8'),
);
const dependency = lock.libgit2;
const patch = path.join(moduleRoot, 'patches/android-posix-permissions.patch');
const patchHash = createHash('sha256')
  .update(await fs.readFile(patch))
  .digest('hex');
const sourceIdentity = `${dependency.sha256}\n${patchHash}`;
const cache = path.join(root, 'work/native-git');
const archive = path.join(cache, `libgit2-${dependency.commit}.tar.gz`);
const destination = path.join(moduleRoot, 'vendor/libgit2');
const marker = path.join(destination, '.agent-mobile-source');
if ((await fs.readFile(marker, 'utf8').catch(() => '')) !== sourceIdentity) {
  await fs.mkdir(cache, { recursive: true });
  let bytes = await fs.readFile(archive).catch(() => undefined);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== dependency.sha256) {
    const response = await fetch(dependency.url);
    if (!response.ok) throw new Error(`libgit2 download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== dependency.sha256)
    throw new Error('libgit2 archive checksum mismatch');
  await fs.writeFile(archive, bytes);
  const stage = path.join(moduleRoot, 'vendor', `libgit2-${dependency.commit}.staging`);
  await fs.mkdir(stage, { recursive: true });
  await execute('tar', ['-xzf', archive, '--strip-components=1', '-C', stage]);
  await execute(
    'git',
    ['apply', '--directory=modules/agent-mobile-git/vendor/' + path.basename(stage), patch],
    { cwd: root },
  );
  // Only our fixed dependency directories may be replaced; never a repository or credential path.
  for (const target of [stage, destination]) {
    if (path.dirname(path.resolve(target)) !== path.join(moduleRoot, 'vendor'))
      throw new Error('Invalid native dependency destination');
  }
  await fs.rm(destination, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  // Directory rename can fail when Windows file watchers hold handles. Publish
  // verified contents by copying, and write the readiness marker only at the end.
  await fs.cp(stage, destination, { recursive: true });
  await fs.rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  await fs.writeFile(marker, sourceIdentity);
}

const json = lock.json;
for (const [name, url, hash] of [
  ['include/nlohmann/json.hpp', json.headerUrl, json.headerSha256],
  ['LICENSE.MIT', json.licenseUrl, json.licenseSha256],
]) {
  const target = path.join(moduleRoot, 'vendor/json', name);
  let content = await fs.readFile(target).catch(() => undefined);
  if (!content || createHash('sha256').update(content).digest('hex') !== hash) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`nlohmann/json download failed: ${response.status}`);
    content = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(content).digest('hex') !== hash)
      throw new Error('JSON dependency checksum mismatch');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

// Upstream COPYING also includes PCRE2, SHA1DC, SHA256, xdiff and NTLM notices.
const licenseFiles = ['COPYING', 'AUTHORS', 'deps/llhttp/LICENSE-MIT', 'deps/zlib/LICENSE'];
const notices = [
  `libgit2 ${dependency.version}\nSource commit: ${dependency.commit}\nArchive SHA256: ${dependency.sha256}\n`,
];
notices.push(
  `Local modification: patches/android-posix-permissions.patch\nSHA256: ${patchHash}\nEnables real chmod only for the app-owned POSIX storage build.\nPatch source is distributed with this module.\n`,
);
for (const name of licenseFiles) {
  const content = await fs.readFile(path.join(destination, name), 'utf8');
  notices.push(`\n${'='.repeat(72)}\n${name}\n${'='.repeat(72)}\n${content}`);
}
notices.push(
  '\nnlohmann/json ' +
    json.version +
    '\n' +
    (await fs.readFile(path.join(moduleRoot, 'vendor/json/LICENSE.MIT'), 'utf8')),
);
// Preserve the license wording while keeping generated notices free of trailing spaces.
await fs.writeFile(
  path.join(root, 'licenses/native-git.txt'),
  notices
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .trimEnd() + '\n',
);
process.stdout.write(`libgit2 ${dependency.version} source verified and prepared.\n`);
