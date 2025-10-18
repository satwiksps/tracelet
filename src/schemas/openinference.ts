/**
 * Zod schema for validating OpenInference / OpenTelemetry span data.
 *
 * Handles the OTLP JSON export format (resourceSpans → scopeSpans → spans)
 * and the dot-notation array encoding used by OpenInference for messages
 * (e.g. `llm.input_messages.0.message.role`).
 */

import { z } from 'zod';
import type { TraceSpan, SpanKind, SpanStatus, Message, ToolCall, TokenUsage } from '../types';
import { OIAttributes } from '../utils/constants';

// ─── OTel KeyValue helpers ──────────────────────────────────────────────────

/** OTel `AnyValue` – one of the typed value wrappers */
const AnyValueSchema = z.object({
  stringValue: z.string().optional(),
  intValue: z.union([z.string(), z.number()]).optional(),
  doubleValue: z.number().optional(),
  boolValue: z.boolean().optional(),
  arrayValue: z.object({ values: z.array(z.lazy((): z.ZodTypeAny => AnyValueSchema)).optional() }).optional(),
  kvlistValue: z.object({ values: z.array(z.lazy((): z.ZodTypeAny => KeyValueSchema)).optional() }).optional(),
});

/** OTel KeyValue pair */
const KeyValueSchema = z.object({
  key: z.string(),
  value: AnyValueSchema,
});

type AnyValue = z.infer<typeof AnyValueSchema>;
type KeyValue = z.infer<typeof KeyValueSchema>;

/** Unwrap a single `AnyValue` to its JS primitive */
function unwrapValue(v: AnyValue): unknown {
  if (v.stringValue !== undefined) { return v.stringValue; }
  if (v.intValue !== undefined) { return typeof v.intValue === 'string' ? parseInt(v.intValue, 10) : v.intValue; }
  if (v.doubleValue !== undefined) { return v.doubleValue; }
  if (v.boolValue !== undefined) { return v.boolValue; }
  if (v.arrayValue?.values) { return v.arrayValue.values.map(unwrapValue); }
  if (v.kvlistValue?.values) { return flattenKeyValues(v.kvlistValue.values as KeyValue[]); }
  return undefined;
}

/** Convert a KeyValue[] array into a flat Record<string, unknown> */
function flattenKeyValues(kvs: KeyValue[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const kv of kvs) {
    result[kv.key] = unwrapValue(kv.value);
  }
  return result;
}

// ─── OTel Span Status ───────────────────────────────────────────────────────

const OtelStatusSchema = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
}).optional();

// ─── OTel Span ──────────────────────────────────────────────────────────────

const OtelSpanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  kind: z.number().optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]),
  endTimeUnixNano: z.union([z.string(), z.number()]),
  attributes: z.array(KeyValueSchema).optional(),
  status: OtelStatusSchema,
  events: z.array(z.unknown()).optional(),
  links: z.array(z.unknown()).optional(),
});

// ─── OTLP Export Envelope ───────────────────────────────────────────────────

const ScopeSpansSchema = z.object({
  scope: z.object({
    name: z.string().optional(),
    version: z.string().optional(),
  }).optional(),
  spans: z.array(OtelSpanSchema),
});

const ResourceSpansSchema = z.object({
  resource: z.object({
    attributes: z.array(KeyValueSchema).optional(),
  }).optional(),
  scopeSpans: z.array(ScopeSpansSchema),
});

/** Top-level OTLP JSON export schema */
export const OtlpExportSchema = z.object({
  resourceSpans: z.array(ResourceSpansSchema),
});

export type OtlpExport = z.infer<typeof OtlpExportSchema>;

// ─── Message reconstruction ─────────────────────────────────────────────────

/**
 * Reconstruct a `Message[]` from flat OpenInference attributes.
 *
 * OpenInference encodes messages using dot-notation indices:
 * ```
 * llm.input_messages.0.message.role = "user"
 * llm.input_messages.0.message.content = "Hello"
 * llm.input_messages.1.message.role = "assistant"
 * ```
 *
 * @param attributes - Flat attribute map
 * @param prefix - The attribute prefix, e.g. `llm.input_messages`
 * @returns Ordered array of Messages
 */
