import { adb, dump, nodes, tapReady as tap, waitFor, screenshot } from './android-ui.mjs';
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
await selectConflictedGitFixture(fixture.activeRebase);
await tap('处理冲突 base.txt');
await waitFor('编辑变基结果');
await tap('当前');
if (!(await dump()).includes('theirs')) throw new Error('Rebase onto side is missing');
await tap('传入');
if (!(await dump()).includes('ours')) throw new Error('Rebase original commit side is missing');
await screenshot('native-git-rebase-conflict.png');
await tap('采用传入版本');
await tap('继续变基');
await waitFor('提交历史 · 4');
await tap('提交历史 · 4');
if ((await dump()).includes('合并提交')) throw new Error('Rebase created a merge commit');
await screenshot('native-git-rebase-history.png');
await selectConflictedGitFixture(fixture.skipRebaseFixture);
await tap('跳过当前提交');
await waitFor('跳过当前提交？');
await tap('跳过当前提交');
await waitFor('没有未暂存更改');
if ((await dump()).includes('处理冲突 base.txt')) throw new Error('Skip left a conflict');
await selectConflictedGitFixture(fixture.abortRebaseFixture);
await tap('中止变基');
await waitFor('中止当前变基？');
await tap('中止变基');
await waitFor('没有未暂存更改');
await tap('仓库');
const branch = nodes(await dump()).find(node => node['content-desc'] === '变基至 incoming');
if (!branch) throw new Error('Branch rebase entry is missing');
await tap('变基至 incoming');
await waitFor('变基至 incoming？');
await tap('开始变基');
await waitFor('处理冲突 base.txt');
await tap('中止变基');
await waitFor('中止当前变基？');
await tap('中止变基');
await waitFor('main · 当前');
if ((await dump()).includes('处理冲突 base.txt')) throw new Error('Final abort left a conflict');
process.stdout.write(
  'Native rebase UI passed: correct three-way sides, continue, linear history, confirmed skip/abort and branch rebase entry.\n',
);
