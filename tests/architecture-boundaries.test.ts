import path from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('导入规则阻止领域/应用层依赖平台和 SDK、界面直连适配器、共享 UI 依赖业务', async () => {
  const lint = new ESLint();
  const cases = [
    ['src/core/runs/boundary.ts', "import { Agent } from '@earendil-works/pi-agent-core';"],
    ['src/application/runs/boundary.ts', "import { Platform } from 'react-native';"],
    ['src/application/runs/boundary.ts', "import { WorkspaceService } from '@/adapters/workspace/service';"],
    ['src/features/workbench/boundary.ts', "import { WorkspaceService } from '@/adapters/workspace/service';"],
    ['src/shared/ui/boundary.ts', "import { useWorkbench } from '@/features/workbench/use-workbench';"],
  ];
  for (const [file, text] of cases) {
    const result = await lint.lintText(text, { filePath: path.resolve(file) });
    expect(result.flatMap((item) => item.messages).some((item) => item.ruleId === 'no-restricted-imports'), file).toBe(true);
  }
});
