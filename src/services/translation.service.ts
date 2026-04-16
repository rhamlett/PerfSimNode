/**
 * =============================================================================
 * TRANSLATION SERVICE — Azure Translator Text API Integration
 * =============================================================================
 *
 * PURPOSE:
 *   Translates UI strings (en.json → {lang}.json) and HTML documents using
 *   Azure Cognitive Services Translator Text API. Uses hash-based caching
 *   to skip translation when source content hasn't changed.
 *
 * ARCHITECTURE:
 *   - JSON string translation: Reads en.json, batches strings, calls Text API,
 *     writes {lang}.json with _meta.source_hash for cache validation.
 *   - HTML document translation: Extracts translatable text segments from HTML,
 *     batches and translates them, reassembles the translated document.
 *   - No-translate terms: Technical terms are wrapped in <span class="notranslate">
 *     before sending to the API, then stripped from the translated output.
 *
 * PORTING NOTES:
 *   Adapted from Java TranslationService.java. Key differences:
 *   - Uses Node.js crypto for SHA256 hashing
 *   - Uses node-fetch/built-in fetch for HTTP calls
 *   - Uses fs/promises for file I/O
 *   - Async/await instead of synchronous blocking
 *
 * @module services/translation
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

/** Maximum elements per API batch (API limit: 1000, we use 100) */
const MAX_BATCH_SIZE = 100;

/** Maximum characters per API batch (API limit: 50,000, we leave margin) */
const MAX_BATCH_CHARS = 49_000;

/** Regex to match {placeholder} tokens */
const PLACEHOLDER_REGEX = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g;

/**
 * Regex to strip notranslate span tags from translated output.
 * Handles double quotes, single quotes, and HTML entities — all three
 * appear unpredictably in real API responses.
 */
