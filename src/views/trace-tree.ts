/**
 * TreeDataProvider for the Tracelet trace explorer sidebar.
 *
 * Responsibilities:
 *  - Stores an ordered Map<traceId, Trace> of currently visible traces.
 *  - Builds a parent-child span hierarchy from flat span lists (via parentId).
 *  - Provides tree items at three levels:
 *      1. TraceRootItem   – one per trace, sorted newest-first
 *      2. SpanItem        – spans within a trace, nested by parentId
 *      3. MetadataItem    – leaf nodes showing model, tokens, duration, status
 */

import * as vscode from 'vscode';
import type { Trace, TraceSpan } from '../types';
import { logger } from '../utils/logger';
import {
  TraceTreeItem,
  TraceRootItem,
  SpanItem,
  MetadataItem,
  formatDuration,
} from './trace-items';

// ─── Provider ────────────────────────────────────────────────────────────────

export class TraceTreeProvider implements vscode.TreeDataProvider<TraceTreeItem> {
  // ── Change event ─────────────────────────────────────────────────────────
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TraceTreeItem | undefined | void>();
  public readonly onDidChangeTreeData: vscode.Event<TraceTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  /** Primary trace storage keyed by traceId. Insertion order = newest first. */
  private traces: Map<string, Trace> = new Map();

  // ── TreeDataProvider interface ───────────────────────────────────────────

  getTreeItem(element: TraceTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TraceTreeItem): vscode.ProviderResult<TraceTreeItem[]> {
    // Root level → one TraceRootItem per trace, newest first
    if (!element) {
      return this.getRootItems();
    }

    // TraceRootItem → top-level spans (those without a parentId or whose parent is the root)
    if (element instanceof TraceRootItem) {
      return this.getSpanChildren(element.trace);
    }

    // SpanItem → child spans + metadata leaves
    if (element instanceof SpanItem) {
      return this.getSpanItemChildren(element);
    }

    return [];
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Replace the entire dataset and refresh the tree. */
  setTraces(traces: Trace[]): void {
    this.traces.clear();
    // Sort newest-first so Map iteration order matches
    const sorted = [...traces].sort((a, b) => b.startTime - a.startTime);
    for (const trace of sorted) {
      this.traces.set(trace.id, trace);
    }
    logger.debug(`TraceTreeProvider: loaded ${traces.length} traces`);
    this.refresh();
  }

  /** Fire the change event to re-render the tree. */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Remove all traces and refresh. */
  clear(): void {
    this.traces.clear();
    this.refresh();
  }

  /** Dispose internal resources. */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Build root-level tree items (one per trace, newest first).
   */
  private getRootItems(): TraceRootItem[] {
    const items: TraceRootItem[] = [];
    for (const trace of this.traces.values()) {
      items.push(new TraceRootItem(trace));
    }
    return items;
  }

  /**
   * Return the top-level span items for a given trace.
   * Top-level spans are those with no parentId, or whose parentId
   * does not match any other span in the trace (i.e. they are roots).
   */
  private getSpanChildren(trace: Trace): SpanItem[] {
    const spanIdSet = new Set(trace.spans.map((s) => s.id));
    const topLevel = trace.spans.filter(
      (s) => !s.parentId || !spanIdSet.has(s.parentId),
    );

    // Sort by startTime so the waterfall reads top-to-bottom chronologically
    topLevel.sort((a, b) => a.startTime - b.startTime);

    return topLevel.map((span) => {
      const hasChildren = this.spanHasChildren(span, trace);
      return new SpanItem(span, hasChildren || span.kind === 'llm');
    });
  }

  /**
   * Build children for a SpanItem: child spans first, then metadata leaves.
   */
  private getSpanItemChildren(item: SpanItem): TraceTreeItem[] {
    const span = item.span;
    const children: TraceTreeItem[] = [];

    // Find the owning trace so we can look up child spans
    const trace = this.traces.get(span.traceId);
    if (trace) {
      const childSpans = trace.spans
        .filter((s) => s.parentId === span.id)
        .sort((a, b) => a.startTime - b.startTime);

      for (const child of childSpans) {
        const hasGrandchildren = this.spanHasChildren(child, trace);
        children.push(new SpanItem(child, hasGrandchildren || child.kind === 'llm'));
      }
    }

    // Append metadata leaves
    children.push(...this.buildMetadataItems(span));

    return children;
  }

  /**
   * Check whether a span has any direct child spans in its trace.
   */
  private spanHasChildren(span: TraceSpan, trace: Trace): boolean {
    return trace.spans.some((s) => s.parentId === span.id);
  }

  /**
   * Build MetadataItem leaves showing model info, tokens, duration, and status.
   */
  private buildMetadataItems(span: TraceSpan): MetadataItem[] {
    const items: MetadataItem[] = [];

    // Status
    items.push(new MetadataItem('Status', span.status, 'pulse'));

    // Duration
    items.push(new MetadataItem('Duration', formatDuration(span.duration), 'clock'));

    // LLM-specific metadata
    if (span.llm) {
      items.push(new MetadataItem('Model', span.llm.model, 'hubot'));

      if (span.llm.provider) {
        items.push(new MetadataItem('Provider', span.llm.provider, 'cloud'));
      }

      const usage = span.llm.tokenUsage;
      if (usage.total > 0) {
        items.push(
          new MetadataItem('Tokens (total)', usage.total.toLocaleString(), 'symbol-numeric'),
        );
        items.push(
          new MetadataItem('Tokens (prompt)', usage.prompt.toLocaleString(), 'arrow-right'),
        );
        items.push(
          new MetadataItem('Tokens (completion)', usage.completion.toLocaleString(), 'arrow-left'),
        );
      }
    }

    // Error message
    if (span.error) {
      items.push(new MetadataItem('Error', span.error, 'error'));
    }

    // Source mapping
    if (span.sourceMapping) {
      const loc = `${span.sourceMapping.filePath}:${span.sourceMapping.lineNumber}`;
      items.push(new MetadataItem('Source', loc, 'go-to-file'));
    }

    return items;
  }
}
