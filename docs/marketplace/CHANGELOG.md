# Changelog

All notable changes to the Tracelet extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-22

### Added

- **CodeLens Integration** — Detects LLM invocations (OpenAI, Anthropic, LangChain, LlamaIndex, Vercel AI SDK) in Python and TypeScript/JavaScript files. Clickable annotations above function calls link directly to trace data.

- **Native Prompt Diff Analyzer** — Side-by-side comparison of static prompt templates vs. runtime-hydrated prompts using VS Code's built-in diff editor. See exactly what was sent to the LLM.

- **Virtual Trace Documents** — Runtime payloads served as read-only virtual documents via custom `ai-trace-preview:` URI scheme. No file clutter in your workspace.

- **Inline Token Heatmaps** — Color-coded editor decorations showing token consumption per code region. 10-level color gradient from cool blue to hot red with hover tooltips showing detailed metrics.

- **Trace Explorer Sidebar** — Dedicated activity bar panel with hierarchical tree view. Browse traces organized as span trees with icons for each span kind (LLM, Chain, Tool, Retriever, Agent).

- **Rich Trace Detail Panel** — Interactive webview with waterfall/Gantt timeline visualization, token usage charts, and formatted message display.

- **Multiple Backend Support**
  - **Demo Mode** — Built-in synthetic traces for immediate exploration
  - **OpenTelemetry (Local)** — Read from local OTLP JSON export files
  - **LangSmith** — Direct API integration with authentication and rate limiting
  - **Langfuse** — Direct API integration with Basic auth

- **Zod Schema Validation** — Runtime validation of all incoming trace data using Zod schemas matching OpenInference, LangSmith, and Langfuse formats.

- **Source Code Mapping** — Automatic mapping of trace spans to local source code using function name matching and attribute-based detection.

- **Provider Selection** — Quick-pick provider switching and configuration via VS Code settings.

### Technical

- TypeScript codebase with strict type checking
- esbuild bundler for fast, lightweight extension loading (< 300KB bundled)
- Comprehensive configuration system with 15+ settings
- Status bar with real-time connection status
- Auto-refresh capability with configurable intervals
