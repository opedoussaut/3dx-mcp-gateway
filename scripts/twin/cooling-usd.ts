import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  coolingUsd,
  EXAMPLE,
  extensionDiff,
  layoutCheck,
  type CoolingDesign,
} from '../../server/twin/cooling-usd';

/**
 * node --import tsx scripts/twin/cooling-usd.ts [design.json] [out.usda] [--hall as-built.json]
 * With --hall, the design is a new zone added to that as-built hall (for rehearsals).
 */
const args = process.argv.slice(2);
const at = args.indexOf('--hall');
const hallFile = at >= 0 ? args.splice(at, 2)[1] : undefined;
const [input, output = '.private/twin/cooling-system.usda'] = args;
const read = (f: string): CoolingDesign => JSON.parse(readFileSync(f, 'utf8'));
const design = input ? read(input) : EXAMPLE;
mkdirSync(dirname(output), { recursive: true });
if (hallFile) {
  const asBuilt = read(hallFile);
  const name = hallFile.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
  const changes = extensionDiff(asBuilt, design);
  writeFileSync(
    output,
    coolingUsd(
      { ...design, baseline: { runReference: `${name} as built`, changes } },
      { name, asBuilt },
    ),
  );
  console.log(`wrote ${output}: ${layoutCheck(design, asBuilt).finding}`);
} else {
  writeFileSync(output, coolingUsd(design));
  console.log(`wrote ${output}`);
}
