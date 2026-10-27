/**
 * OpenUSD representation of a checked liquid-cooling configuration (SYNTHETIC lab geometry).
 *
 * Deterministic: every count and size comes from the design (rack count, CDU units and duty units,
 * total and per-rack flow, loop temperatures). Geometry is schematic (boxes and pipes, metres,
 * Z up); engineering values are carried as `nova:` attributes on the prims, so the 3D scene stays a
 * representation of the checked design and never a second source of numbers.
 */
export type CoolingDesign = {
  runReference?: string;
  itLoadKw: number;
  rackCount: number;
  coolant: string;
  cduModel: string;
  cduUnits: number;
  cduDutyUnits: number;
  cduCapacityKw?: number;
  supplyC: number;
  returnC: number;
  flowLpm: number;
  rackFlowLpm: number;
  facilityWaterC: number;
  /** CATIA Magic element ids, when the SysML model exists (traceability). */
  sysml?: Record<string, string>;
  /** The approved configuration this one changes, and what changed (from designDiff). */
  baseline?: { runReference: string; changes: string[] };
};

const mm = (m: number) => `${Math.round(m * 1000)} mm`;

/** Length of the hall's CDU gallery along the rows (illustrative lab room). */
export const CDU_GALLERY_M = 4.2;
const CDU_GAP_M = 0.1;
const capacityOf = (d: CoolingDesign) =>
  d.cduCapacityKw ?? Number(d.cduModel.match(/(\d{2,5})/)?.[1] ?? 0);
/** In-row units stand in the rack row, not in the CDU gallery; the model name says so. */
export const inRow = (d: CoolingDesign) => /in-?row|-IR-/i.test(d.cduModel);
/** Unit width: in-row 0.6 m (a rack slot), 500 kW class 0.8 m, larger classes 0.95 m (illustrative). */
export const cduWidth = (d: CoolingDesign) => (inRow(d) ? 0.6 : capacityOf(d) > 600 ? 0.95 : 0.8);
const r2 = (n: number) => Math.round(n * 100) / 100;
/**
 * Do the CDUs fit the gallery? The numbers can pass while the room cannot hold the units. With
 * `asBuilt`, `d` is a new zone added to that hall, and the gallery is shared with its units.
 */
