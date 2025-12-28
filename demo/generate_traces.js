/**
 * Tracelet Demo — Trace Generator
 *
 * Generates realistic OTLP JSON trace files with OpenInference attributes.
 * These files are read by Tracelet's OTel local file provider, exercising
 * every feature through the real production code path.
 *
 * Usage:
 *   node generate_traces.js
 *
 * Output:
 *   ./traces/*.json  — OTLP JSON trace files
 *
 * No dependencies required — uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Helpers ────────────────────────────────────────────────────────────────

function hexId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function traceId() {
  return hexId(16); // 32 hex chars
}

function spanId() {
  return hexId(8); // 16 hex chars
}

function nowNano() {
  return BigInt(Date.now()) * BigInt(1_000_000);
}

function msToNano(ms) {
  return BigInt(ms) * BigInt(1_000_000);
}

function attr(key, value) {
  if (typeof value === 'string') {
    return { key, value: { stringValue: value } };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { key, value: { intValue: String(value) } };
    }
    return { key, value: { doubleValue: value } };
  }
  if (typeof value === 'boolean') {
    return { key, value: { boolValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
}

/**
 * Encode messages in OpenInference dot-notation format.
 * llm.input_messages.0.message.role = "system"
 * llm.input_messages.0.message.content = "You are..."
 */
function encodeMessages(prefix, messages) {
  const attrs = [];
  messages.forEach((msg, i) => {
    attrs.push(attr(`${prefix}.${i}.message.role`, msg.role));
    if (msg.content) {
      attrs.push(attr(`${prefix}.${i}.message.content`, msg.content));
    }
    if (msg.tool_calls) {
      msg.tool_calls.forEach((tc, j) => {
        if (tc.id) attrs.push(attr(`${prefix}.${i}.message.tool_calls.${j}.tool_call.id`, tc.id));
        attrs.push(attr(`${prefix}.${i}.message.tool_calls.${j}.tool_call.function.name`, tc.function.name));
        attrs.push(attr(`${prefix}.${i}.message.tool_calls.${j}.tool_call.function.arguments`, tc.function.arguments));
      });
    }
  });
  return attrs;
}

function makeSpan({ name, traceIdVal, spanIdVal, parentSpanId, kind, status, startNano, endNano, attributes }) {
  const span = {
    traceId: traceIdVal,
    spanId: spanIdVal,
    name,
    kind: 3, // SPAN_KIND_CLIENT
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: endNano.toString(),
    attributes: attributes || [],
    status: { code: status === 'error' ? 2 : 1 },
    events: [],
    links: [],
  };
  if (parentSpanId) {
    span.parentSpanId = parentSpanId;
  }
  return span;
}

function wrapOtlp(spans, serviceName = 'tracelet-demo-app') {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr('service.name', serviceName),
            attr('service.version', '1.0.0'),
            attr('telemetry.sdk.language', 'python'),
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: 'openinference.instrumentation',
              version: '0.1.0',
            },
            spans,
          },
        ],
      },
    ],
  };
}

// ─── Demo source file paths (for source mapping) ───────────────────────────

const DEMO_DIR = __dirname;
const RAG_FILE = path.resolve(DEMO_DIR, 'sample_rag_app.py');
const AGENT_FILE = path.resolve(DEMO_DIR, 'sample_agent.py');
const CHAT_FILE = path.resolve(DEMO_DIR, 'sample_chat.ts');

// ─── Scenario 1: RAG Pipeline ──────────────────────────────────────────────

