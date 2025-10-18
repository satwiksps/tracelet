/**
 * Zod schema for validating LangSmith API run objects.
 *
 * Handles the LangSmith REST API response format and converts
 * run objects into the unified `TraceSpan` representation.
 */

import { z } from 'zod';
import type { TraceSpan, SpanKind, SpanStatus, Message, TokenUsage } from '../types';

// ─── LangSmith Run Schema ───────────────────────────────────────────────────

/** Schema for a single LangSmith run object */
export const LangSmithRunSchema = z.object({
  id: z.string(),
  name: z.string(),
  run_type: z.string(),
  status: z.string().optional(),
  start_time: z.string(),
  end_time: z.string().nullable().optional(),
  inputs: z.record(z.unknown()).nullable().optional(),
  outputs: z.record(z.unknown()).nullable().optional(),
  prompt_tokens: z.number().nullable().optional(),
  completion_tokens: z.number().nullable().optional(),
  total_tokens: z.number().nullable().optional(),
  extra: z.record(z.unknown()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  trace_id: z.string().optional(),
  parent_run_id: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  serialized: z.record(z.unknown()).nullable().optional(),
  session_id: z.string().nullable().optional(),
});

export type LangSmithRun = z.infer<typeof LangSmithRunSchema>;

/** Schema for the LangSmith runs query response */
export const LangSmithRunsResponseSchema = z.object({
  runs: z.array(LangSmithRunSchema),
  cursors: z.record(z.string()).optional(),
});

export type LangSmithRunsResponse = z.infer<typeof LangSmithRunsResponseSchema>;

// ─── Run type → SpanKind mapping ────────────────────────────────────────────

const RUN_TYPE_MAP: Record<string, SpanKind> = {
  llm: 'llm',
  chain: 'chain',
  tool: 'tool',
  retriever: 'retriever',
  embedding: 'embedding',
  prompt: 'chain',
  parser: 'chain',
};

function resolveSpanKind(runType: string): SpanKind {
  return RUN_TYPE_MAP[runType.toLowerCase()] ?? 'unknown';
}

// ─── Status mapping ─────────────────────────────────────────────────────────

function resolveStatus(run: LangSmithRun): SpanStatus {
  if (run.error) { return 'error'; }
  if (run.status === 'error') { return 'error'; }
  if (run.status === 'pending' || !run.end_time) { return 'running'; }
  return 'success';
}

// ─── Message extraction ─────────────────────────────────────────────────────

/**
 * Extract messages from LangSmith inputs/outputs.
 *
 * LangSmith stores messages in several formats:
 * - `inputs.messages` — array of arrays: `[[{role, content}], ...]`
 * - `inputs.prompts` — array of strings (older format)
 * - `outputs.generations` — array of arrays of generation objects
 */
function extractMessages(data: Record<string, unknown> | null | undefined): Message[] {
  if (!data) { return []; }

  const messages: Message[] = [];

  // inputs.messages — nested arrays of message-like objects
  const rawMessages = data['messages'];
  if (Array.isArray(rawMessages)) {
    for (const group of rawMessages) {
      const items = Array.isArray(group) ? group : [group];
      for (const item of items) {
        const msg = coerceMessage(item);
        if (msg) { messages.push(msg); }
      }
    }
    if (messages.length > 0) { return messages; }
  }

  // inputs.prompts — simple string array
  const prompts = data['prompts'];
  if (Array.isArray(prompts)) {
    for (const p of prompts) {
      if (typeof p === 'string') {
        messages.push({ role: 'user', content: p });
      }
    }
    if (messages.length > 0) { return messages; }
  }

  // outputs.generations — nested arrays
  const generations = data['generations'];
  if (Array.isArray(generations)) {
    for (const gen of generations) {
      const items = Array.isArray(gen) ? gen : [gen];
      for (const item of items) {
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const text = obj['text'] as string | undefined;
          const message = obj['message'] as Record<string, unknown> | undefined;
          if (message) {
            const msg = coerceMessage(message);
            if (msg) { messages.push(msg); }
          } else if (text) {
            messages.push({ role: 'assistant', content: text });
          }
        }
      }
    }
  }

  return messages;
}

/** Coerce a raw object into a Message, handling various LangSmith formats */
function coerceMessage(raw: unknown): Message | undefined {
  if (!raw || typeof raw !== 'object') { return undefined; }
  const obj = raw as Record<string, unknown>;

  // LangChain serialized message format: { id: [...], type: "HumanMessage", kwargs: { content: "..." } }
  const type = obj['type'] as string | undefined;
  const kwargs = obj['kwargs'] as Record<string, unknown> | undefined;

  if (kwargs && typeof kwargs === 'object') {
    const content = kwargs['content'] as string | null ?? null;
    return {
      role: langchainTypeToRole(type),
      content,
    };
  }

  // Direct {role, content} format
  const role = obj['role'] as string | undefined;
  const content = obj['content'] as string | null ?? null;

  if (role) {
    return {
      role: normalizeRole(role),
      content,
    };
  }

  // Fallback — has content but no role
  if (content !== null) {
    return { role: 'user', content };
  }

  return undefined;
}

