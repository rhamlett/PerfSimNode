/**
 * =============================================================================
 * TRANSLATED HTML MIDDLEWARE — Serves Pre-Translated HTML Documents
 * =============================================================================
 *
 * PURPOSE:
 *   Intercepts requests for HTML documentation pages and serves the
 *   pre-translated version ({name}.{lang}.html) if it exists. Falls through
 *   to the normal static file serving if no translated version is available.
 *
 * ARCHITECTURE:
 *   Inserted BEFORE express.static() in the middleware pipeline so it can
 *   intercept HTML requests before the default static handler serves them.
 *
 * @module middleware/translated-html
 */

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { existsSync } from 'fs';
import { config } from '../config';

/** HTML files that may have translated versions */
const TRANSLATABLE_HTML_FILES = new Set([
  'docs.html',
  'azure-diagnostics.html',
  'azure-load-testing.html',
  'azure-deployment.html',
]);

/**
 * Middleware that serves translated HTML files when available.
 *
 * For requests matching known translatable HTML files, checks if a
 * translated version exists (e.g., docs.es.html) and serves it instead.
 */
export function translatedHtmlMiddleware(req: Request, res: Response, next: NextFunction): void {
  const language = config.uiLanguage;

  // Skip if language is English or not set
  if (!language || language.toLowerCase() === 'en') {
    return next();
  }

  // Only intercept GET requests for known HTML files
  if (req.method !== 'GET') {
    return next();
  }

  // Normalize the URL path (remove leading slash, query string)
  const urlPath = req.path.replace(/^\//, '');

  if (!TRANSLATABLE_HTML_FILES.has(urlPath)) {
    return next();
  }

  // Check if translated version exists
  const publicDir = path.join(__dirname, '..', 'public');
  const dotIndex = urlPath.lastIndexOf('.');
  const nameWithoutExt = urlPath.substring(0, dotIndex);
  const ext = urlPath.substring(dotIndex);
  const translatedFileName = `${nameWithoutExt}.${language}${ext}`;
  const translatedPath = path.join(publicDir, translatedFileName);

  if (existsSync(translatedPath)) {
    return res.sendFile(translatedPath);
  }

  // No translated version — fall through to serve the English original
  next();
}
