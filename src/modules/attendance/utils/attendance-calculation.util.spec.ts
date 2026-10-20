import {
  AttendanceCalculationUtil,
  ShiftCalculationParams,
} from './attendance-calculation.util';
import { AttendanceStatus, BreakType } from '../constants/attendance.constant';

describe('AttendanceCalculationUtil', () => {
  const standardShift: ShiftCalculationParams = {
    startTime: '09:00',
    endTime: '18:00',
    isOvernight: false,
    gracePeriodMinutes: 15,
    minWorkMinutesForFullDay: 480, // 8 hours
    minWorkMinutesForHalfDay: 240, // 4 hours
    overtimeThresholdMinutes: 480,
  };

  const overnightShift: ShiftCalculationParams = {
    startTime: '22:00',
    endTime: '06:00',
    isOvernight: true,
    gracePeriodMinutes: 15,
    minWorkMinutesForFullDay: 480,
    minWorkMinutesForHalfDay: 240,
    overtimeThresholdMinutes: 480,
  };

  describe('getAttendanceDateString and getNormalizedDate', () => {
    it('should format UTC date to YYYY-MM-DD', () => {
      const date = new Date('2026-10-15T09:30:00.000Z');
      const dateStr = AttendanceCalculationUtil.getAttendanceDateString(
        date,
        'UTC',
      );
      expect(dateStr).toBe('2026-10-15');
    });

    it('should create normalized midnight UTC Date object', () => {
      const norm = AttendanceCalculationUtil.getNormalizedDate('2026-10-15');
      expect(norm.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    });
  });

  describe('getShiftWindow', () => {
    it('should correctly build same-day shift window for standard shift', () => {
      const window = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-15',
        standardShift,
      );
      expect(window.shiftStart.toISOString()).toBe('2026-10-15T09:00:00.000Z');
      expect(window.shiftEnd.toISOString()).toBe('2026-10-15T18:00:00.000Z');
      expect(window.gracePeriodEnd.toISOString()).toBe(
        '2026-10-15T09:15:00.000Z',
      );
    });

    it('should correctly build next-day end date for overnight shift', () => {
      const window = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-15',
        overnightShift,
      );
      expect(window.shiftStart.toISOString()).toBe('2026-10-15T22:00:00.000Z');
      expect(window.shiftEnd.toISOString()).toBe('2026-10-16T06:00:00.000Z');
      expect(window.gracePeriodEnd.toISOString()).toBe(
        '2026-10-15T22:15:00.000Z',
      );
    });
  });

  describe('calculateLate', () => {
    const window = AttendanceCalculationUtil.getShiftWindow(
      '2026-10-15',
      standardShift,
    );

    it('should not mark late if checked in on time', () => {
      const checkIn = new Date('2026-10-15T08:58:00.000Z');
      const result = AttendanceCalculationUtil.calculateLate(checkIn, window);
      expect(result.isLate).toBe(false);
      expect(result.lateMinutes).toBe(0);
    });

    it('should not mark late if checked in within grace period', () => {
      const checkIn = new Date('2026-10-15T09:14:00.000Z');
      const result = AttendanceCalculationUtil.calculateLate(checkIn, window);
      expect(result.isLate).toBe(false);
      expect(result.lateMinutes).toBe(0);
    });

    it('should mark late if checked in after grace period', () => {
      const checkIn = new Date('2026-10-15T09:35:00.000Z');
      const result = AttendanceCalculationUtil.calculateLate(checkIn, window);
      expect(result.isLate).toBe(true);
      expect(result.lateMinutes).toBe(35);
    });
  });

  describe('calculateEarlyDeparture', () => {
    const window = AttendanceCalculationUtil.getShiftWindow(
      '2026-10-15',
      standardShift,
    );

    it('should mark early departure if leaving before shift end', () => {
      const checkOut = new Date('2026-10-15T17:30:00.000Z');
      const result = AttendanceCalculationUtil.calculateEarlyDeparture(
        checkOut,
        window,
      );
      expect(result.isEarlyDeparture).toBe(true);
      expect(result.earlyDepartureMinutes).toBe(30);
    });

    it('should not mark early departure if leaving at or after shift end', () => {
      const checkOut = new Date('2026-10-15T18:05:00.000Z');
      const result = AttendanceCalculationUtil.calculateEarlyDeparture(
        checkOut,
        window,
      );
      expect(result.isEarlyDeparture).toBe(false);
      expect(result.earlyDepartureMinutes).toBe(0);
    });
  });

  describe('calculateTotalBreakMinutes', () => {
    it('should compute total break minutes for multiple sessions', () => {
      const breaks = [
        {
          startTime: new Date('2026-10-15T13:00:00.000Z'),
          endTime: new Date('2026-10-15T13:45:00.000Z'),
          durationMinutes: 45,
          type: BreakType.LUNCH,
        },
        {
          startTime: new Date('2026-10-15T16:00:00.000Z'),
          endTime: new Date('2026-10-15T16:15:00.000Z'),
          durationMinutes: 15,
          type: BreakType.TEA,
        },
        {
          startTime: new Date('2026-10-15T17:00:00.000Z'),
          endTime: null,
          durationMinutes: null,
          type: BreakType.PERSONAL,
        },
      ];

      const total =
        AttendanceCalculationUtil.calculateTotalBreakMinutes(breaks);
      expect(total).toBe(60);
    });
  });

  describe('calculateWorkAndOvertime', () => {
    it('should calculate gross, net, and overtime correctly', () => {
      const checkIn = new Date('2026-10-15T09:00:00.000Z');
      const checkOut = new Date('2026-10-15T19:30:00.000Z'); // 10.5 hours = 630 min
      const breakMinutes = 60;
      const otThreshold = 480; // 8 hours

      const calc = AttendanceCalculationUtil.calculateWorkAndOvertime(
        checkIn,
        checkOut,
        breakMinutes,
        otThreshold,
      );

      expect(calc.totalGrossMinutes).toBe(630);
      expect(calc.totalWorkMinutes).toBe(570); // 630 - 60 = 570 min (9.5h)
      expect(calc.overtimeMinutes).toBe(90); // 570 - 480 = 90 min (1.5h OT)
    });

    it('should have 0 overtime if net hours under threshold', () => {
      const checkIn = new Date('2026-10-15T09:00:00.000Z');
      const checkOut = new Date('2026-10-15T17:00:00.000Z'); // 8 hours = 480 min
      const breakMinutes = 60; // net 420 min (7h)

      const calc = AttendanceCalculationUtil.calculateWorkAndOvertime(
        checkIn,
        checkOut,
        breakMinutes,
        480,
      );

      expect(calc.totalWorkMinutes).toBe(420);
      expect(calc.overtimeMinutes).toBe(0);
    });
  });

  describe('determineAttendanceStatus', () => {
    it('should return PRESENT when total minutes >= full day threshold', () => {
      const status = AttendanceCalculationUtil.determineAttendanceStatus(
        480,
        480,
        240,
      );
      expect(status).toBe(AttendanceStatus.PRESENT);
    });

    it('should return HALF_DAY when total minutes >= half day but < full day', () => {
      const status = AttendanceCalculationUtil.determineAttendanceStatus(
        300,
        480,
        240,
      );
      expect(status).toBe(AttendanceStatus.HALF_DAY);
    });

    it('should return ABSENT when total minutes < half day threshold', () => {
      const status = AttendanceCalculationUtil.determineAttendanceStatus(
        180,
        480,
        240,
      );
      expect(status).toBe(AttendanceStatus.ABSENT);
    });
  });
});
