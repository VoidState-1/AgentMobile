import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const serial = process.argv[2];
if (!sdk || !serial) throw new Error('Set ANDROID_HOME and pass the device serial.');
const adbPath = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adb = async (...args) =>
  (await execute(adbPath, ['-s', serial, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout;
const abi = (await adb('shell', 'getprop', 'ro.product.cpu.abi')).trim();
if (!['x86_64', 'arm64-v8a'].includes(abi)) throw new Error(`Probe ABI not validated: ${abi}`);
await execute(process.execPath, [path.join(root, 'scripts/prepare-native-git.mjs')]);
if (!process.argv.includes('--skip-build')) {
  const args = [
    ':agent-mobile-git:assembleDebugAndroidTest',
    `-PreactNativeArchitectures=${abi}`,
    '--console=plain',
  ];
  // cmd /c is only used to invoke the fixed Gradle build script, never for file operations.
  const command = process.platform === 'win32' ? 'cmd.exe' : './gradlew';
  const commandArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', 'gradlew.bat', ...args] : args;
  await execute(command, commandArgs, {
    cwd: path.join(root, 'android'),
    maxBuffer: 16 * 1024 * 1024,
  });
}
const testPackage = 'com.agentmobile.git.validation';
const runner = `${testPackage}/androidx.test.runner.AndroidJUnitRunner`;
await adb(
  'install',
  '-r',
  path.join(
    root,
    'modules/agent-mobile-git/android/build/outputs/apk/androidTest/debug/agent-mobile-git-debug-androidTest.apk',
  ),
);
const runId = `probe-${Date.now()}`;
const reports = [];
const outputDirectory = path.join(root, 'work/native-git', runId);
await fs.mkdir(outputDirectory, { recursive: true });
const formalOutput = await adb(
  'shell',
  'am',
  'instrument',
  '-w',
  '-r',
  '-e',
  'class',
  ['GitRepositoryTest', 'GitMergeTest', 'GitRebaseTest', 'GitPermissionTest']
    .map(name => 'expo.modules.agentmobile.git.' + name)
    .join(','),
  runner,
);
await fs.writeFile(path.join(outputDirectory, 'formal-repository.log'), formalOutput);
const formalCount = Number(formalOutput.match(/OK \((\d+) tests?\)/)?.[1] ?? 0);
if (formalCount < 22 || formalOutput.includes('FAILURES!!!')) throw new Error(formalOutput);
process.stdout.write(
  `Formal repository, merge, rebase and permission tests: ${formalCount} passed\n`,
);
async function instrument(method, phase) {
  const args = [
    'shell',
    'am',
    'instrument',
    '-w',
    '-r',
    '-e',
    'class',
    `expo.modules.agentmobile.git.GitProbeTest#${method}`,
    '-e',
    'runId',
    runId,
  ];
  if (phase) args.push('-e', 'phase', phase);
  args.push(runner);
  const output = await adb(...args);
  await fs.writeFile(path.join(outputDirectory, `${phase ?? method}.log`), output);
  if (!output.includes('OK (1 test)') || output.includes('FAILURES!!!')) throw new Error(output);
  const match = output.match(/INSTRUMENTATION_STATUS: gitReport=(.*)/);
  if (match) {
    const report = JSON.parse(match[1]);
    if (!report.ok) throw new Error(JSON.stringify(report));
    reports.push(report);
    process.stdout.write(
      `${phase}: ${report.checks.length} checks, ${report.progressEvents} progress events\n`,
    );
  } else process.stdout.write(`${method}: passed\n`);
}
await instrument('rejectsUntrustedInputs');
await instrument('validation', 'local');
await instrument('validation', 'prepare-restart');
await adb('shell', 'am', 'force-stop', testPackage);
await instrument('validation', 'resume-restart');
await instrument('validation', 'https');
await instrument('validation', 'cancel');
await instrument('rejectsUntrustedCertificate');

// Export only the probe's own fixtures for independent Git CLI interoperability checks.
const repositories = [
  'repository',
  'conflict',
  'abort',
  'remote.git',
  'clone',
  'restart',
  'https-clone',
];
const gitDirectories = repositories.map(
  name => `${runId}/${name}${name.endsWith('.git') ? '' : '/.git'}`,
);
const tar = await execute(
  adbPath,
  [
    '-s',
    serial,
    'exec-out',
    'run-as',
    testPackage,
    'tar',
    '-c',
    '-C',
    'cache/agent-mobile-git-probes',
    ...gitDirectories,
  ],
  { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 },
);
const archive = path.join(outputDirectory, 'fixtures.tar');
await fs.writeFile(archive, tar.stdout);
await execute('tar', ['-xf', archive, '-C', outputDirectory]);
const interoperable = [];
for (const name of repositories) {
  const repository = path.join(outputDirectory, runId, name, name.endsWith('.git') ? '' : '.git');
  const checked = await execute('git', [`--git-dir=${repository}`, 'fsck', '--full'], {
    maxBuffer: 4 * 1024 * 1024,
  });
  if (checked.stderr.includes('error:') || checked.stderr.includes('fatal:'))
    throw new Error(checked.stderr);
  interoperable.push(name);
}
const summary = {
  runId,
  device: serial,
  abi,
  reports,
  gitFsck: interoperable,
  formalTests: formalCount,
  note: 'Probe and formal native repository tests; mobile application GitPort uses libgit2.',
};
await fs.writeFile(path.join(outputDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
process.stdout.write(
  `Native Git validation passed; evidence: ${path.relative(root, outputDirectory)}\n`,
);
