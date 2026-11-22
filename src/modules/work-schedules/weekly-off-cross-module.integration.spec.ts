/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-enum-comparison */
import { HttpStatus } from '@nestjs/common';
import { Connection, Types } from 'mongoose';
import { WeeklyOffService } from './services/weekly-off.service';
import { WeeklyOffConfigRepository } from './repositories/weekly-off-config.repository';
import { WeeklyOffConfigLean } from './mappers/weekly-off-config.mapper';
import { DayOfWeek, WeekOccurrence } from './constants/weekly-off.constant';
import { LeavesService } from '../leaves/services/leaves.service';
import { CompOffService } from '../leaves/services/comp-off.service';
import { AttendanceService } from '../attendance/services/attendance.service';
import {
  LeaveTypeRepository,
  LeaveTypeLean,
} from '../leaves/repositories/leave-type.repository';
import {
  LeaveBalanceRepository,
  LeaveBalanceLean,
} from '../leaves/repositories/leave-balance.repository';
import {
  LeaveRequestRepository,
  LeaveRequestLean,
} from '../leaves/repositories/leave-request.repository';
import {
  LeaveTransactionRepository,
  LeaveTransactionLean,
} from '../leaves/repositories/leave-transaction.repository';
import {
  HolidayRepository,
  HolidayLean,
} from '../leaves/repositories/holiday.repository';
import {
  CompOffRepository,
  CompOffRecordLean,
} from '../leaves/repositories/comp-off-record.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../employees/repositories/employee.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import {
  AttendanceRepository,
  AttendanceLean,
} from '../attendance/repositories/attendance.repository';
import {
  AttendanceRegularizationRepository,
  AttendanceRegularizationLean,
} from '../attendance/repositories/attendance-regularization.repository';
import { ShiftService } from '../attendance/services/shift.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  LeaveRequestStatus,
  CompOffStatus,
} from '../leaves/constants/leaves.constant';
import {
  AttendanceStatus,
  AttendanceSource,
  WorkMode,
} from '../attendance/constants/attendance.constant';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import { AppError } from '../../common/errors/app-error';

