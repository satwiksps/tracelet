/**
 * Maps trace spans to local source code locations.
 *
 * Strategies (in priority order):
 *  1. Exact attribute match: span attributes contain `code.filepath`, `code.function`, `code.lineno`.
 *  2. Function name search: find workspace files containing a function definition matching span.name.
 *  3. Fuzzy match: search for the span's LLM prompt template text in workspace files.
 *
 * Each strategy assigns a confidence score:
 *  - 1.0 for exact attribute match
 *  - 0.8 for function name match
 *  - 0.5 for fuzzy prompt template match
 *
 * Results are cached by span id for performance.
 */

import * as vscode from 'vscode';
import type { TraceSpan, SourceMapping } from '../types';
import { logger } from '../utils/logger';

// ─── Regex patterns for function definitions ─────────────────────────────────

/** Matches common function definition patterns in Python, TypeScript, and JavaScript. */
function buildFunctionRegex(name: string): RegExp {
  // Python: def func_name(
  // TS/JS:  function funcName(   |   funcName(   |   funcName = (   |   async funcName(
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:def\\s+${escaped}\\s*\\(` +              // Python
    `|function\\s+${escaped}\\s*\\(` +            // JS/TS function declaration
    `|(?:const|let|var)\\s+${escaped}\\s*=` +     // JS/TS arrow / assignment
    `|async\\s+${escaped}\\s*\\(` +               // async function
    `|${escaped}\\s*\\([^)]*\\)\\s*[:{]` +        // method shorthand
    `)`,
  );
}

// ─── SourceMapper ────────────────────────────────────────────────────────────

export class SourceMapper {
  /** Cached mappings keyed by span id. */
  private cache: Map<string, SourceMapping | null> = new Map();

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Attempt to map a single span to a source location.
   * Returns `undefined` if no mapping can be determined.
   */
  async mapSpan(span: TraceSpan): Promise<SourceMapping | undefined> {
    // Return from cache if available
    if (this.cache.has(span.id)) {
      return this.cache.get(span.id) ?? undefined;
    }

    let mapping: SourceMapping | undefined;

    // Strategy 1 – explicit code attributes
    mapping = this.tryAttributeMapping(span);
    if (mapping) {
      this.cache.set(span.id, mapping);
      return mapping;
    }

    // Strategy 2 – function name search
    mapping = await this.tryFunctionNameSearch(span);
    if (mapping) {
      this.cache.set(span.id, mapping);
      return mapping;
    }

    // Strategy 3 – fuzzy prompt template search
    mapping = await this.tryFuzzyPromptSearch(span);
    if (mapping) {
      this.cache.set(span.id, mapping);
      return mapping;
    }

    // Cache the miss to avoid repeated lookups
    this.cache.set(span.id, null);
    return undefined;
  }

  /**
   * Batch-map all spans, mutating their `sourceMapping` field in place.
   */
  async mapSpans(spans: TraceSpan[]): Promise<void> {
    for (const span of spans) {
      try {
        const mapping = await this.mapSpan(span);
        if (mapping) {
          span.sourceMapping = mapping;
        }
      } catch (err) {
        logger.warn(`SourceMapper: failed to map span "${span.name}"`, err);
      }
    }
  }

  /** Clear the mapping cache. */
  clearCache(): void {
    this.cache.clear();
    logger.debug('SourceMapper: cache cleared');
  }

  // ── Strategy 1: Attribute Match (confidence 1.0) ───────────────────────

  /**
   * Check span attributes for explicit code location fields set by
   * OpenTelemetry instrumentation (e.g. `code.filepath`, `code.function`).
   */
  private tryAttributeMapping(span: TraceSpan): SourceMapping | undefined {
    const filePath = span.attributes['code.filepath'] as string | undefined;
    const functionName = span.attributes['code.function'] as string | undefined;
    const lineNo = span.attributes['code.lineno'] as number | undefined;

    if (filePath && functionName) {
      return {
        filePath,
        functionName,
        lineNumber: typeof lineNo === 'number' ? lineNo : 1,
        confidence: 1.0,
      };
    }

    return undefined;
  }

  // ── Strategy 2: Function Name Search (confidence 0.8) ──────────────────

  /**
   * Search workspace source files for a function definition matching span.name.
   * We restrict the search to a manageable set of file types.
   */
  private async tryFunctionNameSearch(span: TraceSpan): Promise<SourceMapping | undefined> {
    // Skip names that are unlikely to be valid function identifiers
    if (!span.name || span.name.includes(' ') || span.name.length < 2) {
      return undefined;
    }

    try {
      const files = await vscode.workspace.findFiles(
        '**/*.{py,ts,js,tsx,jsx}',
        '**/node_modules/**',
        50, // limit to keep it fast
      );

      const regex = buildFunctionRegex(span.name);

      for (const fileUri of files) {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const text = doc.getText();

        const match = regex.exec(text);
        if (match) {
          const lineNumber = doc.positionAt(match.index).line + 1; // 1-based
          return {
            filePath: fileUri.fsPath,
            functionName: span.name,
            lineNumber,
            confidence: 0.8,
          };
        }
      }
    } catch (err) {
      logger.debug(`SourceMapper: function name search failed for "${span.name}"`, err);
    }

    return undefined;
  }

  // ── Strategy 3: Fuzzy Prompt Template Search (confidence 0.5) ──────────

  /**
   * For LLM spans with a prompt template, search workspace files for the
   * template text. Useful when templates are stored in separate files.
   */
  private async tryFuzzyPromptSearch(span: TraceSpan): Promise<SourceMapping | undefined> {
    const template = span.llm?.promptTemplate;
    if (!template || template.length < 20) {
      return undefined;
    }

    try {
      // Take a distinctive substring of the template (first meaningful line)
      const searchSnippet = this.extractSearchSnippet(template);
      if (!searchSnippet) {
        return undefined;
      }

      const files = await vscode.workspace.findFiles(
        '**/*.{py,ts,js,txt,yaml,yml,json,jinja,jinja2,prompt}',
        '**/node_modules/**',
        30,
      );

      for (const fileUri of files) {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const text = doc.getText();

        const idx = text.indexOf(searchSnippet);
        if (idx !== -1) {
          const lineNumber = doc.positionAt(idx).line + 1;
          return {
            filePath: fileUri.fsPath,
            functionName: span.name,
            lineNumber,
            confidence: 0.5,
          };
        }
      }
    } catch (err) {
      logger.debug(`SourceMapper: fuzzy search failed for "${span.name}"`, err);
    }

    return undefined;
  }

  /**
   * Extract a non-trivial search snippet from a prompt template.
   * Skips blank lines and very short lines to improve match accuracy.
   */
  private extractSearchSnippet(template: string): string | undefined {
    const lines = template.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, template variable-only lines, and very short lines
      if (trimmed.length >= 20 && !/^\{\{.*\}\}$/.test(trimmed)) {
        // Cap at 100 chars to avoid massive indexOf calls
        return trimmed.slice(0, 100);
      }
    }
    return undefined;
  }
}
