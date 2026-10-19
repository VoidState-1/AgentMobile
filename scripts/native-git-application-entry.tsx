/** Exercise the actual AppServices + SQLite + native repository path in Hermes. */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { File, Paths } from 'expo-file-system';
import { Buffer } from 'buffer';
import { getAppServices } from '../src/bootstrap';
import { initialEditorState } from '../src/core/documents/state';
import NativeGit from '../modules/agent-mobile-git';
import { AppError } from '../src/core/errors';
import { CURRENT_DATA_FORMAT } from '../src/core/storage/business-store';
import {
  prepareApplicationMerge,
  verifyMergeContinuation,
  verifyDirectoryMerge,
  type GitBranchFixture,
} from './native-git-merge-application';
import {
  prepareApplicationRebase,
  verifyRebaseContinuation,
  verifyRebaseSkipAndAbort,
} from './native-git-rebase-application';

if (!__DEV__) throw new Error('Development integration entry only');

// Public network smoke checks can reconnect; mutating push is never retried here.
async function networkSmoke<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'REMOTE' || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

function GitApplicationHarness() {
  const [message, setMessage] = useState('Native Git application integration');
  useEffect(() => {
    void (async () => {
      let report;
      const checks: string[] = [];
      try {
        const api = await getAppServices();
        if (!('HermesInternal' in globalThis))
          throw new Error('Application harness requires Hermes');
        const durable = new File(Paths.cache, 'native-git-application-fixture.json');
        if (durable.exists) {
          const previous = JSON.parse(await durable.text()) as {
            projectId: string;
            commit: string;
            activeMerge: GitBranchFixture;
            abortMergeFixture: GitBranchFixture;
            activeRebase: GitBranchFixture;
            abortRebaseFixture: GitBranchFixture;
            skipRebaseFixture: GitBranchFixture;
          };
          const repository = await api.workspace.repository(previous.projectId);
          await verifyMergeContinuation(api, previous.activeMerge);
          await api.workspace.abortMerge(
            previous.abortMergeFixture.id,
            await api.workspace.status(previous.abortMergeFixture.id),
          );
          checks.push('merge-conflict-stages-and-session-process-restart');
          await verifyRebaseContinuation(api, previous.activeRebase);
          await api.workspace.abortRebase(
            previous.abortRebaseFixture.id,
            await api.workspace.status(previous.abortRebaseFixture.id),
          );
          await api.workspace.skipRebase(
            previous.skipRebaseFixture.id,
            await api.workspace.status(previous.skipRebaseFixture.id),
          );
          checks.push('rebase-session-stages-and-detached-head-process-restart');
          if (
            repository.engine !== 'libgit2' ||
            repository.head.oid !== previous.commit ||
            repository.head.branch !== 'feature'
          )
            throw new Error('Repository state did not survive process restart');
          if ((await api.workspace.status(previous.projectId)).files.length)
            throw new Error('Restart changed index or worktree');
          if (
            !repository.remotes.some(
              remote =>
                remote.name === 'auth-fixture' && remote.credentialUsername === 'fixture-user',
            )
          )
            throw new Error('Git credential did not survive the process restart');
          await api.workspace.saveGitCredential(
            previous.projectId,
            'auth-fixture',
            'https://example.invalid/repo.git',
            null,
          );
          checks.push('secure-git-credential-process-restart-and-removal');
          checks.push('process-restart-with-sqlite-and-native-git');
        }
        const project = await api.workspace.create(`GitIntegration-${Date.now()}`);
        const id = project.id;
        const first = await api.workspace.repository(id);
        if (first.engine !== 'libgit2') throw new Error('Mobile workspace did not select libgit2');
        checks.push('native-platform-selection');
        const content = Buffer.from('export const greeting = "你好😀";\n');
        const operationId = 'integration-save-' + Date.now();
        await api.workspace.writeText(id, 'src/main.ts', content, null, { operationId });
        await api.workspace.writeText(id, 'src/main.ts', content, null, { operationId });
        checks.push('versioned-write-and-idempotent-retry');
        let status = await api.workspace.status(id);
        await api.workspace.gitCommand(
          id,
          { method: 'identity', name: '应用测试😀', email: 'app@example.invalid' },
          status,
        );
        await api.workspace.stage(id, ['src/main.ts'], {
          ...status,
          revisions: {
            'src/main.ts': status.files.find(file => file.path === 'src/main.ts')!.workingRevision,
          },
        });
        status = await api.workspace.status(id);
        const commit = await api.workspace.commitStaged(id, '应用层原生提交', status);
        const snapshot = await api.workspace.snapshot(id);
        if (
          snapshot.gitStatus.files.length ||
          snapshot.versions[0].oid !== commit ||
          snapshot.versions[0].author.name !== '应用测试😀'
        )
          throw new Error('Native commit or index diverged');
        checks.push('sqlite-journal-index-commit-and-history');
        await api.workspace.gitCommand(
          id,
          { method: 'branchCreate', name: 'feature' },
          snapshot.gitStatus,
        );
        const draft = await api.workspace.saveEditorDraft(
          id,
          'unsaved.md',
          {
            format: 1,
            name: 'unsaved.md',
            fresh: true,
            baseRevision: null,
            lineEnding: '\n',
            state: initialEditorState('draft'),
          },
          0,
        );
        let rejected = false;
        try {
          await api.workspace.gitCommand(
            id,
            { method: 'checkout', name: 'feature' },
            await api.workspace.status(id),
          );
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error('Branch switch ignored unsaved draft');
        await api.workspace.saveEditorDraft(id, 'unsaved.md', null, draft.revision);
        await api.workspace.gitCommand(
          id,
          { method: 'checkout', name: 'feature' },
          await api.workspace.status(id),
        );
        if ((await api.workspace.repository(id)).head.branch !== 'feature')
          throw new Error('Branch switch did not take effect');
        checks.push('branch-switch-and-persisted-draft-protection');
        const merge = await prepareApplicationMerge(api);
        await verifyMergeContinuation(api, merge);
        await verifyDirectoryMerge(api);
        const activeMerge = await prepareApplicationMerge(api);
        const abortMergeFixture = await prepareApplicationMerge(api);
        checks.push('native-merge-edit-resolve-continue-abort-and-directory-conflict');
        const rebase = await prepareApplicationRebase(api);
        await verifyRebaseContinuation(api, rebase);
        await verifyRebaseSkipAndAbort(api);
        const activeRebase = await prepareApplicationRebase(api);
        const abortRebaseFixture = await prepareApplicationRebase(api);
        const skipRebaseFixture = await prepareApplicationRebase(api);
        checks.push('native-rebase-edit-continue-skip-abort-and-metadata');
        await api.workspace.gitCommand(
          id,
          { method: 'tagCreate', name: 'integration-v1' },
          await api.workspace.status(id),
        );
        await api.workspace.gitCommand(
          id,
          {
            method: 'remoteSave',
            name: 'origin',
            url: 'https://github.com/octocat/Hello-World.git',
          },
          await api.workspace.status(id),
        );
        await networkSmoke(async () =>
          api.workspace.gitCommand(
            id,
            { method: 'fetch', name: 'origin' },
            await api.workspace.status(id),
          ),
        );
        const repository = await api.workspace.repository(id);
        if (
          !repository.tags.some(tag => tag.name === 'integration-v1') ||
          !repository.branches.some(branch => branch.remote)
        )
          throw new Error('Tag or fetched tracking refs missing');
        checks.push('tag-remote-and-native-https-fetch');
        const cloned = await networkSmoke(() =>
          api.workspace.cloneProject({
            name: 'GitCloneIntegration-' + Date.now(),
            url: 'https://github.com/octocat/Hello-World.git',
          }),
        );
        const cloneInfo = await api.workspace.repository(cloned.id);
        if (
          !cloneInfo.head.oid ||
          !(await api.workspace.files(cloned.id)).some(file => file.path === 'README') ||
          (await api.workspace.status(cloned.id)).files.length
        )
          throw new Error('Application clone did not publish a clean original repository');
        checks.push('native-clone-staging-and-project-publication');
        await api.workspace.gitCommand(
          id,
          { method: 'remoteSave', name: 'auth-fixture', url: 'https://example.invalid/repo.git' },
          await api.workspace.status(id),
        );
        await api.workspace.saveGitCredential(
          id,
          'auth-fixture',
          'https://example.invalid/repo.git',
          { username: 'fixture-user', token: 'local-integration-fixture-token' },
        );
        const authenticated = await api.workspace.repository(id);
        if (
          !authenticated.remotes.some(
            remote =>
              remote.name === 'auth-fixture' && remote.credentialUsername === 'fixture-user',
          ) ||
          JSON.stringify(authenticated).includes('local-integration-fixture-token')
        )
          throw new Error('Git credential projection leaked or did not persist');
        checks.push('secure-git-credential-and-secret-free-projection');
        durable.write(
          JSON.stringify({
            projectId: id,
            commit,
            activeMerge,
            abortMergeFixture,
            activeRebase,
            abortRebaseFixture,
            skipRebaseFixture,
          }),
        );
        report = {
          ok: true,
          format: CURRENT_DATA_FORMAT,
          hermes: true,
          projectId: id,
          commit,
          checks,
          repository,
        };
      } catch (error) {
        let diagnostic;
        if (String(error).includes('HTTPS') || String(error).includes('传输')) {
          diagnostic = JSON.parse(
            await NativeGit.probe(
              'app-network-' + Date.now(),
              'https',
              'https://github.com/octocat/Hello-World.git',
            ),
          );
        }
        report = { ok: false, error: String(error), checks, diagnostic };
      }
      new File(Paths.cache, 'native-git-application-report.json').write(JSON.stringify(report));
      setMessage(report.ok ? 'Native Git application passed' : 'Native Git application failed');
    })();
  }, []);
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
      <Text>{message}</Text>
    </View>
  );
}
registerRootComponent(GitApplicationHarness);
