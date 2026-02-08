/**
 * Input Validation Helpers
 *
 * Provides validation functions for API request parameters.
 *
 * @module middleware/validation
 */

import { ValidationError } from './error-handler';
import { limits } from '../config';

/**
 * Validates that a value is a positive integer within a range.
 *
 * @param value - Value to validate
 * @param fieldName - Name of the field (for error messages)
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns The validated integer value
 * @throws ValidationError if validation fails
 */
export function validateInteger(
  value: unknown,
  fieldName: string,
  min: number,
  max: number
): number {
  if (value === undefined || value === null) {
    throw new ValidationError(`${fieldName} is required`);
  }

  const numValue = typeof value === 'string' ? parseInt(value, 10) : value;

  if (typeof numValue !== 'number' || isNaN(numValue)) {
    throw new ValidationError(`${fieldName} must be a number`);
  }

  if (!Number.isInteger(numValue)) {
    throw new ValidationError(`${fieldName} must be an integer`);
  }

  if (numValue < min || numValue > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max}`, {
      field: fieldName,
      min,
      max,
      received: numValue,
    });
  }

  return numValue;
}

/**
 * Validates an optional integer parameter, returning a default if not provided.
 *
 * @param value - Value to validate (can be undefined)
 * @param fieldName - Name of the field (for error messages)
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @param defaultValue - Default value if not provided
 * @returns The validated integer value or default
 * @throws ValidationError if validation fails
 */
export function validateOptionalInteger(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  defaultValue: number
): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return validateInteger(value, fieldName, min, max);
}

/**
 * Validates CPU stress parameters.
 *
 * @param targetLoadPercent - Target CPU load percentage
 * @param durationSeconds - Duration in seconds
 * @returns Validated parameters
 * @throws ValidationError if validation fails
 */
export function validateCpuStressParams(
  targetLoadPercent: unknown,
  durationSeconds: unknown
): { targetLoadPercent: number; durationSeconds: number } {
  return {
    targetLoadPercent: validateInteger(
      targetLoadPercent,
      'targetLoadPercent',
      limits.minCpuLoadPercent,
      limits.maxCpuLoadPercent
    ),
    durationSeconds: validateInteger(
      durationSeconds,
      'durationSeconds',
      limits.minDurationSeconds,
      limits.maxDurationSeconds
    ),
  };
}

/**
 * Validates memory pressure parameters.
 *
 * @param sizeMb - Memory size in megabytes
 * @returns Validated parameters
 * @throws ValidationError if validation fails
 */
export function validateMemoryPressureParams(sizeMb: unknown): { sizeMb: number } {
  return {
    sizeMb: validateInteger(sizeMb, 'sizeMb', limits.minMemoryMb, limits.maxMemoryMb),
  };
}

/**
 * Validates event loop blocking parameters.
 *
 * @param durationSeconds - Duration in seconds
 * @returns Validated parameters
 * @throws ValidationError if validation fails
 */
export function validateEventLoopBlockingParams(durationSeconds: unknown): {
  durationSeconds: number;
} {
  return {
    durationSeconds: validateInteger(
      durationSeconds,
      'durationSeconds',
      limits.minDurationSeconds,
      limits.maxDurationSeconds
    ),
  };
}

/**
 * Validates slow request parameters.
 *
 * @param delaySeconds - Delay in seconds
 * @returns Validated parameters
 * @throws ValidationError if validation fails
 */
export function validateSlowRequestParams(delaySeconds: unknown): { delaySeconds: number } {
  return {
    delaySeconds: validateInteger(
      delaySeconds,
      'delaySeconds',
      limits.minDurationSeconds,
      limits.maxDurationSeconds
    ),
  };
}

/**
 * Validates a UUID format.
 *
 * @param value - Value to validate
 * @param fieldName - Name of the field (for error messages)
 * @returns The validated UUID string
 * @throws ValidationError if validation fails
 */
export function validateUuid(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new ValidationError(`${fieldName} must be a valid UUID`);
  }

  return value;
}
