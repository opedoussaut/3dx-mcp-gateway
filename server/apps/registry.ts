import type { AppDomain } from '../../shared/types';

/**
 * Semantic read operations per application.
 *
 * These names are NOVA's internal intentions, NOT claims about real upstream endpoints.
 * A name only reaches a live service when a private, reviewed contract binds it to a
 * documented read operation for the operator's exact release (see docs/CONNECTING-APPS.md).
 */
export type OperationShape = 'list' | 'search' | 'detail' | 'children';
export type OperationSpec = {
  name: string;
  shape: OperationShape;
  recordKind: string;
  description: string;
  /** Allowlisted normalized fields. Anything else in an upstream row is dropped. */
  fields: readonly string[];
  /** Fields every projected row must carry, or the response is a schema mismatch. */
  required: readonly string[];
};

const taskFields = [
  'id',
  'name',
  'processId',
  'processName',
  'step',
  'status',
  'priority',
  'dueDate',
  'createdAt',
  'assignedToPrincipal',
] as const;
const datasetFields = [
  'id',
  'name',
  'description',
  'domain',
  'owner',
  'steward',
  'classification',
  'status',
  'updatedAt',
  'format',
  'lineageDeclared',
] as const;

export const operations: Record<AppDomain, readonly OperationSpec[]> = {
  ITEROP: [
    {
      name: 'iterop.list_startable_processes',
      shape: 'list',
      recordKind: 'process.definition',
      description: 'Process definitions the authenticated principal may start.',
      fields: ['id', 'name', 'category', 'version', 'description'],
      required: ['id', 'name'],
    },
    {
      name: 'iterop.list_my_tasks',
      shape: 'list',
      recordKind: 'process.task',
      description: 'Open tasks assigned to the authenticated principal.',
      fields: taskFields,
      required: ['id', 'name'],
    },
    {
      name: 'iterop.get_task',
      shape: 'detail',
      recordKind: 'process.task',
      description: 'One task visible to the authenticated principal.',
      fields: taskFields,
      required: ['id', 'name'],
    },
    {
      name: 'iterop.get_process_instance',
      shape: 'detail',
      recordKind: 'process.instance',
      description: 'Status of one process instance visible to the principal.',
      fields: [
        'id',
        'name',
        'processName',
        'status',
        'startedAt',
        'updatedAt',
        'initiator',
        'currentStep',
      ],
      required: ['id', 'name'],
    },
    {
      name: 'iterop.list_process_steps',
      shape: 'children',
      recordKind: 'process.step',
      description: 'Steps and approvals of one visible process instance.',
      fields: ['id', 'name', 'order', 'status', 'assignee', 'approval', 'dueDate', 'completedAt'],
      required: ['id', 'name'],
    },
  ],
  DATASET_CATALOG: [
    {
      name: 'catalog.search_datasets',
      shape: 'search',
      recordKind: 'catalog.dataset',
      description: 'Catalog metadata search scoped to datasets the principal may see.',
      fields: datasetFields,
      required: ['id', 'name'],
    },
    {
      name: 'catalog.get_dataset',
      shape: 'detail',
      recordKind: 'catalog.dataset',
      description: 'Metadata of one dataset: owner, description, classification, freshness.',
      fields: datasetFields,
      required: ['id', 'name'],
    },
    {
      name: 'catalog.list_related',
      shape: 'children',
      recordKind: 'catalog.relation',
      description: 'Datasets and assets declared as related to one dataset.',
      fields: ['id', 'name', 'relation', 'assetType', 'direction'],
      required: ['id', 'name'],
    },
    {
      name: 'catalog.get_lineage',
      shape: 'children',
      recordKind: 'catalog.lineage',
      description: 'Declared upstream and downstream lineage of one dataset.',
      fields: ['id', 'name', 'relation', 'direction', 'updatedAt'],
      required: ['id', 'name'],
    },
  ],
};

export const appLabels: Record<AppDomain, { label: string; platform: string; env: string }> = {
  ITEROP: { label: 'Business Process', platform: 'business process service', env: 'ITEROP' },
  DATASET_CATALOG: {
    label: 'Datasets Governance',
    platform: 'dataset catalog service',
    env: 'CATALOG',
  },
};

export function operation(app: AppDomain, name: string) {
  return operations[app].find((op) => op.name === name);
}