export function layoutCheck(d: CoolingDesign, asBuilt?: CoolingDesign) {
  const inGallery = (asBuilt ? [asBuilt, d] : [d]).filter((z) => !inRow(z));
  const units = inGallery.reduce((n, z) => n + z.cduUnits, 0);
  const requiredM = units
    ? r2(inGallery.reduce((m, z) => m + z.cduUnits * cduWidth(z), 0) + (units - 1) * CDU_GAP_M)
    : 0;
  const fits = requiredM <= CDU_GALLERY_M;
  const over = `${r2(requiredM - CDU_GALLERY_M)} m too long`;
  const rowNote = inRow(d) ? ` The ${d.cduUnits} new in-row CDUs stand in the new rack row.` : '';
  const finding = !asBuilt
    ? inRow(d)
      ? `${d.cduUnits} in-row CDUs stand in the rack row; the CDU gallery is not used.`
      : fits
        ? `${d.cduUnits} CDUs need ${requiredM} m of the ${CDU_GALLERY_M} m CDU gallery.`
        : `${d.cduUnits} CDUs need ${requiredM} m but the CDU gallery is ${CDU_GALLERY_M} m: ${over}.`
    : fits
      ? `The CDU gallery holds ${units} CDUs: ${requiredM} of ${CDU_GALLERY_M} m.${rowNote}`
      : `${asBuilt.cduUnits} existing and ${d.cduUnits} new CDUs need ${requiredM} m but the CDU gallery is ${CDU_GALLERY_M} m: ${over}.`;
  return {
    result: fits ? ('PASS' as const) : ('FAIL' as const),
    requiredM,
    availableM: CDU_GALLERY_M,
    finding,
  };
}
/** What a new zone adds to an as-built hall, in plain words. */
export function extensionDiff(asBuilt: CoolingDesign, zone: CoolingDesign): string[] {
  const perRack = (d: CoolingDesign) => Math.round((d.itLoadKw / d.rackCount) * 10) / 10;
  return [
    `existing zone unchanged: ${asBuilt.rackCount} racks, ${asBuilt.itLoadKw} kW, ${asBuilt.cduUnits} × ${asBuilt.cduModel}`,
    `new zone: ${zone.rackCount} racks, ${zone.itLoadKw} kW (${perRack(zone)} kW per rack, ${perRack(asBuilt)} kW in the existing zone)`,
    `new CDUs: ${zone.cduUnits} × ${zone.cduModel} (${zone.cduDutyUnits} duty), ${inRow(zone) ? 'in-row, in the new rack row' : 'in the CDU gallery'}`,
    `new secondary loop: ${zone.supplyC} → ${zone.returnC} °C, ${zone.flowLpm} L/min, ${zone.rackFlowLpm} L/min per rack`,
    `hall IT load ${asBuilt.itLoadKw} → ${asBuilt.itLoadKw + zone.itLoadKw} kW`,
  ];
}
/** Pipe inner diameters that follow from a design (as drawn in the scene). */
export function pipeSizes(d: CoolingDesign) {
  const rows = d.rackCount > 8 ? 2 : 1;
  return {
    distribution: diameter(d.flowLpm),
    rowHeader: diameter(d.flowLpm / rows),
    rackDrop: diameter(d.rackFlowLpm),
  };
}
/** What changed between an approved design and a proposed one, in plain words. */
export function designDiff(base: CoolingDesign, next: CoolingDesign): string[] {
  const out: string[] = [];
  const num = (label: string, a: number, b: number, unit = '') => {
    if (Math.abs(a - b) > 1e-9) out.push(`${label} ${a}${unit} → ${b}${unit}`);
  };
  num('IT load', base.itLoadKw, next.itLoadKw, ' kW');
  num('racks', base.rackCount, next.rackCount);
  if (base.coolant !== next.coolant) out.push(`coolant ${base.coolant} → ${next.coolant}`);
  const units = (d: CoolingDesign) => `${d.cduUnits} × ${d.cduModel} (${d.cduDutyUnits} duty)`;
  if (units(base) !== units(next)) out.push(`CDUs ${units(base)} → ${units(next)}`);
  num('supply', base.supplyC, next.supplyC, ' °C');
  num('return', base.returnC, next.returnC, ' °C');
  num('total flow', base.flowLpm, next.flowLpm, ' L/min');
  num('flow per rack', base.rackFlowLpm, next.rackFlowLpm, ' L/min');
  num('facility water', base.facilityWaterC, next.facilityWaterC, ' °C');
  const [a, b] = [pipeSizes(base), pipeSizes(next)];
  if (a.distribution !== b.distribution)
    out.push(`distribution header ${mm(a.distribution)} → ${mm(b.distribution)}`);
  if (a.rowHeader !== b.rowHeader) out.push(`row headers ${mm(a.rowHeader)} → ${mm(b.rowHeader)}`);
  if (a.rackDrop !== b.rackDrop) out.push(`rack drops ${mm(a.rackDrop)} → ${mm(b.rackDrop)}`);
  return out;
}

/** The configuration from the live run (COOL-2610…, PG25, N+1). */
export const EXAMPLE: CoolingDesign = {
  itLoadKw: 1200,
  rackCount: 16,
  coolant: 'PG25',
  cduModel: 'CDU-500',
  cduUnits: 4,
  cduDutyUnits: 3,
  cduCapacityKw: 500,
  supplyC: 35,
  returnC: 45,
  flowLpm: 1810,
  rackFlowLpm: 113.1,
  facilityWaterC: 32,
};

const RACK = { w: 0.6, d: 1.2, h: 2.2 };
const CDU = { w: 0.8, d: 1.2, h: 2.0 };
const AISLE = 1.8;
const VELOCITY = 1.5; // m/s design velocity used to size pipe diameters
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Inner diameter for a flow in L/min at the design velocity, rounded up to 5 mm. */
const diameter = (lpm: number) =>
  (Math.ceil((Math.sqrt((4 * (lpm / 60000)) / (Math.PI * VELOCITY)) * 1000) / 5) * 5) / 1000;
const ident = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
const str = (s: string) => JSON.stringify(s);

type V3 = [number, number, number];
const v3 = (v: V3) => `(${v.map(r3).join(', ')})`;

