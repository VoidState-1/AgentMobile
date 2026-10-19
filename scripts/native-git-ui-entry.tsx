/** Development-only fixture selection; renders the real Expo Router application. */
import '@expo/metro-runtime';
import { useEffect, useState, type ComponentProps } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { getAppServices } from '../src/bootstrap';
import { useWorkbenchUi } from '../src/shared/workbench-state';
import type { GitBranchFixture } from './native-git-merge-application';

if (!__DEV__) throw new Error('Development UI fixtures only');
declare const require: {
  context(
    path: string,
    recursive: boolean,
    filter: RegExp,
  ): ComponentProps<typeof ExpoRoot>['context'];
};
// Metro requires a direct require.context call with literal arguments.
const ctx = require.context(
  '../src/app',
  true,
  /^\.\/(?!.*\+(?:api|html|middleware)\.)[^]*\.[tj]sx?$/,
);
const fields = [
  'activeMerge',
  'abortMergeFixture',
  'activeRebase',
  'abortRebaseFixture',
  'skipRebaseFixture',
];

function NativeGitUiEntry() {
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let disposed = false,
      busy = false,
      mounted = false,
      last = '';
    const request = new File(Paths.cache, 'native-git-ui-selection');
    const response = new File(Paths.cache, 'native-git-ui-selection-report.json');
    async function select() {
      if (disposed || busy || !request.exists) return;
      busy = true;
      let activeToken = '';
      try {
        const raw = (await request.text()).trim();
        if (raw === last) return;
        const [field, token] = raw.split(':');
        activeToken = token;
        if (!ctx.keys().includes('./index.tsx'))
          throw new Error('Fixture route context is missing src/app/index.tsx');
        if (!fields.includes(field) || !/^[a-f0-9-]{36}$/.test(token))
          throw new Error('Invalid fixture selector');
        const fixture = JSON.parse(
          await new File(Paths.cache, 'native-git-application-fixture.json').text(),
        ) as Record<string, GitBranchFixture>;
        const target = fixture[field];
        if (
          !target ||
          !/^[a-f0-9-]{36}$/.test(target.id) ||
          !target.name.startsWith('MergeIntegration-')
        )
          throw new Error('Not an owned Git fixture');
        const api = await getAppServices();
        if (
          !(await api.workspace.projects()).some(
            project => project.id === target.id && project.name === target.name,
          )
        )
          throw new Error('Fixture project does not match');
        const conversation = await api.conversations.ensureProject(target.id);
        if (disposed) return;
        await api.preferences.saveWorkbench({
          ...(await api.preferences.getWorkbench()),
          projectId: target.id,
        });
        if (mounted) {
          await api.conversations.select(conversation.id, target.id);
          useWorkbenchUi.getState().selectProject(target.id, conversation.id, false);
          useWorkbenchUi.getState().selectTab('history');
        }
        last = raw;
        mounted = true;
        setReady(true);
        response.write(JSON.stringify({ ok: true, token, projectId: target.id }));
      } catch (value) {
        if (!disposed) {
          setError(String(value));
          response.write(JSON.stringify({ ok: false, token: activeToken, error: String(value) }));
        }
      } finally {
        busy = false;
      }
    }
    void select();
    const timer = setInterval(() => {
      void select();
    }, 500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  return ready ? (
    <ExpoRoot context={ctx} location="http://localhost/" />
  ) : (
    <View>
      <Text>{error || 'Preparing owned Git UI fixture'}</Text>
    </View>
  );
}
registerRootComponent(NativeGitUiEntry);
