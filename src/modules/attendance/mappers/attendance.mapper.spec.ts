import { Types } from 'mongoose';
import {
  AttendanceMapper,
  CheckInCreateInput,
  CheckOutUpdateInput,
  RegularizedAttendanceCreateInput,
  RegularizedAttendanceUpdateInput,
  ShiftSnapshotSource,
} from './attendance.mapper';
import {
  AttendanceSource,
  AttendanceStatus,
  BreakType,
  WorkMode,
} from '../constants/attendance.constant';
import { AttendanceLean } from '../repositories/attendance.repository';

describe('AttendanceMapper', () => {
  const employeeId = new Types.ObjectId();
  const shiftId = new Types.ObjectId();
  const attendanceId = new Types.ObjectId();
  const regId = new Types.ObjectId();

  const mockShift: ShiftSnapshotSource & { _id: Types.ObjectId } = {
    _id: shiftId,
    name: 'General Shift',
    code: 'GEN-01',
    startTime: '09:00',
    endTime: '18:00',
    isOvernight: false,
    gracePeriodMinutes: 15,
    minWorkMinutesForFullDay: 480,
    minWorkMinutesForHalfDay: 240,
    overtimeThresholdMinutes: 480,
    breakDurationMinutes: 60,
  };

  describe('toShiftSnapshot', () => {
    it('should map ShiftSnapshotSource to ShiftSnapshot object', () => {
      const snapshot = AttendanceMapper.toShiftSnapshot(mockShift);

      expect(snapshot).toEqual({
        name: 'General Shift',
        code: 'GEN-01',
        startTime: '09:00',
        endTime: '18:00',
        isOvernight: false,
        gracePeriodMinutes: 15,
        breakDurationMinutes: 60,
        minWorkMinutesForFullDay: 480,
        minWorkMinutesForHalfDay: 240,
        overtimeThresholdMinutes: 480,
      });
    });
  });

  describe('toBreakSession', () => {
    it('should map StartBreakDto to a new BreakSession with defaults', () => {
      const now = new Date('2026-10-21T13:00:00.000Z');
      const breakSession = AttendanceMapper.toBreakSession(
        { type: BreakType.LUNCH, note: '  Lunch break  ' },
        now,
      );

      expect(breakSession).toEqual({
        startTime: now,
        endTime: null,
        durationMinutes: null,
        type: BreakType.LUNCH,
        note: 'Lunch break',
      });
    });

    it('should default break type to LUNCH if unspecified', () => {
      const breakSession = AttendanceMapper.toBreakSession({});
      expect(breakSession.type).toBe(BreakType.LUNCH);
      expect(breakSession.endTime).toBeNull();
    });
  });

  describe('toCheckInCreateData', () => {
    it('should correctly format check-in persistence document with defaults', () => {
      const now = new Date('2026-10-21T09:05:00.000Z');
      const input: CheckInCreateInput = {
        employeeId,
        attendanceDate: '2026-10-21',
        shift: mockShift,
        checkInTime: now,
        isLate: false,
        lateMinutes: 0,
        dto: {
          workMode: WorkMode.OFFICE,
          source: AttendanceSource.WEB,
          notes: '  On time  ',
          location: { latitude: 12.9716, longitude: 77.5946, address: 'HQ' },
        },
        ipAddress: '192.168.1.1',
      };

      const result = AttendanceMapper.toCheckInCreateData(input);

      expect(result.employeeId).toEqual(employeeId);
      expect(result.attendanceDate).toBe('2026-10-21');
      expect(result.shiftId).toEqual(shiftId);
      expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
      expect(result.checkInTime).toEqual(now);
      expect(result.checkOutTime).toBeNull();
      expect(result.breaks).toEqual([]);
      expect(result.totalBreakMinutes).toBe(0);
      expect(result.totalWorkMinutes).toBe(0);
      expect(result.isLate).toBe(false);
      expect(result.lateMinutes).toBe(0);
      expect(result.isEarlyDeparture).toBe(false);
      expect(result.earlyDepartureMinutes).toBe(0);
      expect(result.overtimeMinutes).toBe(0);
      expect(result.checkInSource).toBe(AttendanceSource.WEB);
      expect(result.checkInIp).toBe('192.168.1.1');
      expect(result.checkInNotes).toBe('On time');
      expect(result.regularizationId).toBeNull();
    });

    it('should convert string employeeId and shift._id to Types.ObjectId', () => {
      const now = new Date();
      const result = AttendanceMapper.toCheckInCreateData({
        employeeId: employeeId.toString(),
        attendanceDate: '2026-10-21',
        shift: { ...mockShift, _id: shiftId.toString() },
        checkInTime: now,
        isLate: true,
        lateMinutes: 20,
        dto: {},
      });

      expect(result.employeeId).toBeInstanceOf(Types.ObjectId);
      expect(result.shiftId).toBeInstanceOf(Types.ObjectId);
      expect(result.isLate).toBe(true);
      expect(result.lateMinutes).toBe(20);
      expect(result.checkInSource).toBe(AttendanceSource.WEB);
      expect(result.workMode).toBe(WorkMode.OFFICE);
    });
  });

  describe('toCheckOutUpdateData', () => {
    it('should format check-out update dictionary with calculated metrics and trimmed notes', () => {
      const now = new Date('2026-10-21T18:10:00.000Z');
      const input: CheckOutUpdateInput = {
        checkOutTime: now,
        status: AttendanceStatus.PRESENT,
        breaks: [],
        totalBreakMinutes: 60,
        totalWorkMinutes: 480,
        overtimeMinutes: 10,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        dto: {
          source: AttendanceSource.WEB,
          notes: '  Completed tasks  ',
          location: { latitude: 12.9716, longitude: 77.5946 },
        },
        ipAddress: '192.168.1.5',
      };

      const result = AttendanceMapper.toCheckOutUpdateData(input);

      expect(result).toEqual({
        checkOutTime: now,
        status: AttendanceStatus.PRESENT,
        breaks: [],
        totalBreakMinutes: 60,
        totalWorkMinutes: 480,
        overtimeMinutes: 10,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        checkOutSource: AttendanceSource.WEB,
        checkOutIp: '192.168.1.5',
        checkOutLocation: { latitude: 12.9716, longitude: 77.5946 },
        checkOutNotes: 'Completed tasks',
      });
    });
  });

  describe('toRegularizedCreateData', () => {
    it('should map regularized attendance creation with SYSTEM source and REGULARIZED status', () => {
      const checkInTime = new Date('2026-10-20T03:30:00.000Z');
      const checkOutTime = new Date('2026-10-20T12:30:00.000Z');

      const input: RegularizedAttendanceCreateInput = {
        employeeId,
        attendanceDate: '2026-10-20',
        shift: mockShift,
        checkInTime,
        checkOutTime,
        totalWorkMinutes: 480,
        overtimeMinutes: 0,
        isLate: false,
        lateMinutes: 0,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        regularizationId: regId,
      };

      const result = AttendanceMapper.toRegularizedCreateData(input);

      expect(result.status).toBe(AttendanceStatus.REGULARIZED);
      expect(result.checkInSource).toBe(AttendanceSource.SYSTEM);
      expect(result.checkOutSource).toBe(AttendanceSource.SYSTEM);
      expect(result.regularizationId).toEqual(regId);
      expect(result.totalWorkMinutes).toBe(480);
    });
  });

  describe('toRegularizedUpdateData', () => {
    it('should map regularization approval update dictionary', () => {
      const checkInTime = new Date('2026-10-20T03:30:00.000Z');
      const checkOutTime = new Date('2026-10-20T12:30:00.000Z');

      const input: RegularizedAttendanceUpdateInput = {
        checkInTime,
        checkOutTime,
        status: AttendanceStatus.REGULARIZED,
        totalWorkMinutes: 480,
        overtimeMinutes: 30,
        isLate: false,
        lateMinutes: 0,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        regularizationId: regId,
      };

      const result = AttendanceMapper.toRegularizedUpdateData(input);

      expect(result).toEqual({
        checkInTime,
        checkOutTime,
        status: AttendanceStatus.REGULARIZED,
        totalWorkMinutes: 480,
        overtimeMinutes: 30,
        isLate: false,
        lateMinutes: 0,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        regularizationId: regId,
      });
    });
  });

  describe('toResponse and toResponseList', () => {
    const mockLeanDoc: AttendanceLean = {
      _id: attendanceId,
      employeeId,
      attendanceDate: '2026-10-21',
      date: new Date('2026-10-21T00:00:00.000Z'),
      shiftId,
      shiftSnapshot: {
        name: 'General Shift',
        code: 'GEN-01',
        startTime: '09:00',
        endTime: '18:00',
        isOvernight: false,
        gracePeriodMinutes: 15,
        breakDurationMinutes: 60,
        minWorkMinutesForFullDay: 480,
        minWorkMinutesForHalfDay: 240,
        overtimeThresholdMinutes: 480,
      },
      checkInTime: new Date('2026-10-21T09:00:00.000Z'),
      checkOutTime: new Date('2026-10-21T18:00:00.000Z'),
      status: AttendanceStatus.PRESENT,
      workMode: WorkMode.OFFICE,
      breaks: [
        {
          startTime: new Date('2026-10-21T13:00:00.000Z'),
          endTime: new Date('2026-10-21T14:00:00.000Z'),
          durationMinutes: 60,
          type: BreakType.LUNCH,
        },
      ],
      totalBreakMinutes: 60,
      totalWorkMinutes: 480,
      isLate: false,
      lateMinutes: 0,
      isEarlyDeparture: false,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      checkInSource: AttendanceSource.WEB,
      checkOutSource: AttendanceSource.WEB,
      checkInNotes: 'Morning check in',
      checkOutNotes: 'Evening check out',
      regularizationId: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date('2026-10-21T09:00:00.000Z'),
      updatedAt: new Date('2026-10-21T18:00:00.000Z'),
    };

    it('should map lean document to AttendanceResponse with string IDs', () => {
      const response = AttendanceMapper.toResponse(mockLeanDoc);

      expect(response.id).toBe(attendanceId.toString());
      expect(response.employeeId).toBe(employeeId.toString());
      expect(response.shiftId).toBe(shiftId.toString());
      expect(response.status).toBe(AttendanceStatus.PRESENT);
      expect(response.date).toBe('2026-10-21T00:00:00.000+05:30');
      expect(response.checkInTime).toBe('2026-10-21T14:30:00.000+05:30');
      expect(response.checkOutTime).toBe('2026-10-21T23:30:00.000+05:30');
      expect(response.breaks).toHaveLength(1);
      expect(response.breaks[0].type).toBe(BreakType.LUNCH);
      expect(response.breaks[0].startTime).toBe(
        '2026-10-21T18:30:00.000+05:30',
      );
      expect(response.breaks[0].endTime).toBe('2026-10-21T19:30:00.000+05:30');
      expect(response.createdAt).toBe('2026-10-21T14:30:00.000+05:30');
      expect(response.updatedAt).toBe('2026-10-21T23:30:00.000+05:30');
    });

    it('should map a list of lean documents', () => {
      const list = AttendanceMapper.toResponseList([mockLeanDoc]);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(attendanceId.toString());
    });
  });

  describe('toTodayStatus', () => {
    it('should return isCheckedIn: false when attendance is null', () => {
      const result = AttendanceMapper.toTodayStatus(null);
      expect(result).toEqual({
        isCheckedIn: false,
        isOnBreak: false,
        attendance: null,
      });
    });

    it('should return isCheckedIn: true and isOnBreak: true when status is ON_BREAK', () => {
      const mockLeanDoc = {
        _id: attendanceId,
        employeeId,
        attendanceDate: '2026-10-21',
        date: new Date('2026-10-21T00:00:00.000Z'),
        shiftId,
        shiftSnapshot: {
          name: 'General',
          code: 'GEN',
          startTime: '09:00',
          endTime: '18:00',
          isOvernight: false,
          gracePeriodMinutes: 15,
          minWorkMinutesForFullDay: 480,
          minWorkMinutesForHalfDay: 240,
          overtimeThresholdMinutes: 480,
        },
        checkInTime: new Date(),
        checkOutTime: null,
        status: AttendanceStatus.ON_BREAK,
        workMode: WorkMode.OFFICE,
        breaks: [],
        totalBreakMinutes: 0,
        totalWorkMinutes: 0,
        isLate: false,
        lateMinutes: 0,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        overtimeMinutes: 0,
        checkInSource: AttendanceSource.WEB,
        regularizationId: null,
        deletedAt: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as AttendanceLean;

      const result = AttendanceMapper.toTodayStatus(mockLeanDoc);
      expect(result.isCheckedIn).toBe(true);
      expect(result.isOnBreak).toBe(true);
      expect(result.attendance).not.toBeNull();
    });
  });
});
