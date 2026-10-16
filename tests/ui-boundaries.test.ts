import path from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const lint = new ESLint();
const violations = async (file: string, source: string) =>
  (await lint.lintText(source, { filePath: path.resolve(file) }))
    .flatMap(result => result.messages)
    .filter(item => item.ruleId === 'no-restricted-imports');

it('页面共用文本、输入和弹层入口；类型导入与全屏编辑/侧栏外壳仍可用', async () => {
  for (const name of ['Text', 'TextInput', 'Modal']) {
    expect(
      await violations(
        'src/features/skills/new-view.tsx',
        `import { ${name} } from 'react-native';`,
      ),
    ).toHaveLength(1);
  }
  for (const [file, source] of [
    ['src/features/skills/new-view.tsx', "import type { TextInput } from 'react-native';"],
    [
      'src/features/skills/new-view.tsx',
      "import { Field, T } from '@/shared/ui/primitives'; import { Sheet } from '@/shared/ui/sheets';",
    ],
    ['src/features/workbench/editor.tsx', "import { Modal } from 'react-native';"],
    ['src/features/workbench/project-drawer.tsx', "import { Modal } from 'react-native';"],
    ['src/shared/ui/sheets.tsx', "import { Modal } from 'react-native';"],
  ])
    expect(await violations(file, source)).toEqual([]);
  expect(
    await violations(
      'src/features/workbench/editor.tsx',
      "import { TextInput } from 'react-native';",
    ),
  ).toHaveLength(1);
});
