import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { EmployeeSalariesService } from './employee-salaries.service';
import { EmployeeSalaryRepository } from '../repositories/employee-salary.repository';
import { SalaryStructureCalculationService } from '../../salary-structures/services/salary-structure-calculation.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { Employee } from '../../employees/schemas/employee.schema';
import { SalaryStructure } from '../../salary-structures/schemas/salary-structure.schema';
import { SalaryComponent } from '../../salary-components/schemas/salary-component.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../../salary-structures/constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { EmployeeSalaryStatus } from '../constants/employee-salary.constant';
import {
  EmploymentStatus,
  EmploymentType,
} from '../../employees/constants/employee.constant';
import { ErrorCode } from '../../../common/errors/error-codes';
import { EmployeeSalaryLean } from '../schemas/employee-salary.schema';
import { CreateEmployeeSalaryInput } from '../repositories/employee-salary.repository';

describe('EmployeeSalariesService', () => {
  let service: EmployeeSalariesService;
  let mockEmployeeSalaryRepo: Partial<jest.Mocked<EmployeeSalaryRepository>>;
  let mockAuditLogsService: Partial<jest.Mocked<AuditLogsService>>;
  let mockEmployeeModel: { findById: jest.Mock };
  let mockSalaryStructureModel: { findById: jest.Mock };
  let mockSalaryComponentModel: { find: jest.Mock };
  let mockSession: { withTransaction: jest.Mock; endSession: jest.Mock };

  const actorId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const structureId = new Types.ObjectId();
  const basicComponentId = new Types.ObjectId();
  const hraComponentId = new Types.ObjectId();

  const activeEmployee = {
    _id: employeeId,
    employeeCode: 'EMP001',
    firstName: 'Jane',
    lastName: 'Doe',
    employmentStatus: EmploymentStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  const activeStructure = {
    _id: structureId,
    name: 'Standard Engineering CTC',
    code: 'ENG_CTC_50K',
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 50000,
    isActive: true,
    __v: 1,
    components: [
      {
        componentId: basicComponentId,
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 30000,
        percentage: null,
        percentageOf: null,
      },
      {
        componentId: hraComponentId,
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 20000,
        percentage: null,
        percentageOf: null,
      },
    ],
  };

  const basicMaster = {
    _id: basicComponentId,
    name: 'Basic Salary',
    code: 'BASIC',
    type: SalaryComponentType.EARNING,
    isActive: true,
  };

  const hraMaster = {
    _id: hraComponentId,
    name: 'House Rent Allowance',
    code: 'HRA',
    type: SalaryComponentType.EARNING,
    isActive: true,
  };

  beforeEach(async () => {
    mockSession = {
      withTransaction: jest
        .fn()
        .mockImplementation(async (callback: () => Promise<void>) => {
          await callback();
        }),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    mockEmployeeSalaryRepo = {
      create: jest
        .fn()
        .mockImplementation(
          (input: CreateEmployeeSalaryInput): Promise<EmployeeSalaryLean> => {
            const doc: EmployeeSalaryLean = {
              _id: new Types.ObjectId(),
              employeeId: input.employeeId,
              salaryStructureId: input.salaryStructureId,
              effectiveFrom: input.effectiveFrom,
              effectiveTo: input.effectiveTo ?? null,
              salaryBasis: input.salaryBasis,
              salaryFrequency: input.salaryFrequency,
              salaryAmount: input.salaryAmount,
              salaryStructureVersion: input.salaryStructureVersion,
              salarySnapshot: input.salarySnapshot,
              status: input.status ?? EmployeeSalaryStatus.ACTIVE,
              createdBy: input.createdBy,
              updatedBy: input.updatedBy,
              createdAt: new Date(),
              updatedAt: new Date(),
              __v: 0,
            };
            return Promise.resolve(doc);
          },
        ),
      findAllByEmployeeId: jest.fn().mockResolvedValue([]),
      findLatestByEmployeeId: jest.fn().mockResolvedValue(null),
      findCurrentByEmployeeId: jest.fn().mockResolvedValue(null),
      closePreviousAssignment: jest.fn().mockResolvedValue(null),
      findPaginatedByEmployeeId: jest.fn().mockResolvedValue({
        data: [],
        meta: {
          total: 0,
          page: 1,
          limit: 10,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      isDuplicateKeyError: jest.fn().mockReturnValue(false),
    };

    mockAuditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue(undefined),
    };

    mockEmployeeModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeEmployee),
        }),
      }),
    };

    mockSalaryStructureModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeStructure),
        }),
      }),
    };

    mockSalaryComponentModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([basicMaster, hraMaster]),
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeSalariesService,
        SalaryStructureCalculationService,
        {
          provide: getConnectionToken(),
          useValue: {
            startSession: jest.fn().mockResolvedValue(mockSession),
          },
        },
        {
          provide: EmployeeSalaryRepository,
          useValue: mockEmployeeSalaryRepo,
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogsService,
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

    service = module.get<EmployeeSalariesService>(EmployeeSalariesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('assignSalary (Initial Assignment)', () => {
    it('successfully assigns salary structure and creates snapshot', async () => {
      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      const result = await service.assignSalary(employeeId, dto, actorId);

      expect(result).toBeDefined();
      expect(result.employeeId).toEqual(employeeId);
      expect(result.salaryStructureId).toEqual(structureId);
      expect(result.status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(result.salarySnapshot).toBeDefined();
      expect(result.salarySnapshot.grossSalaryMonthly).toBe(50000);
      expect(result.salarySnapshot.totalCtcMonthly).toBe(50000);
      expect(result.salarySnapshot.earnings.length).toBe(2);

      expect(mockEmployeeSalaryRepo.create).toHaveBeenCalledTimes(1);
      expect(mockAuditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
      expect(mockSession.endSession).toHaveBeenCalledTimes(1);
    });

    it('rejects assignment when employee is not found', async () => {
      mockEmployeeModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });

      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });

    it('rejects assignment when employee is soft-deleted', async () => {
      mockEmployeeModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...activeEmployee,
            deletedAt: new Date(),
          }),
        }),
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });

      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });

    it('rejects assignment when employee is RESIGNED', async () => {
      mockEmployeeModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...activeEmployee,
            employmentStatus: EmploymentStatus.RESIGNED,
          }),
        }),
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects assignment when salary structure is not found', async () => {
      mockSalaryStructureModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('rejects assignment when referenced component master is missing from catalog', async () => {
      mockSalaryComponentModel.find.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([basicMaster]), // Missing hraMaster!
        }),
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('rejects assignment when effectiveFrom format is unparseable', async () => {
      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: 'invalid-date-string',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('translates MongoDB duplicate key error (11000) into 409 conflict', async () => {
      (mockEmployeeSalaryRepo.create as jest.Mock).mockRejectedValueOnce({
        code: 11000,
        message: 'E11000 duplicate key error collection',
      });
      (
        mockEmployeeSalaryRepo.isDuplicateKeyError as jest.Mock
      ).mockReturnValueOnce(true);

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('rejects assignment when salary structure is inactive', async () => {
      mockSalaryStructureModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...activeStructure,
            isActive: false,
          }),
        }),
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });

    it('rejects assignment when referenced component master is inactive', async () => {
      mockSalaryComponentModel.find.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue([
              basicMaster,
              { ...hraMaster, isActive: false },
            ]),
        }),
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });

    it('rejects assignment when effectiveFrom is before dateOfJoining', async () => {
      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2025-12-01', // Before 2026-01-01
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });

    it('rejects assignment when employee is TERMINATED', async () => {
      mockEmployeeModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...activeEmployee,
            employmentStatus: EmploymentStatus.TERMINATED,
          }),
        }),
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('assignSalary (Salary Revision)', () => {
    it('successfully creates salary revision and supersedes previous assignment', async () => {
      const existingAssignment: EmployeeSalaryLean = {
        _id: new Types.ObjectId(),
        employeeId,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 40000,
        salaryStructureVersion: 1,
        salarySnapshot: {
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          inputSalaryAmount: 40000,
          grossSalaryMonthly: 40000,
          grossSalaryAnnual: 480000,
          totalEmployerContributionsMonthly: 0,
          totalEmployerContributionsAnnual: 0,
          totalCtcMonthly: 40000,
          totalCtcAnnual: 480000,
          totalEmployeeDeductionsMonthly: 0,
          totalEmployeeDeductionsAnnual: 0,
          estimatedNetSalaryMonthly: 40000,
          estimatedNetSalaryAnnual: 480000,
          summary: {
            monthly: {
              grossSalary: 40000,
              employerContributions: 0,
              totalCtc: 40000,
              employeeDeductions: 0,
              estimatedNetSalary: 40000,
            },
            annual: {
              grossSalary: 480000,
              employerContributions: 0,
              totalCtc: 480000,
              employeeDeductions: 0,
              estimatedNetSalary: 480000,
            },
          },
          earnings: [],
          employeeDeductions: [],
          employerContributions: [],
        },
        status: EmployeeSalaryStatus.ACTIVE,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      };

      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([existingAssignment]);
      (
        mockEmployeeSalaryRepo.closePreviousAssignment as jest.Mock
      ).mockResolvedValueOnce({
        ...existingAssignment,
        effectiveTo: new Date('2026-07-01T00:00:00.000Z'),
        status: EmployeeSalaryStatus.SUPERSEDED,
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      const result = await service.assignSalary(employeeId, dto, actorId);

      expect(result).toBeDefined();
      expect(
        mockEmployeeSalaryRepo.closePreviousAssignment,
      ).toHaveBeenCalledWith(
        existingAssignment._id,
        new Date('2026-07-01T00:00:00.000Z'),
        actorId,
        mockSession,
      );
      expect(mockEmployeeSalaryRepo.create).toHaveBeenCalledTimes(1);
    });

    it('rejects backdated revision (effectiveFrom earlier than or equal to latest)', async () => {
      const existingAssignment = {
        _id: new Types.ObjectId(),
        employeeId,
        effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
        effectiveTo: null,
        status: EmployeeSalaryStatus.ACTIVE,
      } as EmployeeSalaryLean;

      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([existingAssignment]);
      (
        mockEmployeeSalaryRepo.closePreviousAssignment as jest.Mock
      ).mockResolvedValueOnce({
        ...existingAssignment,
        effectiveTo: new Date('2026-07-01T00:00:00.000Z'),
        status: EmployeeSalaryStatus.SUPERSEDED,
      });

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-05-01', // Backdated!
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(
        mockEmployeeSalaryRepo.closePreviousAssignment,
      ).not.toHaveBeenCalled();
      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });

    it('rejects same-day revision (effectiveFrom equal to latest)', async () => {
      const existingAssignment = {
        _id: new Types.ObjectId(),
        employeeId,
        effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
        effectiveTo: null,
        status: EmployeeSalaryStatus.ACTIVE,
      } as EmployeeSalaryLean;

      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([existingAssignment]);

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01', // Same day!
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(
        mockEmployeeSalaryRepo.closePreviousAssignment,
      ).not.toHaveBeenCalled();
    });

    it('rejects revision when a future conflicting assignment already exists', async () => {
      const futureAssignment = {
        _id: new Types.ObjectId(),
        employeeId,
        effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
        effectiveTo: null,
        status: EmployeeSalaryStatus.ACTIVE,
      } as EmployeeSalaryLean;

      const currentAssignment = {
        _id: new Types.ObjectId(),
        employeeId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-10-01T00:00:00.000Z'),
        status: EmployeeSalaryStatus.SUPERSEDED,
      } as EmployeeSalaryLean;

      // Note: findAllByEmployeeId returns newest first
      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([futureAssignment, currentAssignment]);

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-08-01', // Between current and future!
      };

      // Because activeAssignment is 2026-10-01, 2026-08-01 <= 2026-10-01, so it is rejected!
      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects revision when another request concurrently modified the assignment', async () => {
      const existingAssignment = {
        _id: new Types.ObjectId(),
        employeeId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        status: EmployeeSalaryStatus.ACTIVE,
      } as EmployeeSalaryLean;

      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([existingAssignment]);
      // Simulate race condition: closePreviousAssignment returned null because another worker closed it
      (
        mockEmployeeSalaryRepo.closePreviousAssignment as jest.Mock
      ).mockResolvedValueOnce(null);

      const dto = {
        salaryStructureId: structureId.toString(),
        effectiveFrom: '2026-07-01',
      };

      await expect(
        service.assignSalary(employeeId, dto, actorId),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.CONCURRENT_MODIFICATION,
      });
    });

    it('allows new non-overlapping ACTIVE assignment when only closed SUPERSEDED history exists (2026-10-27 to 2027-01-01 -> new 2027-06-01)', async () => {
      const closedHistorical = {
        _id: new Types.ObjectId(),
        employeeId,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2026-10-27T00:00:00.000Z'),
        effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
        status: EmployeeSalaryStatus.SUPERSEDED,
        __v: 0,
      } as EmployeeSalaryLean;

      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([closedHistorical]);

      const result = await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structureId.toString(),
          effectiveFrom: '2027-06-01',
        },
        actorId,
      );

      expect(result.status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(result.effectiveFrom).toEqual(
        new Date('2027-06-01T00:00:00.000Z'),
      );
      expect(result.effectiveTo).toBeNull();
      expect(
        mockEmployeeSalaryRepo.closePreviousAssignment,
      ).not.toHaveBeenCalled();
      expect(mockEmployeeSalaryRepo.create).toHaveBeenCalledTimes(1);
      expect(mockAuditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EMPLOYEE_SALARY_ASSIGNED',
        }),
        mockSession,
      );
    });

    it('allows contiguous boundary assignment immediately after closed SUPERSEDED effectiveTo (2027-01-01)', async () => {
      const closedHistorical = {
        _id: new Types.ObjectId(),
        employeeId,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2026-10-27T00:00:00.000Z'),
        effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
        status: EmployeeSalaryStatus.SUPERSEDED,
        __v: 0,
      } as EmployeeSalaryLean;

      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([closedHistorical]);

      const result = await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structureId.toString(),
          effectiveFrom: '2027-01-01',
        },
        actorId,
      );

      expect(result.status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(result.effectiveTo).toBeNull();
      expect(
        mockEmployeeSalaryRepo.closePreviousAssignment,
      ).not.toHaveBeenCalled();
    });

    it('rejects overlapping or future-conflicting assignments when only SUPERSEDED history exists', async () => {
      const closedHistorical = {
        _id: new Types.ObjectId(),
        employeeId,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2026-10-27T00:00:00.000Z'),
        effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
        status: EmployeeSalaryStatus.SUPERSEDED,
        __v: 0,
      } as EmployeeSalaryLean;

      for (const overlappingDate of [
        '2026-12-01',
        '2026-10-27',
        '2026-09-01',
      ]) {
        (
          mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
        ).mockResolvedValueOnce([closedHistorical]);

        await expect(
          service.assignSalary(
            employeeId,
            {
              salaryStructureId: structureId.toString(),
              effectiveFrom: overlappingDate,
            },
            actorId,
          ),
        ).rejects.toMatchObject({
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        });
      }

      // Future bounded historical interval also blocks overlapping open-ended assignment
      const futureBoundedHistorical = {
        _id: new Types.ObjectId(),
        employeeId,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2027-08-01T00:00:00.000Z'),
        effectiveTo: new Date('2027-10-01T00:00:00.000Z'),
        status: EmployeeSalaryStatus.SUPERSEDED,
      } as EmployeeSalaryLean;

      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([futureBoundedHistorical, closedHistorical]);

      await expect(
        service.assignSalary(
          employeeId,
          {
            salaryStructureId: structureId.toString(),
            effectiveFrom: '2027-06-01',
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });

      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });

    it('rejects ACTIVE revision when another future-dated historical assignment overlaps the requested interval', async () => {
      const futureClosed = {
        _id: new Types.ObjectId(),
        employeeId,
        effectiveFrom: new Date('2027-10-01T00:00:00.000Z'),
        effectiveTo: new Date('2027-12-01T00:00:00.000Z'),
        status: EmployeeSalaryStatus.SUPERSEDED,
      } as EmployeeSalaryLean;
      const openActive = {
        _id: new Types.ObjectId(),
        employeeId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        status: EmployeeSalaryStatus.ACTIVE,
      } as EmployeeSalaryLean;

      (
        mockEmployeeSalaryRepo.findAllByEmployeeId as jest.Mock
      ).mockResolvedValueOnce([futureClosed, openActive]);

      await expect(
        service.assignSalary(
          employeeId,
          {
            salaryStructureId: structureId.toString(),
            effectiveFrom: '2027-06-01',
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });

      expect(
        mockEmployeeSalaryRepo.closePreviousAssignment,
      ).not.toHaveBeenCalled();
      expect(mockEmployeeSalaryRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentSalary', () => {
    it('returns the current salary assignment effective on asOfDate', async () => {
      const activeSalary = {
        _id: new Types.ObjectId(),
        employeeId,
        salaryAmount: 50000,
        status: EmployeeSalaryStatus.ACTIVE,
      } as EmployeeSalaryLean;

      (
        mockEmployeeSalaryRepo.findCurrentByEmployeeId as jest.Mock
      ).mockResolvedValueOnce(activeSalary);

      const result = await service.getCurrentSalary(employeeId, '2026-07-15');

      expect(result).toBe(activeSalary);
      expect(
        mockEmployeeSalaryRepo.findCurrentByEmployeeId,
      ).toHaveBeenCalledWith(employeeId, new Date('2026-07-15T00:00:00.000Z'));
    });

    it('returns null if employee has no active salary assignment', async () => {
      (
        mockEmployeeSalaryRepo.findCurrentByEmployeeId as jest.Mock
      ).mockResolvedValueOnce(null);

      const result = await service.getCurrentSalary(employeeId, '2026-07-15');

      expect(result).toBeNull();
    });

    it('rejects getCurrentSalary when employee is not found', async () => {
      mockEmployeeModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.getCurrentSalary(employeeId)).rejects.toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('rejects getCurrentSalary when employee is soft-deleted', async () => {
      mockEmployeeModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...activeEmployee,
            deletedAt: new Date(),
          }),
        }),
      });

      await expect(service.getCurrentSalary(employeeId)).rejects.toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('rejects getCurrentSalary when asOfDate format is invalid', async () => {
      await expect(
        service.getCurrentSalary(employeeId, 'not-a-valid-date'),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(
        mockEmployeeSalaryRepo.findCurrentByEmployeeId,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getSalaryHistory', () => {
    it('returns paginated and sorted salary history', async () => {
      const historyMock = {
        data: [
          {
            _id: new Types.ObjectId(),
            employeeId,
            effectiveFrom: new Date('2026-07-01'),
            salaryAmount: 75000,
          },
        ] as EmployeeSalaryLean[],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };

      (
        mockEmployeeSalaryRepo.findPaginatedByEmployeeId as jest.Mock
      ).mockResolvedValueOnce(historyMock);

      const result = await service.getSalaryHistory(employeeId, {
        page: 1,
        limit: 10,
        sortBy: 'effectiveFrom',
        sortOrder: 'desc',
      });

      expect(result).toEqual(historyMock);
      expect(
        mockEmployeeSalaryRepo.findPaginatedByEmployeeId,
      ).toHaveBeenCalledWith(employeeId, {
        page: 1,
        limit: 10,
        sortBy: 'effectiveFrom',
        sortOrder: 'desc',
      });
    });

    it('rejects getSalaryHistory when employee is not found', async () => {
      mockEmployeeModel.findById.mockReturnValueOnce({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.getSalaryHistory(employeeId, { page: 1, limit: 10 }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });
  });
});
