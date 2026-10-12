/** US phone check. Returns an error message, or null when the value is acceptable. */
export function validatePhone(phone: string, required = false): string | null {
  if (!phone || phone.trim().length === 0) {
    return required ? 'Phone number is required' : null;
  }
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 10) return 'Phone number must have at least 10 digits';
  if (cleaned.length > 11) return 'Phone number is too long';
  if (cleaned.length === 11 && !cleaned.startsWith('1')) return 'Invalid country code';
  return null;
}
