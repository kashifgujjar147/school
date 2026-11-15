#!/usr/bin/env node
// Builds the release ZIP: all sources, docs, tests, scripts, manifests, .env.example.
// Excludes node_modules, build output, caches, real .env files, local data and test artefacts.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outDir = join(root, 'dist-release');
mkdirSync(outDir, { recursive: true });
const name = `school-management-system-v${version}`;
const zip = join(outDir, `${name}.zip`);
if (existsSync(zip)) rmSync(zip);
const exclude = ['*/node_modules/*', '*/dist/*', '*/dist-release/*', '*/.env', '*/.env.local', '*/.test-data/*', '*/data/*',
  '*/coverage/*', '*/playwright-report/*', '*/test-results/*', '*.log', '*/.DS_Store', '*/.git/*'];
execSync(`cd "${join(root, '..')}" && zip -r -X -q "${zip}" "${root.split('/').filter(Boolean).pop()}" ${exclude.map((e) => `-x "${e}"`).join(' ')}`, { stdio: 'inherit' });
console.log(zip);
