import { describe, expect, it } from 'vitest';
import { summarizeChanges } from '../src/adapters/git/change-summary';

describe('任务文件差异摘要', () => {
  it('新增、删除与替换按完整行计数，保留中文和末行无换行', () => {
    expect(
      summarizeChanges([
        { path: 'new.md', status: 'added', before: '', after: '甲\n乙' },
        { path: 'gone.md', status: 'deleted', before: '甲\n乙\n', after: '' },
        {
          path: 'edit.md',
          status: 'modified',
          before: '保留\n旧行\n',
          after: '保留\n新行\n再一行\n',
        },
      ]),
    ).toMatchObject([
      { status: 'added', added: 2, removed: 0 },
      { status: 'deleted', added: 0, removed: 2 },
      { status: 'modified', added: 2, removed: 1 },
    ]);
  });
  it('图片不伪造行数，暂存独有变化保留范围', () => {
    expect(
      summarizeChanges([
        {
          path: 'assets/photo.png',
          status: 'modified',
          before: 'data:image/png;base64,aaa',
          after: 'data:image/png;base64,bbb',
        },
        { path: 'note.md', status: 'modified', stagedOnly: true, before: '旧', after: '新' },
      ]),
    ).toEqual([
      { path: 'assets/photo.png', status: 'modified', stagedOnly: false, image: true },
      { path: 'note.md', status: 'modified', stagedOnly: true, image: false, added: 1, removed: 1 },
    ]);
  });
  it('没有变化及空文件不会虚构增删', () => {
    expect(
      summarizeChanges([{ path: 'empty.md', status: 'added', before: '', after: '' }])[0],
    ).toMatchObject({ added: 0, removed: 0 });
    expect(summarizeChanges([])).toEqual([]);
  });
  it('超过统计预算保留文件差异入口，不返回不完整的行数', () => {
    const result = summarizeChanges([
      {
        path: 'large.md',
        status: 'modified',
        before: '旧行\n'.repeat(5000),
        after: '新行\n'.repeat(5000),
      },
    ]);
    expect(result).toEqual([
      { path: 'large.md', status: 'modified', stagedOnly: false, image: false },
    ]);
  });
});
