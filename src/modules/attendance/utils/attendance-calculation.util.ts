import * as net from 'net';
import {
  ATTENDANCE_CONSTANTS,
  AttendanceStatus,
} from '../constants/attendance.constant';

export interface ShiftCalculationParams {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isOvernight: boolean;
  gracePeriodMinutes: number;
  minWorkMinutesForFullDay: number;
  minWorkMinutesForHalfDay: number;
  overtimeThresholdMinutes: number;
}

export interface ShiftWindow {
  shiftStart: Date;
  shiftEnd: Date;
  gracePeriodEnd: Date;
}

export class AttendanceCalculationUtil {
  private static readonly dateFormatterCache = new Map<
    string,
    Intl.DateTimeFormat
  >();

  private static readonly offsetFormatterCache = new Map<
    string,
    Intl.DateTimeFormat
  >();

  private static getOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
    let formatter = this.offsetFormatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset',
      });
      this.offsetFormatterCache.set(timeZone, formatter);
    }
    return formatter;
  }

  private static getTimeZoneOffsetMs(date: Date, timeZone: string): number {
    const formatter = this.getOffsetFormatter(timeZone);
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    const match = tzPart?.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (!match) return 0;
    const sign = match[1] === '+' ? 1 : -1;
    const offsetHours = Number(match[2] || 0);
    const offsetMinutes = Number(match[3] || 0);
    return sign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;
  }

  /**
   * Formats a Date object to YYYY-MM-DD representation in the given timezone (defaults to Asia/Kolkata).
   */
  static getAttendanceDateString(
    date: Date,
    timeZone: string = ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
  ): string {
    let formatter = this.dateFormatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      this.dateFormatterCache.set(timeZone, formatter);
    }
    return formatter.format(date);
  }

  private static readonly zonedIsoFormatterCache = new Map<
    string,
    Intl.DateTimeFormat
  >();

  private static getZonedIsoFormatter(timeZone: string): Intl.DateTimeFormat {
    let formatter = this.zonedIsoFormatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
        timeZoneName: 'longOffset',
      });
      this.zonedIsoFormatterCache.set(timeZone, formatter);
    }
    return formatter;
  }

  /**
   * Formats a Date object or ISO timestamp string into an ISO 8601 string representing
   * the specified timezone's wall-clock time and offset (e.g. 2026-10-21T17:14:52.717+05:30).
   * Discovers the timezone offset dynamically via standard Intl APIs without hardcoded offsets.
   */
  static formatZonedISO(
    date: Date | string | null | undefined,
    timeZone: string = ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
  ): string | null {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;

    const formatter = this.getZonedIsoFormatter(timeZone);
    const parts = formatter.formatToParts(d);
    const getPart = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((p) => p.type === type)?.value;

    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    let hour = getPart('hour');
    if (hour === '24') hour = '00';
    const minute = getPart('minute');
    const second = getPart('second');
    const millisecond = getPart('fractionalSecond') || '000';
    const tzName = getPart('timeZoneName') || 'GMT';
    const tzMatch = tzName.match(/GMT([+-]\d{1,2}):?(\d{2})?/);

    let offset = '+00:00';
    if (tzMatch) {
      const sign = tzMatch[1].startsWith('-') ? '-' : '+';
      const h = tzMatch[1].replace(/[+-]/, '').padStart(2, '0');
      const m = (tzMatch[2] || '00').padStart(2, '0');
      offset = `${sign}${h}:${m}`;
    }

    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}${offset}`;
  }

  /**
   * Gets normalized Date object (midnight of the attendanceDate in the configured business timezone).
   */
  static getNormalizedDate(
    attendanceDate: string,
    timeZone: string = ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
  ): Date {
    return this.parseZonedDateTime(attendanceDate, '00:00', timeZone);
  }

  /**
   * Computes the next calendar date string (YYYY-MM-DD) for a given date string.
   */
  static getNextDateString(dateString: string): string {
    const [year, month, day] = dateString.split('-').map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
    return this.getAttendanceDateString(nextDate, 'UTC');
  }

  /**
   * Calculates calendar day difference between two YYYY-MM-DD date strings (dateStr1 - dateStr2).
   * E.g., ('2026-10-27', '2026-10-15') returns 12.
   */
  static calculateCalendarDayDifference(
    dateStr1: string,
    dateStr2: string,
  ): number {
    const [y1, m1, d1] = dateStr1.split('-').map(Number);
    const [y2, m2, d2] = dateStr2.split('-').map(Number);
    const utc1 = Date.UTC(y1, m1 - 1, d1);
    const utc2 = Date.UTC(y2, m2 - 1, d2);
    return Math.round((utc1 - utc2) / (1000 * 60 * 60 * 24));
  }

  /**
   * Determines whether a given YYYY-MM-DD date string represents a weekly off (Sunday = 0).
   */
  static isWeeklyOff(dateString: string): boolean {
    const [year, month, day] = dateString.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return dayOfWeek === 0; // Sunday
  }

  /**
   * Parses a calendar date string (YYYY-MM-DD) and a wall-clock time string (HH:mm)
   * in a given IANA timezone (defaults to Asia/Kolkata) into an absolute UTC Date object.
   * Discovers the exact timezone offset dynamically without hardcoded offsets.
   */
  static parseZonedDateTime(
    dateString: string,
    timeString: string,
    timeZone: string = ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
  ): Date {
    const [year, month, day] = dateString.split('-').map(Number);
    const [hours, minutes] = timeString.split(':').map(Number);
    const naiveUtcMs = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);

    const initialOffset = this.getTimeZoneOffsetMs(
      new Date(naiveUtcMs),
      timeZone,
    );
    const candidate = new Date(naiveUtcMs - initialOffset);
    const refinedOffset = this.getTimeZoneOffsetMs(candidate, timeZone);
    if (refinedOffset !== initialOffset) {
      return new Date(naiveUtcMs - refinedOffset);
    }
    return candidate;
  }

  /**
   * Robust punch timestamp parser.
   * Converts incoming punch timestamps from various client formats into a normalized UTC Date:
   * 1. Simple time string: "09:00" or "09:00:00" -> resolved against attendanceDate in business timeZone (Asia/Kolkata).
   *    Example: "09:00" on "2026-10-15" in Asia/Kolkata (+05:30) becomes 2026-10-15T03:30:00.000Z.
   * 2. Naive local ISO string without timezone or offset: "2026-10-15T09:00:00" -> resolved in business timeZone.
   *    Example: "2026-10-15T09:00:00" in Asia/Kolkata becomes 2026-10-15T03:30:00.000Z.
   * 3. Full ISO string with explicit timezone offset: "2026-10-15T09:00:00+05:30" -> parsed to UTC.
   *    Example: becomes 2026-10-15T03:30:00.000Z.
   * 4. Full UTC ISO timestamp with "Z": "2026-10-15T03:30:00.000Z" -> parsed to UTC.
   */
  static parsePunchTimestamp(
    input: string | Date | null | undefined,
    attendanceDate?: string,
    timeZone: string = ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
  ): Date | null {
    if (!input) return null;
    if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

    const trimmed = input.trim();
    if (!trimmed) return null;

    // Case 1: Simple 24h or 12h time-only string: "09:00", "09:00:00", "09:00 AM", "6:00 PM"
    const timeOnlyMatch = trimmed.match(
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?$/i,
    );
    if (timeOnlyMatch) {
      const targetDate =
        attendanceDate || this.getAttendanceDateString(new Date(), timeZone);
      let rawHours = parseInt(timeOnlyMatch[1], 10);
      const minutes = timeOnlyMatch[2];
      const meridiem = timeOnlyMatch[4]?.toUpperCase();

      if (meridiem) {
        if (meridiem === 'PM' && rawHours < 12) rawHours += 12;
        if (meridiem === 'AM' && rawHours === 12) rawHours = 0;
      }

      const hours = rawHours.toString().padStart(2, '0');
      return this.parseZonedDateTime(
        targetDate,
        `${hours}:${minutes}`,
        timeZone,
      );
    }

    // Case 2: Naive local ISO datetime without timezone/offset (e.g. "2026-10-15T09:00:00" or "2026-10-15 09:00:00")
    // Notice: NO "Z", NO "+HH:mm", NO "-HH:mm" at the end!
    const naiveIsoMatch = trimmed.match(
      /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/,
    );
    if (naiveIsoMatch) {
      const datePart = naiveIsoMatch[1];
      const hours = naiveIsoMatch[2].padStart(2, '0');
      const minutes = naiveIsoMatch[3];
      return this.parseZonedDateTime(datePart, `${hours}:${minutes}`, timeZone);
    }

    // Case 3: Standard ISO string with offset or UTC Z (e.g. "2026-10-15T09:00:00+05:30" or "2026-10-15T03:30:00.000Z")
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return null;
  }

  /**
   * Computes the absolute Shift start, end, and grace period timestamps for an attendance date.
   * Shift startTime and endTime are interpreted in the business timezone (Asia/Kolkata)
   * and converted to precise UTC timestamps.
   */
  static getShiftWindow(
    attendanceDate: string,
    shift: ShiftCalculationParams,
    timeZone: string = ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
  ): ShiftWindow {
    const shiftStart = this.parseZonedDateTime(
      attendanceDate,
      shift.startTime,
      timeZone,
    );

    let endDateString = attendanceDate;
    if (shift.isOvernight) {
      endDateString = this.getNextDateString(attendanceDate);
    }

    const shiftEnd = this.parseZonedDateTime(
      endDateString,
      shift.endTime,
      timeZone,
    );
    const gracePeriodEnd = new Date(
      shiftStart.getTime() + shift.gracePeriodMinutes * 60 * 1000,
    );

    return {
      shiftStart,
      shiftEnd,
      gracePeriodEnd,
    };
  }

  /**
   * Calculates the rounded duration in minutes between two timestamps.
   * Uses Math.round to avoid downward floor truncation bias (e.g. 3m 55s rounds to 4m, not 3m).
   */
  static calculateDurationMinutes(start: Date, end: Date): number {
    const diffMs = Math.max(0, end.getTime() - start.getTime());
    return Math.round(diffMs / (60 * 1000));
  }

  /**
   * Calculates the exact duration in seconds between two timestamps.
   */
  static calculateDurationSeconds(start: Date, end: Date): number {
    const diffMs = Math.max(0, end.getTime() - start.getTime());
    return Math.round(diffMs / 1000);
  }

  /**
   * Calculates late marking and late minutes relative to shift start and grace period.
   *
   * Standard Production Rule (Threshold Model):
   * A grace period is an attendance threshold (buffer), NOT a deduction from penalty minutes.
   * - If checkInTime <= gracePeriodEnd: employee is NOT late (isLate: false, lateMinutes: 0).
   * - If checkInTime > gracePeriodEnd: employee IS late (isLate: true), and late minutes are
   *   measured from the official shift start time (e.g. 10:26:50 check-in for a 10:00:00 shift
   *   with 15m grace is measured from 10:00:00, yielding 27 rounded minutes).
   *
   * @param checkInTime - Actual check-in timestamp
   * @param shiftWindow - Shift window with shiftStart, shiftEnd, gracePeriodEnd
   * @param deductGracePeriod - When true, subtracts grace period from late penalty (deduction model).
   *                            Defaults to false (standard threshold model).
   */
  static calculateLate(
    checkInTime: Date,
    shiftWindow: ShiftWindow,
    deductGracePeriod: boolean = false,
  ): { isLate: boolean; lateMinutes: number } {
    if (checkInTime.getTime() > shiftWindow.gracePeriodEnd.getTime()) {
      const baseTime = deductGracePeriod
        ? shiftWindow.gracePeriodEnd.getTime()
        : shiftWindow.shiftStart.getTime();
      const diffMs = checkInTime.getTime() - baseTime;
      const lateMinutes = Math.max(0, Math.round(diffMs / (60 * 1000)));
      return { isLate: true, lateMinutes };
    }
    return { isLate: false, lateMinutes: 0 };
  }

  /**
   * Calculates early departure relative to shift end using standard rounding.
   */
  static calculateEarlyDeparture(
    checkOutTime: Date,
    shiftWindow: ShiftWindow,
  ): { isEarlyDeparture: boolean; earlyDepartureMinutes: number } {
    if (checkOutTime.getTime() < shiftWindow.shiftEnd.getTime()) {
      const diffMs = shiftWindow.shiftEnd.getTime() - checkOutTime.getTime();
      const earlyDepartureMinutes = Math.max(
        0,
        Math.round(diffMs / (60 * 1000)),
      );
      return { isEarlyDeparture: true, earlyDepartureMinutes };
    }
    return { isEarlyDeparture: false, earlyDepartureMinutes: 0 };
  }

  /**
   * Calculates total break duration in both exact seconds and rounded minutes across all closed breaks.
   */
  static calculateBreakDurations(
    breaks: Array<{
      startTime: Date;
      endTime: Date | null;
      durationMinutes?: number | null;
    }>,
  ): { totalBreakSeconds: number; totalBreakMinutes: number } {
    let totalBreakSeconds = 0;
    for (const b of breaks) {
      if (b.endTime) {
        const diffMs = Math.max(0, b.endTime.getTime() - b.startTime.getTime());
        totalBreakSeconds += Math.round(diffMs / 1000);
      }
    }
    const totalBreakMinutes = Math.round(totalBreakSeconds / 60);
    return { totalBreakSeconds, totalBreakMinutes };
  }

  /**
   * Calculates total duration in minutes of closed breaks using standard rounding.
   */
  static calculateTotalBreakMinutes(
    breaks: Array<{
      startTime: Date;
      endTime: Date | null;
      durationMinutes?: number | null;
    }>,
  ): number {
    return this.calculateBreakDurations(breaks).totalBreakMinutes;
  }

  /**
   * Calculates net working minutes and overtime minutes using high-precision second-level math.
   * Converts gross duration and break duration to total seconds first, subtracts break seconds,
   * and divides by 60 with Math.round() to avoid multi-step truncation/rounding errors.
   */
  static calculateWorkAndOvertime(
    checkInTime: Date,
    checkOutTime: Date,
    totalBreakDuration:
      number | { totalBreakSeconds: number; totalBreakMinutes?: number },
    overtimeThresholdMinutes: number,
  ): {
    totalGrossMinutes: number;
    totalGrossSeconds: number;
    totalBreakMinutes: number;
    totalBreakSeconds: number;
    totalWorkMinutes: number;
    totalWorkSeconds: number;
    overtimeMinutes: number;
  } {
    const grossMs = Math.max(0, checkOutTime.getTime() - checkInTime.getTime());
    const totalGrossSeconds = Math.round(grossMs / 1000);
    const totalGrossMinutes = Math.round(totalGrossSeconds / 60);

    const totalBreakSeconds =
      typeof totalBreakDuration === 'object' && totalBreakDuration !== null
        ? totalBreakDuration.totalBreakSeconds
        : Math.round(totalBreakDuration * 60);

    const totalBreakMinutes =
      typeof totalBreakDuration === 'object' &&
      totalBreakDuration !== null &&
      typeof totalBreakDuration.totalBreakMinutes === 'number'
        ? totalBreakDuration.totalBreakMinutes
        : Math.round(totalBreakSeconds / 60);

    // High precision: Net Work Seconds = Gross Seconds - Break Seconds
    const totalWorkSeconds = Math.max(0, totalGrossSeconds - totalBreakSeconds);
    const totalWorkMinutes = Math.round(totalWorkSeconds / 60);

    const overtimeMinutes =
      totalWorkMinutes > overtimeThresholdMinutes
        ? totalWorkMinutes - overtimeThresholdMinutes
        : 0;

    return {
      totalGrossMinutes,
      totalGrossSeconds,
      totalBreakMinutes,
      totalBreakSeconds,
      totalWorkMinutes,
      totalWorkSeconds,
      overtimeMinutes,
    };
  }

  /**
   * Determines the attendance status (PRESENT, HALF_DAY, INCOMPLETE) based on threshold hours.
   * Punches exist, but if hours fall short of even a half-day, INCOMPLETE is returned.
   * True ABSENT is reserved for no-shows (e.g., assigned via midnight cron or admin).
   */
  static determineAttendanceStatus(
    totalWorkMinutes: number,
    minWorkMinutesForFullDayOrSnapshot:
      | number
      | { minWorkMinutesForFullDay: number; minWorkMinutesForHalfDay: number },
    minWorkMinutesForHalfDay?: number,
  ): AttendanceStatus {
    const fullDayMinutes =
      typeof minWorkMinutesForFullDayOrSnapshot === 'object' &&
      minWorkMinutesForFullDayOrSnapshot !== null
        ? minWorkMinutesForFullDayOrSnapshot.minWorkMinutesForFullDay
        : minWorkMinutesForFullDayOrSnapshot;

    const halfDayMinutes =
      typeof minWorkMinutesForFullDayOrSnapshot === 'object' &&
      minWorkMinutesForFullDayOrSnapshot !== null
        ? minWorkMinutesForFullDayOrSnapshot.minWorkMinutesForHalfDay
        : (minWorkMinutesForHalfDay ?? 0);

    if (totalWorkMinutes >= fullDayMinutes) {
      return AttendanceStatus.PRESENT;
    }
    if (totalWorkMinutes >= halfDayMinutes) {
      return AttendanceStatus.HALF_DAY;
    }
    // Punches exist, but hours are too low for even a half-day.
    return AttendanceStatus.INCOMPLETE;
  }

  /**
   * Calculates the great-circle distance between two geographic coordinates
   * using the Haversine formula. Returns distance rounded to the nearest meter.
   */
  static calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const EARTH_RADIUS_METERS = 6371000;
    const toRadians = (deg: number): number => (deg * Math.PI) / 180;

    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const lat1Rad = toRadians(lat1);
    const lat2Rad = toRadians(lat2);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1Rad) *
        Math.cos(lat2Rad) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(EARTH_RADIUS_METERS * c);
  }

  /**
   * Checks if clientIp matches any of the branch's allowed static IPs or CIDR subnets.
   * Uses Node.js native net.BlockList (zero external dependencies).
   * Supports IPv4, IPv6, IPv4-mapped IPv6 (::ffff:x.x.x.x), and CIDR ranges (e.g. 192.168.1.0/24).
   */
  static isIpAllowed(
    clientIp?: string | null,
    allowedIps: string[] = [],
  ): boolean {
    if (!clientIp || !allowedIps || !allowedIps.length) {
      return false;
    }

    const cleanIp = clientIp.replace(/^::ffff:/, '').trim();
    if (!net.isIPv4(cleanIp) && !net.isIPv6(cleanIp)) {
      return false;
    }

    const blockList = new net.BlockList();

    for (const entry of allowedIps) {
      const cleanEntry = entry.replace(/^::ffff:/, '').trim();
      if (!cleanEntry) continue;

      if (cleanEntry.includes('/')) {
        const [subnet, prefixStr] = cleanEntry.split('/');
        const prefix = parseInt(prefixStr, 10);
        if (isNaN(prefix)) continue;

        if (net.isIPv4(subnet)) {
          blockList.addSubnet(subnet, prefix, 'ipv4');
        } else if (net.isIPv6(subnet)) {
          blockList.addSubnet(subnet, prefix, 'ipv6');
        }
      } else {
        if (net.isIPv4(cleanEntry)) {
          blockList.addAddress(cleanEntry, 'ipv4');
        } else if (net.isIPv6(cleanEntry)) {
          blockList.addAddress(cleanEntry, 'ipv6');
        }
      }
    }

    const clientIpType = net.isIPv6(cleanIp) ? 'ipv6' : 'ipv4';
    return blockList.check(cleanIp, clientIpType);
  }
}

/**
 * Convenience standalone export for determineAttendanceStatus.
 */
export function determineAttendanceStatus(
  totalWorkMinutes: number,
  shiftSnapshotOrFullDay:
    | number
    | { minWorkMinutesForFullDay: number; minWorkMinutesForHalfDay: number },
  minWorkMinutesForHalfDay?: number,
): AttendanceStatus {
  return AttendanceCalculationUtil.determineAttendanceStatus(
    totalWorkMinutes,
    shiftSnapshotOrFullDay,
    minWorkMinutesForHalfDay,
  );
}
