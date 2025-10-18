/**
 * Zod schema for validating Langfuse observation / generation objects.
 *
 * Handles both the new `usageDetails` format and the legacy `usage` format,
 * normalizing everything into the unified `TraceSpan` representation.
 */

import { z } from 'zod';
import type { TraceSpan, SpanKind, SpanStatus, Message, TokenUsage } from '../types';

// ─── Langfuse Observation Schema ────────────────────────────────────────────

/** Legacy usage format */
const LegacyUsageSchema = z.object({
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  input: z.number().optional(),
  output: z.number().optional(),
  total: z.number().optional(),
}).nullable().optional();

/** New usageDetails format */
const UsageDetailsSchema = z.record(z.number()).nullable().optional();

/** Model parameters (temperature, max_tokens, etc.) */
const ModelParametersSchema = z.record(
  z.union([z.string(), z.number(), z.boolean()]),
).nullable().optional();

/** Schema for a single Langfuse observation */
export const LangfuseObservationSchema = z.object({
  id: z.string(),
  traceId: z.string().optional(),
  type: z.string().optional(),
  name: z.string().nullable().optional(),
  startTime: z.string(),
  endTime: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  modelParameters: ModelParametersSchema,
  input: z.unknown().nullable().optional(),
  output: z.unknown().nullable().optional(),
  usageDetails: UsageDetailsSchema,
  usage: LegacyUsageSchema,
  level: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  parentObservationId: z.string().nullable().optional(),
  statusMessage: z.string().nullable().optional(),
  completionStartTime: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
});

export type LangfuseObservation = z.infer<typeof LangfuseObservationSchema>;

/** Schema for Langfuse trace object (contains observations) */
export const LangfuseTraceSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  input: z.unknown().nullable().optional(),
  output: z.unknown().nullable().optional(),
  userId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  timestamp: z.string().optional(),
  observations: z.array(LangfuseObservationSchema).optional(),
});

export type LangfuseTrace = z.infer<typeof LangfuseTraceSchema>;

/** Schema for the Langfuse traces list response */
export const LangfuseTracesResponseSchema = z.object({
  data: z.array(LangfuseTraceSchema),
  meta: z.object({
    page: z.number().optional(),
    limit: z.number().optional(),
    totalItems: z.number().optional(),
    totalPages: z.number().optional(),
  }).optional(),
});

export type LangfuseTracesResponse = z.infer<typeof LangfuseTracesResponseSchema>;

// ─── Observation type → SpanKind mapping ────────────────────────────────────

function resolveSpanKind(obs: LangfuseObservation): SpanKind {
  const type = (obs.type ?? '').toLowerCase();
  if (type === 'generation') { return 'llm'; }
  if (type === 'span') { return 'chain'; }
  if (type === 'event') { return 'chain'; }

  // Infer from model presence
  if (obs.model) { return 'llm'; }

  return 'unknown';
}

// ─── Status mapping ─────────────────────────────────────────────────────────

function resolveStatus(obs: LangfuseObservation): SpanStatus {
  const level = (obs.level ?? '').toUpperCase();
  if (level === 'ERROR') { return 'error'; }
  if (level === 'WARNING') { return 'success'; } // warnings are not failures
  if (!obs.endTime) { return 'running'; }
  return 'success';
}

// ─── Token usage extraction ─────────────────────────────────────────────────

function extractTokenUsage(obs: LangfuseObservation): TokenUsage {
  // New format: usageDetails
  if (obs.usageDetails && typeof obs.usageDetails === 'object') {
    const details = obs.usageDetails;
    const prompt = details['input'] ?? details['promptTokens'] ?? 0;
    const completion = details['output'] ?? details['completionTokens'] ?? 0;
    const total = details['total'] ?? details['totalTokens'] ?? 0;
    return {
      prompt,
      completion,
      total: total > 0 ? total : prompt + completion,
    };
  }

  // Legacy format: usage
  if (obs.usage && typeof obs.usage === 'object') {
    const u = obs.usage;
    const prompt = u.promptTokens ?? u.input ?? 0;
    const completion = u.completionTokens ?? u.output ?? 0;
    const total = u.totalTokens ?? u.total ?? 0;
    return {
      prompt,
      completion,
      total: total > 0 ? total : prompt + completion,
    };
  }

  return { prompt: 0, completion: 0, total: 0 };
}

