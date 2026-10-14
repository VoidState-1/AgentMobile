import type { TSchema } from 'typebox';
import type { ControlledTool } from '@/core/agent/tools';
import type { RunToolsContext } from './context';
import { defineTool, assertRunning } from './common';

export function mcpTools(context: RunToolsContext): ControlledTool[] {
  const { runId, settings, mcpRun } = context;
  return [
...(mcpRun?.tools ?? []).map((binding): ControlledTool => defineTool({
        name: binding.alias, label: binding.label,
        description: binding.label + '\n' + binding.tool.description + '\n参数会发送到远端服务。',
        parameters: JSON.parse(JSON.stringify(binding.tool.inputSchema)) as TSchema, executionMode: 'sequential', effect: 'remote-effect',
        execute: async (callId, args, signal, onUpdate) => {
          assertRunning(signal);
          return binding.execute(runId, runId + ':' + context.round() + ':tool:' + callId, args as Record<string, unknown>, settings.imageInput, signal,
            (text) => onUpdate?.({ content: [{ type: 'text', text }], details: { mcpStatus: 'running' } }));
        },
      }))
  ];
}
