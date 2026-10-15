import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import ts from 'typescript';

// Execute the checked-in TypeScript adapters in isolated Node/browser fixtures.
// All imports are resolved from source; no generated test implementation is used.
export async function sourceModule(file) {
  const absolute = path.resolve(file);
  const source = await fs.readFile(absolute, 'utf8');
  let javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports = [...javascript.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)];
  for (const match of imports) {
    const target = match[2].startsWith('@/') ? path.resolve('src', match[2].slice(2)) : path.resolve(path.dirname(absolute), match[2]);
    if (!match[2].startsWith('@/') && !match[2].startsWith('.')) throw new Error('Unexpected runtime dependency: ' + match[2]);
    const url = await sourceModule(target.endsWith('.ts') ? target : target + '.ts');
    javascript = javascript.replace(match[0], 'from ' + JSON.stringify(url));
  }
  return 'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64');
}
