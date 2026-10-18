import { DocumentHost } from './document-host';

export interface MarkdownReaderProps {
  content: string;
  tone?: 'text' | 'secondary';
  loadImage?(target: string): Promise<string>;
  imageVersion?: string;
}
export function MarkdownReader(props: MarkdownReaderProps) {
  return <DocumentHost kind="reader" {...props} />;
}
