/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PayrollCalculationsController } from './payroll-calculations.controller';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import {
  PayrollCalculationPreviewResponseDto,
  PayrollRecordResponseDto,
} from './dto/payroll-calculation-response.dto';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('PayrollCalculationsController', () => {
  let controller: PayrollCalculationsController;
  let service: jest.Mocked<PayrollCalculationService>;

  const actorId = new Types.ObjectId();
  const mockRequest = {
    user: {
      userId: actorId,
      sessionId: new Types.ObjectId(),
      roleIds: [new Types.ObjectId()],
    },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestRunner/1.0' },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollCalculationsController],
      providers: [
        {
          provide: PayrollCalculationService,
          useValue: {
            preview: jest.fn(),
            calculateAndPersistEmployeePayroll: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(PayrollCalculationsController);
    service = module.get(PayrollCalculationService);
  });

  it('attaches dedicated RBAC permissions to preview and calculateEmployee endpoints', () => {
    const previewPerms = Reflect.getMetadata(
      REQUIRE_PERMISSIONS_KEY,
      PayrollCalculationsController.prototype.preview,
    ) as string[];
    const calcPerms = Reflect.getMetadata(
      REQUIRE_PERMISSIONS_KEY,
      PayrollCalculationsController.prototype.calculateEmployee,
    ) as string[];

    expect(previewPerms).toEqual([PermissionKeys.PAYROLL_CALCULATIONS_VIEW]);
    expect(calcPerms).toEqual([PermissionKeys.PAYROLL_CALCULATIONS_CREATE]);
  });

  it('preview delegates to service and returns { success: true, data }', async () => {
    const mockPreview = {
      persisted: false,
      snapshot: {},
    } as unknown as PayrollCalculationPreviewResponseDto;
    service.preview.mockResolvedValue(mockPreview);

    const dto = {
      payrollPeriodId: new Types.ObjectId().toString(),
      employeeId: new Types.ObjectId().toString(),
      payableDays: 15,
    };
    const res = await controller.preview(dto);

    expect(res).toEqual({ success: true, data: mockPreview });
    expect(service.preview).toHaveBeenCalledWith(dto);
  });

  it('calculateEmployee delegates to service with actorId and clientMetadata', async () => {
    const mockRecord = {
      id: new Types.ObjectId().toString(),
      persisted: true,
    } as unknown as PayrollRecordResponseDto;
    service.calculateAndPersistEmployeePayroll.mockResolvedValue(mockRecord);

    const dto = {
      payrollPeriodId: new Types.ObjectId().toString(),
      employeeId: new Types.ObjectId().toString(),
      payableDays: 30,
      recalculate: false,
    };
    const res = await controller.calculateEmployee(dto, mockRequest);

    expect(res).toEqual({ success: true, data: mockRecord });
    expect(service.calculateAndPersistEmployeePayroll).toHaveBeenCalledWith(
      dto,
      actorId,
      { ipAddress: '127.0.0.1', userAgent: 'JestRunner/1.0' },
    );
  });
});
