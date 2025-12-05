/**
 * Pattern registry for detecting LLM invocations in source code.
 * Each pattern maps a regex to an SDK name, language, and expected span kind.
 */

import type { SpanKind } from '../types';

// ─── Pattern Interface ───────────────────────────────────────────────────────

/** Describes a regex pattern that identifies an LLM SDK invocation in source code */
export interface InvocationPattern {
  /** Regex to match against a single line of source code */
  regex: RegExp;
  /** Programming language this pattern applies to */
  language: 'python' | 'typescript' | 'javascript';
  /** Name of the LLM SDK / framework */
  sdkName: string;
  /** Human-readable description of what the pattern matches */
  description: string;
  /** Suggested span kind when this pattern is matched */
  spanKindHint: SpanKind;
}

// ─── Python Patterns ─────────────────────────────────────────────────────────

const pythonPatterns: InvocationPattern[] = [
  // OpenAI
  {
    regex: /client\.chat\.completions\.create\s*\(/,
    language: 'python',
    sdkName: 'openai',
    description: 'OpenAI chat completions (v1+ SDK)',
    spanKindHint: 'llm',
  },
  {
    regex: /openai\.ChatCompletion\.create\s*\(/,
    language: 'python',
    sdkName: 'openai',
    description: 'OpenAI chat completion (legacy SDK)',
    spanKindHint: 'llm',
  },
  // Anthropic
  {
    regex: /client\.messages\.create\s*\(/,
    language: 'python',
    sdkName: 'anthropic',
    description: 'Anthropic messages API',
    spanKindHint: 'llm',
  },
  {
    regex: /anthropic\.Anthropic\s*\(/,
    language: 'python',
    sdkName: 'anthropic',
    description: 'Anthropic client instantiation',
    spanKindHint: 'llm',
  },
  // LangChain
  {
    regex: /ChatOpenAI\s*\(/,
    language: 'python',
    sdkName: 'langchain',
    description: 'LangChain ChatOpenAI model',
    spanKindHint: 'llm',
  },
  {
    regex: /ChatAnthropic\s*\(/,
    language: 'python',
    sdkName: 'langchain',
    description: 'LangChain ChatAnthropic model',
    spanKindHint: 'llm',
  },
  {
    regex: /\.invoke\s*\(/,
    language: 'python',
    sdkName: 'langchain',
    description: 'LangChain runnable invoke',
    spanKindHint: 'chain',
  },
  {
    regex: /RunnableSequence/,
    language: 'python',
    sdkName: 'langchain',
    description: 'LangChain RunnableSequence pipeline',
    spanKindHint: 'chain',
  },
  {
    regex: /chain\.invoke\s*\(/,
    language: 'python',
    sdkName: 'langchain',
    description: 'LangChain chain invoke',
    spanKindHint: 'chain',
  },
  // LlamaIndex
  {
    regex: /llm\.complete\s*\(/,
    language: 'python',
    sdkName: 'llamaindex',
    description: 'LlamaIndex LLM complete',
    spanKindHint: 'llm',
  },
  {
    regex: /llm\.chat\s*\(/,
    language: 'python',
    sdkName: 'llamaindex',
    description: 'LlamaIndex LLM chat',
    spanKindHint: 'llm',
  },
  {
    regex: /\.as_query_engine\s*\(/,
    language: 'python',
    sdkName: 'llamaindex',
    description: 'LlamaIndex query engine',
    spanKindHint: 'retriever',
  },
  // Decorators
  {
    regex: /@traceable/,
    language: 'python',
    sdkName: 'langsmith',
    description: 'LangSmith @traceable decorator',
    spanKindHint: 'chain',
  },
  {
    regex: /@observe/,
    language: 'python',
    sdkName: 'langfuse',
    description: 'Langfuse @observe decorator',
    spanKindHint: 'chain',
  },
  // Vercel / misc
  {
    regex: /\bgenerate\s*\(/,
    language: 'python',
    sdkName: 'vercel-ai',
    description: 'Vercel AI generate call',
    spanKindHint: 'llm',
  },
  {
    regex: /\bagenerate\s*\(/,
    language: 'python',
    sdkName: 'vercel-ai',
    description: 'Async generate call',
    spanKindHint: 'llm',
  },
];

// ─── TypeScript Patterns ─────────────────────────────────────────────────────

const typescriptPatterns: InvocationPattern[] = [
  // OpenAI
  {
    regex: /openai\.chat\.completions\.create\s*\(/,
    language: 'typescript',
    sdkName: 'openai',
    description: 'OpenAI chat completions',
    spanKindHint: 'llm',
  },
  {
    regex: /new\s+OpenAI\s*\(/,
    language: 'typescript',
    sdkName: 'openai',
    description: 'OpenAI client instantiation',
    spanKindHint: 'llm',
  },
  // Anthropic
  {
    regex: /anthropic\.messages\.create\s*\(/,
    language: 'typescript',
    sdkName: 'anthropic',
    description: 'Anthropic messages API',
    spanKindHint: 'llm',
  },
  {
    regex: /new\s+Anthropic\s*\(/,
    language: 'typescript',
    sdkName: 'anthropic',
    description: 'Anthropic client instantiation',
    spanKindHint: 'llm',
  },
  // LangChain
  {
    regex: /ChatOpenAI/,
    language: 'typescript',
    sdkName: 'langchain',
    description: 'LangChain ChatOpenAI model',
    spanKindHint: 'llm',
  },
  {
    regex: /\.invoke\s*\(/,
    language: 'typescript',
    sdkName: 'langchain',
    description: 'LangChain runnable invoke',
    spanKindHint: 'chain',
  },
  {
    regex: /\.stream\s*\(/,
    language: 'typescript',
    sdkName: 'langchain',
    description: 'LangChain runnable stream',
    spanKindHint: 'chain',
  },
  // Vercel AI SDK
  {
    regex: /generateText\s*\(/,
    language: 'typescript',
    sdkName: 'vercel-ai',
    description: 'Vercel AI SDK generateText',
    spanKindHint: 'llm',
  },
  {
    regex: /streamText\s*\(/,
    language: 'typescript',
    sdkName: 'vercel-ai',
    description: 'Vercel AI SDK streamText',
    spanKindHint: 'llm',
  },
  {
    regex: /generateObject\s*\(/,
    language: 'typescript',
    sdkName: 'vercel-ai',
    description: 'Vercel AI SDK generateObject',
    spanKindHint: 'llm',
  },
  // Generic decorators
  {
    regex: /@traceable/,
    language: 'typescript',
    sdkName: 'langsmith',
    description: 'LangSmith @traceable decorator',
    spanKindHint: 'chain',
  },
  {
    regex: /@observe/,
    language: 'typescript',
    sdkName: 'langfuse',
    description: 'Langfuse @observe decorator',
    spanKindHint: 'chain',
  },
];

// ─── JavaScript Patterns ─────────────────────────────────────────────────────
// JavaScript shares patterns with TypeScript but tagged with 'javascript' language.

const javascriptPatterns: InvocationPattern[] = typescriptPatterns.map((p) => ({
  ...p,
  language: 'javascript' as const,
}));

// ─── Pattern Lookup ──────────────────────────────────────────────────────────

/** Map of VS Code language IDs to their pattern arrays */
const patternsByLanguage: Record<string, InvocationPattern[]> = {
  python: pythonPatterns,
  typescript: typescriptPatterns,
  javascript: javascriptPatterns,
};

/**
 * Returns invocation patterns for the given VS Code language identifier.
 * @param langId - VS Code language ID (e.g., 'python', 'typescript')
 * @returns Array of patterns applicable to the language, or empty array if unsupported
 */
export function getPatternsByLanguage(langId: string): InvocationPattern[] {
  return patternsByLanguage[langId] ?? [];
}

/**
 * Returns all invocation patterns across every supported language.
 * @returns Combined array of all registered patterns
 */
export function getAllPatterns(): InvocationPattern[] {
  return [...pythonPatterns, ...typescriptPatterns, ...javascriptPatterns];
}
