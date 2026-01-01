# Tracelet

**Bridge LLM observability platforms with your IDE.**

Tracelet is a native VS Code extension built for AI engineers, LLMOps practitioners, and backend developers. It acts as a direct bridge between cloud-based LLM observability platforms and the local development environment, drastically reducing the friction of debugging complex AI workflows.

![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/tracelet.tracelet?style=flat-square&label=VS%20Code%20Marketplace&color=007ACC)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-supported-blueviolet?style=flat-square)

---

## ✨ Features

### 🗺️ Native Prompt Diff Analyzer

Side-by-side comparison of your static prompt templates vs. the fully hydrated prompts sent to the LLM at runtime. Uses VS Code's native diff editor — no clunky external tools.

**Left panel:** Your template with `{{variable}}` placeholders
**Right panel:** The exact prompt transmitted to the LLM API

### 📄 Virtual Trace Documents

Runtime payloads are served into temporary virtual tabs using a custom `ai-trace-preview:` URI scheme. No massive JSON logs cluttering your workspace.

### 🔎 Actionable CodeLens Integration

Tracelet scans Python and TypeScript files for standard LLM invocation signatures (OpenAI, Anthropic, LangChain, LlamaIndex, Vercel AI SDK) and injects a clickable CodeLens directly above function definitions. One click to view the most recent execution traces.

**Detected patterns include:**
- `client.chat.completions.create()` (OpenAI)
- `client.messages.create()` (Anthropic)
- `chain.invoke()`, `llm.invoke()` (LangChain)
- `generateText()`, `streamText()` (Vercel AI SDK)
- `@traceable`, `@observe` decorators

### 🔥 Inline Token Heatmaps

Visual overlay highlighting token consumption intensity per code region. Color-coded from cool blue (low usage) to hot red (high usage), with hover tooltips showing exact token counts and percentages.

### 🌳 Trace Explorer Sidebar

Dedicated activity bar panel for browsing traces in a hierarchical tree view. Traces are organized as a span tree with icons for each span kind (LLM, Chain, Tool, Retriever, Agent).

### 📊 Rich Trace Detail Panel

Interactive webview showing a waterfall/Gantt timeline of all spans in a trace, with clickable navigation to source code.

---

## 🔌 Supported Backends

| Backend | Status | Auth Method |
|---------|--------|-------------|
| **Demo Mode** | ✅ Built-in | None required |
| **OpenTelemetry (Local)** | ✅ Supported | Read from local OTLP JSON files |
| **LangSmith** | ✅ Supported | API Key (`x-api-key`) |
| **Langfuse** | ✅ Supported | Public Key + Secret Key (Basic Auth) |

---

## 🚀 Quick Start

### 1. Install

Search for **Tracelet** in the VS Code Extensions sidebar, or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=tracelet.tracelet).

### 2. Try Demo Mode

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
Tracelet: Load Demo Traces
```

This loads realistic synthetic trace data so you can explore all features immediately.

### 3. Configure a Provider

Open Settings (`Ctrl+,`) and search for `tracelet`. Configure your preferred backend:

#### LangSmith
```json
{
  "tracelet.activeProvider": "langsmith",
  "tracelet.langsmith.apiKey": "lsv2_your_api_key_here",
  "tracelet.langsmith.projectName": "my-project"
}
```

#### Langfuse
```json
{
  "tracelet.activeProvider": "langfuse",
  "tracelet.langfuse.publicKey": "pk-lf-your_key",
  "tracelet.langfuse.secretKey": "sk-lf-your_secret",
  "tracelet.langfuse.host": "https://cloud.langfuse.com"
}
```

#### OpenTelemetry (Local Files)
```json
{
  "tracelet.activeProvider": "otel-local",
  "tracelet.otel.logDirectory": "/path/to/your/otlp/traces",
  "tracelet.otel.filePattern": "*.json"
}
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+T` | Fetch Latest Traces |
| `Ctrl+Shift+H` | Toggle Token Heatmap |

---

## 🏗️ Architecture

```
[ LLM App Runtime ] ──→ (OpenTelemetry / APIs) ──→ [ Tracelet Extension ]
                                                           │
                                                           ├── CodeLens (inline annotations)
                                                           ├── Diff View (template ↔ hydrated)
                                                           ├── Token Heatmap (decorations)
                                                           ├── Trace Explorer (sidebar tree)
                                                           └── Detail Panel (webview)
```

### Data Flow

1. **Ingest** — Tracelet fetches trace data from your configured backend (LangSmith, Langfuse, or local OTel files)
2. **Validate** — Incoming data is validated with Zod schemas against OpenInference semantic conventions
3. **Normalize** — Provider-specific formats are converted to a unified `TraceSpan` model
4. **Map** — Spans are matched to local source code using function names, file paths, and fuzzy matching
5. **Visualize** — Mapped data drives CodeLens annotations, diff views, heatmaps, and the trace explorer

### Technology Stack

- **Language:** TypeScript
- **IDE Framework:** VS Code Extension API
- **Telemetry Standards:** OpenTelemetry, OpenInference Semantic Conventions
- **Data Validation:** Zod
- **Bundler:** esbuild

---

## 📝 Configuration Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `tracelet.activeProvider` | `demo` | Active telemetry backend |
| `tracelet.codeLens.enabled` | `true` | Show CodeLens above LLM invocations |
| `tracelet.heatmap.enabled` | `true` | Enable token heatmap decorations |
| `tracelet.heatmap.intensity` | `0.6` | Heatmap opacity (0.1–1.0) |
| `tracelet.autoRefresh.enabled` | `false` | Auto-refresh traces periodically |
| `tracelet.autoRefresh.intervalSeconds` | `30` | Auto-refresh interval |
| `tracelet.maxTraces` | `200` | Max traces in memory |
| `tracelet.logLevel` | `info` | Output channel log level |

---

## 🤝 Contributing

Contributions are welcome! Please see our [Contributing Guide](docs/CONTRIBUTING.md) for details.

### Development

```bash
# Clone the repository
git clone https://github.com/satwiksps/tracelet.git
cd tracelet

# Install dependencies
npm install

# Start development build (watch mode)
npm run watch

# Press F5 in VS Code to launch Extension Development Host
```

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [OpenTelemetry](https://opentelemetry.io/) for the observability standard
- [OpenInference](https://github.com/Arize-ai/openinference) for LLM semantic conventions
- [LangSmith](https://smith.langchain.com/) and [Langfuse](https://langfuse.com/) for their APIs
- The VS Code team for the excellent Extension API
