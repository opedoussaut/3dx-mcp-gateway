import { LIMITS } from './configurators';

/**
 * Independent, deterministic check of a cooling configuration that Claude proposed. Claude does
 * the engineering; this function only verifies it: energy balance, declared lab limits,
 * redundancy arithmetic and property plausibility. Its output is the only thing that may be
 * written to the "Check system limits" task. The limits are the lab's invented ones.
 */
export type Envelope = {
  itLoadKw: number;
  facilityWaterC: number;
  rackCount: number;
  redundancy: 'N' | 'N+1' | '2N';
};
export type Proposal = {
  coolantSelection_fluid: string;
  coolantSelection_cp: number;
  coolantSelection_density: number;
  cduSizing_model: string;
  cduCapacityKw: number;
  cduSizing_units: number;
  cduSizing_dutyUnits: number;
  cduSizing_utilisation: number;
  loopConfiguration_supplyC: number;
  loopConfiguration_returnC: number;
  loopConfiguration_flowLpm: number;
  loopConfiguration_rackFlowLpm: number;
};
export type CheckResult = {
  result: 'PASS' | 'REVIEW' | 'FAIL';
  findings: string[];
  derived: Record<string, number>;
  checkTaskValues: { systemCheck_result: string; systemCheck_findings: string };
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const off = (actual: number, expected: number) =>
  expected === 0 ? Infinity : Math.abs(actual - expected) / Math.abs(expected);

export function checkProposal(e: Envelope, p: Proposal): CheckResult {
  const fail: string[] = [];
  const review: string[] = [];
  const ok: string[] = [];

  // Properties: liquid coolants for this duty sit in a narrow band.
  if (p.coolantSelection_cp < 3 || p.coolantSelection_cp > 4.3)
    review.push(
      `Specific heat ${p.coolantSelection_cp} kJ/kg·K is outside 3.0–4.3 for water-based coolants.`,
    );
  if (p.coolantSelection_density < 950 || p.coolantSelection_density > 1100)
    review.push(`Density ${p.coolantSelection_density} kg/m³ is outside 950–1100.`);

  // Temperatures.
  const dT = p.loopConfiguration_returnC - p.loopConfiguration_supplyC;
  const approach = p.loopConfiguration_supplyC - e.facilityWaterC;
  if (dT <= 0) fail.push('Return temperature must be above supply temperature.');
  if (approach < 1)
    fail.push(
      `Secondary supply ${p.loopConfiguration_supplyC} °C cannot be below facility water ${e.facilityWaterC} °C plus a heat-exchanger approach.`,
    );
  else if (approach < 2) review.push(`Approach of ${r1(approach)} K is very tight.`);
  if (p.loopConfiguration_supplyC > LIMITS.maxSupplyC)
    fail.push(
      `Secondary supply ${p.loopConfiguration_supplyC} °C exceeds the ${LIMITS.maxSupplyC} °C limit.`,
    );

  // Energy balance: Q = ρ·cp·V̇·ΔT  →  V̇ [L/min] = Q / (ρ·cp·ΔT) · 60 000.
  const expectedFlow =
    dT > 0
      ? (e.itLoadKw / (p.coolantSelection_density * p.coolantSelection_cp * dT)) * 60_000
      : NaN;
  if (dT > 0) {
    const d = off(p.loopConfiguration_flowLpm, expectedFlow);
    if (d > 0.25)
      fail.push(
        `Flow ${p.loopConfiguration_flowLpm} L/min does not carry ${e.itLoadKw} kW at ΔT ${r1(dT)} K (energy balance gives ${r1(expectedFlow)} L/min).`,
      );
    else if (d > 0.1)
      review.push(
        `Flow differs from the energy balance (${r1(expectedFlow)} L/min) by ${Math.round(d * 100)} %.`,
      );
    else ok.push(`Energy balance holds (${r1(expectedFlow)} L/min expected).`);
  }
  const perRack = p.loopConfiguration_flowLpm / e.rackCount;
  if (off(p.loopConfiguration_rackFlowLpm, perRack) > 0.05)
    review.push(
      `Flow per rack should be total flow / ${e.rackCount} racks = ${r1(perRack)} L/min.`,
    );
  if (p.loopConfiguration_rackFlowLpm > LIMITS.maxRackFlowLpm)
    fail.push(
      `Flow per rack ${p.loopConfiguration_rackFlowLpm} L/min exceeds ${LIMITS.maxRackFlowLpm} L/min.`,
    );

  // CDUs: capacity, redundancy and utilisation.
  const duty = p.cduSizing_dutyUnits;
  const expectedUnits = e.redundancy === 'N' ? duty : e.redundancy === 'N+1' ? duty + 1 : duty * 2;
  if (p.cduSizing_units !== expectedUnits)
    fail.push(
      `${e.redundancy} with ${duty} duty units means ${expectedUnits} installed units, not ${p.cduSizing_units}.`,
    );
  const utilisation = (e.itLoadKw / (duty * p.cduCapacityKw)) * 100;
  if (utilisation > 100)
    fail.push(`Duty units carry only ${duty * p.cduCapacityKw} kW for ${e.itLoadKw} kW.`);
  else if (utilisation > LIMITS.maxUtilisation)
    fail.push(`Duty utilisation ${r1(utilisation)} % exceeds ${LIMITS.maxUtilisation} %.`);
  if (Math.abs(p.cduSizing_utilisation - utilisation) > 2)
    review.push(
      `Stated utilisation ${p.cduSizing_utilisation} % differs from ${r1(utilisation)} % (load / duty capacity).`,
    );

  const result = fail.length ? 'FAIL' : review.length ? 'REVIEW' : 'PASS';
  const findings = [...fail, ...review, ...(result === 'PASS' ? ok : [])];
  if (result === 'PASS') findings.push('All declared lab limits met.');
  return {
    result,
    findings,
    derived: {
      deltaTK: r1(dT),
      approachK: r1(approach),
      expectedFlowLpm: r1(expectedFlow),
      flowPerRackLpm: r1(perRack),
      utilisationPct: r1(utilisation),
      expectedUnits,
    },
    checkTaskValues: {
      systemCheck_result: result,
      systemCheck_findings: `Independent check of the proposed configuration: ${findings.join(' ')} (Lab limits, illustrative.)`,
    },
  };
}
