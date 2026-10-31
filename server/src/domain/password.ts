export function validatePassword(pw: string): string[] {
  const problems: string[] = [];
  if (pw.length <= 8) problems.push('Use more than eight characters.');
  if (!/[A-Z]/.test(pw)) problems.push('Add an uppercase letter.');
  if (!/[a-z]/.test(pw)) problems.push('Add a lowercase letter.');
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('Add a special character, such as ! or #.');
  return problems;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
