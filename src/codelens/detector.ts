/**
 * Invocation detection engine for Tracelet CodeLens.
 * Scans a VS Code text document line-by-line to find LLM SDK invocations,
 * resolves the enclosing function scope, and deduplicates overlapping matches.
 */

import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { InvocationPattern, getPatternsByLanguage } from './patterns';

// ─── Detection Result ────────────────────────────────────────────────────────

/** An LLM invocation detected in a source document */
export interface DetectedInvocation {
  /** Range of the detected invocation in the document */
  range: vscode.Range;
  /** Zero-based line number where the invocation occurs */
  lineNumber: number;
  /** Name of the enclosing function, or '<module>' if at top-level */
  functionName: string;
  /** Name of the SDK/framework (e.g., 'openai', 'langchain') */
  sdkName: string;
  /** The pattern that triggered the detection */
  pattern: InvocationPattern;
  /** Enclosing scope descriptor (e.g., 'MyClass.method' or 'top-level') */
  scope: string;
}

// ─── Comment / String Detection ──────────────────────────────────────────────

/** Patterns used to detect comment and string lines that should be skipped */
const COMMENT_PATTERNS: Record<string, RegExp[]> = {
  python: [
    /^\s*#/,           // line comment
    /^\s*"""/,         // docstring start/end
    /^\s*'''/,         // docstring start/end (single quotes)
  ],
  typescript: [
    /^\s*\/\//,        // line comment
    /^\s*\/\*/,        // block comment start
    /^\s*\*/,          // block comment continuation
  ],
  javascript: [
    /^\s*\/\//,        // line comment
    /^\s*\/\*/,        // block comment start
    /^\s*\*/,          // block comment continuation
  ],
};

/** Patterns used to detect string-only lines */
const STRING_PATTERNS: RegExp[] = [
  /^\s*["'`]/,        // line starts with a string delimiter (loose heuristic)
];

// ─── Scope Resolution ────────────────────────────────────────────────────────

/**
 * Regex patterns to detect enclosing function/method declarations.
 * Ordered from most specific to most generic.
 */
const SCOPE_PATTERNS: RegExp[] = [
  // Python: def method(self, ...) or async def method(...)
  /^\s*(?:async\s+)?def\s+(\w+)\s*\(/,
  // TypeScript/JavaScript: async function name(...)
  /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/,
  // Class method: methodName(...) { or methodName = async (...) =>
  /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/,
  // Arrow function: const name = (...) => or const name = async (...) =>
  /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/,
  // Python class definition (for building scope context)
  /^\s*class\s+(\w+)\s*[:(]/,
];

// ─── Detector ────────────────────────────────────────────────────────────────

/**
 * Scans VS Code text documents for LLM SDK invocations.
 *
 * @example
 * ```ts
 * const detector = new InvocationDetector();
 * const invocations = detector.detect(document);
 * ```
 */
export class InvocationDetector {

  /**
   * Detects all LLM invocations in the given document.
   *
   * @param document - The VS Code text document to scan
   * @returns Array of detected invocations, deduplicated by line
   */
  detect(document: vscode.TextDocument): DetectedInvocation[] {
    const langId = document.languageId;
    const patterns = getPatternsByLanguage(langId);

    if (patterns.length === 0) {
      logger.debug(`[InvocationDetector] No patterns for language: ${langId}`);
      return [];
    }

    const detections: DetectedInvocation[] = [];
    const seenLines = new Set<number>();
    const commentPatterns = COMMENT_PATTERNS[langId] ?? [];

    let inBlockComment = false;

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const line = document.lineAt(lineIndex);
      const text = line.text;

      // Track block comments (TypeScript/JavaScript)
      if (langId !== 'python') {
        if (inBlockComment) {
          if (text.includes('*/')) {
            inBlockComment = false;
          }
          continue;
        }
        if (/^\s*\/\*/.test(text) && !text.includes('*/')) {
          inBlockComment = true;
          continue;
        }
      }

      // Track Python docstrings (simple heuristic)
      if (langId === 'python') {
        if (/^\s*("""|''')/.test(text)) {
          // Toggle docstring state – skip the line either way
          continue;
        }
      }

      // Skip comment lines
      if (this.isCommentLine(text, commentPatterns)) {
        continue;
      }

      // Skip lines that are purely string content
      if (this.isStringOnlyLine(text, langId)) {
        continue;
      }

      // Test each pattern against the line
      for (const pattern of patterns) {
        if (pattern.regex.test(text)) {
          // Deduplicate: one detection per line
          if (seenLines.has(lineIndex)) {
            continue;
          }
          seenLines.add(lineIndex);

          const matchStart = text.search(pattern.regex);
          const range = new vscode.Range(
            lineIndex,
            Math.max(0, matchStart),
            lineIndex,
            text.length,
          );

          const { functionName, scope } = this.resolveScope(document, lineIndex, langId);

          detections.push({
            range,
            lineNumber: lineIndex,
            functionName,
            sdkName: pattern.sdkName,
            pattern,
            scope,
          });

          // Only one detection per line
          break;
        }
      }
    }

    logger.debug(
      `[InvocationDetector] Found ${detections.length} invocation(s) in ${document.fileName}`,
    );

    return detections;
  }

  /**
   * Determines whether a line is a comment.
   */
  private isCommentLine(text: string, commentPatterns: RegExp[]): boolean {
    return commentPatterns.some((p) => p.test(text));
  }

  /**
   * Determines whether a line is purely string content (heuristic).
   * We only flag lines that start with a quote AND have no code-like
   * characters outside the string — this is intentionally conservative.
   */
  private isStringOnlyLine(text: string, langId: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return false;
    }

    // Only skip lines that are *entirely* wrapped in quotes
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"') && !trimmed.includes('(')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'") && !trimmed.includes('('))
    ) {
      // Likely a standalone string literal (not a function call)
      return true;
    }

    // Python raw/f-strings that are standalone
    if (langId === 'python') {
      if (/^[rfbu]*["']/.test(trimmed) && /["']$/.test(trimmed) && !trimmed.includes('(')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Scans upward from a given line to find the enclosing function/class scope.
   *
   * @param document - The document being scanned
   * @param fromLine - Zero-based line index to start searching upward from
   * @param langId - The document's language ID
   * @returns Object with `functionName` and `scope` descriptor
   */
  private resolveScope(
    document: vscode.TextDocument,
    fromLine: number,
    langId: string,
  ): { functionName: string; scope: string } {
    let functionName: string | undefined;
    let className: string | undefined;

    // Determine the indentation of the target line for scope inference
    const targetLine = document.lineAt(fromLine).text;
    const targetIndent = this.getIndentation(targetLine);

    for (let i = fromLine - 1; i >= 0; i--) {
      const lineText = document.lineAt(i).text;
      const lineIndent = this.getIndentation(lineText);

      // Only consider lines with less indentation (outer scope)
      if (lineText.trim().length === 0 || lineIndent >= targetIndent) {
        continue;
      }

      for (const scopePattern of SCOPE_PATTERNS) {
        const match = lineText.match(scopePattern);
        if (match && match[1]) {
          const name = match[1];

          // Check if this is a class definition
          if (/^\s*class\s/.test(lineText)) {
            if (!className) {
              className = name;
            }
            continue;
          }

          // This is a function/method definition
          if (!functionName) {
            functionName = name;
          }
          break;
        }
      }

      // Stop searching once we have a function (and optionally class)
      if (functionName) {
        break;
      }
    }

    const resolvedFunction = functionName ?? '<module>';
    const scope = className
      ? `${className}.${resolvedFunction}`
      : resolvedFunction === '<module>'
        ? 'top-level'
        : resolvedFunction;

    return { functionName: resolvedFunction, scope };
  }

  /**
   * Returns the number of leading whitespace characters in a line.
   */
  private getIndentation(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }
}
