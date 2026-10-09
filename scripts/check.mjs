import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const files = ['src', 'scripts', 'tests', 'examples'].flatMap(folder => readdirSync(folder).filter(name => name.endsWith('.mjs')).map(name => `${folder}/${name}`));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
for (const file of ['compose.yaml', '.github/workflows/ci.yml']) YAML.parse(readFileSync(file, 'utf8'));
console.log(`Validated ${files.length} JavaScript files and deployment YAML.`);
