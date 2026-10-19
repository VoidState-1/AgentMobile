/** Standalone Hermes bridge harness, loaded as a raw Metro bundle by the dev client. */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { File, Paths } from 'expo-file-system';
import NativeGit, { type GitProbeReport } from '../modules/agent-mobile-git';

if (!__DEV__) throw new Error('Native Git probe entry is development-only');

function GitProbeHarness() {
  const [message, setMessage] = useState('Running native Git bridge validation…');
  useEffect(() => {
    let ticks = 0;
    let progressEvents = 0;
    let cancelRequested = false;
    const timer = setInterval(() => ticks++, 10);
    const runId = `hermes-${Date.now()}`;
    const cancelRunId = `${runId}-cancel`;
    const subscription = NativeGit.addListener('onProgress', event => {
      if (event.runId === runId) progressEvents++;
      if (event.runId === cancelRunId && event.phase === 'cancel-clone-staging') {
        cancelRequested = true;
        NativeGit.cancel(cancelRunId);
      }
    });
    void (async () => {
      let report;
      try {
        const version = await NativeGit.version();
        const queuedId = 'queued-' + Date.now();
        NativeGit.cancel(queuedId);
        const queued = JSON.parse(
          await NativeGit.execute('bridge-cancellation', queuedId, '{"method":"init"}'),
        );
        if (queued.ok || queued.code !== 'CANCELLED')
          throw new Error('Cancellation before native worker initialization was lost');
        const result = JSON.parse(await NativeGit.probe(runId, 'local', '')) as GitProbeReport;
        if (!result.ok || version !== result.version || progressEvents === 0 || ticks === 0)
          throw new Error(
            `Bridge verification failed: ${JSON.stringify({ result, progressEvents, ticks })}`,
          );
        const cancellation = JSON.parse(
          await NativeGit.probe(
            cancelRunId,
            'cancel',
            'https://github.com/octocat/Hello-World.git',
          ),
        ) as GitProbeReport;
        if (!cancelRequested || !cancellation.ok)
          throw new Error(`JS cancellation failed: ${JSON.stringify(cancellation)}`);
        report = {
          ok: true,
          runId,
          version,
          progressEvents,
          jsTimerTicks: ticks,
          hermes: 'HermesInternal' in globalThis,
          cancellationCompleted: true,
          queuedCancellation: true,
          result,
          cancellation,
        };
      } catch (error) {
        report = { ok: false, error: String(error) };
      } finally {
        clearInterval(timer);
        subscription.remove();
      }
      new File(Paths.cache, 'native-git-bridge-report.json').write(JSON.stringify(report));
      setMessage(report.ok ? 'Native Git bridge passed' : 'Native Git bridge failed');
    })();
    return () => {
      clearInterval(timer);
      subscription.remove();
      NativeGit.cancel(runId);
      NativeGit.cancel(cancelRunId);
    };
  }, []);
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
      <Text>{message}</Text>
    </View>
  );
}

registerRootComponent(GitProbeHarness);
