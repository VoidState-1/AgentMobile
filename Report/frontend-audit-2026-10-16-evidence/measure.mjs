import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { ESLint } from 'eslint';

const folders = ['src/app', 'src/features', 'src/shared'];
const files = [];
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, e.name);
    if (e.isDirectory()) await walk(name);
    else if (/\.[jt]sx?$/.test(name)) files.push(name);
  }
}
for (const f of folders) await walk(f);
const rows = [];
let inlineStyles = 0;
let memoObjects = [];
for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  rows.push({ file: file.replaceAll('\\', '/'), lines: text.trimEnd().split('\n').length });
  const ast = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(ast) === 'style' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isObjectLiteralExpression(node.initializer.expression)
    )
      inlineStyles++;
    if (
      file.endsWith('use-workbench.ts') &&
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(ast) === 'useMemo'
    ) {
      const arrow = node.initializer.arguments[0];
      if (arrow && ts.isArrowFunction(arrow)) {
        let body = arrow.body;
        while (ts.isParenthesizedExpression(body)) body = body.expression;
        if (ts.isObjectLiteralExpression(body))
          memoObjects.push({ capability: node.name.getText(ast), fields: body.properties.length });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function luminance(hex) {
  const vals = hex
    .match(/[a-f\d]{2}/gi)
    .map(v => parseInt(v, 16) / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return vals[0] * 0.2126 + vals[1] * 0.7152 + vals[2] * 0.0722;
}
function contrast(a, b) {
  const v = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return Number(((v[0] + 0.05) / (v[1] + 0.05)).toFixed(2));
}
const lint = new ESLint();
const boundaryProbes = [];
for (const [file, source] of [
  ['src/features/audit-boundary.ts', "import * as SQLite from 'expo-sqlite';"],
  ['src/features/audit-boundary.ts', "import * as SecureStore from 'expo-secure-store';"],
  [
    'src/shared/audit-boundary.ts',
    "import { WorkbenchScreen } from '@/features/workbench/screen';",
  ],
]) {
  const result = await lint.lintText(source, { filePath: path.resolve(file) });
  boundaryProbes.push({
    file,
    source,
    architectureErrors: result
      .flatMap(r => r.messages)
      .filter(m => m.ruleId === 'architecture/boundaries').length,
  });
}
const results = {
  scopes: folders.map(folder => ({
    folder,
    files: rows.filter(r => r.file.startsWith(folder + '/')).length,
    lines: rows.filter(r => r.file.startsWith(folder + '/')).reduce((sum, r) => sum + r.lines, 0),
  })),
  totalFiles: rows.length,
  totalLines: rows.reduce((sum, r) => sum + r.lines, 0),
  largest: rows.sort((a, b) => b.lines - a.lines).slice(0, 10),
  inlineObjectStyles: inlineStyles,
  memoObjects,
  lightContrasts: [
    { foreground: '#788397', background: '#FFFFFF', role: 'muted on surface' },
    { foreground: '#788397', background: '#F7F8FC', role: 'muted on background' },
    { foreground: '#A17131', background: '#FBF3E6', role: 'warning on warningSoft' },
    { foreground: '#687286', background: '#FFFFFF', role: 'secondary on surface' },
    { foreground: '#C04753', background: '#FCEEF0', role: 'danger on dangerSoft' },
  ].map(v => ({ ...v, ratio: contrast(v.foreground, v.background) })),
  boundaryProbes,
};
await fs.writeFile(
  'Report/frontend-audit-2026-10-16-evidence/metrics.json',
  JSON.stringify(results, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
