import type { NotificationScheduler } from '../src/core/agent/engine';

export const testNotifications: NotificationScheduler = {
  schedule(listener) { let active = true; queueMicrotask(() => { if (active) listener(); }); return () => { active = false; }; },
};
