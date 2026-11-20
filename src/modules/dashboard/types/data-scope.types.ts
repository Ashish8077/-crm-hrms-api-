import { Types } from 'mongoose';

export type ScopeLevel = 'SELF' | 'TEAM' | 'ORGANIZATION';

export interface DataScope {
  scopeLevel: ScopeLevel;
  ownerIds: Types.ObjectId[];
  callerUserId: Types.ObjectId;
  canViewFinancial: boolean;
}

