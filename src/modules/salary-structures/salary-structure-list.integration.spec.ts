import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SalaryStructuresController } from './salary-structures.controller';
import { SalaryStructuresService } from './services/salary-structures.service';
import { SalaryStructureRepository } from './repositories/salary-structure.repository';
import { SalaryStructureCalculationService } from './services/salary-structure-calculation.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  SalaryStructure,
  SalaryStructureLean,
} from './schemas/salary-structure.schema';
import { SalaryComponent } from '../salary-components/schemas/salary-component.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  SalaryStructureSortableField,
  StructureComponentCalculationType,
} from './constants/salary-structure.constant';
import { ListSalaryStructuresQueryDto } from './dto/list-salary-structures-query.dto';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ValidationError } from 'class-validator';

describe('GET /api/v1/salary-structures (Production Swagger Test Cases)', () => {
  let controller: SalaryStructuresController;
  let validationPipe: ValidationPipe;

  const actorId = new Types.ObjectId();
  const componentId = new Types.ObjectId();

  // Exactly 8 production test records
  const seedRecords: SalaryStructureLean[] = [
    {
      _id: new Types.ObjectId('674100000000000000000001'),
      name: 'Standard Engineering CTC',
      code: 'ENG_STD_CTC',
      description: 'Standard Engineering CTC template',
      salaryBasis: SalaryStructureBasis.CTC,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 50000,
      components: [
        {
          componentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 50000,
          percentage: null,
          percentageOf: null,
        },
      ],
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      updatedAt: new Date('2026-01-01T10:00:00.000Z'),
      __v: 0,
    },
    {
      _id: new Types.ObjectId('674100000000000000000002'),
      name: 'Senior Engineering CTC',
      code: 'ENG_SNR_CTC',
      description: 'Senior Engineering CTC template',
      salaryBasis: SalaryStructureBasis.CTC,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 80000,
      components: [
        {
          componentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 80000,
          percentage: null,
          percentageOf: null,
        },
      ],
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-02T10:00:00.000Z'),
      updatedAt: new Date('2026-01-02T10:00:00.000Z'),
      __v: 0,
    },
    {
      _id: new Types.ObjectId('674100000000000000000003'),
      name: 'Premium Engineering CTC',
      code: 'ENG_PRM_CTC',
      description: 'Premium Engineering CTC template',
      salaryBasis: SalaryStructureBasis.CTC,
      salaryFrequency: SalaryStructureFrequency.ANNUAL,
      salaryAmount: 1200000,
      components: [
        {
          componentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 1200000,
          percentage: null,
          percentageOf: null,
        },
      ],
      isActive: false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-03T10:00:00.000Z'),
      updatedAt: new Date('2026-01-03T10:00:00.000Z'),
      __v: 0,
    },
    {
      _id: new Types.ObjectId('674100000000000000000004'),
      name: 'Junior Engineering Gross',
      code: 'ENG_JNR_GROSS',
      description: 'Junior Engineering Gross template',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 30000,
      components: [
        {
          componentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 30000,
          percentage: null,
          percentageOf: null,
        },
      ],
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-04T10:00:00.000Z'),
      updatedAt: new Date('2026-01-04T10:00:00.000Z'),
      __v: 0,
    },
    {
      _id: new Types.ObjectId('674100000000000000000005'),
      name: 'Corporate Engineering CTC',
      code: 'ENG_CORP_GROSS',
      description: 'Corporate Engineering template (GROSS basis)',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 90000,
      components: [
        {
          componentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 90000,
          percentage: null,
          percentageOf: null,
        },
      ],
      isActive: false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-05T10:00:00.000Z'),
      updatedAt: new Date('2026-01-05T10:00:00.000Z'),
      __v: 0,
    },
    {
      _id: new Types.ObjectId('674100000000000000000006'),
      name: 'Operations Support L1',
      code: 'OPS_GROSS_001',
      description: 'Operations Gross template L1',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 40000,
      components: [
        {
          componentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 40000,
          percentage: null,
          percentageOf: null,
        },
      ],
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-06T10:00:00.000Z'),
      updatedAt: new Date('2026-01-06T10:00:00.000Z'),
      __v: 0,
    },
    {
      _id: new Types.ObjectId('674100000000000000000007'),
      name: 'Operations Support L2',
      code: 'OPS_GROSS_002',
      description: 'Operations Gross template L2',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 60000,
      components: [
        {
          componentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 60000,
          percentage: null,
          percentageOf: null,
        },
      ],
      isActive: false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-07T10:00:00.000Z'),
      updatedAt: new Date('2026-01-07T10:00:00.000Z'),
      __v: 0,
    },
    {
      _id: new Types.ObjectId('674100000000000000000008'),
      name: 'Executive Management CTC',
      code: 'EXEC_CTC_001',
      description: 'Executive Management CTC template',
      salaryBasis: SalaryStructureBasis.CTC,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 150000,
      components: [
        {
          componentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 150000,
          percentage: null,
          percentageOf: null,
        },
      ],
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-08T10:00:00.000Z'),
      updatedAt: new Date('2026-01-08T10:00:00.000Z'),
      __v: 0,
    },
  ];

  /**
   * Filter and sort records using Mongoose query simulation
   */
  const executeQuery = (filter: Record<string, unknown> = {}) => {
    return seedRecords.filter((doc) => {
      // 1. Basis filter
      if (filter.salaryBasis && doc.salaryBasis !== filter.salaryBasis) {
        return false;
      }
      // 2. Active filter
      if (filter.isActive !== undefined && doc.isActive !== filter.isActive) {
        return false;
      }
      // 3. Search regex filter
      if (Array.isArray(filter.$or)) {
        const matches = (
          filter.$or as Array<{
            name?: { $regex: string; $options: string };
            code?: { $regex: string; $options: string };
          }>
        ).some((clause) => {
          if (clause.name) {
            const regex = new RegExp(
              clause.name.$regex,
              clause.name.$options ?? 'i',
            );
            return regex.test(doc.name);
          }
          if (clause.code) {
            const regex = new RegExp(
              clause.code.$regex,
              clause.code.$options ?? 'i',
            );
            return regex.test(doc.code);
          }
          return false;
        });
        if (!matches) return false;
      }
      return true;
    });
  };

  const createModelMock = () => {
    const modelMock = {
      find: jest.fn().mockImplementation((filter: Record<string, unknown>) => {
        let currentDocs = executeQuery(filter);

        const chain = {
          sort: jest
            .fn()
            .mockImplementation(
              (
                sortOptions: Partial<
                  Record<SalaryStructureSortableField, 1 | -1>
                >,
              ) => {
                const [sortField, sortDir] = Object.entries(sortOptions)[0] ?? [
                  'createdAt',
                  -1,
                ];
                const dir = sortDir === 1 ? 1 : -1;

                currentDocs = [...currentDocs].sort((a, b) => {
                  const valA = (a as unknown as Record<string, unknown>)[
                    sortField
                  ];
                  const valB = (b as unknown as Record<string, unknown>)[
                    sortField
                  ];

                  if (valA instanceof Date && valB instanceof Date) {
                    return (valA.getTime() - valB.getTime()) * dir;
                  }
                  if (typeof valA === 'string' && typeof valB === 'string') {
                    return valA.localeCompare(valB) * dir;
                  }
                  if (typeof valA === 'number' && typeof valB === 'number') {
                    return (valA - valB) * dir;
                  }
                  return 0;
                });
                return chain;
              },
            ),
          skip: jest.fn().mockImplementation((skipCount: number) => {
            currentDocs = currentDocs.slice(skipCount);
            return chain;
          }),
          limit: jest.fn().mockImplementation((limitCount: number) => {
            currentDocs = currentDocs.slice(0, limitCount);
            return chain;
          }),
          lean: jest.fn().mockReturnThis(),
          exec: jest
            .fn()
            .mockImplementation(() => Promise.resolve(currentDocs)),
        };

        return chain;
      }),
      countDocuments: jest
        .fn()
        .mockImplementation((filter: Record<string, unknown>) => ({
          exec: jest
            .fn()
            .mockImplementation(() =>
              Promise.resolve(executeQuery(filter).length),
            ),
        })),
    };

    return modelMock;
  };

  beforeAll(async () => {
    const modelMock = createModelMock();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SalaryStructuresController],
      providers: [
        SalaryStructuresService,
        SalaryStructureRepository,
        SalaryStructureCalculationService,
        {
          provide: getModelToken(SalaryStructure.name),
          useValue: modelMock,
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: {
            find: jest.fn().mockReturnValue({
              lean: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue([]),
              }),
            }),
          },
        },
        {
          provide: AuditLogsService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    controller = moduleFixture.get<SalaryStructuresController>(
      SalaryStructuresController,
    );

    // Production-identical ValidationPipe
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

  /**
   * Helper that executes a query through the exact production ValidationPipe and Controller
   */
  const executeListApi = async (rawQuery: Record<string, unknown>) => {
    const validatedDto = (await validationPipe.transform(rawQuery, {
      type: 'query',
      metatype: ListSalaryStructuresQueryDto,
    })) as ListSalaryStructuresQueryDto;

    return controller.list(validatedDto);
  };

  /**
   * Helper that tests query validation errors
   */
  const expectValidationError = async (rawQuery: Record<string, unknown>) => {
    await expect(
      validationPipe.transform(rawQuery, {
        type: 'query',
        metatype: ListSalaryStructuresQueryDto,
      }),
    ).rejects.toThrow(AppError);

    try {
      await validationPipe.transform(rawQuery, {
        type: 'query',
        metatype: ListSalaryStructuresQueryDto,
      });
    } catch (error) {
      const appErr = error as AppError;
      expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
      return appErr;
    }
  };

  // ==========================================
  // Test 1 – Default pagination
  // ==========================================
  it('Test 1 – Default pagination: ?page=1&limit=3', async () => {
    const res = await executeListApi({ page: '1', limit: '3' });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(3);
    expect(res.meta).toEqual({
      total: 8,
      page: 1,
      limit: 3,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    // Default sorting applied: createdAt desc (newest first)
    expect(res.data[0].code).toBe('EXEC_CTC_001');
    expect(res.data[0].grossSalary).toBe(150000);
    expect(res.data[0].totalCtc).toBe(150000);
    expect(res.data[1].code).toBe('OPS_GROSS_002');
    expect(res.data[2].code).toBe('OPS_GROSS_001');
  });

  // ==========================================
  // Test 2 – Next page
  // ==========================================
  it('Test 2 – Next page: ?page=2&limit=3', async () => {
    const res = await executeListApi({ page: '2', limit: '3' });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(3);
    expect(res.meta).toEqual({
      total: 8,
      page: 2,
      limit: 3,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
    // Distinct records, no duplicates from page 1
    const page2Codes = res.data.map((d) => d.code);
    expect(page2Codes).toEqual([
      'ENG_CORP_GROSS',
      'ENG_JNR_GROSS',
      'ENG_PRM_CTC',
    ]);
  });

  // ==========================================
  // Test 3 – Last page
  // ==========================================
  it('Test 3 – Last page: ?page=3&limit=3', async () => {
    const res = await executeListApi({ page: '3', limit: '3' });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(2); // Remaining 2 records
    expect(res.meta).toEqual({
      total: 8,
      page: 3,
      limit: 3,
      totalPages: 3,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    const page3Codes = res.data.map((d) => d.code);
    expect(page3Codes).toEqual(['ENG_SNR_CTC', 'ENG_STD_CTC']);
  });

  // ==========================================
  // Test 4 – Search by name
  // ==========================================
  it('Test 4 – Search by name: ?search=Engineering', async () => {
    const res = await executeListApi({ search: 'Engineering', limit: '10' });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(5);
    const names = res.data.map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Standard Engineering CTC',
        'Senior Engineering CTC',
        'Premium Engineering CTC',
        'Junior Engineering Gross',
        'Corporate Engineering CTC',
      ]),
    );
  });

  // ==========================================
  // Test 5 – Search by code
  // ==========================================
  it('Test 5 – Search by code: ?search=OPS_GROSS', async () => {
    const res = await executeListApi({ search: 'OPS_GROSS', limit: '10' });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(2);
    const codes = res.data.map((d) => d.code);
    expect(codes).toEqual(
      expect.arrayContaining(['OPS_GROSS_001', 'OPS_GROSS_002']),
    );
  });

  // ==========================================
  // Test 6 – Case-insensitive search
  // ==========================================
  it('Test 6 – Case-insensitive search: ?search=engineering', async () => {
    const res = await executeListApi({ search: 'engineering', limit: '10' });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(5);
    const names = res.data.map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Standard Engineering CTC',
        'Senior Engineering CTC',
        'Premium Engineering CTC',
        'Junior Engineering Gross',
        'Corporate Engineering CTC',
      ]),
    );
  });

  // ==========================================
  // Test 7 – CTC filter
  // ==========================================
  it('Test 7 – CTC filter: ?salaryBasis=CTC', async () => {
    const res = await executeListApi({
      salaryBasis: SalaryStructureBasis.CTC,
      limit: '10',
    });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(4);
    for (const item of res.data) {
      expect(item.salaryBasis).toBe(SalaryStructureBasis.CTC);
    }
    const codes = res.data.map((d) => d.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'ENG_STD_CTC',
        'ENG_SNR_CTC',
        'ENG_PRM_CTC',
        'EXEC_CTC_001',
      ]),
    );
  });

  // ==========================================
  // Test 8 – Gross filter
  // ==========================================
  it('Test 8 – Gross filter: ?salaryBasis=GROSS', async () => {
    const res = await executeListApi({
      salaryBasis: SalaryStructureBasis.GROSS,
      limit: '10',
    });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(4);
    for (const item of res.data) {
      expect(item.salaryBasis).toBe(SalaryStructureBasis.GROSS);
    }
    const codes = res.data.map((d) => d.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'ENG_JNR_GROSS',
        'ENG_CORP_GROSS',
        'OPS_GROSS_001',
        'OPS_GROSS_002',
      ]),
    );
  });

  // ==========================================
  // Test 9 – Active structures
  // ==========================================
  it('Test 9 – Active structures: ?isActive=true', async () => {
    const res = await executeListApi({ isActive: 'true', limit: '10' });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(5);
    for (const item of res.data) {
      expect(item.isActive).toBe(true);
    }
  });

  // ==========================================
  // Test 10 – Inactive structures
  // ==========================================
  it('Test 10 – Inactive structures: ?isActive=false', async () => {
    const res = await executeListApi({ isActive: 'false', limit: '10' });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(3);
    for (const item of res.data) {
      expect(item.isActive).toBe(false);
    }
    const codes = res.data.map((d) => d.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'ENG_PRM_CTC',
        'ENG_CORP_GROSS',
        'OPS_GROSS_002',
      ]),
    );
  });

  // ==========================================
  // Test 11 – Combined filters
  // ==========================================
  it('Test 11 – Combined filters: ?salaryBasis=CTC&isActive=true&page=1&limit=2', async () => {
    const res = await executeListApi({
      salaryBasis: SalaryStructureBasis.CTC,
      isActive: 'true',
      page: '1',
      limit: '2',
    });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(2); // 2 on first page
    expect(res.meta).toEqual({
      total: 3, // 3 matching records total
      page: 1,
      limit: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    for (const item of res.data) {
      expect(item.salaryBasis).toBe(SalaryStructureBasis.CTC);
      expect(item.isActive).toBe(true);
    }
  });

  // ==========================================
  // Test 12 – Search + filters + pagination
  // ==========================================
  it('Test 12 – Search + filters + pagination: ?search=Engineering&salaryBasis=CTC&isActive=true&page=1&limit=2', async () => {
    const res = await executeListApi({
      search: 'Engineering',
      salaryBasis: SalaryStructureBasis.CTC,
      isActive: 'true',
      page: '1',
      limit: '2',
    });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(2); // Exactly 2 matching records
    expect(res.meta.total).toBe(2);
    const codes = res.data.map((d) => d.code);
    expect(codes).toEqual(
      expect.arrayContaining(['ENG_STD_CTC', 'ENG_SNR_CTC']),
    );
  });

  // ==========================================
  // Test 13 – Sorting by name
  // ==========================================
  it('Test 13 – Sorting by name: ?sortBy=name&sortOrder=asc', async () => {
    const res = await executeListApi({
      sortBy: 'name',
      sortOrder: 'asc',
      limit: '10',
    });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(8);
    const names = res.data.map((d) => d.name);
    const sortedExpected = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sortedExpected);
    expect(names[0]).toBe('Corporate Engineering CTC');
    expect(names[7]).toBe('Standard Engineering CTC');
  });

  // ==========================================
  // Test 14 – Sorting by salary amount
  // ==========================================
  it('Test 14 – Sorting by salary amount: ?sortBy=salaryAmount&sortOrder=desc', async () => {
    const res = await executeListApi({
      sortBy: 'salaryAmount',
      sortOrder: 'desc',
      limit: '10',
    });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(8);
    const amounts = res.data.map((d) => d.salaryAmount);
    expect(amounts).toEqual([
      1200000, 150000, 90000, 80000, 60000, 50000, 40000, 30000,
    ]);
  });

  // ==========================================
  // Test 15 – Sorting by createdAt
  // ==========================================
  it('Test 15 – Sorting by createdAt: ?sortBy=createdAt&sortOrder=desc', async () => {
    const res = await executeListApi({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      limit: '10',
    });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(8);
    const codes = res.data.map((d) => d.code);
    expect(codes).toEqual([
      'EXEC_CTC_001',
      'OPS_GROSS_002',
      'OPS_GROSS_001',
      'ENG_CORP_GROSS',
      'ENG_JNR_GROSS',
      'ENG_PRM_CTC',
      'ENG_SNR_CTC',
      'ENG_STD_CTC',
    ]);
  });

  // ==========================================
  // Additional Validation Tests
  // ==========================================
  describe('Additional Validation Tests for List API', () => {
    it('Invalid page (?page=0) returns 400', async () => {
      const err = await expectValidationError({ page: '0' });
      expect(JSON.stringify(err?.details)).toContain('page');
    });

    it('Negative limit (?limit=-5) returns 400', async () => {
      const err = await expectValidationError({ limit: '-5' });
      expect(JSON.stringify(err?.details)).toContain('limit');
    });

    it('Invalid basis (?salaryBasis=INVALID) returns 400', async () => {
      const err = await expectValidationError({ salaryBasis: 'INVALID' });
      expect(JSON.stringify(err?.details)).toContain('salaryBasis');
    });

    it('Invalid status (?isActive=yes) returns 400', async () => {
      const err = await expectValidationError({ isActive: 'yes' });
      expect(JSON.stringify(err?.details)).toContain('isActive');
    });

    it('Invalid sort field (?sortBy=password) returns 400', async () => {
      const err = await expectValidationError({ sortBy: 'password' });
      expect(JSON.stringify(err?.details)).toContain('sortBy');
    });

    it('Invalid sort order (?sortOrder=random) returns 400', async () => {
      const err = await expectValidationError({ sortOrder: 'random' });
      expect(JSON.stringify(err?.details)).toContain('sortOrder');
    });

    it('Empty search (?search=) returns consistent empty/default behavior', async () => {
      const res = await executeListApi({ search: '', limit: '10' });

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(8);
      expect(res.meta.total).toBe(8);
    });

    it('Beyond last page (?page=100&limit=10) returns empty data and correct metadata', async () => {
      const res = await executeListApi({ page: '100', limit: '10' });

      expect(res.success).toBe(true);
      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({
        total: 8,
        page: 100,
        limit: 10,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });
  });
});