describe('Weekly Off Cross-Module Integration Suite (Attendance & Leaves)', () => {
  // In-memory data stores for hermetic execution
  const weeklyOffConfigsStore = new Map<string, WeeklyOffConfigLean>();
  const employeesStore = new Map<string, EmployeeLean>();
  const leaveTypesStore = new Map<string, LeaveTypeLean>();
  const leaveBalancesStore = new Map<string, LeaveBalanceLean>();
  const leaveRequestsStore = new Map<string, LeaveRequestLean>();
  const leaveTransactionsStore: LeaveTransactionLean[] = [];
  const attendanceStore = new Map<string, AttendanceLean>();
  const compOffStore = new Map<string, CompOffRecordLean>();
  const regularizationStore = new Map<string, AttendanceRegularizationLean>();
  const holidaysStore: HolidayLean[] = [];

  // Services under test
  let weeklyOffService: WeeklyOffService;
  let leavesService: LeavesService;
  let compOffService: CompOffService;
  let attendanceService: AttendanceService;
  let leaveBalanceRepo: jest.Mocked<LeaveBalanceRepository>;

  // Identity fixtures
  const adminUserId = new Types.ObjectId();
  const managerUserId = new Types.ObjectId();
  const managerEmployeeId = new Types.ObjectId();

  const bangaloreBranchId = new Types.ObjectId();
  const delhiBranchId = new Types.ObjectId();

  const blrEmpUserId = new Types.ObjectId();
  const blrEmpId = new Types.ObjectId();

  const delEmpUserId = new Types.ObjectId();
  const delEmpId = new Types.ObjectId();

  const paidLeaveTypeId = new Types.ObjectId();
  const compOffLeaveTypeId = new Types.ObjectId();
  const shiftId = new Types.ObjectId();

  const clientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'JestCrossModule/1.0',
  };

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation(async (cb: () => Promise<unknown>) => cb()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  } as unknown as Connection;

  beforeAll(() => {
    // ─── 1. Weekly Off Config Repository ───
    const weeklyOffRepo = {
      create: jest.fn(async (data: Partial<WeeklyOffConfigLean>) => {
        const id = new Types.ObjectId();
        const doc: WeeklyOffConfigLean = {
          _id: id,
          branchId: data.branchId ?? null,
          name: data.name!,
          description: data.description ?? null,
          days: data.days ?? [],
          effectiveFrom: data.effectiveFrom!,
          effectiveTo: data.effectiveTo ?? null,
          isActive: data.isActive ?? true,
          deletedAt: null,
          createdBy: data.createdBy ?? adminUserId,
          updatedBy: null,
          deletedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        weeklyOffConfigsStore.set(id.toString(), doc);
        return doc;
      }),
      findById: jest.fn(async (id: Types.ObjectId | string) => {
        const doc = weeklyOffConfigsStore.get(id.toString());
        return doc && !doc.deletedAt ? { ...doc } : null;
      }),
      findEffectiveConfig: jest.fn(
        async (date: string, branchId?: Types.ObjectId | null) => {
          const targetBranch = branchId ? branchId.toString() : null;
          let matched: WeeklyOffConfigLean | null = null;

          for (const config of weeklyOffConfigsStore.values()) {
            if (config.deletedAt || !config.isActive) continue;
            const configBranch = config.branchId
              ? config.branchId.toString()
              : null;
            if (configBranch !== targetBranch) continue;
            if (config.effectiveFrom > date) continue;
            if (config.effectiveTo && config.effectiveTo < date) continue;

            if (
              !matched ||
              config.effectiveFrom > matched.effectiveFrom ||
              (config.effectiveFrom === matched.effectiveFrom &&
                config.createdAt &&
                matched.createdAt &&
                config.createdAt > matched.createdAt)
            ) {
              matched = config;
            }
          }
          return matched ? { ...matched } : null;
        },
      ),
      findOverlappingConfig: jest.fn(async () => null),
      update: jest.fn(
        async (id: Types.ObjectId, update: Partial<WeeklyOffConfigLean>) => {
          const doc = weeklyOffConfigsStore.get(id.toString());
          if (!doc) return null;
          Object.assign(doc, update);
          return { ...doc };
        },
      ),
    } as unknown as jest.Mocked<WeeklyOffConfigRepository>;

    // ─── 2. Branch Repository ───
    const branchRepo = {
      findById: jest.fn(async (id: Types.ObjectId) => ({
        _id: id,
        name:
          id.toString() === bangaloreBranchId.toString()
            ? 'Bangalore Tech Park'
            : 'Delhi Hub',
        isActive: true,
      })),
    } as unknown as jest.Mocked<BranchRepository>;

    // ─── 3. Audit Logs Service ───
    const auditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AuditLogsService>;

    // ─── 4. Authorization Service ───
    const authorizationService = {
      hasPermission: jest.fn().mockResolvedValue(true),
      hasPermissions: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AuthorizationService>;

    // ─── 5. Initialize Centralized WeeklyOffService ───
    weeklyOffService = new WeeklyOffService(
      weeklyOffRepo,
      branchRepo,
      auditLogsService,
      mockConnection,
    );

    // ─── 6. Employee Repository ───
    const employeeRepo = {
      findByUserId: jest.fn(async (userId: Types.ObjectId) => {
        for (const emp of employeesStore.values()) {
          if (
            emp.userId &&
            emp.userId.toString() === userId.toString() &&
            !emp.deletedAt
          ) {
            return { ...emp };
          }
        }
        return null;
      }),
      findById: jest.fn(async (id: Types.ObjectId) => {
        const emp = employeesStore.get(id.toString());
        return emp && !emp.deletedAt ? { ...emp } : null;
      }),
      updateById: jest.fn(
        async (id: Types.ObjectId, update: Partial<EmployeeLean>) => {
          const emp = employeesStore.get(id.toString());
          if (!emp) return null;
          Object.assign(emp, update);
          return { ...emp };
        },
      ),
    } as unknown as jest.Mocked<EmployeeRepository>;

    // ─── 7. Leave Type Repository ───
    const leaveTypeRepo = {
      findById: jest.fn(async (id: Types.ObjectId) => {
        const lt = leaveTypesStore.get(id.toString());
        return lt && !lt.deletedAt ? { ...lt } : null;
      }),
    } as unknown as jest.Mocked<LeaveTypeRepository>;

    // ─── 8. Leave Balance Repository ───
    leaveBalanceRepo = {
      findByEmployeeTypeYear: jest.fn(
        async (
          employeeId: Types.ObjectId,
          leaveTypeId: Types.ObjectId,
          year: number,
        ) => {
          for (const bal of leaveBalancesStore.values()) {
            if (
              bal.employeeId.toString() === employeeId.toString() &&
              bal.leaveTypeId.toString() === leaveTypeId.toString() &&
              bal.year === year
            ) {
              return { ...bal };
            }
          }
          return null;
        },
      ),
      reserveBalance: jest.fn(
        async (
          employeeId: Types.ObjectId,
          leaveTypeId: Types.ObjectId,
          year: number,
          days: number,
        ) => {
          for (const bal of leaveBalancesStore.values()) {
            if (
              bal.employeeId.toString() === employeeId.toString() &&
              bal.leaveTypeId.toString() === leaveTypeId.toString() &&
              bal.year === year
            ) {
              bal.pendingDays += days;
              bal.availableBalance -= days;
              bal.updatedAt = new Date();
              return { ...bal };
            }
          }
          return null;
        },
      ),
      debitApprovedBalance: jest.fn(
        async (
          employeeId: Types.ObjectId,
          leaveTypeId: Types.ObjectId,
          year: number,
          days: number,
        ) => {
          for (const bal of leaveBalancesStore.values()) {
            if (
              bal.employeeId.toString() === employeeId.toString() &&
              bal.leaveTypeId.toString() === leaveTypeId.toString() &&
              bal.year === year
            ) {
              bal.pendingDays -= days;
              bal.usedDays += days;
              bal.updatedAt = new Date();
              return { ...bal };
            }
          }
          return null;
        },
      ),
      creditBalance: jest.fn(
        async (
          employeeId: Types.ObjectId,
          leaveTypeId: Types.ObjectId,
          year: number,
          days: number,
        ) => {
          for (const bal of leaveBalancesStore.values()) {
            if (
              bal.employeeId.toString() === employeeId.toString() &&
              bal.leaveTypeId.toString() === leaveTypeId.toString() &&
              bal.year === year
            ) {
              bal.allocatedDays += days;
              bal.availableBalance += days;
              bal.updatedAt = new Date();
              return { ...bal };
            }
          }
          return null;
        },
      ),
    } as unknown as jest.Mocked<LeaveBalanceRepository>;

    // ─── 9. Leave Request Repository ───
    const leaveRequestRepo = {
      create: jest.fn(async (data: Partial<LeaveRequestLean>) => {
        const id = new Types.ObjectId();
        const doc: LeaveRequestLean = {
          _id: id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as LeaveRequestLean;
        leaveRequestsStore.set(id.toString(), doc);
        return doc;
      }),
      findById: jest.fn(async (id: Types.ObjectId) => {
        const doc = leaveRequestsStore.get(id.toString());
        return doc ? { ...doc } : null;
      }),
      findOverlappingRequests: jest.fn(async () => []),
      updateById: jest.fn(
        async (id: Types.ObjectId, update: Partial<LeaveRequestLean>) => {
          const doc = leaveRequestsStore.get(id.toString());
          if (!doc) return null;
          Object.assign(doc, update);
          return { ...doc };
        },
      ),
      updateStatus: jest.fn(
        async (
          id: Types.ObjectId,
          expectedStatus: LeaveRequestStatus,
          newStatus: LeaveRequestStatus,
          extra?: Record<string, unknown>,
        ) => {
          const doc = leaveRequestsStore.get(id.toString());
          if (!doc || doc.status !== expectedStatus) return null;
          doc.status = newStatus;
          if (extra) {
            Object.assign(doc, extra);
          }
          return { ...doc };
        },
      ),
    } as unknown as jest.Mocked<LeaveRequestRepository>;

    // ─── 10. Leave Transaction Repository ───
    const leaveTransactionRepo = {
      create: jest.fn(async (data: Partial<LeaveTransactionLean>) => {
        const record = {
          _id: new Types.ObjectId(),
          createdAt: new Date(),
          ...data,
        } as LeaveTransactionLean;
        leaveTransactionsStore.push(record);
        return record;
      }),
    } as unknown as jest.Mocked<LeaveTransactionRepository>;

    // ─── 11. Holiday Repository ───
    const holidayRepo = {
      findApplicableHolidays: jest.fn(
        async (startDate: string, endDate: string) => {
          return holidaysStore.filter(
            (h) => h.isActive && h.date >= startDate && h.date <= endDate,
          );
        },
      ),
      findByDate: jest.fn(async (date: string) => {
        return holidaysStore.find((h) => h.isActive && h.date === date) ?? null;
      }),
      findByDateAndBranch: jest.fn(
        async (date: string, branchId?: Types.ObjectId | null) => {
          return (
            holidaysStore.find(
              (h) =>
                h.isActive &&
                h.date === date &&
                (!h.branchId ||
                  !branchId ||
                  h.branchId.toString() === branchId.toString()),
            ) ?? null
          );
        },
      ),
    } as unknown as jest.Mocked<HolidayRepository>;

    // ─── 12. Attendance Repository ───
    const attendanceRepo = {
      create: jest.fn(async (data: Partial<AttendanceLean>) => {
        const id = new Types.ObjectId();
        const doc = {
          _id: id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as AttendanceLean;
        attendanceStore.set(
          `${data.employeeId?.toString()}_${data.attendanceDate}`,
          doc,
        );
        return doc;
      }),
      findByEmployeeAndDate: jest.fn(
        async (employeeId: Types.ObjectId, date: string) => {
          return (
            attendanceStore.get(`${employeeId.toString()}_${date}`) ?? null
          );
        },
      ),
      upsertOnLeaveRecord: jest.fn(
        async (data: {
          employeeId: Types.ObjectId;
          attendanceDate: string;
          reason?: string;
        }) => {
          const key = `${data.employeeId.toString()}_${data.attendanceDate}`;
          const existing = attendanceStore.get(key);
          if (existing) {
            existing.status = AttendanceStatus.ON_LEAVE;
            return existing;
          }
          const [year, month, day] = data.attendanceDate.split('-').map(Number);
          const newDoc: AttendanceLean = {
            _id: new Types.ObjectId(),
            employeeId: data.employeeId,
            attendanceDate: data.attendanceDate,
            date: new Date(Date.UTC(year, month - 1, day)),
            shiftId,
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
            status: AttendanceStatus.ON_LEAVE,
            workMode: WorkMode.OFFICE,
            checkInTime: null,
            checkOutTime: null,
            breaks: [],
            totalBreakMinutes: 0,
            totalWorkMinutes: 0,
            isLate: false,
            lateMinutes: 0,
            isEarlyDeparture: false,
            earlyDepartureMinutes: 0,
            overtimeMinutes: 0,
            checkInSource: AttendanceSource.SYSTEM,
            checkInIp: undefined,
            regularizationId: null,
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          attendanceStore.set(key, newDoc);
          return newDoc;
        },
      ),
      syncLeaveAttendance: jest.fn(
        async (
          employeeId: Types.ObjectId,
          attendanceDate: string,
          status: AttendanceStatus,
          targetShiftId: Types.ObjectId,
        ) => {
          const key = `${employeeId.toString()}_${attendanceDate}`;
          const existing = attendanceStore.get(key);
          if (existing) {
            existing.status = status;
            return existing;
          }
          const [year, month, day] = attendanceDate.split('-').map(Number);
          const newDoc: AttendanceLean = {
            _id: new Types.ObjectId(),
            employeeId,
            attendanceDate,
            date: new Date(Date.UTC(year, month - 1, day)),
            shiftId: targetShiftId ?? shiftId,
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
            status,
            workMode: WorkMode.OFFICE,
            checkInTime: null,
            checkOutTime: null,
            breaks: [],
            totalBreakMinutes: 0,
            totalWorkMinutes: 0,
            isLate: false,
            lateMinutes: 0,
            isEarlyDeparture: false,
            earlyDepartureMinutes: 0,
            overtimeMinutes: 0,
            checkInSource: AttendanceSource.SYSTEM,
            checkInIp: undefined,
            regularizationId: null,
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          attendanceStore.set(key, newDoc);
          return newDoc;
        },
      ),
    } as unknown as jest.Mocked<AttendanceRepository>;

    // ─── 13. Regularization Repository ───
    const regularizationRepo = {
      findPendingByEmployeeAndDate: jest.fn(
        async (employeeId: Types.ObjectId, date: string) => {
          for (const reg of regularizationStore.values()) {
            if (
              reg.employeeId.toString() === employeeId.toString() &&
              reg.attendanceDate === date &&
              reg.status === 'PENDING'
            ) {
              return reg;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async (data: Partial<AttendanceRegularizationLean>) => {
        const id = new Types.ObjectId();
        const doc = { _id: id, ...data } as AttendanceRegularizationLean;
        regularizationStore.set(id.toString(), doc);
        return doc;
      }),
    } as unknown as jest.Mocked<AttendanceRegularizationRepository>;

    // ─── 14. Comp-Off Repository ───
    const compOffRepo = {
      create: jest.fn(async (data: Partial<CompOffRecordLean>) => {
        const id = new Types.ObjectId();
        const doc = { _id: id, ...data } as CompOffRecordLean;
        compOffStore.set(id.toString(), doc);
        return doc;
      }),
      findByEmployeeAndAttendanceDate: jest.fn(
        async (employeeId: Types.ObjectId, date: string) => {
          for (const c of compOffStore.values()) {
            if (
              c.employeeId.toString() === employeeId.toString() &&
              c.attendanceDate === date &&
              !c.deletedAt
            ) {
              return c;
            }
          }
          return null;
        },
      ),
    } as unknown as jest.Mocked<CompOffRepository>;

    // ─── 15. Shift Service ───
    const shiftService = {
      findEmployeeShift: jest.fn().mockResolvedValue({
        shift: {
          _id: shiftId,
          name: 'General Shift',
          startTime: '09:00',
          endTime: '18:00',
          minWorkMinutesForFullDay: 480,
          minWorkMinutesForHalfDay: 240,
        },
      }),
      resolveShift: jest.fn().mockResolvedValue({
        _id: shiftId,
        name: 'General Shift',
        startTime: '09:00',
        endTime: '18:00',
        isOvernight: false,
        gracePeriodMinutes: 15,
        minWorkMinutesForFullDay: 480,
        minWorkMinutesForHalfDay: 240,
        overtimeThresholdMinutes: 480,
      }),
    } as unknown as jest.Mocked<ShiftService>;

    // ─── 16. Initialize Consumer Services with Centralized WeeklyOffService ───
    leavesService = new LeavesService(
      leaveTypeRepo,
      holidayRepo,
      leaveBalanceRepo,
      leaveRequestRepo,
      leaveTransactionRepo,
      compOffRepo,
      employeeRepo,
      branchRepo,
      attendanceRepo,
      shiftService,
      auditLogsService,
      authorizationService,
      mockConnection,
      weeklyOffService, // Injected Centralized WeeklyOffService
    );

    compOffService = new CompOffService(
      compOffRepo,
      leaveTypeRepo,
      leaveBalanceRepo,
      leaveTransactionRepo,
      employeeRepo,
      attendanceRepo,
      holidayRepo,
      auditLogsService,
      authorizationService,
      mockConnection,
      weeklyOffService, // Injected Centralized WeeklyOffService
    );

    attendanceService = new AttendanceService(
      attendanceRepo,
      regularizationRepo,
      employeeRepo,
      branchRepo,
      shiftService,
      auditLogsService,
      authorizationService,
      mockConnection,
      weeklyOffService, // Injected Centralized WeeklyOffService
    );
  });

  beforeEach(() => {
    weeklyOffConfigsStore.clear();
    employeesStore.clear();
    leaveTypesStore.clear();
    leaveBalancesStore.clear();
    leaveRequestsStore.clear();
    leaveTransactionsStore.length = 0;
    attendanceStore.clear();
    compOffStore.clear();
    regularizationStore.clear();
    holidaysStore.length = 0;

    // Seed Leave Types
    leaveTypesStore.set(paidLeaveTypeId.toString(), {
      _id: paidLeaveTypeId,
      name: 'Paid Annual Leave',
      code: 'PL',
      annualAllocation: 24,
      isPaid: true,
      allowHalfDay: true,
      allowNegativeBalance: false,
      allowDuringNoticePeriod: false,
      applicableEmploymentStatuses: [
        EmploymentStatus.ACTIVE,
        EmploymentStatus.PROBATION,
      ],
      requiresAttachment: false,
      deductWeekends: false,
      deductHolidays: false,
      isCarryForwardEnabled: false,
      maxCarryForwardDays: 0,
      isActive: true,
      deletedAt: null,
      createdBy: adminUserId,
      updatedBy: null,
      deletedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    leaveTypesStore.set(compOffLeaveTypeId.toString(), {
      _id: compOffLeaveTypeId,
      name: 'Compensatory Off',
      code: 'COMP_OFF',
      annualAllocation: 0,
      isPaid: true,
      allowHalfDay: true,
      allowNegativeBalance: false,
      allowDuringNoticePeriod: false,
      applicableEmploymentStatuses: [
        EmploymentStatus.ACTIVE,
        EmploymentStatus.PROBATION,
      ],
      requiresAttachment: false,
      deductWeekends: false,
      deductHolidays: false,
      isCarryForwardEnabled: false,
      maxCarryForwardDays: 0,
      isActive: true,
      deletedAt: null,
      createdBy: adminUserId,
      updatedBy: null,
      deletedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed Employees
    employeesStore.set(managerEmployeeId.toString(), {
      _id: managerEmployeeId,
      userId: managerUserId,
      employeeCode: 'MGR-001',
      firstName: 'Sarah',
      lastName: 'Manager',
      workEmail: 'sarah.manager@company.com',
      reportingManagerId: null,
      shiftId,
      branchId: bangaloreBranchId,
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2020-01-01'),
      departmentId: new Types.ObjectId(),
      designationId: new Types.ObjectId(),
      teamId: null,
      bankDetails: null,
      emergencyContact: null,
      skills: [],
      certifications: [],
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    });

    employeesStore.set(blrEmpId.toString(), {
      _id: blrEmpId,
      userId: blrEmpUserId,
      employeeCode: 'BLR-001',
      firstName: 'Aarav',
      lastName: 'Sharma',
      workEmail: 'aarav.blr@company.com',
      reportingManagerId: managerEmployeeId,
      shiftId,
      branchId: bangaloreBranchId,
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2022-01-01'),
      departmentId: new Types.ObjectId(),
      designationId: new Types.ObjectId(),
      teamId: null,
      bankDetails: null,
      emergencyContact: null,
      skills: [],
      certifications: [],
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    });

    employeesStore.set(delEmpId.toString(), {
      _id: delEmpId,
      userId: delEmpUserId,
      employeeCode: 'DEL-001',
      firstName: 'Rohan',
      lastName: 'Verma',
      workEmail: 'rohan.delhi@company.com',
      reportingManagerId: managerEmployeeId,
      shiftId,
      branchId: delhiBranchId,
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2022-01-01'),
      departmentId: new Types.ObjectId(),
      designationId: new Types.ObjectId(),
      teamId: null,
      bankDetails: null,
      emergencyContact: null,
      skills: [],
      certifications: [],
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    });

    // Seed Balances for Year 2026
    leaveBalancesStore.set(
      `${blrEmpId.toString()}_${paidLeaveTypeId.toString()}_2026`,
      {
        _id: new Types.ObjectId(),
        employeeId: blrEmpId,
        leaveTypeId: paidLeaveTypeId,
        year: 2026,
        allocatedDays: 24,
        carriedForwardDays: 0,
        creditedDays: 0,
        debitedDays: 0,
        usedDays: 0,
        availableBalance: 24,
        pendingDays: 0,
        deletedAt: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    leaveBalancesStore.set(
      `${delEmpId.toString()}_${paidLeaveTypeId.toString()}_2026`,
      {
        _id: new Types.ObjectId(),
        employeeId: delEmpId,
        leaveTypeId: paidLeaveTypeId,
        year: 2026,
        allocatedDays: 24,
        carriedForwardDays: 0,
        creditedDays: 0,
        debitedDays: 0,
        usedDays: 0,
        availableBalance: 24,
        pendingDays: 0,
        deletedAt: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    // Seed Configurations:
    // 1. Company-Wide Default: Every Sunday off (occurrences 1..5)
    weeklyOffConfigsStore.set('company_default', {
      _id: new Types.ObjectId(),
      branchId: null,
      name: 'Corporate Default Policy',
      description: 'Sundays are off across all standard locations',
      days: [
        {
          dayOfWeek: DayOfWeek.SUNDAY,
          occurrences: [1, 2, 3, 4, 5],
        },
      ],
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      isActive: true,
      deletedAt: null,
      createdBy: adminUserId,
      updatedBy: null,
      deletedBy: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    // 2. Bangalore Branch Override: Every Sunday + 2nd and 4th Saturday
    weeklyOffConfigsStore.set('bangalore_override', {
      _id: new Types.ObjectId(),
      branchId: bangaloreBranchId,
      name: 'Bangalore Tech Center Policy',
      description: 'Every Sunday and 2nd/4th Saturday off',
      days: [
        {
          dayOfWeek: DayOfWeek.SUNDAY,
          occurrences: [1, 2, 3, 4, 5],
        },
        {
          dayOfWeek: DayOfWeek.SATURDAY,
          occurrences: [WeekOccurrence.SECOND, WeekOccurrence.FOURTH],
        },
      ],
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      isActive: true,
      deletedAt: null,
      createdBy: adminUserId,
      updatedBy: null,
      deletedBy: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
  });

  describe('1. Leave Duration Calculation & Deductions', () => {
    // October 2026 Calendar Reference:
    // 2026-10-09 : Friday (Working day)
    // 2026-10-10 : 2nd Saturday (Weekly Off for Bangalore; Regular day for Delhi)
    // 2026-10-11 : Sunday (Weekly Off for ALL)
    // 2026-10-12 : Monday (Working day)

    it('TC-XO-01: Bangalore employee applies Friday to Monday -> only 2 days deducted (Sat 10 & Sun 11 excluded)', async () => {
      const response = await leavesService.applyLeave(
        blrEmpUserId,
        {
          leaveTypeId: paidLeaveTypeId.toString(),
          startDate: '2026-10-09',
          endDate: '2026-10-12',
          reason: 'Extended weekend getaway to Coorg',
        },
        clientMetadata,
      );

      // Total calendar span: 4 days (Fri, Sat, Sun, Mon)
      // Bangalore branch has 2nd Saturday (Oct 10) and Sunday (Oct 11) as Weekly Offs
      // Only Friday and Monday are deducted
      expect(response.totalDays).toBe(2);
      expect(response.status).toBe(LeaveRequestStatus.PENDING);

      // Verify excluded dates stored on LeaveRequest document for historical preservation
      const savedDoc = leaveRequestsStore.get(response._id.toString());
      expect(savedDoc?.excludedDates).toBeDefined();
      expect(savedDoc?.excludedDates).toEqual(
        expect.arrayContaining(['2026-10-10', '2026-10-11']),
      );
      expect(savedDoc?.excludedDates?.length).toBe(2);

      // Verify leave balance reserved by 2 days (available: 24 - 2 = 22, pending: 2)
      const balance = await leaveBalanceRepo.findByEmployeeTypeYear(
        blrEmpId,
        paidLeaveTypeId,
        2026,
      );
      expect(balance?.pendingDays).toBe(2);
      expect(balance?.availableBalance).toBe(22);
    });

    it('TC-XO-02: Delhi employee (Company Default) applies Friday to Monday -> 3 days deducted (only Sun 11 excluded)', async () => {
      const response = await leavesService.applyLeave(
        delEmpUserId,
        {
          leaveTypeId: paidLeaveTypeId.toString(),
          startDate: '2026-10-09',
          endDate: '2026-10-12',
          reason: 'Family visit in Delhi',
        },
        clientMetadata,
      );

      // Delhi employee falls back to Company Default (Every Sunday off, Saturdays are working)
      // Friday, Saturday, Monday are deductible working days = 3 days
      expect(response.totalDays).toBe(3);
      expect(response.status).toBe(LeaveRequestStatus.PENDING);

      const savedDoc = leaveRequestsStore.get(response._id.toString());
      expect(savedDoc?.excludedDates).toEqual(['2026-10-11']);

      const balance = await leaveBalanceRepo.findByEmployeeTypeYear(
        delEmpId,
        paidLeaveTypeId,
        2026,
      );
      expect(balance?.pendingDays).toBe(3);
      expect(balance?.availableBalance).toBe(21);
    });
  });

  describe('2. Leave Approval & Attendance Syncing', () => {
    it('TC-XO-03: Approving leave never creates ON_LEAVE attendance on branch weekly offs', async () => {
      // 1. Bangalore employee applies Friday to Monday
      const applied = await leavesService.applyLeave(
        blrEmpUserId,
        {
          leaveTypeId: paidLeaveTypeId.toString(),
          startDate: '2026-10-09',
          endDate: '2026-10-12',
          reason: 'Trip',
        },
        clientMetadata,
      );

      // 2. Manager approves request
      const approved = await leavesService.approveLeave(
        managerUserId,
        applied._id,
        { remarks: 'Approved, enjoy your trip!' },
        clientMetadata,
      );

      expect(approved.status).toBe(LeaveRequestStatus.APPROVED);

      // 3. Inspect attendance records created
      // Friday 2026-10-09: Working day -> should be ON_LEAVE
      const friAtt = attendanceStore.get(`${blrEmpId.toString()}_2026-10-09`);
      expect(friAtt).toBeDefined();
      expect(friAtt?.status).toBe(AttendanceStatus.ON_LEAVE);

      // Saturday 2026-10-10: 2nd Saturday weekly off -> MUST NOT be marked ON_LEAVE
      const satAtt = attendanceStore.get(`${blrEmpId.toString()}_2026-10-10`);
      expect(satAtt).toBeUndefined();

      // Sunday 2026-10-11: Sunday weekly off -> MUST NOT be marked ON_LEAVE
      const sunAtt = attendanceStore.get(`${blrEmpId.toString()}_2026-10-11`);
      expect(sunAtt).toBeUndefined();

      // Monday 2026-10-12: Working day -> should be ON_LEAVE
      const monAtt = attendanceStore.get(`${blrEmpId.toString()}_2026-10-12`);
      expect(monAtt).toBeDefined();
      expect(monAtt?.status).toBe(AttendanceStatus.ON_LEAVE);
    });
  });

  describe('3. Historical Preservation of Past Approved Leaves', () => {
    it('TC-XO-04: Changing weekly off configuration in the future never mutates past approved leave duration', async () => {
      // 1. Apply and approve leave for Bangalore employee in October 2026 (2 days)
      const applied = await leavesService.applyLeave(
        blrEmpUserId,
        {
          leaveTypeId: paidLeaveTypeId.toString(),
          startDate: '2026-10-09',
          endDate: '2026-10-12',
          reason: 'October vacation',
        },
        clientMetadata,
      );

      await leavesService.approveLeave(
        managerUserId,
        applied._id,
        {},
        clientMetadata,
      );

      // 2. Later, management deactivates Bangalore 2nd/4th Saturday override (e.g., reverting to 6-day work weeks)
      const blrConfig = weeklyOffConfigsStore.get('bangalore_override');
      if (blrConfig) {
        blrConfig.isActive = false;
        blrConfig.updatedAt = new Date();
      }

      // 3. Retrieve historical request from database
      const historicalRequest = leaveRequestsStore.get(applied._id.toString());
      expect(historicalRequest).toBeDefined();
      // Total days and excluded dates remain immutable
      expect(historicalRequest?.totalDays).toBe(2);
      expect(historicalRequest?.excludedDates).toEqual(
        expect.arrayContaining(['2026-10-10', '2026-10-11']),
      );

      // Employee balance remains intact
      const balance = await leaveBalanceRepo.findByEmployeeTypeYear(
        blrEmpId,
        paidLeaveTypeId,
        2026,
      );
      expect(balance?.usedDays).toBe(2);
      expect(balance?.pendingDays).toBe(0);
      expect(balance?.availableBalance).toBe(22);
    });
  });

  describe('4. Compensatory Off (Comp-Off) Qualification on Weekly Offs', () => {
    it('TC-XO-05: Bangalore employee qualifies for comp-off on 2nd Saturday (Oct 10), but Delhi employee is rejected', async () => {
      // 1. Bangalore employee worked on 2026-10-10 (2nd Saturday)
      attendanceStore.set(`${blrEmpId.toString()}_2026-10-10`, {
        _id: new Types.ObjectId(),
        employeeId: blrEmpId,
        attendanceDate: '2026-10-10',
        date: new Date('2026-10-10T00:00:00.000Z'),
        shiftId,
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
        status: AttendanceStatus.PRESENT,
        workMode: WorkMode.OFFICE,
        totalWorkMinutes: 480, // Full day 8 hours
        checkInTime: new Date('2026-10-10T03:30:00.000Z'),
        checkOutTime: new Date('2026-10-10T12:30:00.000Z'),
        breaks: [],
        totalBreakMinutes: 0,
        isLate: false,
        lateMinutes: 0,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        overtimeMinutes: 0,
        checkInSource: AttendanceSource.WEB,
        checkInIp: '127.0.0.1',
        regularizationId: null,
        deletedAt: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Bangalore employee claims comp-off -> MUST SUCCEED because Oct 10 is 2nd Saturday weekly off
      const blrCompOff = await compOffService.claimCompOff(
        blrEmpUserId,
        {
          attendanceDate: '2026-10-10',
          reason: 'Emergency server migration on 2nd Saturday',
        },
        clientMetadata,
      );

      expect(blrCompOff).toBeDefined();
      expect(blrCompOff.status).toBe(CompOffStatus.PENDING);
      expect(blrCompOff.attendanceDate).toBe('2026-10-10');

      // 2. Delhi employee worked on 2026-10-10 (their normal working Saturday)
      attendanceStore.set(`${delEmpId.toString()}_2026-10-10`, {
        _id: new Types.ObjectId(),
        employeeId: delEmpId,
        attendanceDate: '2026-10-10',
        date: new Date('2026-10-10T00:00:00.000Z'),
        shiftId,
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
        status: AttendanceStatus.PRESENT,
        workMode: WorkMode.OFFICE,
        totalWorkMinutes: 480,
        checkInTime: new Date('2026-10-10T03:30:00.000Z'),
        checkOutTime: new Date('2026-10-10T12:30:00.000Z'),
        breaks: [],
        totalBreakMinutes: 0,
        isLate: false,
        lateMinutes: 0,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        overtimeMinutes: 0,
        checkInSource: AttendanceSource.WEB,
        checkInIp: '127.0.0.1',
        regularizationId: null,
        deletedAt: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Delhi employee claims comp-off on 2026-10-10 -> MUST BE REJECTED (not a holiday or weekly off for Delhi)
      await expect(
        compOffService.claimCompOff(
          delEmpUserId,
          {
            attendanceDate: '2026-10-10',
            reason: 'Regular work attempt as comp off',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);

      try {
        await compOffService.claimCompOff(
          delEmpUserId,
          {
            attendanceDate: '2026-10-10',
            reason: 'Regular work attempt as comp off',
          },
          clientMetadata,
        );
      } catch (err) {
        expect((err as AppError).message).toContain(
          'does not qualify for compensatory off',
        );
        expect((err as AppError).statusCode).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });

  describe('5. Attendance Regularization Enforcement on Branch Weekly Offs', () => {
    it('TC-XO-06: Bangalore employee cannot regularize on 2nd Saturday (2026-11-14), but Delhi employee can proceed', async () => {
      // 2026-11-14 is the 2nd Saturday of November 2026 (within 7-day payroll lockout window)
      // Bangalore employee attempts regularization for Nov 14 (2nd Saturday weekly off)
      await expect(
        attendanceService.createRegularization(
          blrEmpUserId,
          {
            attendanceDate: '2026-11-14',
            requestedCheckInTime: '2026-11-14T03:30:00.000Z',
            requestedCheckOutTime: '2026-11-14T12:30:00.000Z',
            reason: 'Forgot to punch on Saturday',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        'Cannot regularize attendance on a weekly off (2026-11-14). Regularization is only permitted on scheduled working days. Please submit a Comp-Off or Overtime request instead.',
      );

      // Delhi employee attempts regularization for Nov 14 (normal working Saturday for Delhi)
      // Because Nov 14 is NOT a weekly off for Delhi, Guard 5 passes without throwing weekly off error
      const delRegularization = await attendanceService.createRegularization(
        delEmpUserId,
        {
          attendanceDate: '2026-11-14',
          requestedCheckInTime: '2026-11-14T03:30:00.000Z',
          requestedCheckOutTime: '2026-11-14T12:30:00.000Z',
          reason: 'Forgot to punch on scheduled Saturday shift',
        },
        clientMetadata,
      );

      expect(delRegularization).toBeDefined();
      expect(delRegularization.attendanceDate).toBe('2026-11-14');
      expect(delRegularization.status).toBe('PENDING');
    });
  });

  describe('6. Effective Date Range Boundaries', () => {
    it('TC-XO-07: Weekly off correctly resolves depending on policy effective dates', async () => {
      // Configuration effective only for Q1: 2026-01-01 to 2026-03-31
      weeklyOffConfigsStore.set('temp_policy', {
        _id: new Types.ObjectId(),
        branchId: bangaloreBranchId,
        name: 'Q1 Special Policy',
        description: 'Q1 Special Policy',
        days: [
          {
            dayOfWeek: DayOfWeek.FRIDAY,
            occurrences: [1, 2, 3, 4, 5],
          },
        ],
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-03-31',
        isActive: true,
        deletedAt: null,
        createdBy: adminUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      });

      // 2026-01-09 is a Friday in Q1 -> isWeeklyOff = true
      const isOffQ1 = await weeklyOffService.isWeeklyOff(
        '2026-01-09',
        bangaloreBranchId,
      );
      expect(isOffQ1).toBe(true);

      // 2026-04-03 is a Friday in Q2 -> Q1 policy has expired, falls back to Bangalore default (Friday is not off)
      const isOffQ2 = await weeklyOffService.isWeeklyOff(
        '2026-04-03',
        bangaloreBranchId,
      );
      expect(isOffQ2).toBe(false);
    });
  });
});
