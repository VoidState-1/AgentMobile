import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readRuns } from './native-runs.mjs';

// Use only with the isolated fixture emulator, after its task has settled.
export async function verifyMcpRecords(serial) {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('需要 ANDROID_HOME');
  const execute = promisify(execFile);
  const binary = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const target = 'work/mcp-native-records.sqlite';
  for (const suffix of ['', '-wal']) {
    const { stdout } = await execute(
      binary,
      [
        '-s',
        serial,
        'exec-out',
        'run-as',
        'com.agentmobile.app',
        'cat',
        'files/SQLite/agent-mobile.sqlite' + suffix,
      ],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
    );
    await fs.writeFile(target + suffix, stdout);
  }
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const attempts = db
      .prepare("SELECT payload FROM records WHERE bucket='mcp-attempts'")
      .all()
      .map(row => JSON.parse(row.payload));
    const tasks = readRuns(db);
    for (const endpoint of ['mcp-modern', 'mcp-legacy']) {
      const attempt = attempts.find(
        item => item.url.endsWith('/' + endpoint) && item.state === 'completed',
      );
      const task = tasks.find(item => item.id === attempt?.taskId);
      if (
        !task ||
        task.state !== 'completed' ||
        task.finalSnapshot === task.baseSnapshot ||
        !task.uncommittedPaths?.length ||
        !task.trace.some(item => item.id === attempt.traceId && item.state === 'completed')
      )
        throw new Error(endpoint + ' 缺少完整远端回执、轨迹或工作区修改。');
    }
    const unknown = attempts.find(
      item => item.url.endsWith('/mcp-hold') && item.state === 'unknown' && item.retryAllowedAt,
    );
    if (
      !unknown ||
      !tasks.some(
        task =>
          task.id === unknown.taskId &&
          task.state === 'interrupted' &&
          task.trace.some(item => item.id === unknown.traceId && item.state === 'unknown'),
      )
    )
      throw new Error('强制中断的 MCP 记录未正确恢复或解除。');
    if (JSON.stringify([...attempts, ...tasks]).includes('fixture-mcp-token'))
      throw new Error('MCP Token 进入了任务元数据。');
    process.stdout.write(
      'Native SQLite verified: completed MCP receipts/trace/Git for both eras, interrupted unknown receipt and explicit retry acknowledgement.\n',
    );
  } finally {
    db.close();
  }
}
if (process.argv[1]?.endsWith('android-mcp-records.mjs')) await verifyMcpRecords(process.argv[2]);
