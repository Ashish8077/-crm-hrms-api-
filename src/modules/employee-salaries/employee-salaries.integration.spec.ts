/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import { HttpStatus, ValidationPipe, ValidationError } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  getConnectionToken,
  getModelToken,
  ParseObjectIdPipe,
} from '@nestjs/mongoose';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { EmployeeSalariesController } from './employee-salaries.controller';
import { EmployeeSalariesService } from './services/employee-salaries.service';
import {
  CreateEmployeeSalaryInput,
  EmployeeSalaryRepository,
} from './repositories/employee-salary.repository';
import { SalaryStructureCalculationService } from '../salary-structures/services/salary-structure-calculation.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { Employee } from '../employees/schemas/employee.schema';
import {
  SalaryStructure,
  SalaryStructureLean,
} from '../salary-structures/schemas/salary-structure.schema';
import {
  SalaryComponent,
  SalaryComponentLean,
} from '../salary-components/schemas/salary-component.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../salary-structures/constants/salary-structure.constant';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import { EmployeeSalaryStatus } from './constants/employee-salary.constant';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import { EmployeeSalaryLean } from './schemas/employee-salary.schema';
import { AssignSalaryDto } from './dto/assign-salary.dto';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

/**
 * State-preserving in-memory repository simulating MongoDB EmployeeSalary collection.
 */
class InMemoryEmployeeSalaryRepository {
  private store = new Map<string, EmployeeSalaryLean>();
  private backupStore: Map<string, EmployeeSalaryLean> | null = null;

  clear(): void {
    this.store.clear();
    this.backupStore = null;
  }

  getStore(): Map<string, EmployeeSalaryLean> {
    return this.store;
  }

  startTransactionSnapshot(): void {
    this.backupStore = new Map(
      Array.from(this.store.entries()).map(([k, v]) => [k, this.cloneDoc(v)]),
    );
  }

  rollbackTransaction(): void {
    if (this.backupStore) {
      this.store = this.backupStore;
      this.backupStore = null;
    }
  }

  commitTransaction(): void {
    this.backupStore = null;
  }

  private cloneDoc(doc: EmployeeSalaryLean): EmployeeSalaryLean {
    return {
      ...doc,
      effectiveFrom: new Date(doc.effectiveFrom),
      effectiveTo: doc.effectiveTo ? new Date(doc.effectiveTo) : null,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
      salarySnapshot: JSON.parse(
        JSON.stringify(doc.salarySnapshot),
      ) as typeof doc.salarySnapshot,
    };
  }

  async create(input: CreateEmployeeSalaryInput): Promise<EmployeeSalaryLean> {
    const id = new Types.ObjectId();
    const now = new Date();

    // Check unique constraint: at most ONE open-ended active assignment per employee
    if (
      input.effectiveTo === null &&
      input.status === EmployeeSalaryStatus.ACTIVE
    ) {
      for (const existing of this.store.values()) {
        if (
          existing.employeeId.equals(input.employeeId) &&
          existing.effectiveTo === null &&
          existing.status === EmployeeSalaryStatus.ACTIVE
        ) {
          const dupErr = new Error(
            'E11000 duplicate key error collection: employee_salaries index: uq_employee_single_open_ended_active',
          );
          (dupErr as unknown as { code: number }).code = 11000;
          throw dupErr;
        }
      }
    }

    const doc: EmployeeSalaryLean = {
      _id: id,
      employeeId: input.employeeId,
      salaryStructureId: input.salaryStructureId,
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      salaryBasis: input.salaryBasis,
      salaryFrequency: input.salaryFrequency,
      salaryAmount: input.salaryAmount,
      salaryStructureVersion: input.salaryStructureVersion,
      salarySnapshot: JSON.parse(
        JSON.stringify(input.salarySnapshot),
      ) as typeof input.salarySnapshot,
      status: input.status ?? EmployeeSalaryStatus.ACTIVE,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    };

    this.store.set(id.toString(), doc);
    return this.cloneDoc(doc);
  }

  async findById(id: Types.ObjectId): Promise<EmployeeSalaryLean | null> {
    const doc = this.store.get(id.toString());
    return doc ? this.cloneDoc(doc) : null;
  }

  async findLatestByEmployeeId(
    employeeId: Types.ObjectId,
  ): Promise<EmployeeSalaryLean | null> {
    const matching = Array.from(this.store.values())
      .filter((d) => d.employeeId.equals(employeeId))
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    return matching.length > 0 ? this.cloneDoc(matching[0]) : null;
  }

