/**
 * Synthetic process definitions for the orchestration lab.
 *
 * Neutral, invented engineering processes. Variable identifiers follow the ITEROP convention
 * documented in FD04 examples (`start_<id>` for start-form values, `<taskId>_<id>` for task
 * outputs), so the same definitions can be modelled in a sandbox tenant later.
 */
export type VariableType = 'TEXT' | 'TEXT_AREA' | 'SELECT' | 'INTEGER' | 'DECIMAL';
export type VariableDefinition = {
  id: string;
  name: string;
  description: string;
  type: VariableType;
  required: boolean;
  /** FD04 encodes selectable values as one string separated by `##`. */
  values?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  unit?: string;
};
export type ToolName = 'coolant' | 'cdu' | 'loop' | 'validator';
export type TaskDefinition = {
  id: string;
  name: string;
  description: string;
  priority: number;
  /** Automated tasks are completed by NOVA after approval; signature tasks are human-only. */
  tool?: ToolName;
  signature?: boolean;
  /** Who the task is assigned to. NOVA acts as the operator (`self`), never as the reviewer. */
  assignee: 'self' | 'reviewer';
  expectedFields: VariableDefinition[];
};
export type ProcessDefinition = {
  key: string;
  name: string;
  description: string;
  version: number;
  icon: string;
  identificatorPrefix: string;
  startVariables: VariableDefinition[];
  tasks: TaskDefinition[];
  /** Task routed back to the operator when the signature task is rejected. */
  rework?: TaskDefinition;
};

const v = (
  id: string,
  name: string,
  type: VariableType,
  description: string,
  extra: Partial<VariableDefinition> = {},
): VariableDefinition => ({ id, name, type, description, required: true, ...extra });

export const COOLING_CHAIN = 'syn-cooling-chain';
export const REQUIREMENT_INTAKE = 'syn-requirement-intake';