function createRagPipeline() {
  const tid = traceId();
  const baseTime = nowNano() - msToNano(180_000);
  const spans = [];

  // 1. embed_query
  const embedSid = spanId();
  spans.push(makeSpan({
    name: 'embed_query',
    traceIdVal: tid,
    spanIdVal: embedSid,
    kind: 'embedding',
    status: 'ok',
    startNano: baseTime,
    endNano: baseTime + msToNano(120),
    attributes: [
      attr('openinference.span.kind', 'EMBEDDING'),
      attr('embedding.model_name', 'text-embedding-3-small'),
      attr('input.value', 'How does transformer attention mechanism work?'),
      attr('output.value', '[0.0234, -0.0891, 0.1456, ...]  (1536 dimensions)'),
      attr('code.filepath', RAG_FILE),
      attr('code.function', 'embed_query'),
      attr('code.lineno', 14),
    ],
  }));

  // 2. vector_search
  const searchSid = spanId();
  spans.push(makeSpan({
    name: 'vector_search',
    traceIdVal: tid,
    spanIdVal: searchSid,
    parentSpanId: embedSid,
    kind: 'retriever',
    status: 'ok',
    startNano: baseTime + msToNano(130),
    endNano: baseTime + msToNano(480),
    attributes: [
      attr('openinference.span.kind', 'RETRIEVER'),
      attr('input.value', 'query_embedding: [0.0234, -0.0891, ...]'),
      attr('output.value', '5 documents retrieved (scores: 0.94, 0.91, 0.87, 0.82, 0.78)'),
      attr('code.filepath', RAG_FILE),
      attr('code.function', 'vector_search'),
      attr('code.lineno', 22),
    ],
  }));

  // 3. rerank_documents
  const rerankSid = spanId();
  spans.push(makeSpan({
    name: 'rerank_documents',
    traceIdVal: tid,
    spanIdVal: rerankSid,
    parentSpanId: searchSid,
    kind: 'chain',
    status: 'ok',
    startNano: baseTime + msToNano(490),
    endNano: baseTime + msToNano(720),
    attributes: [
      attr('openinference.span.kind', 'CHAIN'),
      attr('input.value', '5 candidate documents'),
      attr('output.value', '3 documents after reranking (scores: 0.97, 0.93, 0.89)'),
      attr('code.filepath', RAG_FILE),
      attr('code.function', 'rerank_documents'),
      attr('code.lineno', 31),
    ],
  }));

  // 4. format_context
  const formatSid = spanId();
  spans.push(makeSpan({
    name: 'format_context',
    traceIdVal: tid,
    spanIdVal: formatSid,
    parentSpanId: rerankSid,
    kind: 'chain',
    status: 'ok',
    startNano: baseTime + msToNano(730),
    endNano: baseTime + msToNano(745),
    attributes: [
      attr('openinference.span.kind', 'CHAIN'),
      attr('input.value', '3 reranked documents'),
      attr('output.value', 'Formatted context string (2,340 characters)'),
      attr('code.filepath', RAG_FILE),
      attr('code.function', 'format_context'),
      attr('code.lineno', 40),
    ],
  }));

  // 5. generate_answer — the LLM span (most detailed)
  const genSid = spanId();
  const inputMessages = [
    {
      role: 'system',
      content: 'You are an expert AI researcher. Use the following context to answer the user\'s question accurately and concisely.\n\n---\nContext:\nThe transformer architecture, introduced in "Attention Is All You Need" (Vaswani et al., 2017), relies on a self-attention mechanism that computes relationships between all pairs of positions in a sequence. The attention function maps a query and a set of key-value pairs to an output, where the output is a weighted sum of the values. The weights are computed by a compatibility function of the query with the corresponding key.\n\nMulti-head attention allows the model to jointly attend to information from different representation subspaces at different positions. Instead of performing a single attention function, multi-head attention linearly projects the queries, keys, and values h times with different learned projections.\n\nThe scaled dot-product attention is computed as: Attention(Q,K,V) = softmax(QK^T / sqrt(d_k))V, where d_k is the dimension of the keys.\n---\n\nProvide clear explanations with examples where helpful.',
    },
    {
      role: 'user',
      content: 'How does transformer attention mechanism work?',
    },
  ];

  const outputMessages = [
    {
      role: 'assistant',
      content: 'The transformer attention mechanism works through a process called **self-attention** (or scaled dot-product attention), which allows the model to weigh the importance of different parts of the input when processing each element.\n\n## How It Works\n\n**1. Query, Key, Value Projections**\nFor each input token, three vectors are created:\n- **Query (Q)**: What this token is looking for\n- **Key (K)**: What this token contains\n- **Value (V)**: The actual information to pass forward\n\n**2. Attention Score Computation**\nThe attention score between two tokens is computed as the dot product of the query of one token with the key of another, scaled by √d_k:\n\n```\nAttention(Q, K, V) = softmax(QK^T / √d_k) × V\n```\n\n**3. Multi-Head Attention**\nRather than computing attention once, transformers use multiple "heads" that each learn different attention patterns. This allows the model to simultaneously attend to information from different representation subspaces.\n\nFor example, in the sentence "The cat sat on the mat because it was tired," one head might learn that "it" refers to "cat," while another head might focus on the spatial relationship between "sat" and "mat."',
    },
  ];

  spans.push(makeSpan({
    name: 'generate_answer',
    traceIdVal: tid,
    spanIdVal: genSid,
    parentSpanId: formatSid,
    kind: 'llm',
    status: 'ok',
    startNano: baseTime + msToNano(750),
    endNano: baseTime + msToNano(3200),
    attributes: [
      attr('openinference.span.kind', 'LLM'),
      attr('llm.model_name', 'gpt-4o'),
      attr('llm.provider', 'openai'),
      attr('llm.token_count.prompt', 2543),
      attr('llm.token_count.completion', 847),
      attr('llm.token_count.total', 3390),
      attr('llm.invocation_parameters', JSON.stringify({ temperature: 0.3, max_tokens: 1024 })),
      attr('llm.prompt_template.template',
        'You are an expert AI researcher. Use the following context to answer the user\'s question accurately and concisely.\n\n---\nContext:\n{{context}}\n---\n\n{{system_instruction}}'),
      attr('llm.prompt_template.variables', JSON.stringify({
        context: 'The transformer architecture, introduced in "Attention Is All You Need" (Vaswani et al., 2017), relies on a self-attention mechanism...',
        system_instruction: 'Provide clear explanations with examples where helpful.',
        user_query: 'How does transformer attention mechanism work?',
      })),
      ...encodeMessages('llm.input_messages', inputMessages),
      ...encodeMessages('llm.output_messages', outputMessages),
      attr('code.filepath', RAG_FILE),
      attr('code.function', 'generate_answer'),
      attr('code.lineno', 49),
    ],
  }));

  return spans;
}

