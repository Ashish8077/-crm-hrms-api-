import * as crypto from 'crypto';
import { DataScope } from '../types/data-scope.types';

export const DASHBOARD_CACHE_TTLS = {
  KPIS: 300, // 5 min
  FUNNEL: 300, // 5 min
  PERFORMANCE: 600, // 10 min
  ACTIVITIES: 180, // 3 min
  LEADERBOARD: 300, // 5 min
  REP_DASHBOARD: 180, // 3 min
  QUOTA: 300, // 5 min
  DAILY_SUMMARY: 60, // 1 min (near real-time)
  CONVERSION: 600, // 10 min
  FORECAST: 600, // 10 min
} as const;

export function buildDashboardCacheKey(
  scope: DataScope,
  endpoint: string,
  queryParams?: Record<string, unknown>,
): string {
  // 1. Sort ownerIds before hashing for consistency
  const sortedIds = scope.ownerIds
    .map((id) => id.toString())
    .sort()
    .join(',');

  const scopeHash = crypto
    .createHash('sha256')
    .update(sortedIds || 'EMPTY_SCOPE')
    .digest('hex')
    .slice(0, 8);

  // 2. Query hash
  const queryStr = queryParams
    ? Object.keys(queryParams)
        .sort()
        .map((k) => `${k}=${String(queryParams[k])}`)
        .join('&')
    : '';

  const queryHash = crypto
    .createHash('sha256')
    .update(queryStr)
    .digest('hex')
    .slice(0, 8);

  return `crm:analytics:${scope.scopeLevel}:${scopeHash}:${endpoint}:${queryHash}`;
}
