import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReconcileLeaveCancellationDto } from './reconcile-leave-cancellation.dto';
import { ReconcileCancellationAction } from '../constants/leaves.constant';

describe('ReconcileLeaveCancellationDto', () => {
  it('should validate a valid APPROVE payload with refundedDays', async () => {
    const raw = {
      action: ReconcileCancellationAction.APPROVE,
      remarks:
        'Verified employee worked on 2026-06-01. Approving 1-day refund.',
      actualAttendanceDetails: 'Biometric punch in 09:00 out 18:00 recorded.',
      refundedDays: 1,
      isPayrollProcessed: false,
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should validate a valid REJECT payload', async () => {
    const raw = {
      action: ReconcileCancellationAction.REJECT,
      remarks: 'Employee was not present in office on requested dates.',
      actualAttendanceDetails:
        'No punches recorded and manager confirmed absence.',
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should validate a valid payload with yearBreakdown', async () => {
    const raw = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Cross-year refund for 2026 and 2027.',
      actualAttendanceDetails:
        'Verified presence on 2026-12-31 and 2027-01-01.',
      yearBreakdown: [
        { year: 2026, days: 1 },
        { year: 2027, days: 1 },
      ],
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should validate a valid payload with datesWorked', async () => {
    const raw = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Verified biometric presence.',
      actualAttendanceDetails: 'In: 09:00, Out: 18:00 on 2026-06-01.',
      datesWorked: ['2026-06-01'],
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject missing action', async () => {
    const raw = {
      remarks: 'Valid remarks here',
      actualAttendanceDetails: 'Valid details here',
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'action')).toBe(true);
  });

  it('should reject invalid action enum value', async () => {
    const raw = {
      action: 'INVALID_ACTION',
      remarks: 'Valid remarks here',
      actualAttendanceDetails: 'Valid details here',
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'action')).toBe(true);
  });

  it('should reject missing or short remarks', async () => {
    const raw = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: '123',
      actualAttendanceDetails: 'Valid details here',
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'remarks')).toBe(true);
  });

  it('should strip HTML tags from remarks transform', () => {
    const raw = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: '<b>Valid remarks</b> with <i>tags</i>',
      actualAttendanceDetails: 'Valid details here',
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    expect(dto.remarks).toBe('Valid remarks with tags');
  });

  it('should reject missing or short actualAttendanceDetails', async () => {
    const raw = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Valid remarks here',
      actualAttendanceDetails: 'abc',
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'actualAttendanceDetails')).toBe(
      true,
    );
  });

  it('should reject negative refundedDays', async () => {
    const raw = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Valid remarks here',
      actualAttendanceDetails: 'Valid details here',
      refundedDays: -1,
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'refundedDays')).toBe(true);
  });

  it('should reject negative days in yearBreakdown', async () => {
    const raw = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Valid remarks here',
      actualAttendanceDetails: 'Valid details here',
      yearBreakdown: [{ year: 2026, days: -0.5 }],
    };
    const dto = plainToInstance(ReconcileLeaveCancellationDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