// ─── Scenario 2: Agent Tool-Calling Workflow ────────────────────────────────

function createAgentWorkflow() {
  const tid = traceId();
  const baseTime = nowNano() - msToNano(90_000);
  const spans = [];

  // 1. plan_action (LLM span with tool calls)
  const planSid = spanId();
  const planInput = [
    {
      role: 'system',
      content: 'You are a research assistant agent. You have access to the following tools:\n\n1. web_search(query: string) - Search the web for information\n2. calculator(expression: string) - Evaluate mathematical expressions\n3. code_interpreter(code: string) - Execute Python code\n\nAnalyze the user\'s request and decide which tools to use.',
    },
    {
      role: 'user',
      content: 'What is the current market cap of NVIDIA and how does it compare to Apple? Calculate the percentage difference.',
    },
  ];

  const planOutput = [
    {
      role: 'assistant',
      content: 'I\'ll help you compare NVIDIA and Apple\'s market caps. Let me search for the latest data.',
      tool_calls: [
        {
          id: 'call_001',
          function: { name: 'web_search', arguments: '{"query": "NVIDIA current market cap 2026"}' },
        },
        {
          id: 'call_002',
          function: { name: 'web_search', arguments: '{"query": "Apple current market cap 2026"}' },
        },
      ],
    },
  ];

  spans.push(makeSpan({
    name: 'plan_action',
    traceIdVal: tid,
    spanIdVal: planSid,
    kind: 'llm',
    status: 'ok',
    startNano: baseTime,
    endNano: baseTime + msToNano(1800),
    attributes: [
      attr('openinference.span.kind', 'LLM'),
      attr('llm.model_name', 'claude-3-5-sonnet-20241022'),
      attr('llm.provider', 'anthropic'),
      attr('llm.token_count.prompt', 1856),
      attr('llm.token_count.completion', 342),
      attr('llm.token_count.total', 2198),
      attr('llm.invocation_parameters', JSON.stringify({ temperature: 0.1, max_tokens: 2048 })),
      ...encodeMessages('llm.input_messages', planInput),
      ...encodeMessages('llm.output_messages', planOutput),
      attr('code.filepath', AGENT_FILE),
      attr('code.function', 'plan_action'),
      attr('code.lineno', 18),
    ],
  }));

  // 2. web_search (tool span)
  const searchSid = spanId();
  spans.push(makeSpan({
    name: 'web_search',
    traceIdVal: tid,
    spanIdVal: searchSid,
    parentSpanId: planSid,
    kind: 'tool',
    status: 'ok',
    startNano: baseTime + msToNano(1810),
    endNano: baseTime + msToNano(2900),
    attributes: [
      attr('openinference.span.kind', 'TOOL'),
      attr('tool.name', 'web_search'),
      attr('tool.description', 'Search the web for information'),
      attr('input.value', '{"query": "NVIDIA current market cap 2026"}'),
      attr('output.value', 'NVIDIA Corporation (NVDA) market capitalization: $4.2 trillion as of June 2026, making it the most valuable company globally...'),
      attr('code.filepath', AGENT_FILE),
      attr('code.function', 'web_search'),
      attr('code.lineno', 35),
    ],
  }));

  // 3. parse_results (chain span)
  const parseSid = spanId();
  spans.push(makeSpan({
    name: 'parse_results',
    traceIdVal: tid,
    spanIdVal: parseSid,
    parentSpanId: searchSid,
    kind: 'chain',
    status: 'ok',
    startNano: baseTime + msToNano(2910),
    endNano: baseTime + msToNano(2960),
    attributes: [
      attr('openinference.span.kind', 'CHAIN'),
      attr('input.value', 'Raw search results (2 queries)'),
      attr('output.value', 'Parsed: NVIDIA=$4.2T, Apple=$3.8T'),
      attr('code.filepath', AGENT_FILE),
      attr('code.function', 'parse_results'),
      attr('code.lineno', 45),
    ],
  }));

  // 4. synthesize_response (LLM span)
  const synthSid = spanId();
  const synthInput = [
    { role: 'system', content: 'Synthesize the search results into a clear, factual response.' },
    {
      role: 'user',
      content: 'Search results:\n- NVIDIA (NVDA): Market cap $4.2 trillion (June 2026)\n- Apple (AAPL): Market cap $3.8 trillion (June 2026)\n\nOriginal question: What is the current market cap of NVIDIA and how does it compare to Apple? Calculate the percentage difference.',
    },
  ];
  const synthOutput = [
    {
      role: 'assistant',
      content: "## Market Cap Comparison: NVIDIA vs Apple (June 2026)\n\n| Company | Market Cap |\n|---------|------------|\n| **NVIDIA (NVDA)** | $4.2 trillion |\n| **Apple (AAPL)** | $3.8 trillion |\n\n### Percentage Difference\nNVIDIA's market cap is approximately **10.5% higher** than Apple's:\n\n```\n((4.2 - 3.8) / 3.8) × 100 = 10.53%\n```\n\nNVIDIA surpassed Apple as the world's most valuable company, driven primarily by the explosive demand for AI accelerator chips (H100, B200, and the latest Blackwell Ultra GPUs).",
    },
  ];

  spans.push(makeSpan({
    name: 'synthesize_response',
    traceIdVal: tid,
    spanIdVal: synthSid,
    parentSpanId: parseSid,
    kind: 'llm',
    status: 'ok',
    startNano: baseTime + msToNano(2970),
    endNano: baseTime + msToNano(4800),
    attributes: [
      attr('openinference.span.kind', 'LLM'),
      attr('llm.model_name', 'claude-3-5-sonnet-20241022'),
      attr('llm.provider', 'anthropic'),
      attr('llm.token_count.prompt', 1245),
      attr('llm.token_count.completion', 523),
      attr('llm.token_count.total', 1768),
      attr('llm.invocation_parameters', JSON.stringify({ temperature: 0.2, max_tokens: 1024 })),
      ...encodeMessages('llm.input_messages', synthInput),
      ...encodeMessages('llm.output_messages', synthOutput),
      attr('code.filepath', AGENT_FILE),
      attr('code.function', 'synthesize_response'),
      attr('code.lineno', 56),
    ],
  }));

  return spans;
}

