export interface SchedulerLimits {
  activeRoots: number;
  modelRequests: number;
  connectionRequests: number;
  queuedRoots: number;
  queuedPerProject: number;
  parallelChildren: number;
  totalChildren: number;
  depth: number;
}
export const defaultSchedulerLimits: Readonly<SchedulerLimits> = Object.freeze({
  activeRoots: 2, modelRequests: 2, connectionRequests: 2, queuedRoots: 16, queuedPerProject: 4,
  parallelChildren: 2, totalChildren: 4, depth: 1,
});
