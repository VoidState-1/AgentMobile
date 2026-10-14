import { AppError } from '../errors';
export class ProtocolError extends AppError {
  constructor(message: string) { super('REMOTE', message); }
}
