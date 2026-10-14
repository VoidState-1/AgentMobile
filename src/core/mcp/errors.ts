import { AppError } from '../errors';

export class McpError extends AppError {
  constructor(message: string, uncertain = false) { super(uncertain ? 'UNKNOWN' : 'REMOTE', message, uncertain); }
}
