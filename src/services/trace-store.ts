/**
 * Central in-memory trace data store for Tracelet.
 *
 * Responsibilities:
 *  - Stores traces (Map<traceId, Trace>) and a flat span index (Map<spanId, TraceSpan>).
 *  - Groups incoming TraceSpan[] into Trace objects by traceId, computing
 *    rootSpan, startTime, endTime, and duration.
 *  - Enforces a maximum trace count via LRU eviction (oldest traces removed first).
 *  - Emits events: onTracesUpdated, onTraceAdded, onStoreCleared.
 *  - Provides rich query methods: by id, function, file, latest, and token aggregation.
 */

import * as vscode from 'vscode';
import type { Trace, TraceSpan, TokenUsageAggregate } from '../types';
import { Defaults } from '../utils/constants';
import { logger } from '../utils/logger';

export class TraceStore {
  // ── Storage ────────────────────────────────────────────────────────────

  /** Primary store keyed by traceId. */
  private traces: Map<string, Trace> = new Map();

  /** Flat span index for O(1) span lookup. */
  private spans: Map<string, TraceSpan> = new Map();

  /** Maximum number of traces to retain before LRU eviction. */
  private maxTraces: number;

  // ── Events ─────────────────────────────────────────────────────────────

  private readonly _onTracesUpdated = new vscode.EventEmitter<Trace[]>();
  /** Fires after any batch of traces is added (payload = all current traces). */
  public readonly onTracesUpdated: vscode.Event<Trace[]> = this._onTracesUpdated.event;

  private readonly _onTraceAdded = new vscode.EventEmitter<Trace>();
  /** Fires once per newly created trace. */
  public readonly onTraceAdded: vscode.Event<Trace> = this._onTraceAdded.event;

  private readonly _onStoreCleared = new vscode.EventEmitter<void>();
  /** Fires when the store is cleared. */
  public readonly onStoreCleared: vscode.Event<void> = this._onStoreCleared.event;

  // ── Constructor ────────────────────────────────────────────────────────

  constructor(maxTraces?: number) {
    this.maxTraces = maxTraces ?? Defaults.MAX_TRACES;
  }

  // ── Ingestion ──────────────────────────────────────────────────────────

  /**
   * Ingest a batch of spans. Spans are grouped by traceId; for each group
   * a Trace object is created (or updated) with computed timing fields.
   */
  addTraces(incomingSpans: TraceSpan[]): void {
    if (incomingSpans.length === 0) {
      return;
    }

    // Group incoming spans by traceId
    const grouped = new Map<string, TraceSpan[]>();
    for (const span of incomingSpans) {
      const bucket = grouped.get(span.traceId) ?? [];
      bucket.push(span);
      grouped.set(span.traceId, bucket);
    }

    const newTraces: Trace[] = [];

    for (const [traceId, spans] of grouped) {
      // Merge with existing trace spans (if any)
      const existing = this.traces.get(traceId);
      const allSpans = existing
        ? this.mergeSpans(existing.spans, spans)
        : spans;

      const trace = this.buildTrace(traceId, allSpans);
      this.traces.set(traceId, trace);

      // Update flat span index
      for (const s of allSpans) {
        this.spans.set(s.id, s);
      }

      if (!existing) {
        newTraces.push(trace);
      }
    }

    // LRU eviction – remove oldest traces when over the limit
    this.evictIfNeeded();

    // Fire events
    for (const t of newTraces) {
      this._onTraceAdded.fire(t);
    }
    this._onTracesUpdated.fire(this.getAllTraces());

    logger.debug(
      `TraceStore: ingested ${incomingSpans.length} spans into ${grouped.size} traces ` +
      `(total: ${this.traceCount} traces, ${this.spanCount} spans)`,
    );
  }

  // ── Queries ────────────────────────────────────────────────────────────