// ─── Message extraction ─────────────────────────────────────────────────────

/**
 * Extract messages from Langfuse input/output fields.
 *
 * Langfuse stores messages in various formats:
 * - Array of `{role, content}` objects
 * - Single `{role, content}` object
 * - Plain string
 * - Array of strings
 */
function extractMessages(data: unknown): Message[] {
  if (!data) { return []; }

  // Array of message objects
  if (Array.isArray(data)) {
    const messages: Message[] = [];
    for (const item of data) {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if ('role' in obj) {
          messages.push({
            role: normalizeRole(String(obj['role'])),
            content: obj['content'] != null ? String(obj['content']) : null,
          });
          continue;
        }
      }
      // Fallback: string item
      if (typeof item === 'string') {
        messages.push({ role: 'user', content: item });
      }
    }
    return messages;
  }

  // Single message object
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;

    // { messages: [...] } wrapper
    if (Array.isArray(obj['messages'])) {
      return extractMessages(obj['messages']);
    }

    if ('role' in obj) {
      return [{
        role: normalizeRole(String(obj['role'])),
        content: obj['content'] != null ? String(obj['content']) : null,
      }];
    }
  }

  // Plain string
  if (typeof data === 'string') {
    return [{ role: 'user', content: data }];
  }

  return [];
}

function normalizeRole(role: string): Message['role'] {
  const lower = role.toLowerCase();
  if (['system', 'user', 'assistant', 'tool', 'function'].includes(lower)) {
    return lower as Message['role'];
  }
  if (lower === 'human') { return 'user'; }
  if (lower === 'ai') { return 'assistant'; }
  return 'user';
}

// ─── Parse a Langfuse observation → TraceSpan ───────────────────────────────

/**
 * Parse a Langfuse observation object into a unified `TraceSpan`.
 *
 * Uses `safeParse` for validation — returns `undefined` for invalid data.
 */
export function parseLangfuseObservation(raw: unknown): TraceSpan | undefined {
  const result = LangfuseObservationSchema.safeParse(raw);
  if (!result.success) {
    return undefined;
  }

  const obs = result.data;
  const startTime = new Date(obs.startTime).getTime();
  const endTime = obs.endTime ? new Date(obs.endTime).getTime() : Date.now();
  const duration = endTime - startTime;
  const kind = resolveSpanKind(obs);
  const status = resolveStatus(obs);

  const traceSpan: TraceSpan = {
    id: obs.id,
    traceId: obs.traceId ?? obs.id,
    parentId: obs.parentObservationId ?? undefined,
    name: obs.name ?? 'unnamed',
    kind,
    status,
    startTime,
    endTime,
    duration,
    attributes: {
      type: obs.type,
      level: obs.level,
      ...(obs.modelParameters ?? {}),
    },
    source: 'langfuse',
  };

  // Error/status message
  if (status === 'error' && obs.statusMessage) {
    traceSpan.error = obs.statusMessage;
  }

  // Metadata
  if (obs.metadata && Object.keys(obs.metadata).length > 0) {
    traceSpan.metadata = obs.metadata;
  }

  // LLM-specific data for generation observations
  if (kind === 'llm') {
    const inputMessages = extractMessages(obs.input);
    const outputMessages = extractMessages(obs.output);
    const tokenUsage = extractTokenUsage(obs);

    traceSpan.llm = {
      model: obs.model ?? 'unknown',
      inputMessages,
      outputMessages,
      tokenUsage,
    };

    // Model parameters as invocation params
    if (obs.modelParameters && Object.keys(obs.modelParameters).length > 0) {
      traceSpan.llm.invocationParams = Object.fromEntries(
        Object.entries(obs.modelParameters).map(([k, v]) => [k, v]),
      );
    }
  } else {
    // Non-LLM spans
    if (obs.input != null) {
      traceSpan.input = typeof obs.input === 'string'
        ? obs.input
        : JSON.stringify(obs.input);
    }
    if (obs.output != null) {
      traceSpan.output = typeof obs.output === 'string'
        ? obs.output
        : JSON.stringify(obs.output);
    }
  }

  return traceSpan;
}
