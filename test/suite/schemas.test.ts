/**
 * Tests for Zod schema validation across all provider formats.
 */

import * as assert from 'assert';
import { parseOtelSpan, parseOtlpExport, reconstructMessages } from '../../schemas/openinference';
import { parseLangSmithRun } from '../../schemas/langsmith';
import { parseLangfuseObservation } from '../../schemas/langfuse';

suite('Schema Validation', () => {
  suite('OpenInference Schema', () => {
    test('should parse a valid OTel LLM span', () => {
      const rawSpan = {
        traceId: 'abc123',
        spanId: 'span456',
        name: 'ChatCompletion',
        kind: 3,
        startTimeUnixNano: '1672531200000000000',
        endTimeUnixNano: '1672531201000000000',
        attributes: [
          { key: 'openinference.span.kind', value: { stringValue: 'LLM' } },
          { key: 'llm.model_name', value: { stringValue: 'gpt-4o' } },
          { key: 'llm.token_count.prompt', value: { intValue: '150' } },
          { key: 'llm.token_count.completion', value: { intValue: '42' } },
        ],
        status: { code: 1 },
      };

      const result = parseOtelSpan(rawSpan);
      assert.ok(result, 'Should parse successfully');
      assert.strictEqual(result.id, 'span456');
      assert.strictEqual(result.traceId, 'abc123');
      assert.strictEqual(result.kind, 'llm');
      assert.strictEqual(result.status, 'success');
      assert.ok(result.llm, 'Should have LLM data');
      assert.strictEqual(result.llm!.model, 'gpt-4o');
      assert.strictEqual(result.llm!.tokenUsage.prompt, 150);
      assert.strictEqual(result.llm!.tokenUsage.completion, 42);
    });

    test('should handle missing attributes gracefully', () => {
      const rawSpan = {
        traceId: 'abc',
        spanId: 'def',
        name: 'test',
        startTimeUnixNano: '0',
        endTimeUnixNano: '1000000',
        status: { code: 0 },
      };

      const result = parseOtelSpan(rawSpan);
      assert.ok(result, 'Should parse span with minimal data');
      assert.strictEqual(result.kind, 'unknown');
    });

    test('should reject invalid span data', () => {
      const result = parseOtelSpan({ invalid: true });
      assert.strictEqual(result, undefined, 'Should return undefined for invalid data');
    });

    test('should parse full OTLP export', () => {
      const otlpExport = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'test-app' } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: 'test' },
                spans: [
                  {
                    traceId: 'trace1',
                    spanId: 'span1',
                    name: 'TestSpan',
                    startTimeUnixNano: '1000000000000000',
                    endTimeUnixNano: '2000000000000000',
                    attributes: [
                      { key: 'openinference.span.kind', value: { stringValue: 'CHAIN' } },
                    ],
                    status: { code: 1 },
                  },
                ],
              },
            ],
          },
        ],
      };

      const spans = parseOtlpExport(otlpExport);
      assert.strictEqual(spans.length, 1);
      assert.strictEqual(spans[0].kind, 'chain');
    });

    test('should reconstruct messages from flat attributes', () => {
      const attrs: Record<string, unknown> = {
        'llm.input_messages.0.message.role': 'system',
        'llm.input_messages.0.message.content': 'You are a helper.',
        'llm.input_messages.1.message.role': 'user',
        'llm.input_messages.1.message.content': 'Hello!',
      };

      const messages = reconstructMessages(attrs, 'llm.input_messages');
      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].role, 'system');
      assert.strictEqual(messages[0].content, 'You are a helper.');
      assert.strictEqual(messages[1].role, 'user');
      assert.strictEqual(messages[1].content, 'Hello!');
    });
  });

  suite('LangSmith Schema', () => {
    test('should parse a valid LangSmith run', () => {
      const run = {
        id: 'run-123',
        name: 'ChatOpenAI',
        run_type: 'llm',
        status: 'success',
        start_time: '2026-06-22T18:00:00Z',
        end_time: '2026-06-22T18:00:05Z',
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        trace_id: 'trace-abc',
        inputs: {
          messages: [[{ role: 'user', content: 'Hello' }]],
        },
        outputs: {
          generations: [[{ text: 'Hi!', message: { role: 'assistant', content: 'Hi!' } }]],
        },
        extra: {
          metadata: { model_name: 'gpt-4o' },
        },
      };

      const result = parseLangSmithRun(run);
      assert.ok(result, 'Should parse LangSmith run');
      assert.strictEqual(result.name, 'ChatOpenAI');
      assert.strictEqual(result.source, 'langsmith');
    });
  });

  suite('Langfuse Schema', () => {
    test('should parse a valid Langfuse observation', () => {
      const obs = {
        id: 'obs-123',
        traceId: 'trace-456',
        type: 'GENERATION',
        name: 'chat-completion',
        startTime: '2026-06-22T18:00:00.000Z',
        endTime: '2026-06-22T18:00:03.500Z',
        model: 'gpt-4o',
        input: [{ role: 'user', content: 'Hello' }],
        output: { role: 'assistant', content: 'Hi!' },
        usageDetails: { input: 28, output: 150 },
        level: 'DEFAULT',
      };

      const result = parseLangfuseObservation(obs);
      assert.ok(result, 'Should parse Langfuse observation');
      assert.strictEqual(result.name, 'chat-completion');
      assert.strictEqual(result.source, 'langfuse');
    });
  });
});
