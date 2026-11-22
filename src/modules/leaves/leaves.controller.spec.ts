/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { LeavesController } from './leaves.controller';
import { LeavesService } from './services/leaves.service';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import {
  HolidayType,
  LeaveRequestStatus,
  ReconcileCancellationAction,
} from './constants/leaves.constant';
import { LeaveTypeLean } from './repositories/leave-type.repository';
import { LeaveRequestLean } from './repositories/leave-request.repository';
import { LeaveTransactionLean } from './repositories/leave-transaction.repository';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { LeaveTransactionType } from './constants/leaves.constant';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { LeaveBalanceLean } from './repositories/leave-balance.repository';
import { AdjustLeaveBalanceDto } from './dto/adjust-leave-balance.dto';

describe('LeavesController', () => {
  let controller: LeavesController;
  let leavesService: jest.Mocked<LeavesService>;

  const userId = new Types.ObjectId();
  const mockRequest = {
    user: { userId, sessionId: new Types.ObjectId() },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestRunner/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockLeaveType: LeaveTypeLean = {
    _id: new Types.ObjectId(),
    name: 'Paid Casual Leave',
    code: 'CL',
    isPaid: true,
    annualAllocation: 12,
    allowHalfDay: true,
    allowNegativeBalance: false,
    allowDuringNoticePeriod: false,
    applicableEmploymentStatuses: [],
    deductWeekends: false,
    deductHolidays: false,
    maxConsecutiveDays: 5,
    requiresAttachment: false,
    isCarryForwardEnabled: false,
    maxCarryForwardDays: 0,
    isActive: true,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLeaveRequest: LeaveRequestLean = {
    _id: new Types.ObjectId(),
    employeeId: new Types.ObjectId(),
    leaveTypeId: mockLeaveType._id,
    leaveTypeSnapshot: {
      code: 'CL',
      name: 'Casual Leave',
      isPaid: true,
      allowHalfDay: true,
      deductWeekends: false,
      deductHolidays: false,
    },
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    totalDays: 2,
    isHalfDay: false,
    halfDaySession: null,
    yearBreakdown: [{ year: 2026, days: 2 }],
    reason: 'Family event',
    attachmentUrl: undefined,
    reportingManagerId: new Types.ObjectId(),
    status: LeaveRequestStatus.PENDING,
    appliedAt: new Date(),
    rejectionReason: undefined,
    cancellationReason: undefined,
    reconciliationNotes: undefined,
    approvalTimeline: [],
    deletedAt: null,
    createdBy: userId,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeavesController],
      providers: [
        {
          provide: LeavesService,
          useValue: {
            createLeaveType: jest.fn().mockResolvedValue(mockLeaveType),
            listLeaveTypes: jest.fn().mockResolvedValue({
              data: [mockLeaveType],
              meta: {
                total: 1,
                page: 1,
                limit: 20,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            }),
            getLeaveTypeById: jest.fn().mockResolvedValue(mockLeaveType),
            updateLeaveType: jest.fn().mockResolvedValue(mockLeaveType),
            updateLeaveTypeStatus: jest.fn().mockResolvedValue(mockLeaveType),
            deleteLeaveType: jest.fn().mockResolvedValue(undefined),
            listHolidays: jest.fn().mockResolvedValue({
              data: [
                {
                  _id: new Types.ObjectId(),
                  name: 'Republic Day',
                  date: '2027-01-26',
                  year: 2027,
                  type: HolidayType.PUBLIC,
                  branchId: null,
                  description: 'National holiday',
                  isActive: true,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              ],
              meta: {
                total: 1,
                page: 1,
                limit: 20,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            }),
            createHoliday: jest.fn().mockResolvedValue({
              _id: new Types.ObjectId(),
              name: 'Republic Day',
              date: '2027-01-26',
              year: 2027,
              type: HolidayType.PUBLIC,
              branchId: null,
              description: 'National holiday',
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
            applyLeave: jest.fn().mockResolvedValue(mockLeaveRequest),
            getMyRequests: jest.fn().mockResolvedValue({
              data: [mockLeaveRequest],
              meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
            }),
            listRequests: jest.fn().mockResolvedValue({
              data: [mockLeaveRequest],
              meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
            }),
            getRequestById: jest.fn().mockResolvedValue(mockLeaveRequest),
            approveLeave: jest.fn().mockResolvedValue({
              ...mockLeaveRequest,
              status: LeaveRequestStatus.APPROVED,
            }),
            rejectLeave: jest.fn().mockResolvedValue({
              ...mockLeaveRequest,
              status: LeaveRequestStatus.REJECTED,
            }),
            cancelLeave: jest.fn().mockResolvedValue({
              ...mockLeaveRequest,
              status: LeaveRequestStatus.CANCELLED,
            }),
            reconcileLeaveCancellation: jest.fn().mockResolvedValue({
              ...mockLeaveRequest,
              status: LeaveRequestStatus.CANCELLED,
            }),
            getMyBalances: jest.fn().mockResolvedValue([]),
            getEmployeeBalances: jest.fn().mockResolvedValue([]),
            allocateLeave: jest.fn().mockResolvedValue([]),
            adjustBalance: jest
              .fn()
              .mockResolvedValue({ availableBalance: 10 }),
            getMyTransactions: jest.fn().mockResolvedValue({
              data: [],
              meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
            }),
            getTransactions: jest.fn().mockResolvedValue({
              data: [],
              meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
            }),
            processYearEndCarryForward: jest.fn().mockResolvedValue({
              fromYear: 2025,
              toYear: 2026,
              processedEmployees: 1,
              totalCarriedForwardDays: 5,
            }),
            getMyCalendar: jest.fn().mockResolvedValue({
              employeeId: userId,
              startDate: '2026-06-01',
              endDate: '2026-06-30',
              leaves: [],
              holidays: [],
            }),
            getTeamCalendar: jest.fn().mockResolvedValue({
              managerId: userId,
              startDate: '2026-06-01',
              endDate: '2026-06-30',
              teamMembers: [],
              leaves: [],
              holidays: [],
            }),
            getOrganizationCalendar: jest.fn().mockResolvedValue({
              startDate: '2026-06-01',
              endDate: '2026-06-30',
              leaves: [],
              holidays: [],
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<LeavesController>(LeavesController);
    leavesService = module.get(LeavesService);
  });

  it('should create a leave type', async () => {
    const result = await controller.createLeaveType(
      {
        name: 'Paid Casual Leave',
        code: 'CL',
        isPaid: true,
        annualAllocation: 12,
      },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.code).toBe('CL');
    expect(leavesService.createLeaveType).toHaveBeenCalled();
  });

  it('should list leave types with pagination and meta', async () => {
    const result = await controller.listLeaveTypes({ page: 1, limit: 20 });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data[0].code).toBe('CL');
    expect(result.meta).toBeDefined();
    expect(result.meta?.total).toBe(1);
    expect(leavesService.listLeaveTypes).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
    });
  });

  it('should toggle or update leave type active status', async () => {
    const resultExplicit = await controller.toggleLeaveTypeStatus(
      mockLeaveType._id,
      { isActive: false },
      mockRequest,
    );

    expect(resultExplicit.success).toBe(true);
    expect(leavesService.updateLeaveTypeStatus).toHaveBeenCalledWith(
      userId,
      mockLeaveType._id,
      false,
      expect.any(Object),
    );

    const resultToggle = await controller.toggleLeaveTypeStatus(
      mockLeaveType._id,
      {},
      mockRequest,
    );

    expect(resultToggle.success).toBe(true);
    expect(leavesService.updateLeaveTypeStatus).toHaveBeenCalledWith(
      userId,
      mockLeaveType._id,
      undefined,
      expect.any(Object),
    );
  });

  it('should create a holiday and return success message and formatted data', async () => {
    const result = await controller.createHoliday(
      {
        name: 'Republic Day',
        date: '2027-01-26',
        description: 'National holiday',
        branchId: null,
      },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe('Holiday created successfully');
    expect(result.data.name).toBe('Republic Day');
    expect(result.data.date).toBe('2027-01-26');
    expect(result.data.branchId).toBeNull();
    expect(leavesService.createHoliday).toHaveBeenCalled();
  });

  it('should list holidays with pagination and meta', async () => {
    const result = await controller.listHolidays({ page: 1, limit: 20 });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.meta).toBeDefined();
    expect(result.meta?.total).toBe(1);
    expect(leavesService.listHolidays).toHaveBeenCalled();
  });

  it('should apply for leave', async () => {
    const result = await controller.applyLeave(
      {
        leaveTypeId: mockLeaveType._id.toString(),
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        reason: 'Family event',
      },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.totalDays).toBe(2);
    expect(leavesService.applyLeave).toHaveBeenCalled();
  });

  it('should approve leave request', async () => {
    const result = await controller.approveLeave(
      mockLeaveRequest._id,
      { remarks: 'Approved' },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(LeaveRequestStatus.APPROVED);
    expect(leavesService.approveLeave).toHaveBeenCalled();
  });

  it('should cancel leave request', async () => {
    const result = await controller.cancelLeave(
      mockLeaveRequest._id,
      { reason: 'Change of plans' },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(LeaveRequestStatus.CANCELLED);
    expect(leavesService.cancelLeave).toHaveBeenCalled();
  });

  it('should reconcile leave cancellation request', async () => {
    const result = await controller.reconcileLeaveCancellation(
      mockLeaveRequest._id,
      {
        action: ReconcileCancellationAction.APPROVE,
        remarks: 'Verified employee attendance',
        actualAttendanceDetails: 'Biometric records confirmed',
        refundedDays: 1,
      },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(LeaveRequestStatus.CANCELLED);
    expect(leavesService.reconcileLeaveCancellation).toHaveBeenCalled();
  });

  it('should reject leave request', async () => {
    const result = await controller.rejectLeave(
      mockLeaveRequest._id,
      { reason: 'Coverage shortage' },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(LeaveRequestStatus.REJECTED);
    expect(leavesService.rejectLeave).toHaveBeenCalled();
  });

  it('should process carry-forward', async () => {
    const result = await controller.processCarryForward(
      { fromYear: 2025, toYear: 2026 },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.totalCarriedForwardDays).toBe(5);
    expect(leavesService.processYearEndCarryForward).toHaveBeenCalled();
  });

  it('should get personal calendar', async () => {
    const result = await controller.getMyCalendar(
      { startDate: '2026-06-01', endDate: '2026-06-30' },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.startDate).toBe('2026-06-01');
    expect(leavesService.getMyCalendar).toHaveBeenCalled();
  });

  it('should get team calendar', async () => {
    const result = await controller.getTeamCalendar(
      { startDate: '2026-06-01', endDate: '2026-06-30' },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(leavesService.getTeamCalendar).toHaveBeenCalled();
  });

  it('should get organization calendar', async () => {
    const result = await controller.getOrganizationCalendar({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });

    expect(result.success).toBe(true);
    expect(leavesService.getOrganizationCalendar).toHaveBeenCalled();
  });

  it('should get employee leave balances by ID', async () => {
    const targetEmpId = new Types.ObjectId();
    const result = await controller.getEmployeeBalances(
      targetEmpId,
      mockRequest,
      2026,
    );

    expect(result.success).toBe(true);
    expect(leavesService.getEmployeeBalances).toHaveBeenCalledWith(
      userId,
      targetEmpId,
      2026,
    );
  });

  it('should get employee leave balances with default current year when year is omitted', async () => {
    const targetEmpId = new Types.ObjectId();
    const result = await controller.getEmployeeBalances(
      targetEmpId,
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(leavesService.getEmployeeBalances).toHaveBeenCalledWith(
      userId,
      targetEmpId,
      new Date().getUTCFullYear(),
    );
  });

  describe('getEmployeeTransactions', () => {
    it('should get employee leave transactions by employee ID', async () => {
      const targetEmpId = new Types.ObjectId();
      const mockResult: PaginatedResult<LeaveTransactionLean> = {
        data: [
          {
            _id: new Types.ObjectId(),
            employeeId: targetEmpId,
            leaveTypeId: new Types.ObjectId(),
            year: 2026,
            days: 10,
            previousAvailable: 0,
            newAvailable: 10,
            referenceId: null,
            transactionType: LeaveTransactionType.ALLOCATION,
            actorId: userId,
            createdAt: new Date(),
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      leavesService.getTransactions.mockResolvedValue(mockResult);

      const query = { page: 1, limit: 20 };
      const result = await controller.getEmployeeTransactions(
        targetEmpId,
        query,
        mockRequest,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResult.data);
      expect(result.meta).toEqual(mockResult.meta);
      expect(leavesService.getTransactions).toHaveBeenCalledWith(
        userId,
        targetEmpId,
        query,
      );
    });

    it('should pass filters to leavesService.getTransactions', async () => {
      const targetEmpId = new Types.ObjectId();
      const query = {
        page: 2,
        limit: 10,
        leaveTypeId: new Types.ObjectId().toString(),
        year: 2026,
      };

      await controller.getEmployeeTransactions(targetEmpId, query, mockRequest);

      expect(leavesService.getTransactions).toHaveBeenCalledWith(
        userId,
        targetEmpId,
        query,
      );
    });
  });

  describe('getMyTransactions', () => {
    it('should get own leave balance transactions for authenticated user', async () => {
      const mockResult: PaginatedResult<LeaveTransactionLean> = {
        data: [
          {
            _id: new Types.ObjectId(),
            employeeId: new Types.ObjectId(),
            leaveTypeId: new Types.ObjectId(),
            year: 2026,
            days: 5,
            previousAvailable: 0,
            newAvailable: 5,
            referenceId: null,
            transactionType: LeaveTransactionType.ALLOCATION,
            actorId: userId,
            createdAt: new Date(),
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      leavesService.getMyTransactions.mockResolvedValue(mockResult);

      const query = { page: 1, limit: 20 };
      const result = await controller.getMyTransactions(query, mockRequest);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResult.data);
      expect(result.meta).toEqual(mockResult.meta);
      expect(leavesService.getMyTransactions).toHaveBeenCalledWith(
        userId,
        query,
      );
    });
  });

  describe('adjustBalance (POST /balances/adjust)', () => {
    it('Test 21: should enforce LEAVE_BALANCES_ADJUST permission metadata on adjustBalance route', () => {
      const requiredPermissions: unknown = Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        LeavesController.prototype.adjustBalance,
      );
      expect(requiredPermissions).toEqual([
        PermissionKeys.LEAVE_BALANCES_ADJUST,
      ]);
    });

    it('should adjust leave balance and return standard API response with mapped balance data', async () => {
      const mockDto: AdjustLeaveBalanceDto = {
        employeeId: new Types.ObjectId().toString(),
        leaveTypeId: mockLeaveType._id.toString(),
        year: 2026,
        adjustmentType: 'CREDIT',
        days: 1.5,
        reason:
          'Correction for overtime worked during branch system migration.',
      };
      const mockBalance: LeaveBalanceLean = {
        _id: new Types.ObjectId(),
        employeeId: new Types.ObjectId(mockDto.employeeId),
        leaveTypeId: mockLeaveType._id,
        year: 2026,
        allocatedDays: 12,
        carriedForwardDays: 0,
        creditedDays: 1.5,
        debitedDays: 0,
        pendingDays: 0,
        usedDays: 0,
        availableBalance: 13.5,
        updatedBy: userId,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      leavesService.adjustBalance.mockResolvedValue(mockBalance);

      const response = await controller.adjustBalance(mockDto, mockRequest);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(
        expect.objectContaining({
          id: mockBalance._id.toString(),
          employeeId: mockDto.employeeId,
          leaveTypeId: mockLeaveType._id.toString(),
          year: 2026,
          creditedDays: 1.5,
          availableBalance: 13.5,
        }),
      );
      expect(leavesService.adjustBalance).toHaveBeenCalledWith(
        userId,
        mockDto,
        {
          ipAddress: '127.0.0.1',
          userAgent: 'JestRunner/1.0',
        },
      );
    });
  });

  describe('processCarryForward (POST /balances/carry-forward)', () => {
    it('Test 33: should enforce LEAVE_BALANCES_CARRY_FORWARD permission metadata on processCarryForward route', () => {
      const requiredPermissions: unknown = Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        LeavesController.prototype.processCarryForward,
      );
      expect(requiredPermissions).toEqual([
        PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD,
      ]);
    });

    it('Test 34/35: should execute carry forward with actor ID and return standard response', async () => {
      const mockDto = {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: mockLeaveType._id.toString(),
        employeeId: new Types.ObjectId().toString(),
      };
      const mockResult = {
        fromYear: 2025,
        toYear: 2026,
        processedEmployees: 1,
        totalCarriedForwardDays: 5,
      };
      leavesService.processYearEndCarryForward.mockResolvedValue(mockResult);

      const response = await controller.processCarryForward(
        mockDto,
        mockRequest,
      );

      expect(response.success).toBe(true);
      expect(response.data).toEqual(mockResult);
      expect(leavesService.processYearEndCarryForward).toHaveBeenCalledWith(
        userId,
        mockDto,
        {
          ipAddress: '127.0.0.1',
          userAgent: 'JestRunner/1.0',
        },
      );
    });
  });
});
