import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { coolingUsd, EXAMPLE, type CoolingDesign } from '../../server/twin/cooling-usd';

/** node --import tsx scripts/twin/cooling-usd.ts [design.json] [out.usda] */
const [input, output = '.private/twin/cooling-system.usda'] = process.argv.slice(2);
const design: CoolingDesign = input ? JSON.parse(readFileSync(input, 'utf8')) : EXAMPLE;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, coolingUsd(design));
console.log(`wrote ${output}`);
