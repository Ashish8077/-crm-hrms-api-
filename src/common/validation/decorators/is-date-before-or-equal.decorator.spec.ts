import { validate } from 'class-validator';
import { IsDateBeforeOrEqual } from './is-date-before-or-equal.decorator';

class TestDateRangeDto {
  @IsDateBeforeOrEqual('endDate')
  startDate?: string;

  endDate?: string;
}

describe('IsDateBeforeOrEqual Decorator', () => {
  it('should pass when startDate is earlier than endDate', async () => {
    const dto = new TestDateRangeDto();
    dto.startDate = '2026-10-01';
    dto.endDate = '2026-10-31';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass when startDate equals endDate', async () => {
    const dto = new TestDateRangeDto();
    dto.startDate = '2026-10-15';
    dto.endDate = '2026-10-15';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass when only startDate is provided', async () => {
    const dto = new TestDateRangeDto();
    dto.startDate = '2026-10-01';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass when only endDate is provided', async () => {
    const dto = new TestDateRangeDto();
    dto.endDate = '2026-10-31';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass when both are undefined or empty', async () => {
    const dto = new TestDateRangeDto();

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when startDate is strictly later than endDate', async () => {
    const dto = new TestDateRangeDto();
    dto.startDate = '2026-10-31';
    dto.endDate = '2026-10-01';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
    expect(errors[0].constraints?.isDateBeforeOrEqual).toBe(
      'startDate must not be later than endDate',
    );
  });
});
