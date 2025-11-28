/**
 * Tree item classes for the Tracelet trace explorer sidebar.
 *
 * Hierarchy:
 *   TraceTreeItem (base)
 *   ├─ TraceGroupItem   – groups traces by session, project, or time
 *   ├─ TraceRootItem    – top-level trace node (id, time, duration)
 *   ├─ SpanItem         – individual span within a trace
 *   └─ MetadataItem     – leaf key/value metadata node
 */

import * as vscode from 'vscode';
import type { Trace, TraceSpan, SpanKind, SpanStatus } from '../types';
import { Commands, ContextValues } from '../utils/constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-friendly string.
 * e.g. 450 → '450ms', 1234 → '1.2s', 62000 → '1m 2s'
 */
export function formatDuration(ms: number): string {
  if (ms < 0) {
    return '0ms';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Format a Unix-ms timestamp as relative time (e.g. "2m ago", "1h ago").
 */
export function formatRelativeTime(timestampMs: number): string {
  const delta = Date.now() - timestampMs;
  if (delta < 0) {
    return 'just now';
  }

  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) {
    return seconds <= 5 ? 'just now' : `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Map a SpanKind to a VS Code ThemeIcon id */
function spanKindIcon(kind: SpanKind): string {
  switch (kind) {
    case 'llm':
      return 'hubot';
    case 'chain':
      return 'link';
    case 'tool':
      return 'wrench';
    case 'retriever':
      return 'search';
    case 'embedding':
      return 'symbol-array';
    case 'agent':
      return 'robot';
    case 'reranker':
      return 'filter';
    case 'guardrail':
      return 'shield';
    case 'evaluator':
      return 'beaker';
    default:
      return 'circle-outline';
  }
}

/** Map a SpanKind to its contextValue for menu when-clauses */
function spanKindContextValue(kind: SpanKind): string {
  switch (kind) {
    case 'llm':
      return ContextValues.LLM_SPAN;
    case 'chain':
      return ContextValues.CHAIN_SPAN;
    case 'tool':
      return ContextValues.TOOL_SPAN;
    case 'retriever':
      return ContextValues.RETRIEVER_SPAN;
    case 'embedding':
      return ContextValues.EMBEDDING_SPAN;
    case 'agent':
      return ContextValues.AGENT_SPAN;
    default:
      // For kinds without a dedicated context value, fall back to kind name + 'Span'
      return `${kind}Span`;
  }
}

/** Build a status indicator string with optional ThemeColor */
function statusIndicator(status: SpanStatus): { text: string; color?: vscode.ThemeColor } {
  switch (status) {
    case 'success':
      return { text: '✓', color: new vscode.ThemeColor('charts.green') };
    case 'error':
      return { text: '✗', color: new vscode.ThemeColor('charts.red') };
    case 'running':
      return { text: '⏳' };
    default:
      return { text: '' };
  }
}

// ─── Base Class ──────────────────────────────────────────────────────────────

/**
 * Base class for every item rendered in the Tracelet trace explorer tree view.
 */
export class TraceTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
  ) {
    super(label, collapsibleState);
  }
}

// ─── Group Item ──────────────────────────────────────────────────────────────

/**
 * Groups traces by session, project, or time bucket.
 */
export class TraceGroupItem extends TraceTreeItem {
  /** The traces that belong to this group */
  public readonly traces: Trace[];

  constructor(
    label: string,
    traces: Trace[],
    iconId: string = 'folder',
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.traces = traces;
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.description = `${traces.length} trace${traces.length === 1 ? '' : 's'}`;
  }
}

// ─── Trace Root Item ─────────────────────────────────────────────────────────

/**
 * Top-level tree node representing a single trace (collection of spans).
 * Shows the trace ID (truncated), relative time, and total duration.
 */
export class TraceRootItem extends TraceTreeItem {
  /** The full Trace object backing this node */
  public readonly trace: Trace;

  constructor(trace: Trace) {
    // Use rootSpan name when available; otherwise fall back to truncated trace ID
    const label = trace.rootSpan?.name ?? `Trace ${trace.id.slice(0, 8)}`;

    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.trace = trace;

    // Description: relative time + duration
    const relTime = formatRelativeTime(trace.startTime);
    const dur = formatDuration(trace.duration);
    this.description = `${relTime} · ${dur}`;

    // Tooltip with full details
    const spanCount = trace.spans.length;
    this.tooltip = new vscode.MarkdownString(
      [
        `**Trace** \`${trace.id}\``,
        `**Source:** ${trace.source}`,
        `**Spans:** ${spanCount}`,
        `**Duration:** ${dur}`,
        `**Started:** ${new Date(trace.startTime).toLocaleString()}`,
      ].join('  \n'),
    );

    this.iconPath = new vscode.ThemeIcon('list-tree');
    this.contextValue = ContextValues.TRACE;

    if (trace.rootSpan) {
      this.command = {
        command: Commands.SHOW_TRACES,
        title: 'Open Trace Detail',
        arguments: [trace.rootSpan],
      };
    }
  }
}

