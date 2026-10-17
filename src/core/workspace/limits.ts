/** Resource budget for buffered, journaled workspace operations; not a filesystem limit. */
export const workspaceLimits = {
  fileOperationBytes: 20 * 1024 * 1024,
} as const;
