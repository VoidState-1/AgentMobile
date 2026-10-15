import path from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const lint = new ESLint();
const errors = async (file: string, source: string) =>
  (await lint.lintText(source, { filePath: path.resolve(file) }))
    .flatMap(item => item.messages)
    .filter(item => item.ruleId === 'architecture/boundaries');

it('静态/类型/动态/require 导入均按实际层级检查', async () => {
  const cases = [
    ['src/core/runs/boundary.ts', "import type { RunKernel } from '@/application/runs/kernel';"],
    ['src/core/runs/boundary.ts', "export * from '../../application/runs/kernel';"],
    ['src/core/runs/boundary.ts', "type T = import('../../application/runs/kernel').RunKernel;"],
    ['src/core/runs/boundary.ts', "import { Agent } from '@earendil-works/pi-agent-core';"],
    ['src/application/runs/boundary.ts', "import { Platform } from 'react-native';"],
    ['src/application/runs/boundary.ts', "void import('../../adapters/agent/pi-engine');"],
    ['src/application/runs/boundary.ts', "require('@/adapters/storage/platform');"],
    [
      'src/features/workbench/boundary.ts',
      "import type { createStorage } from '@/adapters/storage/platform';",
    ],
    ['src/shared/ui/boundary.ts', "export * from '@/features/workbench/use-workbench';"],
    ['src/application/runs/boundary.ts', 'void import(variable);'],
  ];
  for (const [file, source] of cases) expect(await errors(file, source), source).toHaveLength(1);
});

it('允许平台无关 schema、领域内部和应用公开接口', async () => {
  const cases = [
    ['src/core/agent/boundary.ts', "import type { TSchema } from 'typebox';"],
    ['src/core/runs/boundary.ts', "import type { ControlledTool } from '../agent/tools';"],
    ['src/application/runs/boundary.ts', "import type { AppError } from '@/core/errors';"],
    [
      'src/features/workbench/boundary.ts',
      "import type { AppServices } from '@/application/services';",
    ],
    ['src/shared/ui/boundary.ts', "import { View } from 'react-native';"],
  ];
  for (const [file, source] of cases) expect(await errors(file, source), source).toEqual([]);
});