// ─── Span Item ───────────────────────────────────────────────────────────────

/**
 * A single span within a trace. Rendered with an icon matching its SpanKind
 * and a status indicator in the description.
 */
export class SpanItem extends TraceTreeItem {
  /** The TraceSpan data backing this node */
  public readonly span: TraceSpan;

  /** Direct child items (nested spans + metadata) resolved lazily by the provider */
  public children: TraceTreeItem[] | undefined;

  constructor(
    span: TraceSpan,
    hasChildren: boolean = false,
  ) {
    super(
      span.name,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.span = span;

    // Status + duration in description
    const indicator = statusIndicator(span.status);
    const dur = formatDuration(span.duration);
    this.description = `${indicator.text} ${dur}`.trim();

    // Icon based on span kind
    this.iconPath = new vscode.ThemeIcon(
      spanKindIcon(span.kind),
      indicator.color,
    );

    // Context value for menu contributions
    this.contextValue = spanKindContextValue(span.kind);

    // Click command: diff view for LLM spans, show traces for others
    this.command = span.kind === 'llm'
      ? { command: Commands.OPEN_DIFF, title: 'Open Diff', arguments: [span] }
      : { command: Commands.SHOW_TRACES, title: 'Show Traces', arguments: [span] };

    // Rich tooltip
    const tooltipLines: string[] = [
      `**${span.name}**`,
      `**Kind:** ${span.kind}`,
      `**Status:** ${span.status}`,
      `**Duration:** ${dur}`,
    ];
    if (span.llm) {
      tooltipLines.push(`**Model:** ${span.llm.model}`);
      if (span.llm.tokenUsage.total > 0) {
        tooltipLines.push(`**Tokens:** ${span.llm.tokenUsage.total}`);
      }
    }
    if (span.error) {
      tooltipLines.push(`**Error:** ${span.error}`);
    }
    this.tooltip = new vscode.MarkdownString(tooltipLines.join('  \n'));
  }
}

// ─── Metadata Item ───────────────────────────────────────────────────────────

/**
 * Leaf node that shows a key/value metadata pair (e.g., "model: gpt-4",
 * "tokens: 1 234"). Uses greyed-out description styling.
 */
export class MetadataItem extends TraceTreeItem {
  constructor(
    key: string,
    value: string,
    iconId: string = 'info',
  ) {
    super(key, vscode.TreeItemCollapsibleState.None);

    // Value shown in the lighter "description" column
    this.description = value;

    this.iconPath = new vscode.ThemeIcon(iconId, new vscode.ThemeColor('descriptionForeground'));
    this.contextValue = ContextValues.METADATA_ITEM;

    this.tooltip = `${key}: ${value}`;
  }
}
