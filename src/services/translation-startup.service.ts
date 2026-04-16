/**
 * =============================================================================
 * TRANSLATION STARTUP SERVICE — Translate Once at Startup
 * =============================================================================
 *
 * PURPOSE:
 *   Orchestrates the one-time translation of UI strings (en.json → {lang}.json)
 *   and HTML documentation pages at application startup. This runs BEFORE the
 *   server begins accepting requests, ensuring all translated content is ready.
 *
 * ARCHITECTURE:
 *   Called from index.ts main() before starting the HTTP server.
 *   Uses TranslationService for the actual API calls and caching.
 *
 * @module services/translation-startup
 */

import path from 'path';
import { config } from '../config';
import { TranslationService } from './translation.service';

/** HTML document files to translate (relative to the public directory) */
const TRANSLATABLE_DOCS = [
  'docs.html',
  'azure-diagnostics.html',
  'azure-load-testing.html',
  'azure-deployment.html',
];

/** Inter-document delay in milliseconds to avoid rate limiting */
const INTER_DOCUMENT_DELAY_MS = 10_000;

/**
 * Runs all startup translations.
 *
 * Translates:
 *   1. UI strings: en.json → {lang}.json
 *   2. HTML documentation pages: *.html → *.{lang}.html
 *
 * @returns true if all translations succeeded (or language is English)
 */
export async function runStartupTranslation(): Promise<boolean> {
  const language = config.uiLanguage;

  // Diagnostic: log raw env var and resolved config value
  process.stdout.write(`[i18n] UI_LANGUAGE env var: '${process.env.UI_LANGUAGE || '(not set)'}', config.uiLanguage: '${language}'\n`);

  if (!language || language.toLowerCase() === 'en') {
    process.stdout.write('[i18n] UI language is English — no translation needed\n');
    return true;
  }

  process.stdout.write(`[i18n] Starting translation to '${language}'...\n`);

  if (!config.translatorApiKey) {
    process.stdout.write(`[i18n] WARNING: UI_LANGUAGE is set to '${language}' but TRANSLATOR_API_KEY is not configured. UI will fall back to English.\n`);
    return false;
  }

  const translationService = new TranslationService({
    apiKey: config.translatorApiKey,
    endpoint: config.translatorEndpoint,
    region: config.translatorRegion,
  });

  const publicDir = path.join(__dirname, '..', 'public');
  const localesDir = path.join(publicDir, 'locales');

  // 1. Translate UI strings (en.json → {lang}.json)
  process.stdout.write('[i18n] Phase 1: Translating UI strings...\n');
  const stringsOk = await translationService.ensureTranslation(language, localesDir);
  if (!stringsOk) {
    process.stdout.write('[i18n] UI string translation failed — UI will fall back to English\n');
    return false;
  }

  // 2. Translate HTML documentation pages
  process.stdout.write('[i18n] Phase 2: Translating documentation pages...\n');
  let allDocsOk = true;
  for (let i = 0; i < TRANSLATABLE_DOCS.length; i++) {
    const docFile = TRANSLATABLE_DOCS[i];
    const docPath = path.join(publicDir, docFile);

    const docOk = await translationService.ensureDocumentTranslation(docPath, language);
    if (!docOk) {
      process.stdout.write(`[i18n] Failed to translate ${docFile} — will serve English version\n`);
      allDocsOk = false;
    }

    // Inter-document delay (except after the last doc)
    if (i < TRANSLATABLE_DOCS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, INTER_DOCUMENT_DELAY_MS));
    }
  }

  process.stdout.write(`[i18n] Startup translation complete (strings: OK, docs: ${allDocsOk ? 'OK' : 'partial'})\n`);
  return true;
}
