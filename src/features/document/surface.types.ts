export interface DocumentSurfaceHandle {
  post(message: unknown): void;
}
export interface DocumentSurfaceProps {
  html: string;
  channel: string;
  height?: number;
  onMessage(message: unknown): void;
  onError(message: string): void;
}
