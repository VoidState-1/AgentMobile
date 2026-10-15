import { describe, expect, it } from 'vitest';
import { groupTrace, toolCategory } from '../src/features/workbench/trace-groups';
import type { DisplayTrace } from '../src/core/runs/queries';
const tool = (id: string, name: string, extra: object = {}): DisplayTrace => ({
  id,
  kind: 'tool',
  tool: name,
  callId: id,
  round: 1,
  state: 'completed',
  startedAt: '2026-10-15T12:00:00Z',
  input: '{}',
  ...extra,
});
describe('执行轨迹的展示分组', () => {
  it('只折叠连续工具，保留公开推理与中间正文的位置', () => {
    const content = (id: string, kind: 'text' | 'reasoning'): DisplayTrace => ({
      id,
      kind,
      text: id,
      visibility: 'summary',
      contentIndex: 0,
      round: 1,
      state: 'completed',
      startedAt: '2026-10-15T12:00:00Z',
    });
    const items = [
      tool('a', 'list_files'),
      tool('b', 'read_text'),
      content('thought', 'reasoning'),
      tool('c', 'write_text'),
      content('update', 'text'),
      tool('d', 'git_status'),
    ];
    const groups = groupTrace(items);
    expect(groups.map(group => [group.kind, group.id])).toEqual([
      ['tools', 'a'],
      ['content', 'thought'],
      ['tools', 'c'],
      ['content', 'update'],
      ['tools', 'd'],
    ]);
    expect(groups.flatMap(group => (group.kind === 'tools' ? group.items : [group.item]))).toEqual(
      items,
    );
  });
  it('分页与增量追加保持首个调用身份及未知回执、子任务关联', () => {
    const first = tool('first', 'spawn_agent', { childRunIds: ['child'] });
    const remote = tool('remote', 'remote_service', { state: 'unknown' });
    const before = groupTrace([first]);
    const after = groupTrace([first, remote, tool('next-page', 'git_status')]);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].kind === 'tools' && after[0].items).toEqual([
      first,
      remote,
      expect.objectContaining({ id: 'next-page' }),
    ]);
  });
  it('图标类别反映实际能力，不把远程工具当作本地命令', () => {
    expect(
      [
        'read_text',
        'search_text',
        'inspect_image',
        'write_text',
        'git_commit',
        'load_skill',
        'spawn_agent',
        'remote_service',
      ].map(toolCategory),
    ).toEqual(['read', 'search', 'image', 'write', 'git', 'skill', 'agent', 'remote']);
  });
});