export function reconstructMessages(
  attributes: Record<string, unknown>,
  prefix: string = OIAttributes.LLM_INPUT_MESSAGES,
): Message[] {
  // Collect the maximum index
  const indexPattern = new RegExp(`^${escapeRegex(prefix)}\\.(\\d+)\\.`);
  const indices = new Set<number>();

  for (const key of Object.keys(attributes)) {
    const match = indexPattern.exec(key);
    if (match) {
      indices.add(parseInt(match[1], 10));
    }
  }

  if (indices.size === 0) {
    return [];
  }

  const sorted = Array.from(indices).sort((a, b) => a - b);
  const messages: Message[] = [];

  for (const idx of sorted) {
    const base = `${prefix}.${idx}.message`;
    const role = String(attributes[`${base}.role`] ?? 'user') as Message['role'];
    const content = attributes[`${base}.content`] as string | null ?? null;
    const name = attributes[`${base}.name`] as string | undefined;

    const msg: Message = { role, content };
    if (name) { msg.name = name; }

    // Reconstruct tool calls (if any)
    const toolCalls = reconstructToolCalls(attributes, `${base}.tool_calls`);
    if (toolCalls.length > 0) { msg.toolCalls = toolCalls; }

    messages.push(msg);
  }

  return messages;
}

/** Reconstruct ToolCall[] from dot-notation attributes */
function reconstructToolCalls(
  attributes: Record<string, unknown>,
  prefix: string,
): ToolCall[] {
  const indexPattern = new RegExp(`^${escapeRegex(prefix)}\\.(\\d+)\\.`);
  const indices = new Set<number>();

  for (const key of Object.keys(attributes)) {
    const match = indexPattern.exec(key);
    if (match) {
      indices.add(parseInt(match[1], 10));
    }
  }

  if (indices.size === 0) { return []; }

  const sorted = Array.from(indices).sort((a, b) => a - b);
  const toolCalls: ToolCall[] = [];

  for (const idx of sorted) {
    const base = `${prefix}.${idx}.tool_call`;
    toolCalls.push({
      id: attributes[`${base}.id`] as string | undefined,
      function: {
        name: String(attributes[`${base}.function.name`] ?? ''),
        arguments: String(attributes[`${base}.function.arguments`] ?? '{}'),
      },
    });
  }

  return toolCalls;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Span kind mapping ──────────────────────────────────────────────────────

const SPAN_KIND_MAP: Record<string, SpanKind> = {
  llm: 'llm',
  chain: 'chain',
  tool: 'tool',
  retriever: 'retriever',
  embedding: 'embedding',
  agent: 'agent',
  reranker: 'reranker',
  guardrail: 'guardrail',
  evaluator: 'evaluator',
};

function resolveSpanKind(attrs: Record<string, unknown>): SpanKind {
  const raw = attrs[OIAttributes.SPAN_KIND];
  if (typeof raw === 'string') {
    return SPAN_KIND_MAP[raw.toLowerCase()] ?? 'unknown';
  }
  return 'unknown';
}

// ─── Status mapping ─────────────────────────────────────────────────────────

function resolveStatus(status?: { code?: number; message?: string }): SpanStatus {
  if (!status || status.code === undefined) { return 'unset'; }
  switch (status.code) {
    case 0: return 'unset';
    case 1: return 'success';
    case 2: return 'error';
    default: return 'unset';
  }
}

// ─── Nano → millisecond conversion ──────────────────────────────────────────

function nanoToMs(nano: string | number): number {
  const n = typeof nano === 'string' ? BigInt(nano) : BigInt(Math.round(nano));
  return Number(n / BigInt(1_000_000));
}

// ─── Parse a single raw OTel span → TraceSpan ──────────────────────────────

/**
 * Parse a raw OTLP JSON span object into a unified `TraceSpan`.
 *
 * Uses `safeParse` for schema validation — returns `undefined` for invalid data.
 */
export function parseOtelSpan(raw: unknown): TraceSpan | undefined {
  const result = OtelSpanSchema.safeParse(raw);
  if (!result.success) {
    return undefined;
  }

  const span = result.data;
  const attrs = span.attributes ? flattenKeyValues(span.attributes) : {};

  const startTime = nanoToMs(span.startTimeUnixNano);
  const endTime = nanoToMs(span.endTimeUnixNano);
  const duration = endTime - startTime;
  const kind = resolveSpanKind(attrs);
  const status = resolveStatus(span.status);

  const traceSpan: TraceSpan = {
    id: span.spanId,
    traceId: span.traceId,
    parentId: span.parentSpanId,
    name: span.name,
    kind,
    status,
    startTime,
    endTime,
    duration,
    attributes: attrs,
    source: 'otel-local',
  };

  // Extract error message
  if (status === 'error' && span.status?.message) {
    traceSpan.error = span.status.message;
  }

  // Extract input/output for non-LLM spans
  const inputValue = attrs[OIAttributes.INPUT_VALUE];
  if (typeof inputValue === 'string') { traceSpan.input = inputValue; }

  const outputValue = attrs[OIAttributes.OUTPUT_VALUE];
  if (typeof outputValue === 'string') { traceSpan.output = outputValue; }

  // Extract tags
  const tags = attrs[OIAttributes.TAG_TAGS];
  if (Array.isArray(tags)) {
    traceSpan.tags = tags.map(String);
  }

  // Extract metadata
  const metadata = attrs[OIAttributes.METADATA];
  if (typeof metadata === 'object' && metadata !== null) {
    traceSpan.metadata = metadata as Record<string, unknown>;
  }

  // Build LLM data for LLM spans
  if (kind === 'llm') {
    const inputMessages = reconstructMessages(attrs, OIAttributes.LLM_INPUT_MESSAGES);
    const outputMessages = reconstructMessages(attrs, OIAttributes.LLM_OUTPUT_MESSAGES);

    const tokenUsage: TokenUsage = {
      prompt: toNumber(attrs[OIAttributes.LLM_TOKEN_COUNT_PROMPT]),
      completion: toNumber(attrs[OIAttributes.LLM_TOKEN_COUNT_COMPLETION]),
      total: toNumber(attrs[OIAttributes.LLM_TOKEN_COUNT_TOTAL]),
    };

    // Auto-compute total if missing
    if (tokenUsage.total === 0 && (tokenUsage.prompt > 0 || tokenUsage.completion > 0)) {
      tokenUsage.total = tokenUsage.prompt + tokenUsage.completion;
    }

    const model = String(attrs[OIAttributes.LLM_MODEL_NAME] ?? 'unknown');

    traceSpan.llm = {
      model,
      provider: attrs[OIAttributes.LLM_PROVIDER] as string | undefined
        ?? attrs[OIAttributes.LLM_SYSTEM] as string | undefined,
      inputMessages,
      outputMessages,
      tokenUsage,
    };

    // Invocation parameters
    const invocParams = attrs[OIAttributes.LLM_INVOCATION_PARAMETERS];
    if (typeof invocParams === 'string') {
      try {
        traceSpan.llm.invocationParams = JSON.parse(invocParams);
      } catch {
        traceSpan.llm.invocationParams = { raw: invocParams };
      }
    } else if (typeof invocParams === 'object' && invocParams !== null) {
      traceSpan.llm.invocationParams = invocParams as Record<string, unknown>;
    }

    // Prompt template
    const template = attrs[OIAttributes.LLM_PROMPT_TEMPLATE];
    if (typeof template === 'string') {
      traceSpan.llm.promptTemplate = template;
    }

    // Template variables
    const variables = attrs[OIAttributes.LLM_PROMPT_TEMPLATE_VARIABLES];
    if (typeof variables === 'string') {
      try {
        traceSpan.llm.templateVariables = JSON.parse(variables);
      } catch {
        // Ignore malformed JSON
      }
    } else if (typeof variables === 'object' && variables !== null) {
      traceSpan.llm.templateVariables = variables as Record<string, string>;
    }
  }

  return traceSpan;
}

// ─── Full OTLP export parsing ───────────────────────────────────────────────

/**
 * Parse a full OTLP JSON export object and return all `TraceSpan`s.
 *
 * @param raw - The raw JSON object (top-level `resourceSpans`)
 * @returns Array of parsed `TraceSpan`s. Invalid spans are silently skipped.
 */
export function parseOtlpExport(raw: unknown): TraceSpan[] {
  const result = OtlpExportSchema.safeParse(raw);
  if (!result.success) {
    return [];
  }

  const spans: TraceSpan[] = [];

  for (const resourceSpan of result.data.resourceSpans) {
    for (const scopeSpan of resourceSpan.scopeSpans) {
      for (const rawSpan of scopeSpan.spans) {
        const parsed = parseOtelSpan(rawSpan);
        if (parsed) {
          spans.push(parsed);
        }
      }
    }
  }

  return spans;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function toNumber(v: unknown): number {
  if (typeof v === 'number') { return v; }
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}
