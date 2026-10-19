import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const serial = process.argv[2];
const port = process.env.AGENT_MOBILE_GIT_METRO_PORT ?? '4182';
if (!sdk || !serial || !/^\d{4,5}$/.test(port))
  throw new Error('Set ANDROID_HOME, pass the device serial and use a valid Metro port.');
const binary = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adb = async (...args) =>
  (await execute(binary, ['-s', serial, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout;
const mapping = `tcp:${port}`;
const hadMapping = (await adb('reverse', '--list'))
  .split('\n')
  .some(line => line.includes(`${mapping} ${mapping}`));
await adb('reverse', mapping, mapping);
const application = process.argv.includes('--application');
const entry = application ? 'native-git-application-entry' : 'native-git-probe-entry';
const reportName = application
  ? 'native-git-application-report.json'
  : 'native-git-bridge-report.json';
const bundle = `http://127.0.0.1:${port}/scripts/${entry}.bundle?platform=android&dev=true&minify=false`;
async function launch() {
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  await adb('shell', 'run-as', 'com.agentmobile.app', 'rm', '-f', `cache/${reportName}`);
  await adb(
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `exp+agent-mobile://expo-development-client/?url=${encodeURIComponent(bundle)}`,
    'com.agentmobile.app',
  );
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const value = await adb(
      'shell',
      'run-as',
      'com.agentmobile.app',
      'cat',
      `cache/${reportName}`,
    ).catch(() => '');
    if (value.startsWith('{')) return JSON.parse(value);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Native Git application bundle timed out');
}
try {
  await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(5000) });
  if (application)
    await adb(
      'shell',
      'run-as',
      'com.agentmobile.app',
      'rm',
      '-f',
      'cache/native-git-application-fixture.json',
    );
  const firstPass = await launch();
  if (!firstPass.ok) throw new Error(JSON.stringify(firstPass));
  const report = application ? await launch() : firstPass;
  if (
    !report?.ok ||
    (!application &&
      (!report.hermes ||
        !report.progressEvents ||
        !report.jsTimerTicks ||
        !report.cancellationCompleted ||
        !report.queuedCancellation)) ||
    (application &&
      (report.repository?.engine !== 'libgit2' ||
        !report.checks?.includes('process-restart-with-sqlite-and-native-git')))
  )
    throw new Error(`Native Git integration failed: ${JSON.stringify(report)}`);
  await fs.mkdir(path.join(root, 'work/native-git'), { recursive: true });
  await fs.writeFile(
    path.join(
      root,
      'work/native-git/' + (application ? 'application-summary.json' : 'bridge-summary.json'),
    ),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        device: serial,
        ...report,
        ...(application ? { firstPass } : {}),
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    application
      ? `Native Git application passed: ${report.checks.join(', ')}\n`
      : `Hermes bridge passed: ${report.progressEvents} events, ${report.jsTimerTicks} JS timer ticks.\n`,
  );
} finally {
  await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
  if (!hadMapping) await adb('reverse', '--remove', mapping);
}
