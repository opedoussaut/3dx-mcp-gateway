/**
 * Structured lab actions → the canonical command text the deterministic orchestrator parses.
 *
 * A Claude client (MCP) understands the user's request and fills these fields; NOVA turns them
 * into a fixed command, so the model chooses *what* to ask for but never widens *how* it runs:
 * refusals, approval gates and the operation allow-list still apply to the resulting command.
 */
export type CoolingInputs = {
  itLoadKw: number;
  facilityWaterC: number;
  rackCount: number;
  redundancy?: 'N' | 'N+1' | '2N';
  coolant?: 'auto' | 'water' | 'PG25';
};

const num = (n: number) => String(Math.round(n * 100) / 100);

function inputText(i: Partial<CoolingInputs>) {
  const parts: string[] = [];
  if (i.itLoadKw !== undefined) parts.push(`${num(i.itLoadKw)} kW IT load`);
  if (i.facilityWaterC !== undefined) parts.push(`${num(i.facilityWaterC)} °C facility water`);
  if (i.rackCount !== undefined) parts.push(`${Math.round(i.rackCount)} racks`);
  if (i.redundancy) parts.push(i.redundancy === 'N' ? 'N redundancy' : i.redundancy);
  if (i.coolant === 'water') parts.push('use water');
  if (i.coolant === 'PG25') parts.push('coolant PG25');
  return parts.join(', ');
}

export const commands = {
  processes: () => 'Which processes can I start?',
  tasks: () => 'What tasks are waiting for me?',
  status: () => 'What is the status?',
  inbox: () => 'Check my inbox and handle any rework',
  configure: (i: CoolingInputs) => `Configure the cooling chain for ${inputText(i)}`,
  recalculate: (i: Partial<CoolingInputs>) => `Recalculate with ${inputText(i)}`,
  resume: (identificator: string, i: Partial<CoolingInputs> = {}) => {
    const values = inputText(i);
    return `Continue ${identificator.toUpperCase()}${values ? ` with ${values}` : ''}`;
  },
  requirement: (statement: string, source: string) =>
    `Register a candidate requirement: ${statement.replace(/\s+/g, ' ').trim()} source: ${source.replace(/\s+/g, ' ').trim()}`,
};
