import * as vscode from 'vscode';
import { TraceDocumentContentProvider } from './content-provider';
import { TRACE_PREVIEW_SCHEME } from '../utils/constants';
import { logger } from '../utils/logger';
import type { TraceSpan, Message } from '../types';

/**
 * Manages opening diff views and hydrated prompt previews.
 * Orchestrates the interaction between TraceDocumentContentProvider and VS Code's diff editor.
 */
export class DiffViewManager {
  private contentProvider: TraceDocumentContentProvider;

  constructor(contentProvider: TraceDocumentContentProvider) {
    this.contentProvider = contentProvider;
  }

  /**
   * Open VS Code's native diff editor showing template vs. hydrated prompt.
   * Left: Static template with {{variable}} placeholders
   * Right: Fully hydrated prompt as sent to the LLM
   */
  async openDiff(span: TraceSpan): Promise<void> {
    if (!span.llm) {
      logger.warn('Cannot open diff: span has no LLM data');
      await this.openHydratedView(span);
      return;
    }

    const templateUri = vscode.Uri.parse(
      `${TRACE_PREVIEW_SCHEME}://tracelet/${span.traceId}/${span.id}?type=template`,
    );
    const hydratedUri = vscode.Uri.parse(
      `${TRACE_PREVIEW_SCHEME}://tracelet/${span.traceId}/${span.id}?type=hydrated`,
    );

    // Cache span data for the content provider
    this.contentProvider.updateSpan(span.traceId, span.id, span);

    const title = `Tracelet: ${span.name} — Template ↔ Hydrated`;

    try {
      await vscode.commands.executeCommand('vscode.diff', templateUri, hydratedUri, title, {
        preview: true,
        viewColumn: vscode.ViewColumn.Active,
      });
    } catch (err) {
      logger.error('Failed to open diff view:', err);
      vscode.window.showErrorMessage('Tracelet: Failed to open diff view.');
    }
  }

  /**
   * Open just the hydrated prompt as a read-only virtual document.
   */
  async openHydratedView(span: TraceSpan): Promise<void> {
    const uri = vscode.Uri.parse(
      `${TRACE_PREVIEW_SCHEME}://tracelet/${span.traceId}/${span.id}?type=hydrated`,
    );

    this.contentProvider.updateSpan(span.traceId, span.id, span);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      });
    } catch (err) {
      logger.error('Failed to open hydrated view:', err);
      vscode.window.showErrorMessage('Tracelet: Failed to open hydrated prompt view.');
    }
  }
}

/**
 * Format messages into a readable conversation format for the diff view.
 */
export function formatMessages(messages: Message[]): string {
  return messages
    .map((msg) => {
      const role = `[${capitalize(msg.role)}]`;
      let content = msg.content ?? '(empty)';

      // Format tool calls if present
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolCallsStr = msg.toolCalls
          .map((tc) => `  → ${tc.function.name}(${tc.function.arguments})`)
          .join('\n');
        content += `\n\nTool Calls:\n${toolCallsStr}`;
      }

      return `${role}\n${content}`;
    })
    .join('\n\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