  async findCurrentByEmployeeId(
    employeeId: Types.ObjectId,
    asOfDate: Date,
  ): Promise<EmployeeSalaryLean | null> {
    const matching = Array.from(this.store.values())
      .filter((d) => {
        if (!d.employeeId.equals(employeeId)) return false;
        if (d.effectiveFrom.getTime() > asOfDate.getTime()) return false;
        if (
          d.effectiveTo !== null &&
          d.effectiveTo.getTime() <= asOfDate.getTime()
        )
          return false;
        return true;
      })
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

    return matching.length > 0 ? this.cloneDoc(matching[0]) : null;
  }

  async closePreviousAssignment(
    id: Types.ObjectId,
    effectiveTo: Date,
    actorId: Types.ObjectId,
  ): Promise<EmployeeSalaryLean | null> {
    const doc = this.store.get(id.toString());
    if (
      !doc ||
      doc.effectiveTo !== null ||
      doc.status !== EmployeeSalaryStatus.ACTIVE
    ) {
      return null;
    }

    doc.effectiveTo = new Date(effectiveTo);
    doc.status = EmployeeSalaryStatus.SUPERSEDED;
    doc.updatedBy = actorId;
    doc.updatedAt = new Date();
    this.store.set(id.toString(), doc);

    return this.cloneDoc(doc);
  }

  async findAllByEmployeeId(
    employeeId: Types.ObjectId,
  ): Promise<EmployeeSalaryLean[]> {
    return Array.from(this.store.values())
      .filter((d) => d.employeeId.equals(employeeId))
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())
      .map((d) => this.cloneDoc(d));
  }

  async findPaginatedByEmployeeId(
    employeeId: Types.ObjectId,
    query: {
      page?: number;
      limit?: number;
      sortBy?: 'effectiveFrom' | 'createdAt';
      sortOrder?: 'asc' | 'desc';
    },
  ): Promise<{
    data: EmployeeSalaryLean[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const sortBy = query.sortBy ?? 'effectiveFrom';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    const all = Array.from(this.store.values())
      .filter((d) => d.employeeId.equals(employeeId))
      .sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        const aTime = aVal instanceof Date ? aVal.getTime() : 0;
        const bTime = bVal instanceof Date ? bVal.getTime() : 0;
        return (aTime - bTime) * sortOrder;
      });

    const total = all.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const data = all.slice(skip, skip + limit).map((d) => this.cloneDoc(d));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as { code?: number; message?: string };
    return (
      err.code === 11000 ||
      (typeof err.message === 'string' && err.message.includes('11000'))
    );
  }
}

