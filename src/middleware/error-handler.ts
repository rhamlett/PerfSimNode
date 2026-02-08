/**
 * Global Error Handler Middleware
 *
 * Catches and formats all unhandled errors in the application.
 *
 * @module middleware/error-handler
 */

import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../types';

/**
 * Custom application error with status code.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error for invalid input parameters.
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, details);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error for missing resources.
 */
export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

/**
 * Global error handler middleware.
 *
 * Catches all errors and returns a consistent JSON error response.
 *
 * @param err - Error object
 * @param _req - Express request (unused)
 * @param res - Express response
 * @param _next - Express next function (unused but required for Express error handler signature)
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Log error for debugging
  console.error(`[ERROR] ${err.name}: ${err.message}`);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  // Determine status code and build response
  let statusCode = 500;
  let errorResponse: ApiError = {
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  };

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorResponse = {
      error: err.name,
      message: err.message,
      ...(err.details && { details: err.details }),
    };
  } else if (err instanceof SyntaxError && 'body' in err) {
    // JSON parsing error
    statusCode = 400;
    errorResponse = {
      error: 'Bad Request',
      message: 'Invalid JSON in request body',
    };
  }

  res.status(statusCode).json(errorResponse);
}
