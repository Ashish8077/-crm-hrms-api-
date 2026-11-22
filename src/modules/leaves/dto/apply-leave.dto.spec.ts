import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplyLeaveDto } from './apply-leave.dto';
import { HalfDaySession } from '../constants/leaves.constant';

describe('ApplyLeaveDto', () => {
  const validBasePayload = {
    leaveTypeId: '60d5ecb8b5c9c32b8c8d4e11',
    startDate: '2026-12-28',
    endDate: '2026-12-28',
    reason: 'Attending personal appointment outside office.',
  };

  it('should validate a valid full-day payload with isHalfDay: false', async () => {
    const dto = plainToInstance(ApplyLeaveDto, {
      ...validBasePayload,
      isHalfDay: false,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should validate when isHalfDay and halfDaySession are omitted (defaults to full day)', async () => {
    const dto = plainToInstance(ApplyLeaveDto, validBasePayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.isHalfDay).toBe(false);
  });

  it('should validate when isHalfDay is true and halfDaySession is FIRST_HALF', async () => {
    const dto = plainToInstance(ApplyLeaveDto, {
      ...validBasePayload,
      isHalfDay: true,
      halfDaySession: HalfDaySession.FIRST_HALF,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should validate when isHalfDay is true and halfDaySession is SECOND_HALF', async () => {
    const dto = plainToInstance(ApplyLeaveDto, {
      ...validBasePayload,
      isHalfDay: true,
      halfDaySession: HalfDaySession.SECOND_HALF,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid halfDaySession enum value', async () => {
    const dto = plainToInstance(ApplyLeaveDto, {
      ...validBasePayload,
      isHalfDay: true,
      halfDaySession: 'THIRD_HALF',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const sessionError = errors.find((e) => e.property === 'halfDaySession');
    expect(sessionError).toBeDefined();
    expect(sessionError?.constraints?.isEnum).toContain(
      'halfDaySession must be either FIRST_HALF or SECOND_HALF',
    );
  });

  it('should reject missing leaveTypeId', async () => {
    const { leaveTypeId: _, ...payload } = validBasePayload;
    void _;
    const dto = plainToInstance(ApplyLeaveDto, payload);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const idError = errors.find((e) => e.property === 'leaveTypeId');
    expect(idError).toBeDefined();
  });

  it('should reject invalid MongoId format for leaveTypeId', async () => {
    const dto = plainToInstance(ApplyLeaveDto, {
      ...validBasePayload,
      leaveTypeId: 'invalid-mongo-id',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const idError = errors.find((e) => e.property === 'leaveTypeId');
    expect(idError).toBeDefined();
  });

  it('should reject invalid date format for startDate and endDate', async () => {
    const dto = plainToInstance(ApplyLeaveDto, {
      ...validBasePayload,
      startDate: '28-12-2026',
      endDate: '2026/12/28',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
    expect(errors.some((e) => e.property === 'endDate')).toBe(true);
  });

  it('should reject reason shorter than 5 characters', async () => {
    const dto = plainToInstance(ApplyLeaveDto, {
      ...validBasePayload,
      reason: 'Sick',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const reasonError = errors.find((e) => e.property === 'reason');
    expect(reasonError).toBeDefined();
    expect(
      reasonError?.constraints?.minComplexity ||
        reasonError?.constraints?.minLength,
    ).toBeDefined();
  });

  it('should strip HTML tags from reason transform', () => {
    const dto = plainToInstance(ApplyLeaveDto, {
      ...validBasePayload,
      reason: '<b>Medical appointment</b> with doctor.',
    });
    expect(dto.reason).toBe('Medical appointment with doctor.');
  });
});
