import { randomUUID } from 'node:crypto';
import { adb, dump, nodes, tapReady as tap, waitFor, sleep, metroPort } from './android-ui.mjs';

let started = false;
export async function selectConflictedGitFixture(project) {
  const fixtures = JSON.parse(
    await adb(
      'shell',
      'run-as',
      'com.agentmobile.app',
      'cat',
      'cache/native-git-application-fixture.json',
    ),
  );
  const field = [
    'activeMerge',
    'abortMergeFixture',
    'activeRebase',
    'abortRebaseFixture',
    'skipRebaseFixture',
  ].find(key => fixtures[key]?.id === project?.id);
  if (!field) throw new Error('Not an owned Git UI fixture');
  const token = randomUUID();
  // Both values are a fixed enum or UUID; no user text enters the shell command.
  await adb(
    'shell',
    'run-as',
    'com.agentmobile.app',
    'sh',
    '-c',
    `'printf %s ${field}:${token} > cache/native-git-ui-selection.pending'`,
  );
  await adb(
    'shell',
    'run-as',
    'com.agentmobile.app',
    'mv',
    'cache/native-git-ui-selection.pending',
    'cache/native-git-ui-selection',
  );
  if (!started) {
    await adb('reverse', `tcp:${metroPort}`, `tcp:${metroPort}`);
    await adb('shell', 'am', 'force-stop', 'com.agentmobile.app');
    const bundle = `http://127.0.0.1:${metroPort}/scripts/native-git-ui-entry.bundle?platform=android&dev=true&minify=false&transform.routerRoot=src%2Fapp`;
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
    started = true;
  }
  const deadline = Date.now() + 120000;
  for (;;) {
    const raw = await adb(
      'shell',
      'run-as',
      'com.agentmobile.app',
      'cat',
      'cache/native-git-ui-selection-report.json',
    ).catch(() => '');
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      /* Still preparing. */
    }
    if (value?.ok === false && value.token === token) throw new Error(value.error);
    if (value?.token === token && value.projectId === project.id) break;
    if (Date.now() > deadline) throw new Error('Fixture selection timed out');
    await sleep(500);
  }
  await waitFor('Git', 90000);
  await tap('Git');
  await waitFor('处理冲突 base.txt');
  const changes = nodes(await dump()).find(node =>
    /^更改(?: · \d+)?$/.test(node['content-desc'] ?? ''),
  );
  if (!changes) throw new Error('Changes tab is missing');
  await tap(changes['content-desc']);
}
