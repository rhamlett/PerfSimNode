/**
 * =============================================================================
 * GLOBAL ERROR HANDLER MIDDLEWARE
 * =============================================================================
 *
 * PURPOSE:
 *   Catches ALL unhandled errors from route handlers and middleware, and
 *   transforms them into consistent JSON error responses. This is the last
 *   middleware in the pipeline — it acts as a safety net.
 *
 * ERROR HIERARCHY:
 *   AppError (base)       → Custom application error with HTTP status code
 *   ├─ ValidationError    → 400 Bad Request (invalid user input)
 *   └─ NotFoundError      → 404 Not Found (resource doesn't exist)
 *   SyntaxError           → 400 Bad Request (malformed JSON body)
 *   Error (any other)     → 500 Internal Server Error
 *
 * RESPONSE FORMAT:
 *   All errors return: { error: string, message: string, details?: object }
 *
 * PORTING NOTES:
 *   - Java Spring: @ControllerAdvice + @ExceptionHandler methods
 *   - Python FastAPI: @app.exception_handler; Django: custom middleware
 *   - PHP Laravel: App\Exceptions\Handler.php render() method
 *   - C# ASP.NET: UseExceptionHandler middleware or ProblemDetails
 *
 *   The pattern is universal: define custom exception classes with status codes,
 *   and a single global handler that catches them all and formats the response.
 *
 * @module middleware/error-handler
 */

import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../types';

/**
 * Custom application error with HTTP status code.
 *
 * Base class for all application-specific errors. Carries an HTTP status code
 * and optional structured details for the error response body.
 *
 * PORTING NOTES:
 *   In Java, extend RuntimeException with a statusCode field.
 *   In Python, create a custom exception class with status_code attribute.
 *   In C#, create ApiException : Exception with StatusCode property.
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
 * Validation error for invalid input parameters. Returns HTTP 400.
 *
 * Thrown by validation functions when user input doesn't meet requirements.
 * The `details` field can include the field name, min/max, and received value.
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, details);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error for missing resources. Returns HTTP 404.
 *
 * Thrown when a requested simulation or resource doesn't exist.
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