function langchainTypeToRole(type: string | undefined): Message['role'] {
  switch (type?.toLowerCase()) {
    case 'humanmessage':
    case 'human':
      return 'user';
    case 'aimessage':
    case 'ai':
      return 'assistant';
    case 'systemmessage':
    case 'system':
      return 'system';
    case 'toolmessage':
    case 'tool':
      return 'tool';
    case 'functionmessage':
    case 'function':
      return 'function';
    default:
      return 'user';
  }
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

// ─── Token usage extraction ─────────────────────────────────────────────────

function extractTokenUsage(run: LangSmithRun): TokenUsage {
  // Primary: top-level fields
  const prompt = run.prompt_tokens ?? 0;
  const completion = run.completion_tokens ?? 0;
  const total = run.total_tokens ?? 0;

  if (prompt > 0 || completion > 0 || total > 0) {
    return {
      prompt,
      completion,
      total: total > 0 ? total : prompt + completion,
    };
  }

  // Fallback: outputs.llm_output.token_usage
  if (run.outputs && typeof run.outputs === 'object') {
    const llmOutput = run.outputs['llm_output'] as Record<string, unknown> | undefined;
    if (llmOutput && typeof llmOutput === 'object') {
      const tokenUsage = llmOutput['token_usage'] as Record<string, unknown> | undefined;
      if (tokenUsage && typeof tokenUsage === 'object') {
        const p = toNumber(tokenUsage['prompt_tokens']);
        const c = toNumber(tokenUsage['completion_tokens']);
        const t = toNumber(tokenUsage['total_tokens']);
        return { prompt: p, completion: c, total: t > 0 ? t : p + c };
      }
    }
  }

  return { prompt: 0, completion: 0, total: 0 };
}

// ─── Parse a LangSmith run → TraceSpan ──────────────────────────────────────

/**
 * Parse a LangSmith run object into a unified `TraceSpan`.
 *
 * Uses `safeParse` for validation — returns `undefined` for invalid data.
 */
export function parseLangSmithRun(raw: unknown): TraceSpan | undefined {
  const result = LangSmithRunSchema.safeParse(raw);
  if (!result.success) {
    return undefined;
  }

  const run = result.data;
  const startTime = new Date(run.start_time).getTime();
  const endTime = run.end_time ? new Date(run.end_time).getTime() : Date.now();
  const duration = endTime - startTime;
  const kind = resolveSpanKind(run.run_type);
  const status = resolveStatus(run);

  const traceSpan: TraceSpan = {
    id: run.id,
    traceId: run.trace_id ?? run.id,
    parentId: run.parent_run_id ?? undefined,
    name: run.name,
    kind,
    status,
    startTime,
    endTime,
    duration,
    attributes: {
      run_type: run.run_type,
      ...(run.extra ?? {}),
    },
    source: 'langsmith',
  };

  // Error message
  if (run.error) {
    traceSpan.error = run.error;
  }

  // Tags
  if (run.tags && run.tags.length > 0) {
    traceSpan.tags = run.tags;
  }

  // LLM-specific data
  if (kind === 'llm') {
    const inputMessages = extractMessages(run.inputs);
    const outputMessages = extractMessages(run.outputs);
    const tokenUsage = extractTokenUsage(run);

    // Extract model name from extra.invocation_params or serialized
    let model = 'unknown';
    if (run.extra) {
      const invoc = run.extra['invocation_params'] as Record<string, unknown> | undefined;
      if (invoc?.['model_name']) { model = String(invoc['model_name']); }
      else if (invoc?.['model']) { model = String(invoc['model']); }
    }
    if (model === 'unknown' && run.serialized) {
      const kwargs = run.serialized['kwargs'] as Record<string, unknown> | undefined;
      if (kwargs?.['model_name']) { model = String(kwargs['model_name']); }
      else if (kwargs?.['model']) { model = String(kwargs['model']); }
    }

    traceSpan.llm = {
      model,
      inputMessages,
      outputMessages,
      tokenUsage,
    };

    // Invocation params
    if (run.extra?.['invocation_params']) {
      traceSpan.llm.invocationParams = run.extra['invocation_params'] as Record<string, unknown>;
    }
  } else {
    // Non-LLM spans: store input/output as strings
    if (run.inputs) {
      traceSpan.input = typeof run.inputs === 'string'
        ? run.inputs
        : JSON.stringify(run.inputs);
    }
    if (run.outputs) {
      traceSpan.output = typeof run.outputs === 'string'
        ? run.outputs
        : JSON.stringify(run.outputs);
    }
  }

  return traceSpan;
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
