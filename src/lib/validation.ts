/**
 * Centralized Validation Middleware
 * Provides standardized input validation for all forms across the platform
 */

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Email validation with comprehensive checks
 */
export function validateEmail(email: string): string | null {
  if (!email || email.trim().length === 0) {
    return 'Email is required';
  }
  
  const trimmed = email.trim().toLowerCase();
  
  // Basic format check
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!emailRegex.test(trimmed)) {
    return 'Please enter a valid email address';
  }
  
  // Check for common typos
  const commonDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];
  const domain = trimmed.split('@')[1];
  if (domain) {
    // Check for obvious typos like gmial.com, gmal.com
    if (domain.startsWith('gm') && !commonDomains.includes(domain)) {
      const suggestion = 'gmail.com';
      if (domain !== suggestion && domain.length < 12) {
        return `Did you mean ${trimmed.split('@')[0]}@${suggestion}?`;
      }
    }
  }
  
  return null;
}

/**
 * Phone number validation (US format)
 */
export function validatePhone(phone: string, required = false): string | null {
  if (!phone || phone.trim().length === 0) {
    return required ? 'Phone number is required' : null;
  }
  
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length < 10) {
    return 'Phone number must have at least 10 digits';
  }
  
  if (cleaned.length > 11) {
    return 'Phone number is too long';
  }
  
  if (cleaned.length === 11 && !cleaned.startsWith('1')) {
    return 'Invalid country code';
  }
  
  return null;
}

/**
 * Required field validation
 */
export function validateRequired(value: string, fieldName: string): string | null {
  if (!value || value.trim().length === 0) {
    return `${fieldName} is required`;
  }
  return null;
}

/**
 * Password validation
 */
export function validatePassword(password: string): string | null {
  if (!password || password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  
  // Optional: Add more strength requirements
  // if (!/[A-Z]/.test(password)) {
  //   return 'Password must contain at least one uppercase letter';
  // }
  // if (!/[0-9]/.test(password)) {
  //   return 'Password must contain at least one number';
  // }
  
  return null;
}

/**
 * Date validation
 */
export function validateDate(dateString: string, options?: {
  required?: boolean;
  minDate?: Date;
  maxDate?: Date;
}): string | null {
  if (!dateString || dateString.trim().length === 0) {
    return options?.required ? 'Date is required' : null;
  }
  
  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) {
    return 'Please enter a valid date';
  }
  
  if (options?.minDate && date < options.minDate) {
    /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant (billing/subscription/audit date), not a business-day boundary; see src/lib/orgDateRange.ts */
    return `Date must be after ${options.minDate.toLocaleDateString()}`;
  }
  
  if (options?.maxDate && date > options.maxDate) {
    /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant (billing/subscription/audit date), not a business-day boundary; see src/lib/orgDateRange.ts */
    return `Date must be before ${options.maxDate.toLocaleDateString()}`;
  }
  
  return null;
}

/**
 * Numeric validation
 */
export function validateNumber(value: string, options?: {
  required?: boolean;
  min?: number;
  max?: number;
  fieldName?: string;
}): string | null {
  const fieldName = options?.fieldName || 'Value';
  
  if (!value || value.trim().length === 0) {
    return options?.required ? `${fieldName} is required` : null;
  }
  
  const num = parseFloat(value);
  
  if (isNaN(num)) {
    return `${fieldName} must be a valid number`;
  }
  
  if (options?.min !== undefined && num < options.min) {
    return `${fieldName} must be at least ${options.min}`;
  }
  
  if (options?.max !== undefined && num > options.max) {
    return `${fieldName} cannot exceed ${options.max}`;
  }
  
  return null;
}

/**
 * URL validation
 */
export function validateUrl(url: string, required = false): string | null {
  if (!url || url.trim().length === 0) {
    return required ? 'URL is required' : null;
  }
  
  try {
    new URL(url);
    return null;
  } catch {
    return 'Please enter a valid URL';
  }
}

/**
 * Zip code validation (US format)
 */
export function validateZipCode(zipCode: string, required = false): string | null {
  if (!zipCode || zipCode.trim().length === 0) {
    return required ? 'Zip code is required' : null;
  }
  
  const cleaned = zipCode.replace(/\D/g, '');
  
  if (cleaned.length !== 5 && cleaned.length !== 9) {
    return 'Please enter a valid 5 or 9 digit zip code';
  }
  
  return null;
}

/**
 * Sanitize string input to prevent XSS
 */
export function sanitizeInput(input: string): string {
  if (!input) return '';
  
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();
}

/**
 * Generic form validator
 */
export function validateForm<T extends Record<string, string>>(
  data: T,
  rules: Partial<Record<keyof T, (value: string) => string | null>>
): ValidationResult {
  const errors: ValidationError[] = [];
  
  for (const [field, validator] of Object.entries(rules)) {
    if (validator) {
      const value = data[field as keyof T] || '';
      const error = (validator as (value: string) => string | null)(value);
      if (error) {
        errors.push({ field, message: error });
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get first error for a field
 */
export function getFieldError(errors: ValidationError[], field: string): string | undefined {
  return errors.find(e => e.field === field)?.message;
}

/**
 * Sales tax percent entered in settings. Empty means 0 (tax off).
 * Rejects values above 100 and anything that is not a 0–2 decimal number,
 * so "7.5" can be typed and "150" cannot be saved.
 */
export function parseSalesTaxPercent(
  raw: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: 0 };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      ok: false,
      message: 'Sales tax must be a number from 0 to 100 with at most 2 decimal places (for example 7.5).',
    };
  }
  const value = Number(trimmed);
  if (value > 100) {
    return { ok: false, message: 'Sales tax cannot be more than 100%.' };
  }
  return { ok: true, value };
}

/** Optional US state. Blank is fine. A value must be a 2-letter code. */
export function validateOptionalState(state: string): string | null {
  const trimmed = state.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z]{2}$/.test(trimmed)) {
    return 'State must be a 2-letter code (for example FL).';
  }
  return null;
}

/** Optional US ZIP. Blank is fine. Accepts 12345 and 12345-6789. */
export function validateOptionalZip(zip: string): string | null {
  const trimmed = zip.trim();
  if (!trimmed) return null;
  if (!/^\d{5}(-\d{4})?$/.test(trimmed)) {
    return 'ZIP must be 5 digits or ZIP+4 (12345 or 12345-6789).';
  }
  return null;
}

/**
 * Check if form has any errors
 */
export function hasErrors(result: ValidationResult): boolean {
  return !result.valid;
}
