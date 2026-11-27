import { Types } from 'mongoose';
import { RegularizationStatus } from '../../attendance/constants/attendance.constant';
import { LeaveRequestStatus } from '../../leaves/constants/leaves.constant';
import { WeeklyOffConfigLean } from '../../work-schedules/mappers/weekly-off-config.mapper';
import { WEEKLY_OFF_CONSTANTS } from '../../work-schedules/constants/weekly-off.constant';
import { WeeklyOffCalculationUtil } from '../../work-schedules/utils/weekly-off-calculation.util';

export interface BranchCalendarLookup {
  weeklyOffConfigsByBranch: Map<string, WeeklyOffConfigLean[]>;
  companyWeeklyOffConfigs: WeeklyOffConfigLean[];
  holidaysByBranch: Map<string, Set<string>>;
  globalHolidays: Set<string>;
}

export interface VerifiedRegularizationRecord {
  employeeId: Types.ObjectId;
  attendanceDate: string;
  status: RegularizationStatus;
}

export const PAYROLL_INCLUDED_LEAVE_STATUSES: LeaveRequestStatus[] = [
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.CANCELLATION_REQUESTED,
];

/**
 * Rounds day counts cleanly to 2 decimal places (avoids binary floating drift on 0.5 increments).
 */
export function roundPayrollDays(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildBranchCalendarLookup(
  holidays: Array<{ date: string; branchId: Types.ObjectId | null }>,
  weeklyOffConfigs: WeeklyOffConfigLean[],
): BranchCalendarLookup {
  const globalHolidays = new Set<string>();
  const holidaysByBranch = new Map<string, Set<string>>();

  for (const holiday of holidays) {
    if (!holiday.branchId) {
      globalHolidays.add(holiday.date);
    } else {
      const branchKey = holiday.branchId.toHexString();
      let set = holidaysByBranch.get(branchKey);
      if (!set) {
        set = new Set<string>();
        holidaysByBranch.set(branchKey, set);
      }
      set.add(holiday.date);
    }
  }

  const companyWeeklyOffConfigs: WeeklyOffConfigLean[] = [];
  const weeklyOffConfigsByBranch = new Map<string, WeeklyOffConfigLean[]>();

  for (const cfg of weeklyOffConfigs) {
    if (!cfg.branchId) {
      companyWeeklyOffConfigs.push(cfg);
    } else {
      const branchKey = cfg.branchId.toHexString();
      const list = weeklyOffConfigsByBranch.get(branchKey);
      if (list) {
        list.push(cfg);
      } else {
        weeklyOffConfigsByBranch.set(branchKey, [cfg]);
      }
    }
  }

  return {
    weeklyOffConfigsByBranch,
    companyWeeklyOffConfigs,
    holidaysByBranch,
    globalHolidays,
  };
}

export function resolveBranchDayStatus(
  branchIdStr: string,
  dateStr: string,
  lookup: BranchCalendarLookup,
  cache: Map<string, { isWeeklyOff: boolean; isHoliday: boolean }>,
): { isWeeklyOff: boolean; isHoliday: boolean } {
  const cacheKey = `${branchIdStr}:${dateStr}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const isHoliday =
    lookup.globalHolidays.has(dateStr) ||
    Boolean(lookup.holidaysByBranch.get(branchIdStr)?.has(dateStr));

  const branchCfgs = lookup.weeklyOffConfigsByBranch.get(branchIdStr) ?? [];
  const matchedBranchCfg = branchCfgs.find(
    (cfg) =>
      cfg.effectiveFrom <= dateStr &&
      (cfg.effectiveTo === null || cfg.effectiveTo >= dateStr),
  );

  let isWeeklyOff: boolean;
  if (matchedBranchCfg) {
    isWeeklyOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
      dateStr,
      matchedBranchCfg.days,
    );
  } else {
    const matchedCompanyCfg = lookup.companyWeeklyOffConfigs.find(
      (cfg) =>
        cfg.effectiveFrom <= dateStr &&
        (cfg.effectiveTo === null || cfg.effectiveTo >= dateStr),
    );
    if (matchedCompanyCfg) {
      isWeeklyOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
        dateStr,
        matchedCompanyCfg.days,
      );
    } else {
      isWeeklyOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
        dateStr,
        WEEKLY_OFF_CONSTANTS.DEFAULT_WEEKLY_OFF_DAYS,
      );
    }
  }

  const result = { isWeeklyOff, isHoliday };
  cache.set(cacheKey, result);
  return result;
}

export function isVerifiedApprovedRegularization(
  reg: VerifiedRegularizationRecord | undefined,
  employeeId: Types.ObjectId,
  attendanceDate: string,
): boolean {
  if (!reg) return false;
  return (
    reg.status === RegularizationStatus.APPROVED &&
    reg.employeeId.equals(employeeId) &&
    reg.attendanceDate === attendanceDate
  );
}
