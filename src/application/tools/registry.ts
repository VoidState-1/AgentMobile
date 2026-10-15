import { AppError } from '@/core/errors';
import type { RunToolsContext } from './context';
import { workspaceTools } from './workspace';
import { gitTools } from './git';
import { mcpTools } from './mcp';
import { skillsTools } from './skills';

export function createRunTools(context: RunToolsContext) {
  const tools = [
    ...workspaceTools(context),
    ...gitTools(context),
    ...mcpTools(context),
    ...skillsTools(context),
  ];
  if (new Set(tools.map(tool => tool.name)).size !== tools.length)
    throw new AppError('STORAGE', '工具名称重复');
  return tools;
}
