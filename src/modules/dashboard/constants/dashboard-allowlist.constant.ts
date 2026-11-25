export const ALLOWED_ENTITIES = [
  'leads',
  'deals',
  'activities',
  'tasks',
] as const;
export type AllowedEntity = (typeof ALLOWED_ENTITIES)[number];

export const ALLOWED_FIELDS: Record<AllowedEntity, string[]> = {
  leads: [
    'firstName',
    'lastName',
    'email',
    'phone',
    'companyName',
    'status',
    'source',
    'score',
    'ownerId',
    'createdAt',
    'updatedAt',
  ],
  deals: [
    'title',
    'amount',
    'currency',
    'stage',
    'status',
    'probability',
    'expectedCloseDate',
    'actualCloseDate',
    'ownerId',
    'createdAt',
    'updatedAt',
  ],
  activities: [
    'type',
    'subject',
    'activityDate',
    'durationMinutes',
    'outcome',
    'performedBy',
    'entityType',
    'createdAt',
  ],
  tasks: [
    'title',
    'status',
    'priority',
    'dueDate',
    'assignedTo',
    'createdBy',
    'createdAt',
  ],
};

export const FINANCIAL_FIELDS = new Set<string>([
  'amount',
  'totalRevenue',
  'avgDealSize',
  'pipelineValue',
  'quotaAmount',
  'revenueGenerated',
  'revenueWon',
]);

export const ALLOWED_GROUP_BY: Record<AllowedEntity, string[]> = {
  leads: ['status', 'source', 'ownerId'],
  deals: ['stage', 'status', 'currency', 'ownerId'],
  activities: ['type', 'outcome', 'performedBy', 'entityType'],
  tasks: ['status', 'priority', 'assignedTo'],
};
