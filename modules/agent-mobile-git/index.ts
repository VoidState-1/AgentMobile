import { requireNativeModule } from 'expo';

export type GitProbePhase = 'local' | 'https' | 'cancel' | 'prepare-restart' | 'resume-restart';
export interface NativeGitProgress {
  runId: string;
  phase: string;
  completed: number;
  total: number;
  bytes: number;
}
export interface GitProbeReport {
  ok: boolean;
  version: string;
  phase: GitProbePhase;
  checks: { name: string; detail: string; durationMs: number }[];
  error?: string;
}

/** Host adapter bridge; probe is registered only in development builds. */
interface NativeGitModule {
  version(): Promise<string>;
  execute(projectId: string, operationId: string, request: string): Promise<string>;
  probe(runId: string, phase: GitProbePhase, remoteUrl: string): Promise<string>;
  cancel(runId: string): void;
  addListener(
    event: 'onProgress',
    listener: (progress: NativeGitProgress) => void,
  ): { remove(): void };
}

export default requireNativeModule<NativeGitModule>('AgentMobileGit');
