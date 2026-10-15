import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readRuns } from './native-runs.mjs';
import { readOperations } from './native-journal.mjs';

// Only run on the isolated fixture emulator, with its app force-stopped.
export async function verifyGitRecords(serial, injectRecovery = false) {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('需要 ANDROID_HOME');
  const execute = promisify(execFile);
  const binary = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const adb = async (...args) =>
    (
      await execute(binary, ['-s', serial, ...args], {
        encoding: 'buffer',
        maxBuffer: 32 * 1024 * 1024,
      })
    ).stdout;
  const target = 'work/git-native-records.sqlite';
  for (const suffix of ['', '-wal']) {
    try {
      await fs.writeFile(
        target + suffix,
        await adb(
          'exec-out',
          'run-as',
          'com.agentmobile.app',
          'cat',
          'files/SQLite/agent-mobile.sqlite' + suffix,
        ),
      );
    } catch (error) {
      if (suffix) await fs.rm(target + suffix, { force: true });
      else throw error;
    }
  }
  const db = new DatabaseSync(target);
  try {
    const all = bucket =>
      db
        .prepare('SELECT payload FROM records WHERE bucket=?')
        .all(bucket)
        .map(row => JSON.parse(row.payload));
    const project = all('projects')
      .filter(item => item.name.startsWith('GitNative-'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!project) throw new Error('未找到本轮 Git 测试项目');
    const operations = readOperations(db, 'projects', project.id);
    const task = readRuns(db).find(item => item.projectId === project.id);
    if (
      !task ||
      task.state !== 'completed' ||
      task.finalCommit !== task.baseCommit ||
      task.finalSnapshot === task.baseSnapshot ||
      !task.uncommittedPaths.includes('documents/summary.md')
    )
      throw new Error('原生任务结果/快照/未提交状态不一致');
    if (
      operations.some(op => op.phase !== 'recorded') ||
      operations.filter(op => op.kind === 'commit').length !== 1 ||
      !operations.some(op => op.kind === 'index')
    )
      throw new Error('原生 Git 操作回执不完整');
    const directory = path.resolve('work/git-native-extracted-' + Date.now());
    await fs.mkdir(directory, { recursive: true });
    const archive = path.join(directory, 'repository.tar');
    await fs.writeFile(
      archive,
      await adb(
        'exec-out',
        'run-as',
        'com.agentmobile.app',
        'tar',
        '-C',
        'files/agent-mobile/workspaces/' + project.id,
        '-cf',
        '-',
        'repository',
      ),
    );
    await execute('tar', ['-xf', archive, '-C', directory]);
    const git = async (...args) =>
      (
        await execute('git', ['-C', path.join(directory, 'repository'), ...args], {
          encoding: 'utf8',
        })
      ).stdout;
    if ((await git('rev-list', '--count', 'HEAD')).trim() !== '2')
      throw new Error('普通历史被自动检查点污染');
    if (
      (await git('show', 'HEAD:documents/notes.md')) !== 'Git_v1' ||
      (await git('show', ':documents/notes.md')) !== 'Git_v1'
    )
      throw new Error('原生提交没有使用已暂存 v1');
    if (
      (await fs.readFile(path.join(directory, 'repository/documents/notes.md'), 'utf8')) !==
      'Git_v2'
    )
      throw new Error('原生未暂存 v2 丢失');
    const status = await git('status', '--porcelain');
    if (!status.includes(' M documents/notes.md') || !status.includes('?? documents/summary.md'))
      throw new Error('原生 HEAD/index/工作区状态与 CLI 不符');
    if (!(await git('for-each-ref', 'refs/agent-mobile/checkpoints')).includes('tasks/'))
      throw new Error('原生检查点没有引用');
    if (injectRecovery) {
      const commit = operations.find(op => op.kind === 'commit');
      commit.phase = 'prepared';
      delete commit.commit;
      const { changes: _changes, indexChanges: _indexChanges, ...header } = commit;
      db.prepare(
        'UPDATE operation_headers SET payload=?,pending=1 WHERE namespace=? AND project_id=? AND id=?',
      ).run(JSON.stringify(header), header.scope.namespace, header.scope.projectId, header.id);
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    process.stdout.write(
      'Native Git verified by SQLite and standard Git CLI: staged v1 committed, v2 unstaged, Agent output untracked, 2 public commits, private checkpoints.\n',
    );
  } finally {
    db.close();
  }
  if (injectRecovery) {
    // Synthetic app data only: reproduce Git success with a missing SQLite receipt.
    await adb('push', target, '/data/local/tmp/agent-mobile-git-recovery.sqlite');
    await adb(
      'shell',
      'run-as',
      'com.agentmobile.app',
      'rm',
      '-f',
      'files/SQLite/agent-mobile.sqlite-wal',
      'files/SQLite/agent-mobile.sqlite-shm',
    );
    await adb(
      'shell',
      'run-as',
      'com.agentmobile.app',
      'cp',
      '/data/local/tmp/agent-mobile-git-recovery.sqlite',
      'files/SQLite/agent-mobile.sqlite',
    );
  }
}
if (process.argv[1]?.endsWith('android-git-records.mjs'))
  await verifyGitRecords(process.argv[2], process.argv.includes('--inject-recovery'));
