/**
 * Extension-wide constants for Tracelet.
 * Centralizes all magic strings for commands, views, schemes, and config keys.
 */

// ─── Extension Identity ──────────────────────────────────────────────────────

export const EXTENSION_ID = 'tracelet';
export const EXTENSION_DISPLAY_NAME = 'Tracelet';
export const OUTPUT_CHANNEL_NAME = 'Tracelet';

// ─── URI Scheme ──────────────────────────────────────────────────────────────

export const TRACE_PREVIEW_SCHEME = 'ai-trace-preview';

// ─── Command IDs ─────────────────────────────────────────────────────────────

export const Commands = {
  FETCH_TRACES: 'tracelet.fetchTraces',
  SHOW_TRACES: 'tracelet.showTraces',
  OPEN_DIFF: 'tracelet.openDiff',
  OPEN_HYDRATED_PROMPT: 'tracelet.openHydratedPrompt',
  TOGGLE_HEATMAP: 'tracelet.toggleHeatmap',
  REFRESH_EXPLORER: 'tracelet.refreshExplorer',
  CLEAR_CACHE: 'tracelet.clearCache',
  OPEN_SETTINGS: 'tracelet.openSettings',
  OPEN_IN_DASHBOARD: 'tracelet.openInDashboard',
  SELECT_PROVIDER: 'tracelet.selectProvider',
  INSTALL_SDK: 'tracelet.installSdk',
} as const;

// ─── View IDs ────────────────────────────────────────────────────────────────

export const Views = {
  TRACE_EXPLORER: 'tracelet-explorer',
  SIDEBAR_CONTAINER: 'tracelet-sidebar',
} as const;

// ─── Configuration Keys ──────────────────────────────────────────────────────

export const ConfigKeys = {
  ACTIVE_PROVIDER: 'tracelet.activeProvider',
  OTEL_LOG_DIRECTORY: 'tracelet.otel.logDirectory',
  OTEL_FILE_PATTERN: 'tracelet.otel.filePattern',
  LANGSMITH_API_KEY: 'tracelet.langsmith.apiKey',
  LANGSMITH_BASE_URL: 'tracelet.langsmith.baseUrl',
  LANGSMITH_PROJECT_NAME: 'tracelet.langsmith.projectName',
  LANGFUSE_PUBLIC_KEY: 'tracelet.langfuse.publicKey',
  LANGFUSE_SECRET_KEY: 'tracelet.langfuse.secretKey',
  LANGFUSE_HOST: 'tracelet.langfuse.host',
  HEATMAP_ENABLED: 'tracelet.heatmap.enabled',
  HEATMAP_INTENSITY: 'tracelet.heatmap.intensity',
  CODELENS_ENABLED: 'tracelet.codeLens.enabled',
  AUTO_REFRESH_ENABLED: 'tracelet.autoRefresh.enabled',
  AUTO_REFRESH_INTERVAL: 'tracelet.autoRefresh.intervalSeconds',
  MAX_TRACES: 'tracelet.maxTraces',
  LOG_LEVEL: 'tracelet.logLevel',
} as const;

// ─── Context Values (for menu when-clauses) ──────────────────────────────────

export const ContextValues = {
  TRACE: 'trace',
  LLM_SPAN: 'llmSpan',
  CHAIN_SPAN: 'chainSpan',
  TOOL_SPAN: 'toolSpan',
  RETRIEVER_SPAN: 'retrieverSpan',
  EMBEDDING_SPAN: 'embeddingSpan',
  AGENT_SPAN: 'agentSpan',
  METADATA_ITEM: 'metadataItem',
} as const;

// ─── Default Values ──────────────────────────────────────────────────────────

export const Defaults = {
  LANGSMITH_BASE_URL: 'https://api.smith.langchain.com',
  LANGFUSE_HOST: 'https://cloud.langfuse.com',
  OTEL_FILE_PATTERN: '*.json',
  MAX_TRACES: 200,
  AUTO_REFRESH_INTERVAL_SECONDS: 30,
  HEATMAP_INTENSITY: 0.6,
  LOG_LEVEL: 'info' as const,
} as const;

// ─── OpenInference Attribute Keys ────────────────────────────────────────────

export const OIAttributes = {
  SPAN_KIND: 'openinference.span.kind',
  LLM_MODEL_NAME: 'llm.model_name',
  LLM_PROVIDER: 'llm.provider',
  LLM_SYSTEM: 'llm.system',
  LLM_INVOCATION_PARAMETERS: 'llm.invocation_parameters',
  LLM_INPUT_MESSAGES: 'llm.input_messages',
  LLM_OUTPUT_MESSAGES: 'llm.output_messages',
  LLM_TOKEN_COUNT_PROMPT: 'llm.token_count.prompt',
  LLM_TOKEN_COUNT_COMPLETION: 'llm.token_count.completion',
  LLM_TOKEN_COUNT_TOTAL: 'llm.token_count.total',
  LLM_PROMPT_TEMPLATE: 'llm.prompt_template.template',
  LLM_PROMPT_TEMPLATE_VARIABLES: 'llm.prompt_template.variables',
  INPUT_VALUE: 'input.value',
  INPUT_MIME_TYPE: 'input.mime_type',
  OUTPUT_VALUE: 'output.value',
  OUTPUT_MIME_TYPE: 'output.mime_type',
  RETRIEVAL_DOCUMENTS: 'retrieval.documents',
  EMBEDDING_MODEL_NAME: 'embedding.model_name',
  TOOL_NAME: 'tool.name',
  TOOL_DESCRIPTION: 'tool.description',
  TOOL_PARAMETERS: 'tool.parameters',
  SESSION_ID: 'session.id',
  USER_ID: 'user.id',
  TAG_TAGS: 'tag.tags',
  METADATA: 'metadata',
} as const;
