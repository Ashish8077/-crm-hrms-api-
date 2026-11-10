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
    it('should format date using default Asia/Kolkata timezone', () => {
      // 2026-10-15 09:30 AM IST is 04:00 AM UTC
      const date = new Date('2026-10-15T04:00:00.000Z');
      const dateStr = AttendanceCalculationUtil.getAttendanceDateString(date);
      expect(dateStr).toBe('2026-10-15');
    });

    it('should correctly handle midnight/date boundary in Asia/Kolkata', () => {
      // 23:59:59 IST on 2026-10-21 is 18:29:59 UTC
      const beforeMidnight = new Date('2026-10-21T18:29:59.000Z');
      expect(
        AttendanceCalculationUtil.getAttendanceDateString(beforeMidnight),
      ).toBe('2026-10-21');

      // 00:00:00 IST on 2026-10-22 is 18:30:00 UTC
      const atMidnight = new Date('2026-10-21T18:30:00.000Z');
      expect(
        AttendanceCalculationUtil.getAttendanceDateString(atMidnight),
      ).toBe('2026-10-22');
    });

    it('should create normalized midnight Date object in Asia/Kolkata', () => {
      const norm = AttendanceCalculationUtil.getNormalizedDate('2026-10-15');
      expect(norm.toISOString()).toBe('2026-10-14T18:30:00.000Z');
      expect(AttendanceCalculationUtil.formatZonedISO(norm)).toBe(
        '2026-10-15T00:00:00.000+05:30',
      );
    });

    describe('TC-07 — Date/timezone boundary', () => {
      it('should roll over attendance date at exactly 00:00:00 IST, even while server UTC is still previous day', () => {
        // 23:59:59 IST on 2026-10-21 is 18:29:59 UTC
        const beforeMidnight = new Date('2026-10-21T18:29:59.000Z');
        // 00:00:00 IST on 2026-10-22 is 18:30:00 UTC (still 2026-10-21 in UTC!)
        const atMidnight = new Date('2026-10-21T18:30:00.000Z');

        // Verify server UTC date would blindly say 2026-10-21 for both
        expect(beforeMidnight.toISOString().slice(0, 10)).toBe('2026-10-21');
        expect(atMidnight.toISOString().slice(0, 10)).toBe('2026-10-21');

        // Verify configured timezone correctly determines business date
        expect(
          AttendanceCalculationUtil.getAttendanceDateString(beforeMidnight),
        ).toBe('2026-10-21');
        expect(
          AttendanceCalculationUtil.getAttendanceDateString(atMidnight),
        ).toBe('2026-10-22');
      });

      it('should not roll over at 00:00:00 UTC when configured timezone has already rolled over hours earlier', () => {
        // 23:59:59 UTC on 2026-10-21 -> 05:29:59 IST on 2026-10-22
        const utcBeforeMidnight = new Date('2026-10-21T23:59:59.000Z');
        // 00:00:00 UTC on 2026-10-22 -> 05:30:00 IST on 2026-10-22
        const utcAtMidnight = new Date('2026-10-22T00:00:00.000Z');

        // UTC date changes here
        expect(utcBeforeMidnight.toISOString().slice(0, 10)).toBe('2026-10-21');
        expect(utcAtMidnight.toISOString().slice(0, 10)).toBe('2026-10-22');

        // But in Asia/Kolkata, BOTH are already 2026-10-22!
        expect(
          AttendanceCalculationUtil.getAttendanceDateString(utcBeforeMidnight),
        ).toBe('2026-10-22');
        expect(
          AttendanceCalculationUtil.getAttendanceDateString(utcAtMidnight),
        ).toBe('2026-10-22');
      });

      it('should accurately respect any configured organization/employee timezone at boundary', () => {
        // America/New_York (EDT, UTC-4): midnight occurs at 04:00:00 UTC
        const nyBeforeMidnight = new Date('2026-10-22T03:59:59.000Z'); // 23:59:59 EDT
        const nyAtMidnight = new Date('2026-10-22T04:00:00.000Z'); // 00:00:00 EDT

        expect(
          AttendanceCalculationUtil.getAttendanceDateString(
            nyBeforeMidnight,
            'America/New_York',
          ),
        ).toBe('2026-10-21');
        expect(
          AttendanceCalculationUtil.getAttendanceDateString(
            nyAtMidnight,
            'America/New_York',
          ),
        ).toBe('2026-10-22');

        // Asia/Tokyo (JST, UTC+9): midnight occurs at 15:00:00 UTC
        const tokyoBeforeMidnight = new Date('2026-10-21T14:59:59.000Z'); // 23:59:59 JST
        const tokyoAtMidnight = new Date('2026-10-21T15:00:00.000Z'); // 00:00:00 JST

        expect(
          AttendanceCalculationUtil.getAttendanceDateString(
            tokyoBeforeMidnight,
            'Asia/Tokyo',
          ),
        ).toBe('2026-10-21');
        expect(
          AttendanceCalculationUtil.getAttendanceDateString(
            tokyoAtMidnight,
            'Asia/Tokyo',
          ),
        ).toBe('2026-10-22');
      });
    });
  });

  describe('parseZonedDateTime', () => {
    it('should parse 09:00 in Asia/Kolkata into exact UTC timestamp', () => {
      // 09:00 IST is 03:30 UTC
      const date = AttendanceCalculationUtil.parseZonedDateTime(
        '2026-10-15',
        '09:00',
      );
      expect(date.toISOString()).toBe('2026-10-15T03:30:00.000Z');
    });

    it('should parse 22:00 in Asia/Kolkata into exact UTC timestamp', () => {
      // 22:00 IST is 16:30 UTC
      const date = AttendanceCalculationUtil.parseZonedDateTime(
        '2026-10-15',
        '22:00',
      );
      expect(date.toISOString()).toBe('2026-10-15T16:30:00.000Z');
    });
  });

  describe('getNextDateString', () => {
    it('should advance regular day', () => {
      expect(AttendanceCalculationUtil.getNextDateString('2026-10-15')).toBe(
        '2026-10-16',
      );
    });

    it('should advance across month boundary', () => {
      expect(AttendanceCalculationUtil.getNextDateString('2026-10-31')).toBe(
        '2026-11-01',
      );
    });

    it('should advance across year boundary', () => {
      expect(AttendanceCalculationUtil.getNextDateString('2026-12-31')).toBe(
        '2027-01-01',
      );
    });

    it('should correctly handle leap years', () => {
      expect(AttendanceCalculationUtil.getNextDateString('2024-02-28')).toBe(
        '2024-02-29',
      );
      expect(AttendanceCalculationUtil.getNextDateString('2024-02-29')).toBe(
        '2024-03-01',
      );
    });
  });

  describe('getShiftWindow', () => {
    it('should correctly build same-day shift window for standard shift in Asia/Kolkata', () => {
      const window = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-15',
        standardShift,
      );
      // 09:00 IST -> 03:30 UTC
      expect(window.shiftStart.toISOString()).toBe('2026-10-15T03:30:00.000Z');
      // 18:00 IST -> 12:30 UTC
      expect(window.shiftEnd.toISOString()).toBe('2026-10-15T12:30:00.000Z');
      // 09:15 IST -> 03:45 UTC
      expect(window.gracePeriodEnd.toISOString()).toBe(
        '2026-10-15T03:45:00.000Z',
      );
    });

    it('should correctly build next-day end date for overnight shift in Asia/Kolkata', () => {
      const window = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-15',
        overnightShift,
      );
      // 22:00 IST -> 16:30 UTC on 2026-10-15
      expect(window.shiftStart.toISOString()).toBe('2026-10-15T16:30:00.000Z');
      // 06:00 IST -> 00:30 UTC on 2026-10-16
      expect(window.shiftEnd.toISOString()).toBe('2026-10-16T00:30:00.000Z');
      // 22:15 IST -> 16:45 UTC on 2026-10-15
      expect(window.gracePeriodEnd.toISOString()).toBe(
        '2026-10-15T16:45:00.000Z',
      );

      // Duration: 8 hours
      const durationMs =
        window.shiftEnd.getTime() - window.shiftStart.getTime();
      expect(durationMs / (60 * 60 * 1000)).toBe(8);
    });

    it('should correctly handle overnight shift crossing month boundary', () => {
      const window = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-31',
        overnightShift,
      );
      expect(window.shiftStart.toISOString()).toBe('2026-10-31T16:30:00.000Z');
      expect(window.shiftEnd.toISOString()).toBe('2026-11-01T00:30:00.000Z');
    });

    it('should correctly handle overnight shift crossing year boundary', () => {
      const window = AttendanceCalculationUtil.getShiftWindow(
        '2026-12-31',
        overnightShift,
      );
      expect(window.shiftStart.toISOString()).toBe('2026-12-31T16:30:00.000Z');
      expect(window.shiftEnd.toISOString()).toBe('2027-01-01T00:30:00.000Z');
    });
  });

  describe('calculateLate', () => {
    const window = AttendanceCalculationUtil.getShiftWindow(
      '2026-10-15',
      standardShift,
    );

    it('should not mark late if checked in on time', () => {
      // 08:58 IST -> 03:28 UTC
      const checkIn = new Date('2026-10-15T03:28:00.000Z');
      const result = AttendanceCalculationUtil.calculateLate(checkIn, window);
      expect(result.isLate).toBe(false);
      expect(result.lateMinutes).toBe(0);
    });

    it('should not mark late if checked in exactly at grace period boundary', () => {
      // 09:15:00 IST -> 03:45:00 UTC
      const checkIn = new Date('2026-10-15T03:45:00.000Z');
      const result = AttendanceCalculationUtil.calculateLate(checkIn, window);
      expect(result.isLate).toBe(false);
      expect(result.lateMinutes).toBe(0);
    });

    it('should mark late if checked in 1 second after grace period boundary (15m from start)', () => {
      // 09:15:01 IST -> 03:45:01 UTC
      // Grace period (09:15:00) exceeded -> Late from shift start (09:00:00) -> 15m 1s -> rounds to 15m
      const checkIn = new Date('2026-10-15T03:45:01.000Z');
      const result = AttendanceCalculationUtil.calculateLate(checkIn, window);
      expect(result.isLate).toBe(true);
      expect(result.lateMinutes).toBe(15);
    });

    it('should mark late with minutes counted from shift start (standard threshold model)', () => {
      // 09:20:00 IST -> 03:50:00 UTC (20 minutes after 09:00 shift start)
      const checkIn = new Date('2026-10-15T03:50:00.000Z');
      const result = AttendanceCalculationUtil.calculateLate(checkIn, window);
      expect(result.isLate).toBe(true);
      expect(result.lateMinutes).toBe(20);
    });

    it('should calculate 169 late minutes for check-in at 11:49:15 with 09:00 shift start', () => {
      // 11:49:15 IST -> 06:19:15 UTC
      // 11:49:15 - 09:00:00 = 2 hours 49 minutes 15 seconds = 169m 15s -> rounds to 169
      const checkIn = new Date('2026-10-15T06:19:15.000Z');
      const result = AttendanceCalculationUtil.calculateLate(checkIn, window);
      expect(result.isLate).toBe(true);
      expect(result.lateMinutes).toBe(169);
    });

    it('should support deductGracePeriod policy when explicitly configured', () => {
      // 09:20:00 IST -> 03:50:00 UTC with grace deducted: 09:20 - 09:15 = 5m
      const checkIn = new Date('2026-10-15T03:50:00.000Z');
      const result = AttendanceCalculationUtil.calculateLate(
        checkIn,
        window,
        true,
      );
      expect(result.isLate).toBe(true);
      expect(result.lateMinutes).toBe(5);
    });

    it('should correctly calculate late for overnight shifts from shift start', () => {
      const nightWindow = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-15',
        overnightShift,
      );
      // Shift starts 22:00 IST (16:30 UTC), grace ends 22:15 IST (16:45 UTC)
      // Check in at 22:30 IST (17:00 UTC) -> 30 mins from shift start
      const checkIn = new Date('2026-10-15T17:00:00.000Z');
      const result = AttendanceCalculationUtil.calculateLate(
        checkIn,
        nightWindow,
      );
      expect(result.isLate).toBe(true);
      expect(result.lateMinutes).toBe(30);
    });

    it('should correctly calculate late for user scenario (10:00 start, 15m grace, 10:26:50 check-in -> 27m)', () => {
      const tenAmShift: ShiftCalculationParams = {
        ...standardShift,
        startTime: '10:00',
        endTime: '19:00',
        gracePeriodMinutes: 15,
      };
      const tenAmWindow = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-27',
        tenAmShift,
      );
      // 10:26:50.574 IST -> 04:56:50.574 UTC
      const checkIn = new Date('2026-10-27T04:56:50.574Z');
      const result = AttendanceCalculationUtil.calculateLate(
        checkIn,
        tenAmWindow,
      );
      expect(result.isLate).toBe(true);
      // 10:26:50.574 - 10:00:00 = 26m 50.574s -> rounds to 27 late minutes
      expect(result.lateMinutes).toBe(27);
    });

    describe('TC-06 — Check-in around shift boundaries', () => {
      // Standard shift: 09:00 - 18:00 IST (03:30 - 12:30 UTC), 15m grace (ends 09:15:00 IST -> 03:45:00 UTC)
      const shiftWin = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-15',
        standardShift,
      );

      it('1. exact shift start (09:00:00 IST / 03:30:00 UTC)', () => {
        const checkIn = new Date('2026-10-15T03:30:00.000Z');
        const result = AttendanceCalculationUtil.calculateLate(
          checkIn,
          shiftWin,
        );
        expect(result.isLate).toBe(false);
        expect(result.lateMinutes).toBe(0);
      });

      it('2. 1 second before shift start (08:59:59 IST / 03:29:59 UTC)', () => {
        const checkIn = new Date('2026-10-15T03:29:59.000Z');
        const result = AttendanceCalculationUtil.calculateLate(
          checkIn,
          shiftWin,
        );
        expect(result.isLate).toBe(false);
        expect(result.lateMinutes).toBe(0);
      });

      it('3. 1 second after shift start (09:00:01 IST / 03:30:01 UTC) - within grace period', () => {
        const checkIn = new Date('2026-10-15T03:30:01.000Z');
        const result = AttendanceCalculationUtil.calculateLate(
          checkIn,
          shiftWin,
        );
        expect(result.isLate).toBe(false);
        expect(result.lateMinutes).toBe(0);
      });

      it('4. maximum allowed late boundary (09:15:00 IST / 03:45:00 UTC)', () => {
        const checkIn = new Date('2026-10-15T03:45:00.000Z');
        const result = AttendanceCalculationUtil.calculateLate(
          checkIn,
          shiftWin,
        );
        expect(result.isLate).toBe(false);
        expect(result.lateMinutes).toBe(0);
      });

      it('5. beyond late boundary (09:15:01 IST / 03:45:01 UTC) - 15 minutes late from shift start', () => {
        const checkIn = new Date('2026-10-15T03:45:01.000Z');
        const result = AttendanceCalculationUtil.calculateLate(
          checkIn,
          shiftWin,
        );
        expect(result.isLate).toBe(true);
        expect(result.lateMinutes).toBe(15);
      });

      it('5b. beyond late boundary (09:20:00 IST / 03:50:00 UTC) - 20 minutes late from shift start', () => {
        const checkIn = new Date('2026-10-15T03:50:00.000Z');
        const result = AttendanceCalculationUtil.calculateLate(
          checkIn,
          shiftWin,
        );
        expect(result.isLate).toBe(true);
        expect(result.lateMinutes).toBe(20);
      });

      it('should respect dynamic configuration if gracePeriodMinutes is 0', () => {
        const strictShift = { ...standardShift, gracePeriodMinutes: 0 };
        const strictWin = AttendanceCalculationUtil.getShiftWindow(
          '2026-10-15',
          strictShift,
        );

        // Exact start: not late
        expect(
          AttendanceCalculationUtil.calculateLate(
            new Date('2026-10-15T03:30:00.000Z'),
            strictWin,
          ),
        ).toEqual({ isLate: false, lateMinutes: 0 });

        // 1s before start: not late
        expect(
          AttendanceCalculationUtil.calculateLate(
            new Date('2026-10-15T03:29:59.000Z'),
            strictWin,
          ),
        ).toEqual({ isLate: false, lateMinutes: 0 });

        // 1s after start: late immediately because grace is 0
        expect(
          AttendanceCalculationUtil.calculateLate(
            new Date('2026-10-15T03:30:01.000Z'),
            strictWin,
          ),
        ).toEqual({ isLate: true, lateMinutes: 0 });

        // 5m after start: 5 late minutes
        expect(
          AttendanceCalculationUtil.calculateLate(
            new Date('2026-10-15T03:35:00.000Z'),
            strictWin,
          ),
        ).toEqual({ isLate: true, lateMinutes: 5 });
      });
    });
  });

  describe('calculateEarlyDeparture', () => {
    const window = AttendanceCalculationUtil.getShiftWindow(
      '2026-10-15',
      standardShift,
    );

    it('should mark early departure if leaving before shift end', () => {
      // Shift ends 18:00 IST (12:30 UTC). Leaving 17:30 IST (12:00 UTC) -> 30 mins early
      const checkOut = new Date('2026-10-15T12:00:00.000Z');
      const result = AttendanceCalculationUtil.calculateEarlyDeparture(
        checkOut,
        window,
      );
      expect(result.isEarlyDeparture).toBe(true);
      expect(result.earlyDepartureMinutes).toBe(30);
    });

    it('should not mark early departure if leaving at exact shift end', () => {
      // 18:00:00 IST -> 12:30:00 UTC
      const checkOut = new Date('2026-10-15T12:30:00.000Z');
      const result = AttendanceCalculationUtil.calculateEarlyDeparture(
        checkOut,
        window,
      );
      expect(result.isEarlyDeparture).toBe(false);
      expect(result.earlyDepartureMinutes).toBe(0);
    });

    it('should not mark early departure if leaving after shift end', () => {
      // 18:05:00 IST -> 12:35:00 UTC
      const checkOut = new Date('2026-10-15T12:35:00.000Z');
      const result = AttendanceCalculationUtil.calculateEarlyDeparture(
        checkOut,
        window,
      );
      expect(result.isEarlyDeparture).toBe(false);
      expect(result.earlyDepartureMinutes).toBe(0);
    });

    it('should correctly calculate early departure for overnight shift across midnight', () => {
      const nightWindow = AttendanceCalculationUtil.getShiftWindow(
        '2026-10-15',
        overnightShift,
      );
      // Shift ends 06:00 IST on 2026-10-16 (00:30 UTC on 2026-10-16)
      // Leaving 05:45 IST on 2026-10-16 (00:15 UTC on 2026-10-16) -> 15 mins early
      const checkOut = new Date('2026-10-16T00:15:00.000Z');
      const result = AttendanceCalculationUtil.calculateEarlyDeparture(
        checkOut,
        nightWindow,
      );
      expect(result.isEarlyDeparture).toBe(true);
      expect(result.earlyDepartureMinutes).toBe(15);
    });
  });

  describe('calculateTotalBreakMinutes', () => {
    it('should compute total break minutes for multiple sessions', () => {
      const breaks = [
        {
          startTime: new Date('2026-10-15T07:30:00.000Z'), // 13:00 IST
          endTime: new Date('2026-10-15T08:15:00.000Z'), // 13:45 IST
          durationMinutes: 45,
          type: BreakType.LUNCH,
        },
        {
          startTime: new Date('2026-10-15T10:30:00.000Z'), // 16:00 IST
          endTime: new Date('2026-10-15T10:45:00.000Z'), // 16:15 IST
          durationMinutes: 15,
          type: BreakType.TEA,
        },
        {
          startTime: new Date('2026-10-15T11:30:00.000Z'),
          endTime: null,
          durationMinutes: null,
          type: BreakType.PERSONAL,
        },
      ];

      const total =
        AttendanceCalculationUtil.calculateTotalBreakMinutes(breaks);
      expect(total).toBe(60);
    });

    it('should calculate total break minutes with rounding for unrounded sessions', () => {
      const breaks = [
        {
          startTime: new Date('2026-10-27T05:05:03.640Z'), // 10:35:03 IST
          endTime: new Date('2026-10-27T05:08:58.562Z'), // 10:38:58 IST (3m 55s -> rounds to 4m)
          durationMinutes: null,
          type: BreakType.LUNCH,
        },
      ];

      const total =
        AttendanceCalculationUtil.calculateTotalBreakMinutes(breaks);
      expect(total).toBe(4);
    });
  });

  describe('calculateDurationMinutes and calculateDurationSeconds', () => {
    it('should round 3 minutes 55 seconds to 4 minutes (prevent downward truncation bias)', () => {
      // 10:35:03.640 IST -> 05:05:03.640 UTC
      const start = new Date('2026-10-27T05:05:03.640Z');
      // 10:38:58.562 IST -> 05:08:58.562 UTC (3m 54.922s)
      const end = new Date('2026-10-27T05:08:58.562Z');
      const minutes = AttendanceCalculationUtil.calculateDurationMinutes(
        start,
        end,
      );
      expect(minutes).toBe(4);
    });

    it('should round 3 minutes 10 seconds to 3 minutes', () => {
      const start = new Date('2026-10-27T05:00:00.000Z');
      const end = new Date('2026-10-27T05:03:10.000Z');
      const minutes = AttendanceCalculationUtil.calculateDurationMinutes(
        start,
        end,
      );
      expect(minutes).toBe(3);
    });

    it('should calculate duration in seconds correctly', () => {
      const start = new Date('2026-10-27T05:05:03.640Z');
      const end = new Date('2026-10-27T05:08:58.562Z');
      const seconds = AttendanceCalculationUtil.calculateDurationSeconds(
        start,
        end,
      );
      expect(seconds).toBe(235);
    });
  });

  describe('calculateWorkAndOvertime', () => {
    it('should calculate gross, net, and overtime correctly', () => {
      const checkIn = new Date('2026-10-15T03:30:00.000Z'); // 09:00 IST
      const checkOut = new Date('2026-10-15T14:00:00.000Z'); // 19:30 IST (10.5 hours = 630 min)
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
      const checkIn = new Date('2026-10-15T03:30:00.000Z');
      const checkOut = new Date('2026-10-15T11:30:00.000Z'); // 8 hours = 480 min
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

    it('should use second-level precision to prevent premature decimal truncation across breaks', () => {
      // 09:00:00 IST -> 03:30:00 UTC
      const checkIn = new Date('2026-10-15T03:30:00.000Z');
      // 18:00:20 IST -> 12:30:20 UTC (9h 0m 20s = 32,420 gross seconds)
      const checkOut = new Date('2026-10-15T12:30:20.000Z');
      // Breaks totaling 3620 seconds (60 min 20 sec)
      const breakDurations = { totalBreakSeconds: 3620, totalBreakMinutes: 60 };

      const calc = AttendanceCalculationUtil.calculateWorkAndOvertime(
        checkIn,
        checkOut,
        breakDurations,
        480,
      );

      // Net seconds: 32,420 - 3,620 = 28,800 seconds = exactly 480 minutes!
      expect(calc.totalGrossSeconds).toBe(32420);
      expect(calc.totalBreakSeconds).toBe(3620);
      expect(calc.totalWorkSeconds).toBe(28800);
      expect(calc.totalWorkMinutes).toBe(480);
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

    it('should return INCOMPLETE when total minutes < half day threshold (Option B)', () => {
      const status = AttendanceCalculationUtil.determineAttendanceStatus(
        180,
        480,
        240,
      );
      expect(status).toBe(AttendanceStatus.INCOMPLETE);
    });

    it('should support shiftSnapshot object parameter format and standalone function', () => {
      const shiftSnapshot = {
        minWorkMinutesForFullDay: 480,
        minWorkMinutesForHalfDay: 240,
      };
      expect(
        AttendanceCalculationUtil.determineAttendanceStatus(480, shiftSnapshot),
      ).toBe(AttendanceStatus.PRESENT);
      expect(
        AttendanceCalculationUtil.determineAttendanceStatus(300, shiftSnapshot),
      ).toBe(AttendanceStatus.HALF_DAY);
      expect(
        AttendanceCalculationUtil.determineAttendanceStatus(20, shiftSnapshot),
      ).toBe(AttendanceStatus.INCOMPLETE);
    });
  });

  describe('calculateHaversineDistance', () => {
    it('should return 0 meters for identical coordinates', () => {
      const distance = AttendanceCalculationUtil.calculateHaversineDistance(
        12.9716,
        77.5946,
        12.9716,
        77.5946,
      );
      expect(distance).toBe(0);
    });

    it('should accurately calculate small distance within 150m geofence radius', () => {
      // Branch at (12.971600, 77.594600)
      // Check-in point ~75m north-east (12.972100, 77.595000)
      const distance = AttendanceCalculationUtil.calculateHaversineDistance(
        12.9716,
        77.5946,
        12.9721,
        77.595,
      );
      // Expected ~71 meters
      expect(distance).toBeGreaterThanOrEqual(65);
      expect(distance).toBeLessThanOrEqual(80);
      expect(distance <= 150).toBe(true);
    });

    it('should accurately detect points outside the 150m geofence radius', () => {
      // Point ~500m away
      const distance = AttendanceCalculationUtil.calculateHaversineDistance(
        12.9716,
        77.5946,
        12.976,
        77.5946,
      );
      expect(distance).toBeGreaterThan(450);
      expect(distance).toBeLessThan(550);
      expect(distance <= 150).toBe(false);
    });

    it('should compute approximate distance between Bangalore and Mumbai (~840km)', () => {
      // Bangalore: 12.9716, 77.5946
      // Mumbai: 19.0760, 72.8777
      const distance = AttendanceCalculationUtil.calculateHaversineDistance(
        12.9716,
        77.5946,
        19.076,
        72.8777,
      );
      // ~840,000 meters
      expect(distance).toBeGreaterThan(830000);
      expect(distance).toBeLessThan(860000);
    });
  });

  describe('isIpAllowed', () => {
    it('should return true when exact static IPv4 matches', () => {
      expect(
        AttendanceCalculationUtil.isIpAllowed('192.168.1.100', [
          '192.168.1.100',
        ]),
      ).toBe(true);
    });

    it('should normalize IPv4-mapped IPv6 address and match', () => {
      expect(
        AttendanceCalculationUtil.isIpAllowed('::ffff:192.168.1.100', [
          '192.168.1.100',
        ]),
      ).toBe(true);
    });

    it('should return true when IP is within a configured CIDR subnet', () => {
      expect(
        AttendanceCalculationUtil.isIpAllowed('192.168.1.45', [
          '192.168.1.0/24',
        ]),
      ).toBe(true);
      expect(
        AttendanceCalculationUtil.isIpAllowed('10.50.12.99', ['10.50.0.0/16']),
      ).toBe(true);
    });

    it('should return false when IP is outside the configured CIDR subnet', () => {
      expect(
        AttendanceCalculationUtil.isIpAllowed('192.168.2.1', [
          '192.168.1.0/24',
        ]),
      ).toBe(false);
      expect(
        AttendanceCalculationUtil.isIpAllowed('203.0.113.5', [
          '192.168.1.0/24',
        ]),
      ).toBe(false);
    });

    it('should match against IPv6 CIDR subnets', () => {
      expect(
        AttendanceCalculationUtil.isIpAllowed('2001:db8::1', ['2001:db8::/32']),
      ).toBe(true);
      expect(
        AttendanceCalculationUtil.isIpAllowed('2001:db9::1', ['2001:db8::/32']),
      ).toBe(false);
    });

    it('should return false for missing, invalid, or empty inputs', () => {
      expect(AttendanceCalculationUtil.isIpAllowed(null, ['192.168.1.1'])).toBe(
        false,
      );
      expect(
        AttendanceCalculationUtil.isIpAllowed(undefined, ['192.168.1.1']),
      ).toBe(false);
      expect(AttendanceCalculationUtil.isIpAllowed('192.168.1.1', [])).toBe(
        false,
      );
      expect(
        AttendanceCalculationUtil.isIpAllowed('not-an-ip', ['192.168.1.1']),
      ).toBe(false);
    });
  });

  describe('parsePunchTimestamp', () => {
    it('should parse UTC ISO timestamp with Z accurately', () => {
      // 9:00 AM IST expressed in UTC is 03:30:00.000Z
      const result = AttendanceCalculationUtil.parsePunchTimestamp(
        '2026-10-15T03:30:00.000Z',
        '2026-10-15',
      );
      expect(result?.toISOString()).toBe('2026-10-15T03:30:00.000Z');
      expect(AttendanceCalculationUtil.formatZonedISO(result)).toBe(
        '2026-10-15T09:00:00.000+05:30',
      );
    });

    it('should parse ISO timestamp with explicit +05:30 offset accurately', () => {
      const result = AttendanceCalculationUtil.parsePunchTimestamp(
        '2026-10-15T09:00:00+05:30',
        '2026-10-15',
      );
      expect(result?.toISOString()).toBe('2026-10-15T03:30:00.000Z');
    });

    it('should parse naive local datetime string without offset by interpreting in Asia/Kolkata', () => {
      const result = AttendanceCalculationUtil.parsePunchTimestamp(
        '2026-10-15T09:00:00',
        '2026-10-15',
      );
      expect(result?.toISOString()).toBe('2026-10-15T03:30:00.000Z');
      expect(AttendanceCalculationUtil.formatZonedISO(result)).toBe(
        '2026-10-15T09:00:00.000+05:30',
      );
    });

    it('should parse simple time-only string (HH:mm) against attendanceDate in Asia/Kolkata', () => {
      const result = AttendanceCalculationUtil.parsePunchTimestamp(
        '09:00',
        '2026-10-15',
      );
      expect(result?.toISOString()).toBe('2026-10-15T03:30:00.000Z');
      expect(AttendanceCalculationUtil.formatZonedISO(result)).toBe(
        '2026-10-15T09:00:00.000+05:30',
      );
    });

    it('should parse 12-hour time strings with AM/PM against attendanceDate in Asia/Kolkata', () => {
      const morning = AttendanceCalculationUtil.parsePunchTimestamp(
        '09:00 AM',
        '2026-10-15',
      );
      expect(morning?.toISOString()).toBe('2026-10-15T03:30:00.000Z');

      const evening = AttendanceCalculationUtil.parsePunchTimestamp(
        '6:30 PM',
        '2026-10-15',
      );
      expect(evening?.toISOString()).toBe('2026-10-15T13:00:00.000Z');
    });

    it('should return null for invalid date strings', () => {
      expect(
        AttendanceCalculationUtil.parsePunchTimestamp(
          'not-a-valid-date',
          '2026-10-15',
        ),
      ).toBeNull();
      expect(
        AttendanceCalculationUtil.parsePunchTimestamp('', '2026-10-15'),
      ).toBeNull();
      expect(
        AttendanceCalculationUtil.parsePunchTimestamp(null, '2026-10-15'),
      ).toBeNull();
    });
  });

  describe('calculateCalendarDayDifference and isWeeklyOff', () => {
    it('should correctly calculate the difference in calendar days between two dates', () => {
      expect(
        AttendanceCalculationUtil.calculateCalendarDayDifference(
          '2026-10-27',
          '2026-10-15',
        ),
      ).toBe(12);
      expect(
        AttendanceCalculationUtil.calculateCalendarDayDifference(
          '2026-10-15',
          '2026-10-15',
        ),
      ).toBe(0);
      expect(
        AttendanceCalculationUtil.calculateCalendarDayDifference(
          '2026-10-15',
          '2026-10-20',
        ),
      ).toBe(-5);
    });

    it('should identify Sunday as weekly off', () => {
      // 2026-10-25 is a Sunday
      expect(AttendanceCalculationUtil.isWeeklyOff('2026-10-25')).toBe(true);
      // 2026-10-18 is a Sunday
      expect(AttendanceCalculationUtil.isWeeklyOff('2026-10-18')).toBe(true);
      // 2026-10-15 is a Thursday
      expect(AttendanceCalculationUtil.isWeeklyOff('2026-10-15')).toBe(false);
      // 2026-10-27 is a Tuesday
      expect(AttendanceCalculationUtil.isWeeklyOff('2026-10-27')).toBe(false);
    });
  });
});
