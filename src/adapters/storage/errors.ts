export function missing(path: string): Error & { code: string } {
  return Object.assign(new Error('文件或目录不存在：' + path), { code: 'ENOENT' });
}
