import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateShiftDto } from './create-shift.dto';
import { UpdateShiftDto } from './update-shift.dto';

describe('Shift DTO Validation', () => {
  describe('CreateShiftDto', () => {
    const validBasePayload = {
      name: 'General Shift',
      code: 'GEN',
      startTime: '09:00',
      endTime: '18:00',
    };

    it('should validate successfully when numeric fields are numbers', async () => {
      const dto = plainToInstance(CreateShiftDto, {
        ...validBasePayload,
        gracePeriodMinutes: 15,
        breakDurationMinutes: 60,
        minWorkMinutesForFullDay: 480,
        minWorkMinutesForHalfDay: 240,
        overtimeThresholdMinutes: 480,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject string numbers for gracePeriodMinutes and other numeric fields', async () => {
      const dto = plainToInstance(CreateShiftDto, {
        ...validBasePayload,
        gracePeriodMinutes: '15',
        breakDurationMinutes: '60',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);

      const graceError = errors.find(
        (e) => e.property === 'gracePeriodMinutes',
      );
      expect(graceError).toBeDefined();
      expect(graceError?.constraints).toHaveProperty('isInt');

      const breakError = errors.find(
        (e) => e.property === 'breakDurationMinutes',
      );
      expect(breakError).toBeDefined();
      expect(breakError?.constraints).toHaveProperty('isInt');
    });

    it('should reject floating point numbers for minutes', async () => {
      const dto = plainToInstance(CreateShiftDto, {
        ...validBasePayload,
        gracePeriodMinutes: 15.5,
      });

      const errors = await validate(dto);
      const graceError = errors.find(
        (e) => e.property === 'gracePeriodMinutes',
      );
      expect(graceError).toBeDefined();
      expect(graceError?.constraints).toHaveProperty('isInt');
    });

    it('should reject HTML/script tags in name', async () => {
      const scriptDto = plainToInstance(CreateShiftDto, {
        ...validBasePayload,
        name: 'General<script>',
      });
      const scriptErrors = await validate(scriptDto);
      expect(scriptErrors.some((e) => e.property === 'name')).toBe(true);

      const imgDto = plainToInstance(CreateShiftDto, {
        ...validBasePayload,
        name: 'General<img src=x>',
      });
      const imgErrors = await validate(imgDto);
      expect(imgErrors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should allow valid domain characters in name (letters, numbers, spaces, dots, underscores, hyphens, parentheses)', async () => {
      const validNames = [
        'General Shift',
        'Morning Shift (A)',
        'Night Shift - A',
        'General_Shift_1',
        'Shift 2.0',
      ];

      for (const name of validNames) {
        const dto = plainToInstance(CreateShiftDto, {
          ...validBasePayload,
          name,
        });
        const errors = await validate(dto);
        const nameError = errors.find((e) => e.property === 'name');
        expect(nameError).toBeUndefined();
      }
    });
  });

  describe('UpdateShiftDto', () => {
    it('should accept valid number updates', async () => {
      const dto = plainToInstance(UpdateShiftDto, {
        gracePeriodMinutes: 20,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject string numbers in update payload', async () => {
      const dto = plainToInstance(UpdateShiftDto, {
        gracePeriodMinutes: '20',
      });
      const errors = await validate(dto);
      const graceError = errors.find(
        (e) => e.property === 'gracePeriodMinutes',
      );
      expect(graceError).toBeDefined();
      expect(graceError?.constraints).toHaveProperty('isInt');
    });
  });
});
