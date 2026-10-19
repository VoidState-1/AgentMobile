import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile),
  root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT,
  serial = process.argv[2];
if (!sdk || !serial) throw new Error('Set ANDROID_HOME and pass the Android serial.');
const binary = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const fixture = JSON.parse(
  (
    await execute(binary, [
      '-s',
      serial,
      'shell',
      'run-as',
      'com.agentmobile.app',
      'cat',
      'cache/native-git-application-fixture.json',
    ])
  ).stdout,
).activeRebase;
if (!fixture || !/^[a-zA-Z0-9-]{1,128}$/.test(fixture.id) || !/^[a-f0-9]{40}$/.test(fixture.source))
  throw new Error('Missing owned rebase fixture');
const directory = await fs.mkdtemp(path.join(root, 'work/native-git/rebase-cli-'));
const repository = path.join(directory, 'repository'),
  hooks = path.join(directory, 'empty-hooks');
await fs.mkdir(repository);
await fs.mkdir(hooks);
const archive = (
  await execute(
    binary,
    [
      '-s',
      serial,
      'exec-out',
      'run-as',
      'com.agentmobile.app',
      'tar',
      '-C',
      `files/agent-mobile/workspaces/${fixture.id}/repository`,
      '-cf',
      '-',
      '.',
    ],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
).stdout;
const archivePath = path.join(directory, 'repository.tar');
await fs.writeFile(archivePath, archive);
await execute('tar', ['-xf', archivePath, '-C', repository]);
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(directory, 'no-global-config'),
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_COMMITTER_NAME: 'CLI Validator',
  GIT_COMMITTER_EMAIL: 'cli@example.invalid',
};
const git = async (...args) =>
  (
    await execute('git', ['-C', repository, '-c', 'core.hooksPath=' + hooks, ...args], {
      env,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;
const stages = (await git('ls-files', '-u')).trim().split('\n');
if (stages.length !== 3 || !(await git('rebase', '--show-current-patch')).includes('base.txt'))
  throw new Error('Standard Git cannot inspect native rebase stages');
const expectedAuthor = (await git('show', '-s', '--format=%an', 'REBASE_HEAD')).trim();
await fs.writeFile(path.join(repository, 'base.txt'), 'CLI resolved\r\n');
await git('add', '--', 'base.txt');
await git('rebase', '--continue');
const author = (await git('show', '-s', '--format=%an', 'HEAD')).trim();
if (author !== expectedAuthor || !author.includes("O'Neil $(printf should-not-run)"))
  throw new Error('Author quoting changed literal commit metadata');
if (
  (await git('rev-parse', 'HEAD^')).trim() !== fixture.source ||
  (await git('symbolic-ref', '--short', 'HEAD')).trim() !== 'main' ||
  (await git('status', '--porcelain')).trim()
)
  throw new Error('Git CLI continuation diverged from the native rebase plan');
await git('fsck', '--full');
await fs.writeFile(
  path.join(root, 'work/native-git/rebase-cli-summary.json'),
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      device: serial,
      copiedFixture: fixture.id,
      stages: stages.length,
      preservedAuthor: author,
      nativeRebaseContinuedWithStandardGit: true,
      fsck: true,
    },
    null,
    2,
  ),
);
process.stdout.write(
  'Native rebase interoperability passed: three stages, current patch, standard Git continuation, literal author metadata and fsck.\n',
);
