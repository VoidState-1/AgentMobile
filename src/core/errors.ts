export type AppErrorCode = 'VALIDATION' | 'CONFLICT' | 'CANCELLED' | 'LIMIT' | 'STORAGE' | 'REMOTE' | 'UNKNOWN' | 'DATA_FORMAT';

/** Structured dispatch failure; host control never parses a public message. */
export interface LimitFailure {
  kind: 'deadline' | 'budget_exhausted';
  scope: 'run' | 'group';
  resource?: 'requests' | 'tools';
  deadlineAt?: string;
}

/** Only these public fields cross the application boundary. No native cause is retained. */
export class AppError extends Error {
  constructor(readonly code: AppErrorCode, message: string, readonly uncertain = false, readonly limit?: LimitFailure) {
    super(message); this.name = 'AppError';
  }
}

export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError('UNKNOWN', '操作失败，请重试或重新打开应用。');
}
