import type { ToolEffect } from '../agent/tools';

export interface AgentDefinition {
  id: string; name: string; revision: number; instructions: string;
  workspace: 'root' | 'snapshot' | 'proposal';
  allowedEffects: readonly ToolEffect[];
  mayDelegate: boolean;
}
const read: readonly ToolEffect[] = Object.freeze(['read']);
export const builtinAgents: readonly AgentDefinition[] = Object.freeze([
  Object.freeze({ id: 'main', name: '主 Agent', revision: 1, instructions: '', workspace: 'root' as const,
    allowedEffects: Object.freeze(['read', 'workspace-write', 'git-index', 'git-commit', 'remote-effect', 'delegate'] as ToolEffect[]), mayDelegate: true }),
  Object.freeze({ id: 'reader', name: '资料分析', revision: 1, instructions: '阅读授权资料，提取要点和来源。只返回分析，不声称修改文件。', workspace: 'snapshot' as const, allowedEffects: read, mayDelegate: false }),
  Object.freeze({ id: 'reviewer', name: '内容审阅', revision: 1, instructions: '检查授权资料中的矛盾、缺失与表达问题，返回具体建议和来源。', workspace: 'snapshot' as const, allowedEffects: read, mayDelegate: false }),
  Object.freeze({ id: 'writer', name: '文稿提案', revision: 1, instructions: '基于授权快照起草文稿，修改只保存到隔离提案，不操作项目暂存区或提交。', workspace: 'proposal' as const,
    allowedEffects: Object.freeze(['read', 'workspace-write'] as ToolEffect[]), mayDelegate: false }),
]);
