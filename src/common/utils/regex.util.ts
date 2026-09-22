/**
 * Escapes a string to be used safely within a regular expression.
 * Prevents user input from unintentionally being treated as regex syntax.
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
