import { validatePasswordPolicy } from './password-policy.util';

describe('validatePasswordPolicy', () => {
  it('should accept a valid password meeting all rules', () => {
    expect(validatePasswordPolicy('Str0ng!Pa$$')).toEqual([]);
  });

  it('should accept a password at exact minimum length', () => {
    expect(validatePasswordPolicy('Aa1!xxxx')).toEqual([]);
  });

  describe('minimum length', () => {
    it('should reject a password shorter than 8 characters', () => {
      const violations = validatePasswordPolicy('Aa1!xx');
      expect(violations).toContain('Password must be at least 8 characters');
    });

    it('should reject an empty string', () => {
      const violations = validatePasswordPolicy('');
      expect(violations).toContain('Password must be at least 8 characters');
    });
  });

  describe('uppercase letter', () => {
    it('should reject a password without an uppercase letter', () => {
      const violations = validatePasswordPolicy('lowercase1!');
      expect(violations).toContain(
        'Password must contain at least one uppercase letter',
      );
    });
  });

  describe('lowercase letter', () => {
    it('should reject a password without a lowercase letter', () => {
      const violations = validatePasswordPolicy('UPPERCASE1!');
      expect(violations).toContain(
        'Password must contain at least one lowercase letter',
      );
    });
  });

  describe('number', () => {
    it('should reject a password without a number', () => {
      const violations = validatePasswordPolicy('NoNumbers!');
      expect(violations).toContain('Password must contain at least one number');
    });
  });

  describe('special character', () => {
    it('should reject a password without a special character', () => {
      const violations = validatePasswordPolicy('NoSpecial1');
      expect(violations).toContain(
        'Password must contain at least one special character',
      );
    });
  });

  describe('multiple violations', () => {
    it('should return all violations for a completely invalid password', () => {
      const violations = validatePasswordPolicy('abc');
      expect(violations).toHaveLength(4);
      expect(violations).toContain('Password must be at least 8 characters');
      expect(violations).toContain(
        'Password must contain at least one uppercase letter',
      );
      expect(violations).toContain('Password must contain at least one number');
      expect(violations).toContain(
        'Password must contain at least one special character',
      );
    });
  });
});
