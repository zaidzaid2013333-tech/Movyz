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

const providerEntries = [];

for (const file of walk(root)) {
  const source = fs.readFileSync(file, 'utf8');
  const classes = [...source.matchAll(/export\s+class\s+(\w+)\s+extends\s+BaseProvider/g)].map(
    (match) => match[1],
  );
  if (!classes.length) continue;

  const relative = './' + path
    .relative(path.dirname(output), file)
    .split(path.sep)
    .join('/')
    .replace(/\.ts$/, '.js');

  providerEntries.push({ relative, classes });
}

const imports = providerEntries.map((entry, index) =>
  `import * as providerModule${index} from '${entry.relative}';`,
);

const constructors = providerEntries.flatMap((entry, index) =>
  entry.classes.map((name) => `  () => new providerModule${index}.${name}(),`),
);

const source = `\n${imports.join('\n')}

const providerConstructors = [
${constructors.join('\n')}
];

export function discoverCoreProviders() {
  return providerConstructors.flatMap((create) => {
    try {
      return [create()];
    } catch (error) {
      console.warn(
        '[CinePro Core] provider initialization failed:',
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  });
}
`;

fs.writeFileSync(output, source.trimStart());
console.log(
  `Generated ${constructors.length} CinePro Core providers from ${providerEntries.length} modules`,
);
