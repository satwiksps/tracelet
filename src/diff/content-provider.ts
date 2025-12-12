/**
 * Virtual document content provider for Tracelet trace previews.
 * Serves rendered prompt templates and hydrated prompts as virtual documents
 * that VS Code can display and diff.
 */

import * as vscode from 'vscode';
import type { TraceSpan, Message } from '../types';
import { TRACE_PREVIEW_SCHEME } from '../utils/constants';
import { logger } from '../utils/logger';

// ─── Content Provider ────────────────────────────────────────────────────────

/**
 * Provides virtual document content for the `ai-trace-preview` URI scheme.
 *
 * URI format:
 *   `ai-trace-preview://tracelet/{traceId}/{spanId}?type=template`
 *   `ai-trace-preview://tracelet/{traceId}/{spanId}?type=hydrated`
 *
 * - `type=template` renders the prompt template with `{{variable}}` placeholders
 * - `type=hydrated` renders the fully resolved prompt as sent to the LLM
 */
export class TraceDocumentContentProvider implements vscode.TextDocumentContentProvider {
  /** Fires when a virtual document's content changes */
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  /** Internal cache: maps `{traceId}/{spanId}` to the span data */
  private readonly spanCache = new Map<string, TraceSpan>();

  /**
   * Caches span data for later retrieval by the content provider.
   *
   * @param traceId - Trace identifier
   * @param spanId - Span identifier
   * @param span - The trace span containing LLM data
   */
  updateSpan(traceId: string, spanId: string, span: TraceSpan): void {
    const key = `${traceId}/${spanId}`;
    this.spanCache.set(key, span);

    // Notify VS Code that both virtual documents may have changed
    this._onDidChange.fire(this.buildUri(traceId, spanId, 'template'));
    this._onDidChange.fire(this.buildUri(traceId, spanId, 'hydrated'));

    logger.debug(`[TraceDocumentContentProvider] Updated span cache: ${key}`);
  }

  /**
   * Provides content for a virtual document URI.
   * Called by VS Code when a document with the `ai-trace-preview` scheme is opened.
   */
  provideTextDocumentContent(uri: vscode.Uri): string {
    const { traceId, spanId, type } = this.parseUri(uri);
    const key = `${traceId}/${spanId}`;
    const span = this.spanCache.get(key);

    if (!span) {
      logger.warn(`[TraceDocumentContentProvider] No cached span for: ${key}`);
      return `# ─── Tracelet Trace Preview ───────────────────────\n# No data available for this trace span.\n# Trace ID: ${traceId}\n# Span ID: ${spanId}\n`;
    }

    if (type === 'template') {
      return this.renderTemplate(span);
    }

    return this.renderHydrated(span);
  }

  /**
   * Builds a URI for a trace preview document.
   *
   * @param traceId - Trace identifier
   * @param spanId - Span identifier
   * @param type - Document type ('template' or 'hydrated')
   * @returns A VS Code URI with the `ai-trace-preview` scheme
   */
  buildUri(traceId: string, spanId: string, type: 'template' | 'hydrated'): vscode.Uri {
    return vscode.Uri.parse(
      `${TRACE_PREVIEW_SCHEME}://tracelet/${traceId}/${spanId}?type=${type}`,
    );
  }

