/**
 * Tests for the LLM invocation pattern detector.
 * Verifies detection across Python, TypeScript, and JavaScript patterns.
 */

import * as assert from 'assert';
import { getPatternsByLanguage, getAllPatterns } from '../../codelens/patterns';

suite('CodeLens Pattern Detection', () => {
  suite('Pattern Registry', () => {
    test('should have patterns for Python', () => {
      const patterns = getPatternsByLanguage('python');
      assert.ok(patterns.length > 0, 'Expected Python patterns');
    });

    test('should have patterns for TypeScript', () => {
      const patterns = getPatternsByLanguage('typescript');
      assert.ok(patterns.length > 0, 'Expected TypeScript patterns');
    });

    test('should have patterns for JavaScript', () => {
      const patterns = getPatternsByLanguage('javascript');
      assert.ok(patterns.length > 0, 'Expected JavaScript patterns');
    });

    test('should return empty array for unsupported language', () => {
      const patterns = getPatternsByLanguage('rust');
      assert.strictEqual(patterns.length, 0);
    });

    test('should return all patterns', () => {
      const all = getAllPatterns();
      assert.ok(all.length > 10, 'Expected many patterns across all languages');
    });
  });

  suite('Python Pattern Matching', () => {
    const pythonPatterns = getPatternsByLanguage('python');

    test('should detect OpenAI chat.completions.create', () => {
      const line = 'response = client.chat.completions.create(model="gpt-4o", messages=messages)';
      const matched = pythonPatterns.some((p) => p.regex.test(line));
      assert.ok(matched, 'Should detect OpenAI chat completion');
    });

    test('should detect Anthropic messages.create', () => {
      const line = 'message = client.messages.create(model="claude-3", messages=msgs)';
      const matched = pythonPatterns.some((p) => p.regex.test(line));
      assert.ok(matched, 'Should detect Anthropic messages');
    });

    test('should detect LangChain ChatOpenAI', () => {
      const line = 'llm = ChatOpenAI(model="gpt-4o", temperature=0.7)';
      const matched = pythonPatterns.some((p) => p.regex.test(line));
      assert.ok(matched, 'Should detect LangChain ChatOpenAI');
    });

    test('should detect @traceable decorator', () => {
      const line = '@traceable(run_type="llm")';
      const matched = pythonPatterns.some((p) => p.regex.test(line));
      assert.ok(matched, 'Should detect @traceable decorator');
    });

    test('should detect @observe decorator', () => {
      const line = '@observe()';
      const matched = pythonPatterns.some((p) => p.regex.test(line));
      assert.ok(matched, 'Should detect @observe decorator');
    });
  });

  suite('TypeScript Pattern Matching', () => {
    const tsPatterns = getPatternsByLanguage('typescript');

    test('should detect OpenAI chat.completions.create', () => {
      const line = 'const response = await openai.chat.completions.create({ model: "gpt-4o" });';
      const matched = tsPatterns.some((p) => p.regex.test(line));
      assert.ok(matched, 'Should detect OpenAI TS pattern');
    });

    test('should detect generateText from Vercel AI SDK', () => {
      const line = 'const result = await generateText({ model: openai("gpt-4o") });';
      const matched = tsPatterns.some((p) => p.regex.test(line));
      assert.ok(matched, 'Should detect Vercel AI generateText');
    });

    test('should detect streamText from Vercel AI SDK', () => {
      const line = 'const stream = await streamText({ model: anthropic("claude-3") });';
      const matched = tsPatterns.some((p) => p.regex.test(line));
      assert.ok(matched, 'Should detect Vercel AI streamText');
    });
  });
});
