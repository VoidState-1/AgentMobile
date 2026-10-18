import { safePath } from '@/core/workspace/path';

export function resolveProjectPath(documentPath: string, target: string): string {
  const decoded = decodeURIComponent(target);
  if (/^[a-z][\w+.-]*:|^\/|\\|[\u0000-\u001f]/i.test(decoded))
    throw new Error('外部资源不自动加载');
  const parts = documentPath.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('资源路径越界');
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return safePath(parts.join('/'));
}
