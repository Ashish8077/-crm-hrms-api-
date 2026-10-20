import { AttendanceStatus } from '../constants/attendance.constant';

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
  /**
   * Formats a Date object to YYYY-MM-DD representation in the given timezone (defaults to UTC).
   */
  static getAttendanceDateString(date: Date, timeZone: string = 'UTC'): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  }

  /**
   * Gets normalized Date object (midnight UTC of the attendanceDate YYYY-MM-DD).
   */
  static getNormalizedDate(attendanceDate: string): Date {
    return new Date(`${attendanceDate}T00:00:00.000Z`);
  }

  /**
   * Computes the absolute Shift start, end, and grace period timestamps for an attendance date.
   */
  static getShiftWindow(
    attendanceDate: string,
    shift: ShiftCalculationParams,
  ): ShiftWindow {
    const shiftStart = new Date(`${attendanceDate}T${shift.startTime}:00.000Z`);

    let endDateString = attendanceDate;
    if (shift.isOvernight) {
      const nextDay = new Date(shiftStart.getTime() + 24 * 60 * 60 * 1000);
      endDateString = this.getAttendanceDateString(nextDay, 'UTC');
    }

    const shiftEnd = new Date(`${endDateString}T${shift.endTime}:00.000Z`);
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
   * Calculates late marking and late minutes relative to shift start and grace period.
   */
  static calculateLate(
    checkInTime: Date,
    shiftWindow: ShiftWindow,
  ): { isLate: boolean; lateMinutes: number } {
    if (checkInTime.getTime() > shiftWindow.gracePeriodEnd.getTime()) {
      const diffMs = checkInTime.getTime() - shiftWindow.shiftStart.getTime();
      const lateMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));
      return { isLate: true, lateMinutes };
    }
    return { isLate: false, lateMinutes: 0 };
  }

  /**
   * Calculates early departure relative to shift end.
   */
  static calculateEarlyDeparture(
    checkOutTime: Date,
    shiftWindow: ShiftWindow,
  ): { isEarlyDeparture: boolean; earlyDepartureMinutes: number } {
    if (checkOutTime.getTime() < shiftWindow.shiftEnd.getTime()) {
      const diffMs = shiftWindow.shiftEnd.getTime() - checkOutTime.getTime();
      const earlyDepartureMinutes = Math.max(
        0,
        Math.floor(diffMs / (60 * 1000)),
      );
      return { isEarlyDeparture: true, earlyDepartureMinutes };
    }
    return { isEarlyDeparture: false, earlyDepartureMinutes: 0 };
  }

  /**
   * Calculates total duration in minutes of closed breaks.
   */
  static calculateTotalBreakMinutes(
    breaks: Array<{
      startTime: Date;
      endTime: Date | null;
      durationMinutes?: number | null;
    }>,
  ): number {
    let totalMinutes = 0;
    for (const b of breaks) {
      if (b.endTime) {
        if (typeof b.durationMinutes === 'number' && b.durationMinutes > 0) {
          totalMinutes += b.durationMinutes;
        } else {
          const diffMs = b.endTime.getTime() - b.startTime.getTime();
          totalMinutes += Math.max(0, Math.floor(diffMs / (60 * 1000)));
        }
      }
    }
    return totalMinutes;
  }

  /**
   * Calculates net working minutes and overtime minutes.
   */
  static calculateWorkAndOvertime(
    checkInTime: Date,
    checkOutTime: Date,
    totalBreakMinutes: number,
    overtimeThresholdMinutes: number,
  ): {
    totalGrossMinutes: number;
    totalWorkMinutes: number;
    overtimeMinutes: number;
  } {
    const totalGrossMs = Math.max(
      0,
      checkOutTime.getTime() - checkInTime.getTime(),
    );
    const totalGrossMinutes = Math.floor(totalGrossMs / (60 * 1000));
    const totalWorkMinutes = Math.max(0, totalGrossMinutes - totalBreakMinutes);
    const overtimeMinutes =
      totalWorkMinutes > overtimeThresholdMinutes
        ? totalWorkMinutes - overtimeThresholdMinutes
        : 0;

    return {
      totalGrossMinutes,
      totalWorkMinutes,
      overtimeMinutes,
    };
  }

  /**
   * Determines the attendance status (PRESENT, HALF_DAY, ABSENT) based on threshold hours.
   */
  static determineAttendanceStatus(
    totalWorkMinutes: number,
    minWorkMinutesForFullDay: number,
    minWorkMinutesForHalfDay: number,
  ): AttendanceStatus {
    if (totalWorkMinutes >= minWorkMinutesForFullDay) {
      return AttendanceStatus.PRESENT;
    }
    if (totalWorkMinutes >= minWorkMinutesForHalfDay) {
      return AttendanceStatus.HALF_DAY;
    }
    return AttendanceStatus.ABSENT;
  }
}
