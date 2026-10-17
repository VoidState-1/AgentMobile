import type { DisplayTrace } from '@/core/runs/queries';
import type { ToolTrace } from '@/core/trace';

export type ToolCategory =
  'read' | 'search' | 'image' | 'write' | 'git' | 'skill' | 'remote' | 'agent';
export const toolCategoryNames: Record<ToolCategory, string> = {
  read: '读取',
  search: '搜索',
  image: '图片',
  write: '修改',
  git: 'Git',
  skill: '技能',
  remote: 'MCP',
  agent: '子 Agent',
};
export function toolCategory(tool: string): ToolCategory {
  if (tool === 'inspect_image') return 'image';
  if (tool === 'search_text') return 'search';
  if (['edit_text', 'write_text', 'delete_file', 'move_file'].includes(tool)) return 'write';
  if (tool.startsWith('git_')) return 'git';
  if (tool === 'load_skill' || tool === 'read_skill_resource') return 'skill';
  if (
    [
      'spawn_agent',
      'wait_agents',
      'get_agent_result',
      'cancel_agent',
      'get_proposal',
      'apply_proposal',
    ].includes(tool)
  )
    return 'agent';
  if (tool === 'list_files' || tool === 'read_text') return 'read';
  return 'remote';
}
export type TraceGroup =
  | { kind: 'tools'; id: string; items: ToolTrace[] }
  | { kind: 'content'; id: string; item: DisplayTrace };

/** Group adjacent calls only. Text and public reasoning are ordering boundaries. */
export function groupTrace(items: readonly DisplayTrace[]): TraceGroup[] {
  const groups: TraceGroup[] = [];
  for (const item of items) {
    const previous = groups.at(-1);
    if (item.kind === 'tool') {
      if (previous?.kind === 'tools') previous.items.push(item);
      else groups.push({ kind: 'tools', id: item.id, items: [item] });
    } else groups.push({ kind: 'content', id: item.id, item });
  }
  return groups;
}
