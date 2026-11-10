/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './services/attendance.service';
import {
  AttendanceSource,
  AttendanceStatus,
  BreakType,
  RegularizationStatus,
  WorkMode,
} from './constants/attendance.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { CheckInDto } from './dto/check-in.dto';

describe('AttendanceController', () => {
  let controller: AttendanceController;
  let attendanceService: jest.Mocked<AttendanceService>;

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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        {
          provide: AttendanceService,
          useValue: {
            checkIn: jest.fn().mockResolvedValue(mockAttendanceResponse),
            recordManualAttendance: jest
              .fn()
              .mockResolvedValue(mockAttendanceResponse),
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
              incompleteDays: 0,
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
      ],
    }).compile();

    controller = module.get<AttendanceController>(AttendanceController);
    attendanceService = module.get(AttendanceService);
  });

  describe('checkIn', () => {
    it('should call attendanceService.checkIn and wrap response', async () => {
      const result = await controller.checkIn(
        { workMode: WorkMode.OFFICE },
        mockRequest,
      );

      expect(attendanceService.checkIn).toHaveBeenCalledWith(
        userId,
        { workMode: WorkMode.OFFICE },
        { ipAddress: '127.0.0.1', userAgent: 'JestRunner/1.0' },
      );
      expect(result).toEqual({ success: true, data: mockAttendanceResponse });
    });

    it('TC-11: should derive employee identity strictly from request.user.userId and ignore any employeeId in request body', async () => {
      const victimEmployeeId = new Types.ObjectId().toString();
      const maliciousBody = {
        workMode: WorkMode.OFFICE,
        employeeId: victimEmployeeId,
      } as unknown as CheckInDto;

      await controller.checkIn(maliciousBody, mockRequest);

      // The controller derives identity from session (request.user.userId) as first param
      expect(attendanceService.checkIn).toHaveBeenCalledWith(
        userId,
        maliciousBody,
        { ipAddress: '127.0.0.1', userAgent: 'JestRunner/1.0' },
      );
      expect(attendanceService.checkIn).not.toHaveBeenCalledWith(
        victimEmployeeId,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('recordManualAttendance', () => {
    it('should call attendanceService.recordManualAttendance and wrap response', async () => {
      const dto = {
        employeeId: new Types.ObjectId().toString(),
        attendanceDate: '2026-10-23',
        checkInTime: '2026-10-23T09:00:00.000Z',
      };
      const result = await controller.recordManualAttendance(dto, mockRequest);

      expect(attendanceService.recordManualAttendance).toHaveBeenCalledWith(
        userId,
        dto,
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

  describe('regularization REST endpoints (Option 1 and Option 2)', () => {
    const regId = new Types.ObjectId();
    const mockRegResponse = {
      id: regId.toString(),
      employeeId: new Types.ObjectId().toString(),
      attendanceDate: '2026-10-15',
      status: RegularizationStatus.APPROVED,
    };

    it('should approve regularization via PATCH action (Option 1)', async () => {
      (attendanceService.approveRegularization as jest.Mock).mockResolvedValue(
        mockRegResponse,
      );

      const result = await controller.approveRegularization(
        regId,
        { notes: 'Approved per email confirmation.' },
        mockRequest,
      );

      expect(attendanceService.approveRegularization).toHaveBeenCalledWith(
        regId,
        userId,
        { notes: 'Approved per email confirmation.' },
        { ipAddress: '127.0.0.1', userAgent: 'JestRunner/1.0' },
      );
      expect(result).toEqual({ success: true, data: mockRegResponse });
    });

    it('should reject regularization via PATCH action (Option 1)', async () => {
      (attendanceService.rejectRegularization as jest.Mock).mockResolvedValue({
        ...mockRegResponse,
        status: RegularizationStatus.REJECTED,
      });

      const result = await controller.rejectRegularization(
        regId,
        { reason: 'No evidence provided.' },
        mockRequest,
      );

      expect(attendanceService.rejectRegularization).toHaveBeenCalledWith(
        regId,
        userId,
        { reason: 'No evidence provided.' },
        { ipAddress: '127.0.0.1', userAgent: 'JestRunner/1.0' },
      );
      expect(result.data.status).toBe(RegularizationStatus.REJECTED);
    });

    it('should update regularization status via pure REST PATCH /status (Option 2) for APPROVED', async () => {
      (attendanceService.approveRegularization as jest.Mock).mockResolvedValue(
        mockRegResponse,
      );

      const result = await controller.updateRegularizationStatus(
        regId,
        {
          status: RegularizationStatus.APPROVED,
          comments: 'Approved, generating attendance record.',
        },
        mockRequest,
      );

      expect(attendanceService.approveRegularization).toHaveBeenCalledWith(
        regId,
        userId,
        expect.objectContaining({
          reviewRemarks: 'Approved, generating attendance record.',
          comments: 'Approved, generating attendance record.',
        }),
        { ipAddress: '127.0.0.1', userAgent: 'JestRunner/1.0' },
      );
      expect(result.success).toBe(true);
    });

    it('should update regularization status via pure REST PATCH /status (Option 2) for REJECTED', async () => {
      (attendanceService.rejectRegularization as jest.Mock).mockResolvedValue({
        ...mockRegResponse,
        status: RegularizationStatus.REJECTED,
      });

      const result = await controller.updateRegularizationStatus(
        regId,
        {
          status: RegularizationStatus.REJECTED,
          reason: 'No evidence provided.',
        },
        mockRequest,
      );

      expect(attendanceService.rejectRegularization).toHaveBeenCalledWith(
        regId,
        userId,
        expect.objectContaining({
          reason: 'No evidence provided.',
        }),
        { ipAddress: '127.0.0.1', userAgent: 'JestRunner/1.0' },
      );
      expect(result.success).toBe(true);
    });

    it('should reject pure REST PATCH /status if status is invalid', async () => {
      await expect(
        controller.updateRegularizationStatus(
          regId,
          {
            status: RegularizationStatus.PENDING,
          },
          mockRequest,
        ),
      ).rejects.toThrow('Invalid target status');
    });
  });
});
