import { DealStatus } from './deal-status.constant';

export enum DealStage {
  NEW = 'NEW',
  QUALIFIED = 'QUALIFIED',
  DEMO_MEETING = 'DEMO_MEETING',
  PROPOSAL_SENT = 'PROPOSAL_SENT',
  NEGOTIATION = 'NEGOTIATION',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST',
}

export interface StageMetadata {
  order: number;
  name: string;
  defaultProbability: number;
  status: DealStatus;
  isTerminal: boolean;
}

export const STAGE_METADATA: Record<DealStage, StageMetadata> = {
  [DealStage.NEW]: {
    order: 1,
    name: 'New Opportunity',
    defaultProbability: 10,
    status: DealStatus.OPEN,
    isTerminal: false,
  },
  [DealStage.QUALIFIED]: {
    order: 2,
    name: 'Qualified',
    defaultProbability: 25,
    status: DealStatus.OPEN,
    isTerminal: false,
  },
  [DealStage.DEMO_MEETING]: {
    order: 3,
    name: 'Demo / Meeting',
    defaultProbability: 40,
    status: DealStatus.OPEN,
    isTerminal: false,
  },
  [DealStage.PROPOSAL_SENT]: {
    order: 4,
    name: 'Proposal Sent',
    defaultProbability: 60,
    status: DealStatus.OPEN,
    isTerminal: false,
  },
  [DealStage.NEGOTIATION]: {
    order: 5,
    name: 'In Negotiation',
    defaultProbability: 80,
    status: DealStatus.OPEN,
    isTerminal: false,
  },
  [DealStage.CLOSED_WON]: {
    order: 6,
    name: 'Closed Won',
    defaultProbability: 100,
    status: DealStatus.WON,
    isTerminal: true,
  },
  [DealStage.CLOSED_LOST]: {
    order: 7,
    name: 'Closed Lost',
    defaultProbability: 0,
    status: DealStatus.LOST,
    isTerminal: true,
  },
};

export const OPEN_STAGES: DealStage[] = [
  DealStage.NEW,
  DealStage.QUALIFIED,
  DealStage.DEMO_MEETING,
  DealStage.PROPOSAL_SENT,
  DealStage.NEGOTIATION,
];

export const TERMINAL_STAGES: DealStage[] = [
  DealStage.CLOSED_WON,
  DealStage.CLOSED_LOST,
];

export const STAGE_ORDER: Record<DealStage, number> = Object.entries(
  STAGE_METADATA,
).reduce(
  (acc, [stage, meta]) => ({ ...acc, [stage]: meta.order }),
  {} as Record<DealStage, number>,
);

export const DEFAULT_STAGE_PROBABILITIES: Record<DealStage, number> =
  Object.entries(STAGE_METADATA).reduce(
    (acc, [stage, meta]) => ({ ...acc, [stage]: meta.defaultProbability }),
    {} as Record<DealStage, number>,
  );

export const STAGE_STATUS_MAP: Record<DealStage, DealStatus> = Object.entries(
  STAGE_METADATA,
).reduce(
  (acc, [stage, meta]) => ({ ...acc, [stage]: meta.status }),
  {} as Record<DealStage, DealStatus>,
);
