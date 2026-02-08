/**
 * Utility Functions
 *
 * Shared helper functions used throughout the application.
 *
 * @module utils
 */

import { randomUUID } from 'crypto';

/**
 * Generates a new UUID v4.
 *
 * @returns A new UUID string
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Converts bytes to megabytes.
 *
 * @param bytes - Number of bytes
 * @returns Size in megabytes (2 decimal places)
 */
export function bytesToMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/**
 * Converts megabytes to bytes.
 *
 * @param mb - Size in megabytes
 * @returns Size in bytes
 */
export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

/**
 * Converts nanoseconds to milliseconds.
 *
 * @param ns - Time in nanoseconds
 * @returns Time in milliseconds (2 decimal places)
 */
export function nsToMs(ns: number): number {
  return Math.round((ns / 1e6) * 100) / 100;
}

/**
 * Converts seconds to milliseconds.
 *
 * @param seconds - Time in seconds
 * @returns Time in milliseconds
 */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

/**
 * Formats a date to ISO string.
 *
 * @param date - Date to format (defaults to now)
 * @returns ISO 8601 formatted date string
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * Calculates elapsed time between two dates in milliseconds.
 *
 * @param start - Start date
 * @param end - End date (defaults to now)
 * @returns Elapsed time in milliseconds
 */
export function elapsedMs(start: Date, end: Date = new Date()): number {
  return end.getTime() - start.getTime();
}

/**
 * Checks if a value is within a range (inclusive).
 *
 * @param value - Value to check
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns True if value is within range
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Clamps a value to a range.
 *
 * @param value - Value to clamp
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Delays execution for a specified duration.
 *
 * @param ms - Delay in milliseconds
 * @returns Promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates an abort signal that times out after specified duration.
 *
 * @param ms - Timeout in milliseconds
 * @returns AbortSignal that will abort after timeout
 */
export function createTimeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