  /** Get a trace by its unique identifier. */
  getTraceById(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  /** Get a span by its unique identifier. */
  getSpanById(spanId: string): TraceSpan | undefined {
    return this.spans.get(spanId);
  }

  /** Find all spans whose sourceMapping.functionName matches. */
  getByFunction(functionName: string): TraceSpan[] {
    const results: TraceSpan[] = [];
    for (const span of this.spans.values()) {
      if (span.sourceMapping?.functionName === functionName) {
        results.push(span);
      }
    }
    return results;
  }

  /** Find all spans whose sourceMapping.filePath matches (normalized comparison). */
  getByFile(filePath: string): TraceSpan[] {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const results: TraceSpan[] = [];
    for (const span of this.spans.values()) {
      if (span.sourceMapping?.filePath.replace(/\\/g, '/').toLowerCase() === normalized) {
        results.push(span);
      }
    }
    return results;
  }

  /** Return the most recent traces, sorted newest-first. */
  getLatest(limit?: number): Trace[] {
    const all = this.getAllTraces();
    return limit !== undefined ? all.slice(0, limit) : all;
  }

  /** Return all traces sorted newest-first. */
  getAllTraces(): Trace[] {
    return Array.from(this.traces.values()).sort(
      (a, b) => b.startTime - a.startTime,
    );
  }

  /**
   * Aggregate token usage grouped by function name.
   * Only spans with an LLM data block and a sourceMapping are included.
   */
  getTokenUsageByFunction(): TokenUsageAggregate[] {
    const map = new Map<
      string,
      { fn: string; fp?: string; prompt: number; completion: number; total: number; count: number }
    >();

    for (const span of this.spans.values()) {
      if (!span.llm || span.llm.tokenUsage.total === 0) {
        continue;
      }
      const fn = span.sourceMapping?.functionName ?? span.name;
      const fp = span.sourceMapping?.filePath;
      const key = `${fn}::${fp ?? ''}`;

      const agg = map.get(key) ?? { fn, fp, prompt: 0, completion: 0, total: 0, count: 0 };
      agg.prompt += span.llm.tokenUsage.prompt;
      agg.completion += span.llm.tokenUsage.completion;
      agg.total += span.llm.tokenUsage.total;
      agg.count += 1;
      map.set(key, agg);
    }

    return Array.from(map.values()).map((a) => ({
      functionName: a.fn,
      filePath: a.fp,
      totalPromptTokens: a.prompt,
      totalCompletionTokens: a.completion,
      totalTokens: a.total,
      invocationCount: a.count,
      avgTokensPerCall: a.count > 0 ? Math.round(a.total / a.count) : 0,
    }));
  }

  // ── Mutation ────────────────────────────────────────────────────────────

  /** Remove all traces and spans, fires onStoreCleared. */
  clear(): void {
    this.traces.clear();
    this.spans.clear();
    this._onStoreCleared.fire();
    logger.info('TraceStore: cleared');
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  /** Number of traces currently stored. */
  get traceCount(): number {
    return this.traces.size;
  }

  /** Number of spans currently indexed. */
  get spanCount(): number {
    return this.spans.size;
  }

  // ── Disposal ───────────────────────────────────────────────────────────

  dispose(): void {
    this._onTracesUpdated.dispose();
    this._onTraceAdded.dispose();
    this._onStoreCleared.dispose();
  }

  // ── Internal Helpers ───────────────────────────────────────────────────

  /**
   * Merge new spans into an existing span list, de-duplicating by span id.
   * Newer spans (by id match) overwrite older ones.
   */
  private mergeSpans(existing: TraceSpan[], incoming: TraceSpan[]): TraceSpan[] {
    const merged = new Map<string, TraceSpan>();
    for (const s of existing) {
      merged.set(s.id, s);
    }
    for (const s of incoming) {
      merged.set(s.id, s); // incoming wins on conflict
    }
    return Array.from(merged.values());
  }

  /**
   * Build a Trace object from a flat list of spans belonging to the same traceId.
   * Computes rootSpan, startTime, endTime, and duration.
   */
  private buildTrace(traceId: string, spans: TraceSpan[]): Trace {
    // Determine root span: the one with no parentId (or parentId not in this trace)
    const idSet = new Set(spans.map((s) => s.id));
    const rootSpan = spans.find((s) => !s.parentId || !idSet.has(s.parentId));

    // Compute aggregate timing
    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const s of spans) {
      if (s.startTime < minStart) {
        minStart = s.startTime;
      }
      if (s.endTime > maxEnd) {
        maxEnd = s.endTime;
      }
    }

    const source = rootSpan?.source ?? spans[0].source;

    return {
      id: traceId,
      rootSpan,
      spans,
      source,
      startTime: minStart,
      endTime: maxEnd,
      duration: maxEnd - minStart,
      metadata: this.extractTraceMetadata(spans),
    };
  }

  /**
   * Extract trace-level metadata from span attributes (session, user, tags).
   */
  private extractTraceMetadata(
    spans: TraceSpan[],
  ): Trace['metadata'] {
    // Prefer attributes from the root span, then fall back to any span
    for (const span of spans) {
      const sessionId = span.attributes['session.id'] as string | undefined;
      const userId = span.attributes['user.id'] as string | undefined;
      const tags = span.tags;
      if (sessionId || userId || tags) {
        return { sessionId, userId, tags };
      }
    }
    return undefined;
  }

  /**
   * Evict oldest traces if the store exceeds maxTraces.
   * Traces are sorted by startTime; the oldest are removed first.
   */
  private evictIfNeeded(): void {
    if (this.traces.size <= this.maxTraces) {
      return;
    }

    const sorted = Array.from(this.traces.values()).sort(
      (a, b) => a.startTime - b.startTime,
    );

    const excess = sorted.length - this.maxTraces;
    for (let i = 0; i < excess; i++) {
      const trace = sorted[i];
      // Remove span index entries for evicted trace
      for (const span of trace.spans) {
        this.spans.delete(span.id);
      }
      this.traces.delete(trace.id);
    }

    logger.debug(`TraceStore: evicted ${excess} oldest trace(s)`);
  }
}
