/**
 * Core trace data types for Tracelet.
 * These define the unified internal representation of telemetry data,
 * regardless of which provider (OTel, LangSmith, Langfuse) it came from.
 */

// ─── Data Source ─────────────────────────────────────────────────────────────

/** Identifies which telemetry provider a trace came from */
export type DataSource = 'otel-local' | 'langsmith' | 'langfuse';

// ─── Span Classification ────────────────────────────────────────────────────

/** OpenInference-compatible span kinds */
export type SpanKind =
  | 'llm'
  | 'chain'
  | 'tool'
  | 'retriever'
  | 'embedding'
  | 'agent'
  | 'reranker'
  | 'guardrail'
  | 'evaluator'
  | 'unknown';

/** Execution status of a span */
export type SpanStatus = 'success' | 'error' | 'running' | 'unset';

// ─── Message Types ───────────────────────────────────────────────────────────

/** A single message in an LLM conversation */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string | null;
  name?: string;
  toolCalls?: ToolCall[];
}

/** A tool/function call made by an LLM */
export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: string;
  };
}

// ─── Token Usage ─────────────────────────────────────────────────────────────

/** Token consumption metrics for an LLM invocation */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// ─── LLM-Specific Data ──────────────────────────────────────────────────────

/** LLM invocation details extracted from a span's attributes */
export interface LLMData {
  model: string;
  provider?: string;
  inputMessages: Message[];
  outputMessages: Message[];
  tokenUsage: TokenUsage;
  invocationParams?: Record<string, unknown>;
  /** The prompt template with placeholder syntax (e.g., {{variable}}) */
  promptTemplate?: string;
  /** Template variables and their runtime values */
  templateVariables?: Record<string, string>;
}

// ─── Source Mapping ──────────────────────────────────────────────────────────

/** Links a trace span to a local source code location */
export interface SourceMapping {
  filePath: string;
  lineNumber: number;
  functionName: string;
  /** Confidence score 0-1 for the mapping accuracy */
  confidence: number;
}

// ─── Core Trace Span ─────────────────────────────────────────────────────────

/**
 * Unified internal representation of a telemetry span.
 * All provider-specific data is normalized into this format.
 */
export interface TraceSpan {
  /** Unique span identifier */
  id: string;
  /** Trace ID grouping related spans */
  traceId: string;
  /** Parent span ID for hierarchy */
  parentId?: string;
  /** Human-readable span name (e.g., "ChatCompletion", "retrieve_docs") */
  name: string;
  /** Classification of the span's purpose */
  kind: SpanKind;
  /** Execution status */
  status: SpanStatus;
  /** Start timestamp (Unix ms) */
  startTime: number;
  /** End timestamp (Unix ms) */
  endTime: number;
  /** Duration in milliseconds */
  duration: number;
  /** Raw attributes from the telemetry source */
  attributes: Record<string, unknown>;
  /** Which telemetry provider this span came from */
  source: DataSource;
  /** LLM-specific fields (only present for LLM spans) */
  llm?: LLMData;
  /** Mapping to local source code */
  sourceMapping?: SourceMapping;
  /** Raw input value (for non-LLM spans) */
  input?: string;
  /** Raw output value (for non-LLM spans) */
  output?: string;
  /** Error message if status is 'error' */
  error?: string;
  /** Tags/labels attached to the span */
  tags?: string[];
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

// ─── Trace (collection of spans) ────────────────────────────────────────────

/** A complete trace consisting of a tree of related spans */
export interface Trace {
  /** Unique trace identifier */
  id: string;
  /** The root span of the trace */
  rootSpan?: TraceSpan;
  /** All spans in this trace (flat list for easy iteration) */
  spans: TraceSpan[];
  /** Trace-level metadata */
  metadata?: {
    serviceName?: string;
    userId?: string;
    sessionId?: string;
    tags?: string[];
  };
  /** Source provider */
  source: DataSource;
  /** Timestamp of the earliest span */
  startTime: number;
  /** Timestamp of the latest span end */
  endTime: number;
  /** Total duration from first span start to last span end */
  duration: number;
}

// ─── Aggregated Metrics ──────────────────────────────────────────────────────

/** Token usage aggregated by function/file */
export interface TokenUsageAggregate {
  functionName: string;
  filePath?: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  invocationCount: number;
  avgTokensPerCall: number;
}

// ─── Provider Fetch Options ──────────────────────────────────────────────────

/** Options for fetching traces from a provider */
export interface FetchOptions {
  /** Maximum number of traces to fetch */
  limit?: number;
  /** Only fetch traces after this timestamp */
  since?: Date;
  /** Filter by function name */
  functionName?: string;
  /** Filter by file path */
  filePath?: string;
  /** Filter by span kind */
  spanKind?: SpanKind;
  /** Filter by trace ID */
  traceId?: string;
}

// ─── Connection Result ───────────────────────────────────────────────────────

/** Result of testing a provider connection */
export interface ConnectionResult {
  success: boolean;
  message: string;
  latencyMs: number;
  provider: DataSource;
}