const LOOKS: Record<string, V3> = {
  Floor: [0.55, 0.57, 0.6],
  Rack: [0.12, 0.13, 0.15],
  RackDense: [0.1, 0.17, 0.34],
  CduDuty: [0.04, 0.42, 0.43],
  CduStandby: [0.45, 0.6, 0.62],
  Supply: [0.09, 0.41, 0.64],
  Return: [0.78, 0.2, 0.16],
  Facility: [0.2, 0.55, 0.25],
  Gallery: [0.95, 0.75, 0.2],
  Clash: [0.85, 0.12, 0.1],
};

/**
 * With `hall`, the scene is the as-built hall plus `design` as a new zone: the existing equipment
 * keeps exactly the prim paths and values of its own scene, so a viewer comparison shows only what
 * the new zone adds.
 */
export function coolingUsd(design: CoolingDesign, hall?: { name: string; asBuilt: CoolingDesign }) {
  const d = hall ? hall.asBuilt : design;
  const ext = hall ? design : undefined;
  const out: string[] = [];
  const indent = (n: number) => '    '.repeat(n);
  const attrs = (n: number, a: Record<string, string | number>) =>
    Object.entries(a).map(([k, v]) =>
      typeof v === 'number'
        ? `${indent(n)}custom double nova:${k} = ${r3(v)}`
        : `${indent(n)}custom string nova:${k} = ${str(v)}`,
    );
  const look = (n: number, name: string) => [
    `${indent(n)}rel material:binding = </CoolingSystem/Looks/${name}>`,
    `${indent(n)}color3f[] primvars:displayColor = [${v3(LOOKS[name])}]`,
  ];
  /**
   * Explicit polygon meshes (not implicit Cube/Cylinder prims): every USD reader imports them, and
   * material bindings on them are honoured, which some importers skip for implicit shapes.
   */
  const mesh = (
    n: number,
    name: string,
    at: V3,
    points: V3[],
    faces: number[][],
    mat: string,
    a: Record<string, string | number>,
    label?: string,
    /** One normal per face, for hard edges (boxes); omitted for smooth pipes. */
    faceNormals?: V3[],
  ) => [
    `${indent(n)}def Mesh ${str(name)} (`,
    `${indent(n + 1)}prepend apiSchemas = ["MaterialBindingAPI"]`,
    ...(label ? [`${indent(n + 1)}displayName = ${str(label)}`] : []),
    `${indent(n)})`,
    `${indent(n)}{`,
    `${indent(n + 1)}point3f[] points = [${points.map(v3).join(', ')}]`,
    `${indent(n + 1)}int[] faceVertexCounts = [${faces.map((f) => f.length).join(', ')}]`,
    `${indent(n + 1)}int[] faceVertexIndices = [${faces.flat().join(', ')}]`,
    `${indent(n + 1)}uniform token subdivisionScheme = "none"`,
    ...(faceNormals
      ? [
          `${indent(n + 1)}normal3f[] normals = [${faces.flatMap((f, i) => f.map(() => v3(faceNormals[i]))).join(', ')}] (`,
          `${indent(n + 2)}interpolation = "faceVarying"`,
          `${indent(n + 1)})`,
        ]
      : []),
    `${indent(n + 1)}double3 xformOp:translate = ${v3(at)}`,
    `${indent(n + 1)}uniform token[] xformOpOrder = ["xformOp:translate"]`,
    ...look(n + 1, mat),
    ...attrs(n + 1, a),
    `${indent(n)}}`,
  ];
  const box = (
    n: number,
    name: string,
    size: V3,
    at: V3,
    mat: string,
    a: Record<string, string | number> = {},
    label?: string,
  ) => {
    const [x, y, z] = size.map((s) => s / 2);
    const p: V3[] = [
      [-x, -y, -z],
      [x, -y, -z],
      [x, y, -z],
      [-x, y, -z],
      [-x, -y, z],
      [x, -y, z],
      [x, y, z],
      [-x, y, z],
    ];
    const faces = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    const normals: V3[] = [
      [0, 0, -1],
      [0, 0, 1],
      [0, -1, 0],
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
    ];
    return mesh(n, name, at, p, faces, mat, a, label, normals);
  };
  /** A straight pipe between two points along one axis, as a closed 16-sided mesh. */
  const pipe = (
    n: number,
    name: string,
    from: V3,
    to: V3,
    dia: number,
    mat: string,
    a: Record<string, string | number> = {},
  ) => {
    const axis = from[0] !== to[0] ? 0 : from[1] !== to[1] ? 1 : 2;
    const half = Math.abs(to[axis] - from[axis]) / 2;
    const mid: V3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    const sides = 16;
    const [u, w] = [0, 1, 2].filter((k) => k !== axis);
    const ring = (along: number) =>
      Array.from({ length: sides }, (_, i) => {
        const v: V3 = [0, 0, 0];
        v[axis] = along;
        v[u] = (dia / 2) * Math.cos((2 * Math.PI * i) / sides);
        v[w] = (dia / 2) * Math.sin((2 * Math.PI * i) / sides);
        return v;
      });
    const points = [...ring(-half), ...ring(half)];
    const faces = [
      ...Array.from({ length: sides }, (_, i) => [
        i,
        (i + 1) % sides,
        sides + ((i + 1) % sides),
        sides + i,
      ]),
      Array.from({ length: sides }, (_, i) => sides - 1 - i),
      Array.from({ length: sides }, (_, i) => sides + i),
    ];
    return mesh(n, name, mid, points, faces, mat, { innerDiameterM: dia, ...a });
  };

  // Layout: racks in two rows facing a shared aisle; CDUs in a line at the row ends.
  const rows = d.rackCount > 8 ? 2 : 1;
  const perRow = Math.ceil(d.rackCount / rows);
  const rowY = (row: number) => row * (RACK.d + AISLE);
  const rowEnd = perRow * RACK.w;
  const cduX = -1.0 - CDU.d / 2;
  const riserX = -0.6;
  const zSupply = RACK.h + 0.35;
  const zReturn = RACK.h + 0.65;
  const spanY: [number, number] = [-0.6, rowY(rows - 1) + 0.6];
  // CDUs side by side in the gallery, centred when they fit; otherwise they run past its end.
  const space = layoutCheck(d);
  const unitW = cduWidth(d);
  const galleryMid = (spanY[0] + spanY[1]) / 2;
  const galleryStart = galleryMid - CDU_GALLERY_M / 2;
  const galleryEnd = galleryMid + CDU_GALLERY_M / 2;
  const firstY =
    space.result === 'PASS'
      ? galleryMid - space.requiredM / 2 + unitW / 2
      : galleryStart + unitW / 2;
  const cduY = (i: number) => firstY + i * (unitW + CDU_GAP_M);
  const outside = (i: number) => cduY(i) + unitW / 2 > galleryEnd + 1e-6;
  const mainDia = diameter(d.flowLpm);
  const rowDia = diameter(d.flowLpm / rows);
  const unitDia = diameter(d.flowLpm / d.cduDutyUnits);
  const rackDia = diameter(d.rackFlowLpm);
  const deltaK = d.returnC - d.supplyC;
  const facilityLpm = (d.itLoadKw / (4.18 * 0.997 * deltaK)) * 60;
  const facilityDia = diameter(facilityLpm / d.cduDutyUnits);
  const hallSpace = ext ? layoutCheck(ext, d) : space;

  // A new zone: its rack row(s) continue the existing rows, with its own secondary loop above the
  // existing one. In-row units stand at the start of its first row; gallery units follow the
  // existing ones and run past the gallery's end when it is full.
  const extRows = ext ? (ext.rackCount > 12 ? 2 : 1) : 0;
  const extPerRow = ext ? Math.ceil(ext.rackCount / extRows) : 0;
  const extInRow = ext ? inRow(ext) : false;
  const extUnitW = ext ? cduWidth(ext) : 0;
  const extX0 = rowEnd + 1.2;
  const extRackX0 = extX0 + (ext && extInRow ? ext.cduUnits * extUnitW : 0);
  const extEnd = extRackX0 + extPerRow * RACK.w;
  const extGalleryY = (i: number) =>
    cduY(d.cduUnits - 1) + unitW / 2 + CDU_GAP_M + extUnitW / 2 + i * (extUnitW + CDU_GAP_M);
  const extOutside = (i: number) => extGalleryY(i) + extUnitW / 2 > galleryEnd + 1e-6;
  const extUnitAt = (i: number): V3 =>
    extInRow
      ? [extX0 + i * extUnitW + extUnitW / 2, rowY(0), CDU.h / 2]
      : [cduX, extGalleryY(i), CDU.h / 2];

  out.push(
    '#usda 1.0',
    '(',
    '    defaultPrim = "CoolingSystem"',
    '    metersPerUnit = 1',
    '    upAxis = "Z"',
    `    doc = ${str(`NOVA lab: liquid cooling configuration${design.runReference ? ` ${design.runReference}` : ''}${hall ? `, new zone in ${hall.name} as built` : ''}. Synthetic schematic geometry generated from the checked design; values are illustrative lab values.`)}`,
    ')',
    '',
    'def Xform "CoolingSystem" (',
    '    kind = "assembly"',
    '    displayName = "Liquid cooling system"',
    ')',
    '{',
    ...attrs(1, {
      source: 'synthetic',
      runReference: design.runReference ?? '',
      ...(hall ? { hall: hall.name, asBuiltRun: d.runReference ?? '' } : {}),
      itLoadKw: d.itLoadKw + (ext?.itLoadKw ?? 0),
      coolant: d.coolant,
      supplyC: d.supplyC,
      returnC: d.returnC,
      flowLpm: d.flowLpm,
      facilityWaterC: d.facilityWaterC,
      ...(d.sysml?.system ? { sysmlElementId: d.sysml.system } : {}),
      ...(design.baseline
        ? {
            baselineRun: design.baseline.runReference,
            changes: design.baseline.changes.join('; ') || 'no change',
          }
        : {}),
      spaceCheck: hallSpace.result,
      spaceFinding: hallSpace.finding,
    }),
    '',
    '    def Scope "Looks"',
    '    {',
  );
  for (const [name, c] of Object.entries(LOOKS))
    out.push(
      `        def Material ${str(name)}`,
      '        {',
      `            token outputs:surface.connect = </CoolingSystem/Looks/${name}/Surface.outputs:surface>`,
      '            def Shader "Surface"',
      '            {',
      '                uniform token info:id = "UsdPreviewSurface"',
      `                color3f inputs:diffuseColor = ${v3(c)}`,
      `                float inputs:metallic = ${name.startsWith('Cdu') || name.startsWith('Rack') ? 0.4 : name === 'Floor' ? 0 : 0.6}`,
      `                float inputs:roughness = ${name === 'Floor' ? 0.9 : 0.35}`,
      ...(name === 'Gallery' ? ['                float inputs:opacity = 0.45'] : []),
      '                token outputs:surface',
      '            }',
      '        }',
    );
  out.push('    }', '');

  const minX = cduX - CDU.d / 2 - 1.6;
  const maxX = (ext ? extEnd : rowEnd) + 1.0;
  const minY = Math.min(spanY[0], galleryStart) - 1.2;
  const maxY =
    Math.max(
      spanY[1],
      galleryEnd,
      cduY(d.cduUnits - 1) + unitW / 2,
      ext && !extInRow ? extGalleryY(ext.cduUnits - 1) + extUnitW / 2 : -Infinity,
    ) + 1.2;
  out.push(
    ...box(
      1,
      'Floor',
      [maxX - minX, maxY - minY, 0.05],
      [(minX + maxX) / 2, (minY + maxY) / 2, -0.025],
      'Floor',
    ),
    '',
    '    def Xform "Racks"',
    '    {',
  );
  for (let i = 0; i < d.rackCount; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const name = `Rack_${String(i + 1).padStart(2, '0')}`;
    out.push(
      ...box(
        2,
        name,
        [RACK.w * 0.96, RACK.d, RACK.h],
        [col * RACK.w + RACK.w / 2, rowY(row), RACK.h / 2],
        'Rack',
        { heatLoadKw: d.itLoadKw / d.rackCount, flowLpm: d.rackFlowLpm },
        `Rack ${i + 1}`,
      ),
    );
  }
  out.push(
    '    }',
    '',
    ...box(
      1,
      'CDU_Gallery',
      [CDU.d + 0.4, CDU_GALLERY_M, 0.02],
      [cduX, galleryMid, 0.012],
      'Gallery',
      { lengthM: CDU_GALLERY_M, requiredM: hallSpace.requiredM, spaceCheck: hallSpace.result },
      'CDU gallery',
    ),
    '',
    '    def Xform "CoolantDistributionUnits"',
    '    {',
  );
  for (let i = 0; i < d.cduUnits; i++) {
    const duty = i < d.cduDutyUnits;
    out.push(
      ...box(
        2,
        `CDU_${i + 1}`,
        [CDU.d, unitW * 0.96, CDU.h],
        [cduX, cduY(i), CDU.h / 2],
        outside(i) ? 'Clash' : duty ? 'CduDuty' : 'CduStandby',
        {
          model: d.cduModel,
          role: duty ? 'duty' : 'standby',
          ...(outside(i) ? { clash: 'outside the CDU gallery' } : {}),
          ...(d.cduCapacityKw ? { capacityKw: d.cduCapacityKw } : {}),
          ...(d.sysml?.cdu ? { sysmlElementId: d.sysml.cdu } : {}),
        },
        `${d.cduModel} ${i + 1} (${duty ? 'duty' : 'standby'})`,
      ),
    );
  }
  out.push('    }', '');

  // Secondary loop: per-CDU risers, a distribution header across the rows, a header per row,
  // and one supply and one return drop per rack.
  const loop = (kind: 'Supply' | 'Return', z: number, temp: number) => {
    const p: string[] = [`    def Xform ${str(`Secondary${kind}`)}`, '    {'];
    p.push(...attrs(2, { temperatureC: temp, flowLpm: d.flowLpm, coolant: d.coolant }));
    const dy = kind === 'Return' ? 0.15 : -0.15;
    for (let i = 0; i < d.cduUnits; i++) {
      const y = cduY(i) + dy;
      p.push(
        ...pipe(
          2,
          `Unit_${i + 1}_Out`,
          [cduX + CDU.d / 2, y, CDU.h - 0.2],
          [riserX, y, CDU.h - 0.2],
          unitDia,
          kind,
        ),
        ...pipe(2, `Unit_${i + 1}_Riser`, [riserX, y, CDU.h - 0.2], [riserX, y, z], unitDia, kind),
      );
    }
    p.push(...pipe(2, 'Distribution', [riserX, spanY[0], z], [riserX, spanY[1], z], mainDia, kind));
    for (let row = 0; row < rows; row++) {
      const y = rowY(row) + (kind === 'Supply' ? -0.2 : 0.2);
      p.push(
        ...pipe(2, `Row_${row + 1}_Feed`, [riserX, rowY(row), z], [riserX, y, z], rowDia, kind),
        ...pipe(2, `Row_${row + 1}_Header`, [riserX, y, z], [rowEnd, y, z], rowDia, kind, {
          flowLpm: d.flowLpm / rows,
        }),
      );
      for (let col = 0; col < perRow && row * perRow + col < d.rackCount; col++) {
        const x = col * RACK.w + RACK.w / 2 + (kind === 'Supply' ? -0.1 : 0.1);
        p.push(
          ...pipe(
            2,
            `Rack_${String(row * perRow + col + 1).padStart(2, '0')}_Drop`,
            [x, y, z],
            [x, y, RACK.h],
            rackDia,
            kind,
            {
              flowLpm: d.rackFlowLpm,
            },
          ),
        );
      }
    }
    p.push('    }', '');
    return p;
  };
  out.push(...loop('Supply', zSupply, d.supplyC), ...loop('Return', zReturn, d.returnC));

  // Primary side: facility water to each duty CDU from a wall header.
  out.push('    def Xform "FacilityWater"', '    {', ...attrs(2, { supplyC: d.facilityWaterC }));
  const wallX = minX + 0.4;
  for (let i = 0; i < d.cduUnits; i++)
    for (const [k, z] of [
      ['Supply', 0.35],
      ['Return', 0.6],
    ] as const)
      out.push(
        ...pipe(
          2,
          `Unit_${i + 1}_${k}`,
          [wallX, cduY(i), z],
          [cduX - CDU.d / 2, cduY(i), z],
          facilityDia,
          'Facility',
        ),
      );
  out.push(
    ...pipe(
      2,
      'Wall_Header_Supply',
      [wallX, spanY[0], 0.35],
      [wallX, spanY[1], 0.35],
      diameter(facilityLpm),
      'Facility',
    ),
    ...pipe(
      2,
      'Wall_Header_Return',
      [wallX, spanY[0], 0.6],
      [wallX, spanY[1], 0.6],
      diameter(facilityLpm),
      'Facility',
    ),
    '    }',
  );
  if (ext) out.push('', ...extension(ext));
  out.push('}', '');
  return out.join('\n');

  function extension(z: CoolingDesign) {
    const p: string[] = [
      '    def Xform "Extension" (',
      `        displayName = ${str(`New zone${z.runReference ? ` ${z.runReference}` : ''}`)}`,
      '    )',
      '    {',
      ...attrs(2, {
        runReference: z.runReference ?? '',
        itLoadKw: z.itLoadKw,
        rackCount: z.rackCount,
        coolant: z.coolant,
        supplyC: z.supplyC,
        returnC: z.returnC,
        flowLpm: z.flowLpm,
        cduPlacement: extInRow ? 'in-row' : 'CDU gallery',
        ...(z.sysml?.system ? { sysmlElementId: z.sysml.system } : {}),
      }),
      '        def Xform "Racks"',
      '        {',
    ];
    const rackKw = z.itLoadKw / z.rackCount;
    const dense = rackKw > 1.2 * (d.itLoadKw / d.rackCount);
    const rackAt = (i: number): [number, number] => [
      extRackX0 + (i % extPerRow) * RACK.w + RACK.w / 2,
      rowY(Math.floor(i / extPerRow)),
    ];
    for (let i = 0; i < z.rackCount; i++) {
      const [x, y] = rackAt(i);
      p.push(
        ...box(
          3,
          `Rack_${String(i + 1).padStart(2, '0')}`,
          [RACK.w * 0.96, RACK.d, RACK.h],
          [x, y, RACK.h / 2],
          dense ? 'RackDense' : 'Rack',
          { heatLoadKw: rackKw, flowLpm: z.rackFlowLpm },
          `New rack ${i + 1} (${Math.round(rackKw)} kW)`,
        ),
      );
    }
    p.push('        }', '        def Xform "CoolantDistributionUnits"', '        {');
    for (let i = 0; i < z.cduUnits; i++) {
      const duty = i < z.cduDutyUnits;
      const clash = !extInRow && extOutside(i);
      p.push(
        ...box(
          3,
          `CDU_${i + 1}`,
          extInRow ? [extUnitW * 0.96, RACK.d, CDU.h] : [CDU.d, extUnitW * 0.96, CDU.h],
          extUnitAt(i),
          clash ? 'Clash' : duty ? 'CduDuty' : 'CduStandby',
          {
            model: z.cduModel,
            role: duty ? 'duty' : 'standby',
            placement: extInRow ? 'in-row' : 'CDU gallery',
            ...(clash ? { clash: 'outside the CDU gallery' } : {}),
            ...(z.cduCapacityKw ? { capacityKw: z.cduCapacityKw } : {}),
          },
          `${z.cduModel} ${i + 1} (${duty ? 'duty' : 'standby'}, new zone)`,
        ),
      );
    }
    p.push('        }');

    // Its own secondary loop, one level above the existing one.
    const mainDiaZ = diameter(z.flowLpm);
    const rowDiaZ = diameter(z.flowLpm / extRows);
    const unitDiaZ = diameter(z.flowLpm / z.cduDutyUnits);
    const rackDiaZ = diameter(z.rackFlowLpm);
    const galleryRiserX = -0.85;
    for (const kind of ['Supply', 'Return'] as const) {
      const zz = RACK.h + (kind === 'Supply' ? 0.95 : 1.25);
      const yo = kind === 'Supply' ? -0.2 : 0.2;
      p.push(
        `        def Xform ${str(`Secondary${kind}`)}`,
        '        {',
        ...attrs(3, {
          temperatureC: kind === 'Supply' ? z.supplyC : z.returnC,
          flowLpm: z.flowLpm,
          coolant: z.coolant,
        }),
      );
      const headerFrom = extInRow ? extX0 : galleryRiserX;
      for (let i = 0; i < z.cduUnits; i++) {
        const [ux, uy] = extUnitAt(i);
        if (extInRow) {
          const x = ux + (kind === 'Supply' ? -0.1 : 0.1);
          p.push(
            ...pipe(
              3,
              `Unit_${i + 1}_Riser`,
              [x, uy + yo, CDU.h],
              [x, uy + yo, zz],
              unitDiaZ,
              kind,
            ),
          );
        } else {
          const y = uy + (kind === 'Return' ? 0.15 : -0.15);
          p.push(
            ...pipe(
              3,
              `Unit_${i + 1}_Out`,
              [cduX + CDU.d / 2, y, CDU.h - 0.2],
              [galleryRiserX, y, CDU.h - 0.2],
              unitDiaZ,
              kind,
            ),
            ...pipe(
              3,
              `Unit_${i + 1}_Riser`,
              [galleryRiserX, y, CDU.h - 0.2],
              [galleryRiserX, y, zz],
              unitDiaZ,
              kind,
            ),
          );
        }
      }
      // Distribution along the gallery (or across the rows) to the row headers.
      const ys = [
        ...Array.from({ length: extRows }, (_, r) => rowY(r) + yo),
        ...(extInRow
          ? []
          : Array.from(
              { length: z.cduUnits },
              (_, i) => extGalleryY(i) + (kind === 'Return' ? 0.15 : -0.15),
            )),
      ];
      const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
      if (y1 - y0 > 1e-6)
        p.push(
          ...pipe(3, 'Distribution', [headerFrom, y0, zz], [headerFrom, y1, zz], mainDiaZ, kind),
        );
      for (let r = 0; r < extRows; r++) {
        const y = rowY(r) + yo;
        p.push(
          ...pipe(3, `Row_${r + 1}_Header`, [headerFrom, y, zz], [extEnd, y, zz], rowDiaZ, kind, {
            flowLpm: z.flowLpm / extRows,
          }),
        );
      }
      for (let i = 0; i < z.rackCount; i++) {
        const [x, y] = rackAt(i);
        const xx = x + (kind === 'Supply' ? -0.1 : 0.1);
        p.push(
          ...pipe(
            3,
            `Rack_${String(i + 1).padStart(2, '0')}_Drop`,
            [xx, y + yo, zz],
            [xx, y + yo, RACK.h],
            rackDiaZ,
            kind,
            { flowLpm: z.rackFlowLpm },
          ),
        );
      }
      p.push('        }');
    }

    // Facility water to the new units: along the wall to gallery units, or to the in-row units
    // along the back of the first row.
    const deltaZ = z.returnC - z.supplyC;
    const facilityZ = (z.itLoadKw / (4.18 * 0.997 * deltaZ)) * 60;
    const fDia = diameter(facilityZ / z.cduDutyUnits);
    const wallX = minX + 0.4;
    p.push('        def Xform "FacilityWater"', '        {');
    for (const [k, fz] of [
      ['Supply', 0.35],
      ['Return', 0.6],
    ] as const) {
      if (extInRow) {
        const backY = rowY(0) - RACK.d / 2 - 0.25;
        const lastX = extUnitAt(z.cduUnits - 1)[0];
        p.push(
          ...pipe(
            3,
            `Wall_Link_${k}`,
            [wallX, spanY[0], fz],
            [wallX, backY, fz],
            diameter(facilityZ),
            'Facility',
          ),
          ...pipe(
            3,
            `Header_${k}`,
            [wallX, backY, fz],
            [lastX, backY, fz],
            diameter(facilityZ),
            'Facility',
          ),
        );
        for (let i = 0; i < z.cduUnits; i++) {
          const ux = extUnitAt(i)[0] + (k === 'Supply' ? -0.1 : 0.1);
          p.push(
            ...pipe(
              3,
              `Unit_${i + 1}_${k}`,
              [ux, backY, fz],
              [ux, rowY(0) - RACK.d / 2, fz],
              fDia,
              'Facility',
            ),
          );
        }
      } else {
        const lastY = extGalleryY(z.cduUnits - 1);
        if (lastY > spanY[1])
          p.push(
            ...pipe(
              3,
              `Wall_Extension_${k}`,
              [wallX, spanY[1], fz],
              [wallX, lastY, fz],
              diameter(facilityZ),
              'Facility',
            ),
          );
        for (let i = 0; i < z.cduUnits; i++)
          p.push(
            ...pipe(
              3,
              `Unit_${i + 1}_${k}`,
              [wallX, extGalleryY(i), fz],
              [cduX - CDU.d / 2, extGalleryY(i), fz],
              fDia,
              'Facility',
            ),
          );
      }
    }
    p.push('        }', '    }');
    return p;
  }
}
