#!/usr/bin/env node
// Syntax verification for every .ts/.tsx file using the TypeScript compiler's parser.
// This does NOT type-check (that needs installed dependencies: run `npm run typecheck`).
// It catches syntax errors, malformed JSX and invalid TS constructs without node_modules.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  ts = require(join(globalRoot, 'typescript'));
}

const root = new URL('..', import.meta.url).pathname;
const skip = new Set(['node_modules', 'dist', '.git', '.test-data', 'coverage']);
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    if (skip.has(f)) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mts)$/.test(f) && !f.endsWith('.d.ts')) files.push(p);
  }
})(root);

let errors = 0;
for (const file of files) {
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true }
  });
  for (const d of out.diagnostics ?? []) {
    errors++;
    const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    console.error(`${relative(root, file)}${pos ? `:${pos.line + 1}:${pos.character + 1}` : ''}  ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  }
}
console.log(`Checked ${files.length} TypeScript files with TypeScript ${ts.version}: ${errors} syntax error(s).`);
process.exit(errors ? 1 : 0);
