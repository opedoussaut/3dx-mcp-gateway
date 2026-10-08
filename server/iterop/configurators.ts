/**
 * ILLUSTRATIVE engineering configurators for the orchestration lab.
 *
 * Transparent textbook formulas with invented catalogue entries and invented limits. They exist to
 * show how an orchestrator chains tools around process tasks. They are NOT engineering values and
 * must never be presented as a validated design; in a real deployment the authoritative
 * configurators and system models produce every number.
 */
export type ChainInputs = {
  itLoadKw: number;
  facilityWaterC: number;
  rackCount: number;
  redundancy: 'N' | 'N+1' | '2N';
  coolant: 'auto' | 'water' | 'PG25';
};
export type Fields = Record<string, string | number>;

/** Approximate public property values near 30 °C. */
const FLUIDS = {
  water: { label: 'Water', cp: 4.18, density: 997 },
  PG25: { label: 'PG25 (25 % propylene glycol)', cp: 3.93, density: 1020 },
} as const;
/** Invented catalogue. */
const UNITS = [
  { model: 'CDU-350', capacityKw: 350 },
  { model: 'CDU-800', capacityKw: 800 },
  { model: 'CDU-1500', capacityKw: 1500 },
] as const;
export const LIMITS = {
  /** Invented limits, declared so the check is reproducible. */
  approachK: 3,
  designDeltaK: 10,
  maxSupplyC: 40,
  maxRackFlowLpm: 150,
  maxUtilisation: 90,
} as const;

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function coolant(input: ChainInputs): Fields {
  const key = input.coolant === 'water' ? 'water' : 'PG25';
  const fluid = FLUIDS[key];
  return {
    coolantSelection_fluid: key,
    coolantSelection_cp: fluid.cp,
    coolantSelection_density: fluid.density,
    coolantSelection_rationale:
      input.coolant === 'auto'
        ? `${fluid.label}: default lab rule favours freeze and corrosion protection over heat capacity.`
        : `${fluid.label}: requested in the start form.`,
  };
}

export function cdu(input: ChainInputs): Fields {
  // Smallest model that carries the load with at most three duty units under the utilisation limit.
  const pick =
    UNITS.find(
      (u) => Math.ceil(input.itLoadKw / ((u.capacityKw * LIMITS.maxUtilisation) / 100)) <= 3,
    ) ?? UNITS[UNITS.length - 1];
  const duty = Math.ceil(input.itLoadKw / ((pick.capacityKw * LIMITS.maxUtilisation) / 100));
  const units = input.redundancy === 'N' ? duty : input.redundancy === 'N+1' ? duty + 1 : duty * 2;
  return {
    cduSizing_model: pick.model,
    cduSizing_units: units,
    cduSizing_dutyUnits: duty,
    cduSizing_utilisation: round((input.itLoadKw / (duty * pick.capacityKw)) * 100),
  };
}

export function loop(input: ChainInputs, fluid: Fields): Fields {
  const supply = input.facilityWaterC + LIMITS.approachK;
  // Q = ṁ·cp·ΔT  →  V̇ = Q / (ρ·cp·ΔT)   [kW / (kg/m³ · kJ/kg·K · K) = m³/s]
  const flowM3s =
    input.itLoadKw /
    (Number(fluid.coolantSelection_density) *
      Number(fluid.coolantSelection_cp) *
      LIMITS.designDeltaK);
  const flowLpm = flowM3s * 60_000;
  return {
    loopConfiguration_supplyC: round(supply),
    loopConfiguration_returnC: round(supply + LIMITS.designDeltaK),
    loopConfiguration_flowLpm: round(flowLpm, 0),
    loopConfiguration_rackFlowLpm: round(flowLpm / input.rackCount),
  };
}

export function validator(input: ChainInputs, unit: Fields, loopFields: Fields): Fields {
  const findings: string[] = [];
  let result: 'PASS' | 'REVIEW' | 'FAIL' = 'PASS';
  const supply = Number(loopFields.loopConfiguration_supplyC);
  const rack = Number(loopFields.loopConfiguration_rackFlowLpm);
  if (supply > LIMITS.maxSupplyC) {
    result = 'FAIL';
    findings.push(
      `Secondary supply ${supply} °C exceeds the ${LIMITS.maxSupplyC} °C lab inlet limit.`,
    );
  }
  if (rack > LIMITS.maxRackFlowLpm) {
    if (result === 'PASS') result = 'REVIEW';
    findings.push(
      `Flow per rack ${rack} L/min exceeds the ${LIMITS.maxRackFlowLpm} L/min lab manifold limit.`,
    );
  }
  if (input.redundancy === 'N') {
    if (result === 'PASS') result = 'REVIEW';
    findings.push('No redundant unit: a single unit failure reduces cooling capacity.');
  }
  if (!findings.length)
    findings.push(
      `Within lab limits: supply ≤ ${LIMITS.maxSupplyC} °C, rack flow ≤ ${LIMITS.maxRackFlowLpm} L/min, ${unit.cduSizing_units} units for ${input.redundancy}.`,
    );
  return { systemCheck_result: result, systemCheck_findings: findings.join(' ') };
}
