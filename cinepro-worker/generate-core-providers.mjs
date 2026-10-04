import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('core/src/providers');
const output = path.resolve('generated-core-providers.ts');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.types.ts') &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.spec.')
    ) {
      out.push(full);
    }
  }
  return out;
}

const providerFiles = walk(root).filter((file) => {
  const source = fs.readFileSync(file, 'utf8');
  return /export\s+class\s+\w+\s+extends\s+BaseProvider/.test(source);
});

const imports = providerFiles.map((file, index) => {
  const relative = './' + path
    .relative(path.dirname(output), file)
    .split(path.sep)
    .join('/');
  return `import * as providerModule${index} from '${relative.replace(/\\.ts$/, '.js')}';`;
});

const moduleNames = providerFiles.map((_, index) => `providerModule${index}`).join(',\n  ');

const source = `import { BaseProvider } from '@omss/framework';
${imports.join('\n')}

const providerModules = [
  ${moduleNames}
];

export function discoverCoreProviders() {
  const instances = [];
  for (const module of providerModules) {
    for (const exported of Object.values(module)) {
      if (
        typeof exported === 'function' &&
        exported.prototype &&
        BaseProvider.prototype.isPrototypeOf(exported.prototype)
      ) {
        try {
          instances.push(new exported());
        } catch (error) {
          console.warn(
            '[CinePro Core] provider initialization failed:',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
  }
  return instances;
}
`;

fs.writeFileSync(output, source);
console.log(`Generated ${providerFiles.length} CinePro Core providers`);
