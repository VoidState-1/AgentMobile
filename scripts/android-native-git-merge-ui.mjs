import { adb, dump, tapReady as tap, waitFor, screenshot } from './android-ui.mjs';
import { selectConflictedGitFixture } from './android-native-git-navigation.mjs';

const fixture = JSON.parse(
  await adb(
    'shell',
    'run-as',
    'com.agentmobile.app',
    'cat',
    'cache/native-git-application-fixture.json',
  ),
);
await selectConflictedGitFixture(fixture.activeMerge);
await tap('处理冲突 base.txt');
await waitFor('编辑合并结果');
await tap('当前');
if (!(await dump()).includes('ours')) throw new Error('Current side preview missing');
await tap('传入');
if (!(await dump()).includes('theirs')) throw new Error('Incoming side preview missing');
await screenshot('native-git-three-way-conflict.png');
await tap('采用传入版本');
await tap('继续合并');
await waitFor('提交历史 · 5');
await tap('提交历史 · 5');
if (!(await dump()).includes('合并提交')) throw new Error('Merge parent history is missing');
await screenshot('native-git-merge-history.png');
await selectConflictedGitFixture(fixture.abortMergeFixture);
await tap('中止合并');
await waitFor('中止当前合并？');
await tap('中止合并');
await waitFor('没有未暂存更改');
if ((await dump()).includes('处理冲突 base.txt'))
  throw new Error('Abort did not clear the merge conflict');
process.stdout.write(
  'Native merge UI passed: three-way preview, side resolution, dual-parent history and confirmed abort.\n',
);
