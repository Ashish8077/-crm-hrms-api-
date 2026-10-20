/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './services/attendance.service';
import { ShiftService } from './services/shift.service';
import {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
  BreakType,
} from './constants/attendance.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('AttendanceController', () => {
  let controller: AttendanceController;
  let attendanceService: jest.Mocked<AttendanceService>;
  let shiftService: jest.Mocked<ShiftService>;

  const userId = new Types.ObjectId();
  const mockRequest = {
    user: { userId, sessionId: new Types.ObjectId() },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestRunner/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockAttendanceResponse = {
    id: new Types.ObjectId().toString(),
    employeeId: new Types.ObjectId().toString(),
    attendanceDate: '2026-10-15',
    date: new Date('2026-10-15T00:00:00.000Z'),
    shiftId: new Types.ObjectId().toString(),
    shiftSnapshot: {
      name: 'General Shift',
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
    status: AttendanceStatus.CHECKED_IN,
    attendanceType: AttendanceType.REGULAR,
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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        {
          provide: AttendanceService,
          useValue: {
            checkIn: jest.fn().mockResolvedValue(mockAttendanceResponse),
            checkOut: jest.fn().mockResolvedValue(mockAttendanceResponse),
            startBreak: jest.fn().mockResolvedValue(mockAttendanceResponse),
            endBreak: jest.fn().mockResolvedValue(mockAttendanceResponse),
            getTodayStatus: jest.fn().mockResolvedValue({
              isCheckedIn: true,
              isOnBreak: false,
              attendance: mockAttendanceResponse,
            }),
            getCalendar: jest.fn().mockResolvedValue([mockAttendanceResponse]),
            getMonthlySummary: jest.fn().mockResolvedValue({
              totalRecords: 1,
              presentDays: 1,
              halfDays: 0,
              absentDays: 0,
              lateDays: 0,
              earlyDepartures: 0,
              totalWorkingMinutes: 480,
              totalOvertimeMinutes: 0,
              totalBreakMinutes: 0,
            }),
            createRegularization: jest.fn(),
            listRegularizations: jest.fn(),
            approveRegularization: jest.fn(),
            rejectRegularization: jest.fn(),
            listReports: jest.fn(),
          },
        },
        {
          provide: ShiftService,
          useValue: {
            create: jest.fn(),
            list: jest.fn(),
            getById: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            assignShift: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AttendanceController>(AttendanceController);
    attendanceService = module.get(AttendanceService);
    shiftService = module.get(ShiftService);
  });

  describe('checkIn', () => {
    it('should call attendanceService.checkIn and wrap response', async () => {
      const result = await controller.checkIn(
        { attendanceType: AttendanceType.REGULAR },
        mockRequest,
      );

      expect(attendanceService.checkIn).toHaveBeenCalledWith(
        userId,
        { attendanceType: AttendanceType.REGULAR },
        { ipAddress: '127.0.0.1', userAgent: 'JestRunner/1.0' },
      );
      expect(result).toEqual({ success: true, data: mockAttendanceResponse });
    });
  });

  describe('checkOut', () => {
    it('should call attendanceService.checkOut and wrap response', async () => {
      const result = await controller.checkOut({}, mockRequest);

      expect(attendanceService.checkOut).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: mockAttendanceResponse });
    });
  });

  describe('startBreak and endBreak', () => {
    it('should call startBreak with correct arguments', async () => {
      const result = await controller.startBreak(
        { type: BreakType.LUNCH },
        mockRequest,
      );

      expect(attendanceService.startBreak).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should call endBreak with correct arguments', async () => {
      const result = await controller.endBreak({}, mockRequest);

      expect(attendanceService.endBreak).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('getTodayStatus', () => {
    it('should call getTodayStatus and wrap response', async () => {
      const result = await controller.getTodayStatus(mockRequest);

      expect(attendanceService.getTodayStatus).toHaveBeenCalledWith(userId);
      expect(result.success).toBe(true);
      expect(result.data.isCheckedIn).toBe(true);
    });
  });

  describe('shifts', () => {
    it('should call shiftService.list and wrap response', async () => {
      const mockShifts = [{ id: '1', name: 'General', code: 'GEN' } as any];
      shiftService.list.mockResolvedValue(mockShifts);

      const result = await controller.listShifts({});

      expect(shiftService.list).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: true, data: mockShifts });
    });
  });
});
