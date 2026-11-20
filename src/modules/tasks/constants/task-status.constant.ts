export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DEFERRED = 'DEFERRED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const OPEN_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.IN_PROGRESS,
  TaskStatus.DEFERRED,
];

export const TERMINAL_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.COMPLETED,
  TaskStatus.CANCELLED,
];