const NOTRANSLATE_SPAN_REGEX = /<span\s+class\s*=\s*(?:"|&quot;|')notranslate(?:"|&quot;|')>(.*?)<\/span>/gs;

/** Regex to split HTML into tags and text segments */
const HTML_TAG_REGEX = /(<[^>]+>)/;

/** Regex to detect opening no-translate elements */
const NO_TRANSLATE_ELEMENT_OPEN_REGEX = /<(code|pre|script|style|svg)[\s>]/i;

/** Retry delays in seconds for 429 rate-limit responses */
const RETRY_DELAYS = [5, 15, 30, 60];

interface TranslationConfig {
  apiKey: string;
  endpoint: string;
  region: string;
}

interface HtmlSegment {
  text: string;
  isTranslatable: boolean;
  translatedText?: string;
}

/**
 * Translates UI strings and HTML documents from English to a target language
 * using Azure Cognitive Services Translator Text API.
 */
export class TranslationService {
  private config: TranslationConfig;

  constructor(config: TranslationConfig) {
    this.config = config;
  }

  /**
   * Ensures a translated locale file exists for the specified language.
   * Uses SHA256 hash caching to skip re-translation when source hasn't changed.
   *
   * @param targetLanguage - ISO 639-1 language code
   * @param localesPath - Path to the locales directory
   * @returns true if translation succeeded or was cached
   */
  async ensureTranslation(targetLanguage: string, localesPath: string): Promise<boolean> {
    if (!targetLanguage || targetLanguage.toLowerCase() === 'en') {
      return true;
    }

    const enFilePath = path.join(localesPath, 'en.json');
    const targetFilePath = path.join(localesPath, `${targetLanguage}.json`);

    if (!existsSync(enFilePath)) {
      console.error(`[i18n] English source file not found: ${enFilePath}`);
      return false;
    }

    try {
      const enContent = await fs.readFile(enFilePath, 'utf-8');
      const sourceHash = this.computeHash(enContent);

      // Check cache
      if (existsSync(targetFilePath)) {
        try {
          const existingContent = await fs.readFile(targetFilePath, 'utf-8');
          const existingDoc = JSON.parse(existingContent);
          if (existingDoc._meta?.source_hash === sourceHash) {
            console.log(`[i18n] Translation for ${targetLanguage} is up to date (hash: ${sourceHash.substring(0, 8)})`);
            return true;
          }
          console.log(`[i18n] Translation for ${targetLanguage} exists but source has changed, re-translating`);
        } catch {
          console.warn(`[i18n] Existing translation file for ${targetLanguage} is invalid, re-translating`);
        }
      }

      if (!this.config.apiKey) {
        console.warn(`[i18n] UI_LANGUAGE is set to '${targetLanguage}' but TRANSLATOR_API_KEY is not configured.`);
        return false;
      }

      // Parse English strings (skip _meta)
      const enDoc = JSON.parse(enContent);
      const sourceStrings: Map<string, string> = new Map();
      for (const [key, value] of Object.entries(enDoc)) {
        if (key !== '_meta' && typeof value === 'string') {
          sourceStrings.set(key, value);
        }
      }

      if (sourceStrings.size === 0) {
        console.warn('[i18n] No translatable strings found in en.json');
        return false;
      }

      // Load no-translate terms
      const noTranslateTerms = await this.loadNoTranslateTerms(localesPath);

      console.log(`[i18n] Translating ${sourceStrings.size} strings to ${targetLanguage} (${noTranslateTerms.length} protected terms)...`);

      // Translate in batches
      const translatedStrings: Map<string, string> = new Map();
      const keys = Array.from(sourceStrings.keys());

      let i = 0;
      while (i < keys.length) {
        const batchKeys: string[] = [];
        const batchTexts: string[] = [];
        let batchCharCount = 0;

        while (i < keys.length && batchKeys.length < MAX_BATCH_SIZE) {
          const wrapped = this.wrapNoTranslateTerms(sourceStrings.get(keys[i])!, noTranslateTerms);
          if (batchCharCount + wrapped.length > MAX_BATCH_CHARS && batchKeys.length > 0) {
            break;
          }
          batchKeys.push(keys[i]);
          batchTexts.push(wrapped);
          batchCharCount += wrapped.length;
          i++;
        }

        const translations = await this.translateBatch(batchTexts, targetLanguage);
        if (!translations) {
          console.error(`[i18n] Translation API call failed for batch starting at index ${i - batchKeys.length}`);
          return false;
        }

        for (let j = 0; j < batchKeys.length; j++) {
          translatedStrings.set(batchKeys[j], this.stripNoTranslateTags(translations[j]));
        }

        // Inter-batch delay (2 seconds)
        if (i < keys.length) {
          await this.delay(2000);
        }
      }

      // Build output JSON
      const output: Record<string, unknown> = {
        _meta: {
          source_hash: sourceHash,
          source_lang: 'en',
          target_lang: targetLanguage,
          generated: new Date().toISOString(),
          generator: 'Azure Cognitive Services Translator',
        },
      };
      for (const [key, value] of translatedStrings) {
        output[key] = value;
      }

      await fs.writeFile(targetFilePath, JSON.stringify(output, null, 2), 'utf-8');
      console.log(`[i18n] Translation complete: ${translatedStrings.size} strings written to ${targetFilePath}`);
      return true;
    } catch (err) {
      console.error(`[i18n] Translation failed for ${targetLanguage}:`, err);
      return false;
    }
  }

  /**
   * Ensures a translated HTML document exists for the specified language.
   * Uses SHA256 hash caching embedded as an HTML comment on the first line.
   *
   * @param sourceHtmlPath - Path to the source HTML file
   * @param targetLanguage - ISO 639-1 language code
   * @returns true if translation succeeded or was cached
   */
  async ensureDocumentTranslation(sourceHtmlPath: string, targetLanguage: string): Promise<boolean> {
    if (!targetLanguage || targetLanguage.toLowerCase() === 'en') {
      return true;
    }

    if (!existsSync(sourceHtmlPath)) {
      console.error(`[i18n] HTML source file not found: ${sourceHtmlPath}`);
      return false;
    }

    try {
      const sourceContent = await fs.readFile(sourceHtmlPath, 'utf-8');
      const sourceHash = this.computeHash(sourceContent);
      const targetPath = this.getTranslatedHtmlPath(sourceHtmlPath, targetLanguage);
      const sourceFileName = path.basename(sourceHtmlPath);

      // Check cache
      if (existsSync(targetPath)) {
        const existingContent = await fs.readFile(targetPath, 'utf-8');
        const firstLine = existingContent.split('\n')[0];
        if (firstLine.includes(`source_hash:${sourceHash}`)) {
          console.log(`[i18n] Document translation for ${sourceFileName} (${targetLanguage}) is up to date (hash: ${sourceHash.substring(0, 8)})`);
          return true;
        }
        console.log(`[i18n] Document translation for ${sourceFileName} (${targetLanguage}) exists but source changed, re-translating`);
      }

      if (!this.config.apiKey) {
        console.warn(`[i18n] Cannot translate ${sourceFileName} to '${targetLanguage}' — TRANSLATOR_API_KEY is not configured.`);
        return false;
      }

      // Load no-translate terms
      const localesPath = path.join(path.dirname(sourceHtmlPath), 'locales');
      const noTranslateTerms = await this.loadNoTranslateTerms(localesPath);

      // Extract translatable segments
      const segments = this.extractTranslatableSegments(sourceContent);
      const translatableSegments = segments.filter(s => s.isTranslatable && s.text.trim().length > 0);

      if (translatableSegments.length === 0) {
        console.warn(`[i18n] No translatable text found in ${sourceFileName}`);
        return false;
      }

      console.log(`[i18n] Translating document ${sourceFileName} to ${targetLanguage}: ${translatableSegments.length} text segments...`);

      // Translate in character-aware batches
      let batchIndex = 0;
      let si = 0;
      while (si < translatableSegments.length) {
        const batch: HtmlSegment[] = [];
        const batchTexts: string[] = [];
        let batchCharCount = 0;

        while (si < translatableSegments.length && batch.length < MAX_BATCH_SIZE) {
          const wrapped = this.wrapNoTranslateTerms(translatableSegments[si].text, noTranslateTerms);
          if (batchCharCount + wrapped.length > MAX_BATCH_CHARS && batch.length > 0) {
            break;
          }
          batch.push(translatableSegments[si]);
          batchTexts.push(wrapped);
          batchCharCount += wrapped.length;
          si++;
        }

        const translations = await this.translateBatch(batchTexts, targetLanguage);
        if (!translations) {
          console.error(`[i18n] Document translation API call failed for ${sourceFileName} at batch ${batchIndex}`);
          return false;
        }

        for (let j = 0; j < batch.length; j++) {
          batch[j].translatedText = this.stripNoTranslateTags(translations[j]);
        }

        batchIndex++;

        // Inter-batch delay (2 seconds)
        if (si < translatableSegments.length) {
          await this.delay(2000);
        }
      }

      // Reassemble translated HTML
      const parts: string[] = [];
      parts.push(`<!-- source_hash:${sourceHash} lang:${targetLanguage} generated:${new Date().toISOString()} -->\n`);
      for (const segment of segments) {
        if (segment.isTranslatable && segment.translatedText) {
          parts.push(segment.translatedText);
        } else {
          parts.push(segment.text);
        }
      }

      await fs.writeFile(targetPath, parts.join(''), 'utf-8');
      console.log(`[i18n] Document translation complete: ${sourceFileName} → ${path.basename(targetPath)} (${translatableSegments.length} segments)`);
      return true;
    } catch (err) {
      console.error(`[i18n] Document translation failed for ${path.basename(sourceHtmlPath)}:`, err);
      return false;
    }
  }

  /**
   * Calls the Azure Translator API to translate a batch of strings.
   * Retries up to 4 times on 429 (rate limit) with exponential backoff.
   */
  private async translateBatch(texts: string[], targetLanguage: string): Promise<string[] | null> {
    const requestBody = texts.map(text => ({ Text: text }));
    const requestUrl = `${this.config.endpoint}/translate?api-version=3.0&from=en&to=${encodeURIComponent(targetLanguage)}&textType=html`;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': this.config.apiKey,
            'Ocp-Apim-Subscription-Region': this.config.region,
          },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) {
          const responseData = await response.json() as Array<{ translations: Array<{ text: string }> }>;
          return responseData.map(item => item.translations[0].text);
        }

        if (response.status === 429 && attempt < RETRY_DELAYS.length) {
          let delaySeconds = RETRY_DELAYS[attempt];

          // Check Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            const parsed = parseInt(retryAfter, 10);
            if (!isNaN(parsed)) {
              delaySeconds = parsed;
            }
          }

          console.warn(`[i18n] Translator API rate limited (attempt ${attempt + 1}/${RETRY_DELAYS.length + 1}). Retrying in ${delaySeconds}s...`);
          await this.delay(delaySeconds * 1000);
          continue;
        }

        const errorBody = await response.text();
        console.error(`[i18n] Azure Translator API returned ${response.status}: ${errorBody}`);
        return null;
      } catch (err) {
        console.error(`[i18n] Translation API request failed:`, err);
        return null;
      }
    }

    return null;
  }

  /**
   * Loads the no-translate terms list from no-translate.json, sorted longest-first.
   */
  private async loadNoTranslateTerms(localesPath: string): Promise<string[]> {
    const noTranslatePath = path.join(localesPath, 'no-translate.json');
    if (!existsSync(noTranslatePath)) {
      return [];
    }

    try {
      const content = await fs.readFile(noTranslatePath, 'utf-8');
      const doc = JSON.parse(content);
      if (Array.isArray(doc.terms)) {
        const terms = doc.terms.filter((t: unknown) => typeof t === 'string' && t.length > 0);
        // Sort longest first to avoid partial matches
        terms.sort((a: string, b: string) => b.length - a.length);
        return terms;
      }
    } catch (err) {
      console.warn(`[i18n] Failed to load no-translate.json:`, err);
    }

    return [];
  }

  /**
   * Wraps {placeholder} tokens and no-translate terms in notranslate spans.
   * Placeholder wrapping happens first (per the spec's bug prevention note).
   */
  private wrapNoTranslateTerms(text: string, terms: string[]): string {
    // Wrap {placeholder} tokens first
    text = text.replace(PLACEHOLDER_REGEX, '<span class="notranslate">$&</span>');

    if (terms.length === 0) return text;

    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?<![a-zA-Z])${escaped}(?![a-zA-Z])`, 'g');
      text = text.replace(pattern, `<span class="notranslate">${term}</span>`);
    }

    return text;
  }

  /**
   * Strips notranslate span tags from translated text.
   * Handles double quotes, single quotes, and HTML entities.
   */
  private stripNoTranslateTags(text: string): string {
    return text.replace(NOTRANSLATE_SPAN_REGEX, '$1');
  }

  /**
   * Computes a SHA256 hash of the input string (first 16 hex chars).
   */
  private computeHash(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf-8').digest('hex').substring(0, 16);
  }

  /**
   * Gets the path for a translated HTML document.
   * e.g., docs.html with lang "es" → docs.es.html
   */
  private getTranslatedHtmlPath(sourceHtmlPath: string, targetLanguage: string): string {
    const dir = path.dirname(sourceHtmlPath);
    const fileName = path.basename(sourceHtmlPath);
    const dotIndex = fileName.lastIndexOf('.');
    const nameWithoutExt = fileName.substring(0, dotIndex);
    const ext = fileName.substring(dotIndex);
    return path.join(dir, `${nameWithoutExt}.${targetLanguage}${ext}`);
  }

  /**
   * Splits an HTML document into translatable text segments and non-translatable markup.
   */
  private extractTranslatableSegments(html: string): HtmlSegment[] {
    const segments: HtmlSegment[] = [];
    const parts = html.split(HTML_TAG_REGEX);

    // Track no-translate element depth
    const noTranslateDepth: Map<string, number> = new Map();
    let insideNoTranslate = false;

    for (const part of parts) {
      if (!part) continue;

      // Check if this is an HTML tag
      if (part.startsWith('<') && part.endsWith('>')) {
        segments.push({ text: part, isTranslatable: false });
        this.updateNoTranslateState(part, noTranslateDepth);
        insideNoTranslate = Array.from(noTranslateDepth.values()).some(v => v > 0);
      } else {
        // Text segment
        const shouldTranslate = !insideNoTranslate && part.trim().length > 0;
        segments.push({ text: part, isTranslatable: shouldTranslate });
      }
    }

    return segments;
  }

  /**
   * Updates the no-translate depth counter based on opening/closing tags.
   */
  private updateNoTranslateState(tag: string, noTranslateDepth: Map<string, number>): void {
    const openMatch = NO_TRANSLATE_ELEMENT_OPEN_REGEX.exec(tag);
    if (openMatch) {
      const tagName = openMatch[1].toLowerCase();
      noTranslateDepth.set(tagName, (noTranslateDepth.get(tagName) || 0) + 1);
    } else if (tag.startsWith('</')) {
      const closingTag = tag.substring(2).replace(/[>\s]/g, '').toLowerCase();
      const current = noTranslateDepth.get(closingTag);
      if (current !== undefined) {
        if (current <= 1) {
          noTranslateDepth.delete(closingTag);
        } else {
          noTranslateDepth.set(closingTag, current - 1);
        }
      }
    }
  }

  /**
   * Promise-based delay utility.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