describe('EmployeeSalariesController & Service (Integration Tests)', () => {
  let controller: EmployeeSalariesController;
  let inMemoryRepo: InMemoryEmployeeSalaryRepository;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let reflector: Reflector;
  let validationPipe: ValidationPipe;

  const actorId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const structure1Id = new Types.ObjectId();
  const structure2Id = new Types.ObjectId();
  const basicCompId = new Types.ObjectId();
  const hraCompId = new Types.ObjectId();

  const mockUser = {
    userId: actorId,
    email: 'hr.admin@company.com',
    roles: ['HR_ADMIN'],
    permissions: [
      PermissionKeys.EMPLOYEE_SALARIES_ASSIGN,
      PermissionKeys.EMPLOYEE_SALARIES_VIEW,
    ],
  };

  const mockRequest: AuthenticatedRequest = {
    user: mockUser,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestIntegrationTest/1.0' },
  } as unknown as AuthenticatedRequest;

  // Catalog data
  const employeeCatalog = new Map<string, object>([
    [
      employeeId.toString(),
      {
        _id: employeeId,
        employeeCode: 'EMP1001',
        firstName: 'Alex',
        lastName: 'Morgan',
        employmentStatus: EmploymentStatus.ACTIVE,
        employmentType: EmploymentType.FULL_TIME,
        dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      },
    ],
  ]);

  const structureCatalog = new Map<string, SalaryStructureLean>([
    [
      structure1Id.toString(),
      {
        _id: structure1Id,
        name: 'Standard Engineering CTC',
        code: 'ENG_50K',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        isActive: true,
        __v: 1,
        components: [
          {
            componentId: basicCompId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 30000,
            percentage: null,
            percentageOf: null,
          },
          {
            componentId: hraCompId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 20000,
            percentage: null,
            percentageOf: null,
          },
        ],
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ],
    [
      structure2Id.toString(),
      {
        _id: structure2Id,
        name: 'Senior Engineering CTC',
        code: 'ENG_75K',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 75000,
        isActive: true,
        __v: 2,
        components: [
          {
            componentId: basicCompId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 45000,
            percentage: null,
            percentageOf: null,
          },
          {
            componentId: hraCompId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 30000,
            percentage: null,
            percentageOf: null,
          },
        ],
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ],
  ]);

  const componentCatalog = new Map<string, SalaryComponentLean>([
    [
      basicCompId.toString(),
      {
        _id: basicCompId,
        name: 'Basic Salary',
        code: 'BASIC',
        type: SalaryComponentType.EARNING,
        isActive: true,
        isTaxable: true,
        isStatutory: false,
        description: 'Core basic pay',
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ],
    [
      hraCompId.toString(),
      {
        _id: hraCompId,
        name: 'House Rent Allowance',
        code: 'HRA',
        type: SalaryComponentType.EARNING,
        isActive: true,
        isTaxable: true,
        isStatutory: false,
        description: 'House rent',
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ],
  ]);

  beforeAll(async () => {
    inMemoryRepo = new InMemoryEmployeeSalaryRepository();

    auditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AuditLogsService>;

    const mockConnection = {
      startSession: jest.fn().mockImplementation(() => ({
        withTransaction: jest
          .fn()
          .mockImplementation(async (cb: () => Promise<void>) => {
            inMemoryRepo.startTransactionSnapshot();
            try {
              await cb();
              inMemoryRepo.commitTransaction();
            } catch (err) {
              inMemoryRepo.rollbackTransaction();
              throw err;
            }
          }),
        endSession: jest.fn().mockResolvedValue(undefined),
      })),
    };

    const mockEmployeeModel = {
      findById: jest.fn().mockImplementation((id: Types.ObjectId) => ({
        lean: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue(employeeCatalog.get(id.toString()) ?? null),
        }),
      })),
    };

    const mockSalaryStructureModel = {
      findById: jest.fn().mockImplementation((id: Types.ObjectId) => ({
        lean: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue(structureCatalog.get(id.toString()) ?? null),
        }),
      })),
    };

    const mockSalaryComponentModel = {
      find: jest
        .fn()
        .mockImplementation((query: { _id?: { $in?: Types.ObjectId[] } }) => {
          const ids = query?._id?.$in ?? [];
          const results = ids
            .map((id) => componentCatalog.get(id.toString()))
            .filter(Boolean);
          return {
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(results),
            }),
          };
        }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [EmployeeSalariesController],
      providers: [
        EmployeeSalariesService,
        SalaryStructureCalculationService,
        Reflector,
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
        {
          provide: EmployeeSalaryRepository,
          useValue: inMemoryRepo,
        },
        {
          provide: AuditLogsService,
          useValue: auditLogsService,
        },
        {
          provide: getModelToken(Employee.name),
          useValue: mockEmployeeModel,
        },
        {
          provide: getModelToken(SalaryStructure.name),
          useValue: mockSalaryStructureModel,
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: mockSalaryComponentModel,
        },
      ],
    }).compile();

    controller = moduleFixture.get<EmployeeSalariesController>(
      EmployeeSalariesController,
    );
    reflector = moduleFixture.get<Reflector>(Reflector);

    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = mapValidationErrors(errors);
        return new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          HttpStatus.BAD_REQUEST,
          details,
        );
      },
    });
  });

  beforeEach(() => {
    inMemoryRepo.clear();
    jest.clearAllMocks();
  });

  describe('1. Initial Salary Assignment Flow', () => {
    it('TC-SAL-01: Successfully creates initial assignment with immutable snapshot', async () => {
      const dto: AssignSalaryDto = {
        salaryStructureId: structure1Id.toString(),
        effectiveFrom: '2026-07-01',
      };

      const response = await controller.assignSalary(
        employeeId,
        dto,
        mockRequest,
      );

      expect(response.success).toBe(true);
      expect(response.data.employeeId).toBe(employeeId.toString());
      expect(response.data.salaryStructureId).toBe(structure1Id.toString());
      expect(response.data.effectiveFrom).toBe('2026-07-01');
      expect(response.data.effectiveTo).toBeNull();
      expect(response.data.status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(response.data.salaryAmount).toBe(50000);
      expect(response.data.salarySnapshot).toBeDefined();
      expect(response.data.salarySnapshot.grossSalaryMonthly).toBe(50000);
      expect(response.data.salarySnapshot.totalCtcMonthly).toBe(50000);
      expect(response.data.salarySnapshot.earnings.length).toBe(2);

      // Verify audit log
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId,
          action: AuditAction.EMPLOYEE_SALARY_ASSIGNED,
          targetModel: AuditTargetModel.EMPLOYEE_SALARY,
        }),
        expect.anything(),
      );
    });

    it('TC-SAL-02: Rejects assignment when effectiveFrom precedes employee dateOfJoining', async () => {
      const dto: AssignSalaryDto = {
        salaryStructureId: structure1Id.toString(),
        effectiveFrom: '2025-12-01', // Before 2026-01-01 joining date
      };

      await expect(
        controller.assignSalary(employeeId, dto, mockRequest),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringContaining(
          'cannot precede the employee date of joining',
        ),
      });
    });
  });

  describe('2. Salary Revision Flow & Snapshot Immutability', () => {
    it('TC-SAL-03: Closes previous assignment, leaves old snapshot immutable, and saves new snapshot', async () => {
      // 1. Initial assignment
      const initialDto: AssignSalaryDto = {
        salaryStructureId: structure1Id.toString(),
        effectiveFrom: '2026-01-01',
      };
      const initialRes = await controller.assignSalary(
        employeeId,
        initialDto,
        mockRequest,
      );
      const initialId = initialRes.data.id;
      const initialSnapshotSerialized = JSON.stringify(
        initialRes.data.salarySnapshot,
      );

      // 2. Revision assignment with Structure 2
      const revisionDto: AssignSalaryDto = {
        salaryStructureId: structure2Id.toString(),
        effectiveFrom: '2026-07-01',
      };
      const revisionRes = await controller.assignSalary(
        employeeId,
        revisionDto,
        mockRequest,
      );

      // 3. Assert new revision details
      expect(revisionRes.success).toBe(true);
      expect(revisionRes.data.effectiveFrom).toBe('2026-07-01');
      expect(revisionRes.data.effectiveTo).toBeNull();
      expect(revisionRes.data.status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(revisionRes.data.salaryAmount).toBe(75000);
      expect(revisionRes.data.salarySnapshot.grossSalaryMonthly).toBe(75000);

      // 4. Inspect old assignment in repository: verify closed with exact date & unchanged snapshot
      const oldDoc = await inMemoryRepo.findById(new Types.ObjectId(initialId));
      expect(oldDoc).toBeDefined();
      expect(oldDoc?.status).toBe(EmployeeSalaryStatus.SUPERSEDED);
      expect(oldDoc?.effectiveTo?.toISOString().slice(0, 10)).toBe(
        '2026-07-01',
      );

      // Verify IMMUTABILITY: old snapshot is 100% identical to when created
      expect(JSON.stringify(oldDoc?.salarySnapshot)).toBe(
        initialSnapshotSerialized,
      );

      // Verify revision audit log
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.EMPLOYEE_SALARY_REVISED,
          details: expect.objectContaining({
            previousSalaryAmount: 50000,
            newSalaryAmount: 75000,
          }),
        }),
        expect.anything(),
      );
    });

    it('TC-SAL-04: Rejects backdated or same-day revision (Rule 5)', async () => {
      // Setup existing assignment starting 2026-07-01
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-07-01',
        },
        mockRequest,
      );

      // Try backdated revision to 2026-05-01
      await expect(
        controller.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2026-05-01',
          },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringContaining(
          'Backdated revisions are not permitted',
        ),
      });

      // Try same-day revision on 2026-07-01
      await expect(
        controller.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2026-07-01',
          },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringContaining('must be strictly later'),
      });
    });
  });

  describe('3. Current Salary Evaluation with Future Assignments (Rule 4)', () => {
    it('TC-SAL-05: Returns active assignment and ignores future-dated assignment until effective date arrives', async () => {
      // Assignment 1: Active starting 2026-01-01
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        mockRequest,
      );

      // Assignment 2: Future revision starting 2026-10-01 (75k)
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2026-10-01',
        },
        mockRequest,
      );

      // Query as of 2026-08-01: Must return Assignment 1 (50k)
      const currentRes1 = await controller.getCurrentSalary(
        employeeId,
        '2026-08-01',
      );
      expect(currentRes1.data).toBeDefined();
      expect(currentRes1.data?.salaryAmount).toBe(50000);
      expect(currentRes1.data?.effectiveFrom).toBe('2026-01-01');
      expect(currentRes1.data?.effectiveTo).toBe('2026-10-01');

      // Query as of 2026-10-01 (day future becomes active): Must return Assignment 2 (75k)
      const currentRes2 = await controller.getCurrentSalary(
        employeeId,
        '2026-10-01',
      );
      expect(currentRes2.data).toBeDefined();
      expect(currentRes2.data?.salaryAmount).toBe(75000);
      expect(currentRes2.data?.effectiveFrom).toBe('2026-10-01');
      expect(currentRes2.data?.effectiveTo).toBeNull();
    });

    it('TC-SAL-05b: Validates exact date boundaries: effectiveFrom is inclusive, effectiveTo is exclusive', async () => {
      // 1. Initial assignment [2026-01-01, null)
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        mockRequest,
      );

      // 2. Revision closing previous at 2026-07-01:
      // Initial becomes [2026-01-01, 2026-07-01) (50k)
      // Revision becomes [2026-07-01, null) (75k)
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2026-07-01',
        },
        mockRequest,
      );

      // Boundary Check A: Day before initial effectiveFrom (2025-12-31) -> Should return null
      const resBefore = await controller.getCurrentSalary(
        employeeId,
        '2025-12-31',
      );
      expect(resBefore.data).toBeNull();

      // Boundary Check B: Exact start of initial assignment (2026-01-01) -> Returns 50k
      const resStart = await controller.getCurrentSalary(
        employeeId,
        '2026-01-01',
      );
      expect(resStart.data?.salaryAmount).toBe(50000);

      // Boundary Check C: Day before closed interval ends (2026-06-30) -> Returns 50k
      const resEndMinusOne = await controller.getCurrentSalary(
        employeeId,
        '2026-06-30',
      );
      expect(resEndMinusOne.data?.salaryAmount).toBe(50000);

      // Boundary Check D: Exact end boundary (2026-07-01) -> effectiveTo is exclusive, so 50k is expired; returns new 75k
      const resBoundary = await controller.getCurrentSalary(
        employeeId,
        '2026-07-01',
      );
      expect(resBoundary.data?.salaryAmount).toBe(75000);
      expect(resBoundary.data?.effectiveFrom).toBe('2026-07-01');
    });

    it('TC-SAL-06: Returns null when employee has no assignments', async () => {
      const unassignedEmployeeId = new Types.ObjectId();
      employeeCatalog.set(unassignedEmployeeId.toString(), {
        _id: unassignedEmployeeId,
        employeeCode: 'EMP2002',
        firstName: 'New',
        lastName: 'Hire',
        employmentStatus: EmploymentStatus.ACTIVE,
        employmentType: EmploymentType.FULL_TIME,
        dateOfJoining: new Date('2026-01-01'),
        deletedAt: null,
      });

      const res = await controller.getCurrentSalary(unassignedEmployeeId);
      expect(res.success).toBe(true);
      expect(res.data).toBeNull();
    });
  });

  describe('4. Salary History Pagination & Sorting', () => {
    it('TC-SAL-07: Returns paginated assignments sorted newest effectiveFrom first', async () => {
      // Create 3 assignments
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        mockRequest,
      );
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2026-06-01',
        },
        mockRequest,
      );
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-12-01',
        },
        mockRequest,
      );

      const historyRes = await controller.getSalaryHistory(employeeId, {
        page: 1,
        limit: 2,
      });

      expect(historyRes.success).toBe(true);
      expect(historyRes.data.length).toBe(2);
      expect(historyRes.meta.total).toBe(3);
      expect(historyRes.meta.totalPages).toBe(2);

      // Verify newest first: 2026-12-01 then 2026-06-01
      expect(historyRes.data[0].effectiveFrom).toBe('2026-12-01');
      expect(historyRes.data[1].effectiveFrom).toBe('2026-06-01');
    });

    it('TC-SAL-07b: Supports dynamic sorting by effectiveFrom ascending', async () => {
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        mockRequest,
      );
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2026-07-01',
        },
        mockRequest,
      );

      // Query with sortOrder asc
      const historyAsc = await controller.getSalaryHistory(employeeId, {
        page: 1,
        limit: 10,
        sortBy: 'effectiveFrom',
        sortOrder: 'asc',
      });

      expect(historyAsc.success).toBe(true);
      expect(historyAsc.data.length).toBe(2);
      expect(historyAsc.data[0].effectiveFrom).toBe('2026-01-01');
      expect(historyAsc.data[1].effectiveFrom).toBe('2026-07-01');
    });
  });

  describe('5. Concurrency & Overlap Protection', () => {
    it('TC-SAL-08b: Rejects invalid MongoDB ObjectId in route parameters via ParseObjectIdPipe', () => {
      const pipe = new ParseObjectIdPipe();
      expect(() => pipe.transform('invalid-hex-id')).toThrow();
    });

    it('TC-SAL-08: Rejects second concurrent revision with CONCURRENT_MODIFICATION error', async () => {
      // Initial assignment
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        mockRequest,
      );

      // Mock closePreviousAssignment returning null to simulate another transaction already closed it
      const originalClose =
        inMemoryRepo.closePreviousAssignment.bind(inMemoryRepo);
      jest
        .spyOn(inMemoryRepo, 'closePreviousAssignment')
        .mockResolvedValueOnce(null);

      await expect(
        controller.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2026-07-01',
          },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.CONCURRENT_MODIFICATION,
        message: expect.stringContaining('Concurrent revision detected'),
      });

      jest
        .spyOn(inMemoryRepo, 'closePreviousAssignment')
        .mockImplementation(originalClose);
    });

    it('TC-SAL-09: Rejects payload with unknown extra properties via ValidationPipe', async () => {
      const payload = {
        salaryStructureId: structure1Id.toString(),
        effectiveFrom: '2026-07-01',
        injectedClientSnapshot: { gross: 999999 }, // Unwhitelisted!
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: AssignSalaryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('6. RBAC Permission Protection', () => {
    it('TC-SAL-10: Gated by proper permissions on all endpoints', () => {
      const assignPermissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.assignSalary,
      );
      expect(assignPermissions).toEqual([
        PermissionKeys.EMPLOYEE_SALARIES_ASSIGN,
      ]);

      const currentPermissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.getCurrentSalary,
      );
      expect(currentPermissions).toEqual([
        PermissionKeys.EMPLOYEE_SALARIES_VIEW,
      ]);

      const historyPermissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.getSalaryHistory,
      );
      expect(historyPermissions).toEqual([
        PermissionKeys.EMPLOYEE_SALARIES_VIEW,
      ]);
    });
  });

  describe('7. Transaction Rollback & Atomicity', () => {
    it('TC-SAL-11: Rolls back all operations if repository creation fails during revision', async () => {
      // 1. Establish initial assignment
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        mockRequest,
      );

      const storeBefore = Array.from(inMemoryRepo.getStore().values());
      expect(storeBefore.length).toBe(1);
      const originalAssignment = storeBefore[0];

      // 2. Mock repository.create to fail on revision insert
      const originalCreate = inMemoryRepo.create.bind(inMemoryRepo);
      let callCount = 0;
      jest
        .spyOn(inMemoryRepo, 'create')
        .mockImplementation(async (input: CreateEmployeeSalaryInput) => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Database disk error during insert');
          }
          return originalCreate(input);
        });

      // 3. Attempt revision - should throw
      await expect(
        controller.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2026-07-01',
          },
          mockRequest,
        ),
      ).rejects.toThrow('Database disk error during insert');

      // 4. Assert atomicity: previous assignment remained ACTIVE with effectiveTo null!
      const storeAfter = Array.from(inMemoryRepo.getStore().values());
      expect(storeAfter.length).toBe(1);
      expect(storeAfter[0].status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(storeAfter[0].effectiveTo).toBeNull();
      expect(storeAfter[0]._id.toString()).toBe(
        originalAssignment._id.toString(),
      );

      jest.spyOn(inMemoryRepo, 'create').mockImplementation(originalCreate);
    });

    it('TC-SAL-12: Rolls back assignment closure and creation if audit log creation fails', async () => {
      // 1. Establish initial assignment
      await controller.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        mockRequest,
      );

      // 2. Mock audit log service to fail during revision
      auditLogsService.createAuditLog.mockRejectedValueOnce(
        new Error('Audit service unavailable'),
      );

      // 3. Attempt revision - should fail
      await expect(
        controller.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2026-07-01',
          },
          mockRequest,
        ),
      ).rejects.toThrow('Audit service unavailable');

      // 4. Assert atomicity: transaction rolled back, leaving only the initial assignment
      const store = Array.from(inMemoryRepo.getStore().values());
      expect(store.length).toBe(1);
      expect(store[0].status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(store[0].effectiveTo).toBeNull();
      expect(store[0].salaryAmount).toBe(50000);
    });
  });
});
