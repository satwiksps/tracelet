# Tracelet Demo

This folder contains everything needed to demonstrate all of Tracelet's features using **real data through the real production code path** — no fake built-in demo mode.

## What's Inside

```
demo/
├── generate_traces.js     ← Generates realistic OTLP JSON trace files
├── sample_rag_app.py      ← Sample RAG pipeline (CodeLens + Heatmap target)
├── sample_agent.py        ← Sample agent with tool calling (CodeLens target)
├── sample_chat.ts         ← Sample TypeScript chat app (CodeLens target)
├── .vscode/settings.json  ← Pre-configured Tracelet settings
└── traces/                ← Generated OTLP trace files (created by script)
```

## How to Run the Demo

### Step 1: Generate trace files

```bash
cd demo
node generate_traces.js
```

This creates 3 OTLP JSON trace files in `demo/traces/`:
- `rag_pipeline.json` — 5 spans: embed → search → rerank → format → LLM
- `agent_workflow.json` — 4 spans: plan → tool calls → parse → LLM
- `chat_completion.json` — 1 span: simple chat completion

Each trace includes:
- OpenInference semantic attributes (model, tokens, messages)
- Source mapping attributes (`code.filepath`, `code.function`, `code.lineno`) pointing to the sample files
- Prompt templates with `{{variables}}` and their hydrated values
- Realistic token usage for heatmap visualization

### Step 2: Launch the Extension Development Host

1. Open the **tracelet root folder** (`d:\tracelet`) in VS Code
2. Press **F5** — the Extension Development Host opens
3. In the new window, open the `demo/` folder (File → Open Folder → `d:\tracelet\demo`)

> The `.vscode/settings.json` in the demo folder auto-configures Tracelet to read from `demo/traces/`.

### Step 3: Fetch traces

Press **Ctrl+Shift+T** (or Command Palette → "Tracelet: Fetch Latest Traces")

You should see: _"Tracelet: Loaded 10 spans from OpenTelemetry (Local)."_

### Step 4: Explore every feature

| Feature | How to See It |
|---------|---------------|
| **Trace Explorer** | Click the Tracelet icon (pulse) in the Activity Bar — see 3 traces with full span hierarchy |
| **CodeLens** | Open `sample_rag_app.py` — see "Tracelet: View Traces" above `client.chat.completions.create(` |
| **Prompt Diff** | In Trace Explorer, right-click `generate_answer` → "Open Prompt Diff View" — see `{{context}}` vs actual text |
| **Token Heatmap** | Press `Ctrl+Shift+H` with `sample_rag_app.py` open — lines 49-76 glow hot (3,390 tokens) |
| **Trace Detail Panel** | Double-click any trace in the explorer — see waterfall timeline |
| **Source Navigation** | In the Trace Detail Panel, click "Go to Source" on any span — jumps to the exact line |

### Step 5: Re-generate with fresh data

Run `node generate_traces.js` again — trace IDs and timestamps change each time. Then fetch traces again in Tracelet to see the updated data.

## Why This Approach

Instead of shipping fake data inside the extension:

1. **Every feature is exercised through the real production code path** — OTel file reading, Zod schema validation, source mapping, all of it
2. **The trace data is verifiable** — you can open the JSON files and inspect them
3. **Source mapping works** — the `code.filepath` attributes point to the actual demo files, so heatmap decorations appear on real lines
4. **It's reproducible** — anyone can run the generator and get the same demo experience
5. **It models the real workflow** — this is exactly how engineers would use Tracelet with OTel-instrumented apps
