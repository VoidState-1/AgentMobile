import type { NotificationScheduler } from '@/core/agent/engine';

export const notifications: NotificationScheduler = {
  schedule(listener) {
    const frame = requestAnimationFrame(listener);
    return () => cancelAnimationFrame(frame);
  },
};
