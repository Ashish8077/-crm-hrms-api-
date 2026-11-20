import { escapeRegExp } from './regex.util';

describe('regex.util', () => {
  describe('escapeRegExp', () => {
    it('should escape all regex special characters', () => {
      const inputStr = '.*+?^${}()|[]\\';
      const expectedStr = '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\';
      expect(escapeRegExp(inputStr)).toBe(expectedStr);
    });

    it('should not alter normal strings', () => {
      expect(escapeRegExp('hello world 123')).toBe('hello world 123');
    });
  });
});