// ─── Scenario 3: Simple Chat Completion ────────────────────────────────────

function createSimpleChat() {
  const tid = traceId();
  const baseTime = nowNano() - msToNano(30_000);

  const inputMsgs = [
    { role: 'system', content: 'You are a concise coding assistant. Answer briefly.' },
    { role: 'user', content: 'What is a Python decorator?' },
  ];
  const outputMsgs = [
    {
      role: 'assistant',
      content: 'A **decorator** is a function that wraps another function to extend its behavior without modifying its code. It uses the `@` syntax:\n\n```python\ndef log_calls(func):\n    def wrapper(*args, **kwargs):\n        print(f"Calling {func.__name__}")\n        return func(*args, **kwargs)\n    return wrapper\n\n@log_calls\ndef greet(name):\n    return f"Hello, {name}!"\n```\n\nWhen you call `greet("Alice")`, it prints "Calling greet" then returns "Hello, Alice!".',
    },
  ];

  return [makeSpan({
    name: 'chat_completion',
    traceIdVal: tid,
    spanIdVal: spanId(),
    kind: 'llm',
    status: 'ok',
    startNano: baseTime,
    endNano: baseTime + msToNano(650),
    attributes: [
      attr('openinference.span.kind', 'LLM'),
      attr('llm.model_name', 'gpt-4o-mini'),
      attr('llm.provider', 'openai'),
      attr('llm.token_count.prompt', 89),
      attr('llm.token_count.completion', 156),
      attr('llm.token_count.total', 245),
      attr('llm.invocation_parameters', JSON.stringify({ temperature: 0.5, max_tokens: 512 })),
      ...encodeMessages('llm.input_messages', inputMsgs),
      ...encodeMessages('llm.output_messages', outputMsgs),
      attr('code.filepath', CHAT_FILE),
      attr('code.function', 'chatCompletion'),
      attr('code.lineno', 10),
    ],
  })];
}