export const definitions: readonly ProcessDefinition[] = [
  {
    key: COOLING_CHAIN,
    name: 'Liquid cooling configuration chain',
    description:
      'Configures a direct liquid cooling loop for a rack group: coolant, coolant distribution units, secondary loop, system check and engineering sign-off.',
    version: 1,
    icon: 'thermometer',
    identificatorPrefix: 'COOL',
    startVariables: [
      v('start_itLoadKw', 'IT heat load', 'DECIMAL', 'Heat to remove from the racks.', {
        min: '50',
        max: '20000',
        unit: 'kW',
      }),
      v(
        'start_facilityWaterC',
        'Facility water supply',
        'DECIMAL',
        'Primary-side supply temperature.',
        { min: '10', max: '45', unit: '°C' },
      ),
      v('start_rackCount', 'Rack count', 'INTEGER', 'Racks on the secondary loop.', {
        min: '1',
        max: '500',
      }),
      v('start_redundancy', 'CDU redundancy', 'SELECT', 'Redundancy policy.', {
        values: 'N##N+1##2N',
        defaultValue: 'N+1',
      }),
      v('start_coolant', 'Coolant preference', 'SELECT', 'Requested coolant, or automatic.', {
        values: 'auto##water##PG25',
        defaultValue: 'auto',
        required: false,
      }),
    ],
    tasks: [
      {
        id: 'coolantSelection',
        name: 'Select coolant',
        description: 'Choose the secondary coolant and its design properties.',
        priority: 2,
        assignee: 'self',
        tool: 'coolant',
        expectedFields: [
          v('coolantSelection_fluid', 'Coolant', 'TEXT', 'Selected coolant.'),
          v('coolantSelection_cp', 'Specific heat', 'DECIMAL', 'kJ/(kg·K).', { unit: 'kJ/kg·K' }),
          v('coolantSelection_density', 'Density', 'DECIMAL', 'kg/m³.', { unit: 'kg/m³' }),
          v('coolantSelection_rationale', 'Rationale', 'TEXT_AREA', 'Why this coolant.'),
        ],
      },
      {
        id: 'cduSizing',
        name: 'Size coolant distribution units',
        description: 'Select the unit model and count for the heat load and redundancy policy.',
        priority: 2,
        assignee: 'self',
        tool: 'cdu',
        expectedFields: [
          v('cduSizing_model', 'Unit model', 'TEXT', 'Selected unit model.'),
          v('cduSizing_units', 'Installed units', 'INTEGER', 'Including redundant units.'),
          v('cduSizing_dutyUnits', 'Duty units', 'INTEGER', 'Units carrying the load.'),
          v('cduSizing_utilisation', 'Duty utilisation', 'DECIMAL', 'Load share per duty unit.', {
            unit: '%',
          }),
        ],
      },
      {
        id: 'loopConfiguration',
        name: 'Configure secondary loop',
        description: 'Derive supply and return temperatures and flow rates.',
        priority: 2,
        assignee: 'self',
        tool: 'loop',
        expectedFields: [
          v('loopConfiguration_supplyC', 'Secondary supply', 'DECIMAL', '°C.', { unit: '°C' }),
          v('loopConfiguration_returnC', 'Secondary return', 'DECIMAL', '°C.', { unit: '°C' }),
          v('loopConfiguration_flowLpm', 'Total flow', 'DECIMAL', 'L/min.', { unit: 'L/min' }),
          v('loopConfiguration_rackFlowLpm', 'Flow per rack', 'DECIMAL', 'L/min.', {
            unit: 'L/min',
          }),
        ],
      },
      {
        id: 'systemCheck',
        name: 'Check system limits',
        description: 'Check the configuration against the declared synthetic limits.',
        priority: 3,
        assignee: 'self',
        tool: 'validator',
        expectedFields: [
          v('systemCheck_result', 'Check result', 'SELECT', 'PASS, REVIEW or FAIL.', {
            values: 'PASS##REVIEW##FAIL',
          }),
          v('systemCheck_findings', 'Findings', 'TEXT_AREA', 'What the check found.'),
        ],
      },
      {
        id: 'engineeringSignoff',
        name: 'Engineering sign-off',
        description: 'A qualified engineer reviews and signs the configuration.',
        priority: 3,
        assignee: 'reviewer',
        signature: true,
        expectedFields: [
          v('engineeringSignoff_decision', 'Decision', 'SELECT', 'Approve or reject.', {
            values: 'Approve##Reject',
          }),
          v('engineeringSignoff_comment', 'Comment', 'TEXT_AREA', 'Reason or instruction.', {
            required: false,
          }),
        ],
      },
    ],
    rework: {
      id: 'configurationRework',
      name: 'Rework configuration',
      description:
        'The reviewer rejected the configuration. Revise the inputs and run the chain again.',
      priority: 3,
      assignee: 'self',
      expectedFields: [
        v('configurationRework_coolant', 'Revised coolant', 'SELECT', 'Coolant preference.', {
          values: 'auto##water##PG25',
        }),
        v('configurationRework_redundancy', 'Revised redundancy', 'SELECT', 'Redundancy.', {
          values: 'N##N+1##2N',
        }),
        v('configurationRework_facilityWaterC', 'Facility water supply', 'DECIMAL', '°C.', {
          min: '10',
          max: '45',
        }),
        v('configurationRework_note', 'Rework note', 'TEXT_AREA', 'What changed and why.'),
      ],
    },
  },
  {
    key: REQUIREMENT_INTAKE,
    name: 'Candidate requirement intake',
    description:
      'Registers a candidate engineering requirement with its public source for human review before it enters the system model.',
    version: 1,
    icon: 'file-check',
    identificatorPrefix: 'REQ',
    startVariables: [
      v('start_statement', 'Requirement statement', 'TEXT_AREA', 'The candidate requirement.', {
        min: '10',
        max: '1000',
      }),
      v('start_sourceReference', 'Source reference', 'TEXT', 'Where it comes from.', {
        max: '300',
      }),
    ],
    tasks: [
      {
        id: 'requirementReview',
        name: 'Review candidate requirement',
        description: 'An engineer accepts, edits or rejects the candidate.',
        priority: 2,
        assignee: 'reviewer',
        signature: true,
        expectedFields: [
          v('requirementReview_decision', 'Decision', 'SELECT', 'Decision.', {
            values: 'Accept##Edit##Reject',
          }),
        ],
      },
    ],
  },
];

export const definition = (key: string) => definitions.find((d) => d.key === key);