  /**
   * Signals that a document should be refreshed.
   */
  fireChange(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  /**
   * Disposes the event emitter.
   */
  dispose(): void {
    this._onDidChange.dispose();
  }

  // ─── URI Parsing ─────────────────────────────────────────────────────────

  /**
   * Parses trace/span IDs and document type from a preview URI.
   */
  private parseUri(uri: vscode.Uri): { traceId: string; spanId: string; type: string } {
    // Path format: /{traceId}/{spanId}
    const segments = uri.path.split('/').filter(Boolean);
    const traceId = segments[0] ?? 'unknown';
    const spanId = segments[1] ?? 'unknown';

    const params = new URLSearchParams(uri.query);
    const type = params.get('type') ?? 'hydrated';

    return { traceId, spanId, type };
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  /**
   * Renders the prompt template view with `{{variable}}` placeholders.
   */
  private renderTemplate(span: TraceSpan): string {
    const header = this.renderHeader(span, 'Template');
    const llm = span.llm;

    if (!llm) {
      return `${header}\n# (No LLM data available for this span)\n`;
    }

    // If the span has a prompt template, use it directly
    if (llm.promptTemplate) {
      return `${header}\n${llm.promptTemplate}\n`;
    }

    // Otherwise, reconstruct from messages, replacing variable values with placeholders
    const messages = this.renderMessages(llm.inputMessages, llm.templateVariables);
    const output = this.renderOutputMessages(llm.outputMessages);

    return `${header}\n${messages}${output}`;
  }

  /**
   * Renders the fully hydrated prompt view.
   */
  private renderHydrated(span: TraceSpan): string {
    const header = this.renderHeader(span, 'Hydrated');
    const llm = span.llm;

    if (!llm) {
      return `${header}\n# (No LLM data available for this span)\n`;
    }

    const messages = this.renderMessages(llm.inputMessages);
    const output = this.renderOutputMessages(llm.outputMessages);

    return `${header}\n${messages}${output}`;
  }

  /**
   * Renders the metadata header block.
   */
  private renderHeader(span: TraceSpan, viewType: string): string {
    const llm = span.llm;
    const model = llm?.model ?? 'unknown';
    const promptTokens = llm?.tokenUsage.prompt ?? 0;
    const completionTokens = llm?.tokenUsage.completion ?? 0;
    const timestamp = new Date(span.startTime).toISOString();
    const durationSec = (span.duration / 1000).toFixed(1);

    return [
      `# ─── Tracelet Trace Preview (${viewType}) ───────────────────────`,
      `# Model: ${model} | Tokens: ${this.formatNumber(promptTokens)} prompt / ${this.formatNumber(completionTokens)} completion`,
      `# Timestamp: ${timestamp} | Duration: ${durationSec}s`,
      `# ──────────────────────────────────────────────────`,
      '',
    ].join('\n');
  }

  /**
   * Renders an array of messages, optionally replacing known variable values
   * with `{{varName}}` placeholders for template view.
   */
  private renderMessages(
    messages: Message[],
    templateVariables?: Record<string, string>,
  ): string {
    if (!messages || messages.length === 0) {
      return '# (No messages)\n';
    }

    const sections: string[] = [];

    for (const msg of messages) {
      const roleLabel = this.formatRole(msg.role);
      let content = msg.content ?? '(empty)';

      // In template mode, replace variable values with placeholders
      if (templateVariables) {
        content = this.replaceWithPlaceholders(content, templateVariables);
      }

      sections.push(`[${roleLabel}]`);
      sections.push(content);
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Renders output/assistant messages.
   */
  private renderOutputMessages(messages: Message[]): string {
    if (!messages || messages.length === 0) {
      return '';
    }

    const sections: string[] = [];

    for (const msg of messages) {
      const roleLabel = this.formatRole(msg.role);
      const content = msg.content ?? '(empty)';

      sections.push(`[${roleLabel}]`);
      sections.push(content);
      sections.push('');

      // Render tool calls if present
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          sections.push(`  [Tool Call: ${tc.function.name}]`);
          sections.push(`  ${tc.function.arguments}`);
          sections.push('');
        }
      }
    }

    return sections.join('\n');
  }

  /**
   * Replaces occurrences of variable values in content with `{{varName}}` placeholders.
   * Longer values are replaced first to avoid partial matches.
   */
  private replaceWithPlaceholders(
    content: string,
    variables: Record<string, string>,
  ): string {
    let result = content;

    // Sort by value length descending to replace longer values first
    const sortedEntries = Object.entries(variables).sort(
      ([, a], [, b]) => b.length - a.length,
    );

    for (const [name, value] of sortedEntries) {
      if (value && value.length > 0) {
        // Escape special regex characters in the value
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), `{{${name}}}`);
      }
    }

    return result;
  }

  /**
   * Formats a message role into a display label.
   */
  private formatRole(role: string): string {
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  /**
   * Formats a number with thousands separators.
   */
  private formatNumber(n: number): string {
    return n.toLocaleString('en-US');
  }
}