// ─── Generate & Write ──────────────────────────────────────────────────────

const TRACES_DIR = path.join(__dirname, 'traces');

// Ensure output directory exists
if (!fs.existsSync(TRACES_DIR)) {
  fs.mkdirSync(TRACES_DIR, { recursive: true });
}

// Generate all three scenarios
const ragSpans = createRagPipeline();
const agentSpans = createAgentWorkflow();
const chatSpans = createSimpleChat();

// Write each scenario as a separate OTLP JSON file
fs.writeFileSync(
  path.join(TRACES_DIR, 'rag_pipeline.json'),
  JSON.stringify(wrapOtlp(ragSpans, 'rag-pipeline-app'), null, 2),
);

fs.writeFileSync(
  path.join(TRACES_DIR, 'agent_workflow.json'),
  JSON.stringify(wrapOtlp(agentSpans, 'agent-app'), null, 2),
);

fs.writeFileSync(
  path.join(TRACES_DIR, 'chat_completion.json'),
  JSON.stringify(wrapOtlp(chatSpans, 'chat-app'), null, 2),
);

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           Tracelet Demo Traces Generated ✓                  ║');
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log('║                                                              ║');
console.log(`║  Output: ${TRACES_DIR}`);
console.log('║                                                              ║');
console.log(`║  • rag_pipeline.json    — 5 spans (embed → search → LLM)    ║`);
console.log(`║  • agent_workflow.json  — 4 spans (plan → tools → LLM)      ║`);
console.log(`║  • chat_completion.json — 1 span  (simple chat)             ║`);
console.log('║                                                              ║');
console.log('║  Next steps:                                                 ║');
console.log('║  1. Open this folder in VS Code                             ║');
console.log('║  2. Set tracelet.otel.logDirectory to "./demo/traces"       ║');
console.log('║  3. Run "Tracelet: Fetch Latest Traces" (Ctrl+Shift+T)      ║');
console.log('║  4. Open sample_rag_app.py to see CodeLens + Heatmap        ║');
console.log('║                                                              ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
