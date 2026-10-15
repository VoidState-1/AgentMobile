import type { ControlledTool, ToolEffect } from './tools';
import { AppError } from '../errors';

export interface AgentDefinition {
  id: string; name: string; revision: number; instructions: string;
  workspace: 'root' | 'snapshot' | 'proposal';
  allowedEffects: readonly ToolEffect[];
  mayDelegate: boolean;
}

export function toolAllowed(agent: AgentDefinition, tool: ControlledTool): boolean {
  return agent.allowedEffects.includes(tool.effect) && (tool.effect !== 'delegate' || agent.mayDelegate);
}

export function authorizedTools(agent: AgentDefinition, tools: readonly ControlledTool[]): ControlledTool[] {
  const effects: readonly ToolEffect[] = ['read', 'workspace-write', 'git-index', 'git-commit', 'remote-effect', 'delegate'];
  if (tools.some(tool => !effects.includes(tool.effect))) throw new AppError('VALIDATION', '工具必须显式声明受支持的副作用。');
  return tools.filter(tool => toolAllowed(agent, tool));
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
