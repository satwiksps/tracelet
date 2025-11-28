/**
 * Webview panel for rich trace detail visualization.
 *
 * Features:
 *  - Waterfall / Gantt timeline of all spans in a trace
 *  - Span detail sidebar showing name, kind, duration, status, model,
 *    token usage bar chart, and input/output messages as a chat conversation
 *  - Message handling: navigateToSource, openDiff, copyText
 *  - VS Code theme integration via CSS custom properties
 *  - CSP headers for security
 */

import * as vscode from 'vscode';
import type { Trace, TraceSpan, SpanKind, Message } from '../types';
import { Commands } from '../utils/constants';
import { logger } from '../utils/logger';
import { formatDuration } from './trace-items';

// ─── Panel Manager ───────────────────────────────────────────────────────────

/** Tracks one webview panel per span id to implement singleton behaviour. */
const activePanels: Map<string, TraceDetailPanel> = new Map();

/**
 * Rich webview panel that renders a trace waterfall timeline with
 * interactive span detail views.
 */
export class TraceDetailPanel {
  public static readonly viewType = 'tracelet.traceDetail';

  private readonly panel: vscode.WebviewPanel;
  private readonly span: TraceSpan;
  private readonly trace: Trace;
  private disposables: vscode.Disposable[] = [];

  // ── Factory ────────────────────────────────────────────────────────────

  /**
   * Show (or re-focus) a detail panel for the given span.
   * One panel is kept per span id; re-calling for the same span simply reveals it.
   */
  static createOrShow(
    context: vscode.ExtensionContext,
    span: TraceSpan,
    trace: Trace,
  ): TraceDetailPanel {
    const existing = activePanels.get(span.id);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      TraceDetailPanel.viewType,
      `Trace: ${span.name}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    const detail = new TraceDetailPanel(panel, span, trace);
    activePanels.set(span.id, detail);
    return detail;
  }

  // ── Constructor ────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel, span: TraceSpan, trace: Trace) {
    this.panel = panel;
    this.span = span;
    this.trace = trace;

    // Render initial content
    this.panel.webview.html = this.buildHtml();

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    // Clean up when panel is closed
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  // ── Dispose ────────────────────────────────────────────────────────────

  dispose(): void {
    activePanels.delete(this.span.id);
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  // ── Message Handling ───────────────────────────────────────────────────

  private async handleMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'navigateToSource': {
        const filePath = msg.filePath as string | undefined;
        const line = (msg.line as number | undefined) ?? 0;
        if (filePath) {
          try {
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(line, 0, line, 0),
              preview: true,
            });
          } catch (err) {
            logger.error('Failed to navigate to source', err);
            vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
          }
        }
        break;
      }

      case 'openDiff': {
        const spanId = msg.spanId as string | undefined;
        if (spanId) {
          const targetSpan = this.trace.spans.find((s) => s.id === spanId) ?? this.span;
          await vscode.commands.executeCommand(Commands.OPEN_DIFF, targetSpan);
        }
        break;
      }

      case 'copyText': {
        const text = msg.text as string | undefined;
        if (text) {
          await vscode.env.clipboard.writeText(text);
          vscode.window.showInformationMessage('Copied to clipboard');
        }
        break;
      }

      default:
        logger.debug(`TraceDetailPanel: unhandled message type "${msg.type}"`);
    }
  }

  // ── HTML Generation ────────────────────────────────────────────────────

  private buildHtml(): string {
    const nonce = this.getNonce();
    const traceJson = JSON.stringify(this.serializeTrace());
    const selectedSpanId = JSON.stringify(this.span.id);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Trace Detail</title>
  <style nonce="${nonce}">
    ${this.getCss()}
  </style>
</head>
<body>
  <div id="root">
    <div id="waterfall-container">
      <h2 class="section-title">Trace Timeline</h2>
      <div id="waterfall"></div>
    </div>
    <div id="detail-container">
      <h2 class="section-title">Span Detail</h2>
      <div id="detail"></div>
    </div>
  </div>
  <script nonce="${nonce}">
    (function() {
      ${this.getJs(traceJson, selectedSpanId)}
    })();
  </script>
</body>
</html>`;
  }

  // ── CSS ────────────────────────────────────────────────────────────────

  private getCss(): string {
    return /* css */ `
      /* ── Reset & Theme ──────────────────────────── */
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: var(--vscode-font-family, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        overflow-x: hidden;
      }
      #root {
        display: flex;
        flex-direction: column;
        height: 100vh;
      }

      /* ── Section titles ─────────────────────────── */
      .section-title {
        font-size: 1.1em;
        font-weight: 600;
        padding: 12px 16px 6px;
        color: var(--vscode-foreground);
        border-bottom: 1px solid var(--vscode-panel-border, #444);
      }

      /* ── Waterfall ──────────────────────────────── */
      #waterfall-container {
        flex: 0 0 auto;
        max-height: 45vh;
        overflow-y: auto;
        border-bottom: 1px solid var(--vscode-panel-border, #444);
      }
      #waterfall { padding: 8px 16px 12px; }

      .wf-row {
        display: flex;
        align-items: center;
        height: 28px;
        cursor: pointer;
        border-radius: 3px;
        padding: 0 4px;
      }
      .wf-row:hover { background: var(--vscode-list-hoverBackground); }
      .wf-row.selected { background: var(--vscode-list-activeSelectionBackground); }

      .wf-label {
        flex: 0 0 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.9em;
        color: var(--vscode-foreground);
      }

      .wf-bar-track {
        flex: 1;
        position: relative;
        height: 16px;
        background: transparent;
      }

      .wf-bar {
        position: absolute;
        height: 100%;
        border-radius: 3px;
        min-width: 3px;
        display: flex;
        align-items: center;
        padding-left: 4px;
        font-size: 0.75em;
        color: #fff;
        overflow: hidden;
        white-space: nowrap;
      }

      /* Span kind colours */
      .wf-bar[data-kind="llm"]       { background: #6b7bda; }
      .wf-bar[data-kind="chain"]     { background: #5ca1a0; }
      .wf-bar[data-kind="tool"]      { background: #c98a4b; }
      .wf-bar[data-kind="retriever"] { background: #58a65c; }
      .wf-bar[data-kind="embedding"] { background: #9370db; }
      .wf-bar[data-kind="agent"]     { background: #d96c75; }
      .wf-bar[data-kind="reranker"]  { background: #b0965a; }
      .wf-bar[data-kind="guardrail"] { background: #6495ed; }
      .wf-bar[data-kind="evaluator"] { background: #20b2aa; }
      .wf-bar[data-kind="unknown"]   { background: #888; }

      .wf-bar-tooltip {
        display: none;
        position: absolute;
        top: -30px;
        left: 0;
        background: var(--vscode-editorHoverWidget-background, #333);
        border: 1px solid var(--vscode-editorHoverWidget-border, #555);
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 0.8em;
        white-space: nowrap;
        z-index: 10;
        pointer-events: none;
      }
      .wf-bar:hover .wf-bar-tooltip { display: block; }

      /* ── Detail ─────────────────────────────────── */
      #detail-container {
        flex: 1;
        overflow-y: auto;
        padding-bottom: 24px;
      }
      #detail { padding: 12px 16px; }

      .detail-section { margin-bottom: 16px; }
      .detail-section h3 {
        font-size: 0.95em;
        font-weight: 600;
        margin-bottom: 6px;
        color: var(--vscode-descriptionForeground);
      }

      .kv-table { width: 100%; border-collapse: collapse; }
      .kv-table td {
        padding: 3px 8px;
        vertical-align: top;
        border-bottom: 1px solid var(--vscode-panel-border, #333);
      }
      .kv-table td:first-child {
        width: 140px;
        font-weight: 500;
        color: var(--vscode-descriptionForeground);
      }

      /* Token bar chart */
      .token-bar-container {
        display: flex;
        height: 20px;
        border-radius: 4px;
        overflow: hidden;
        margin-top: 4px;
      }
      .token-bar-prompt {
        background: #6b7bda;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75em;
        color: #fff;
      }
      .token-bar-completion {
        background: #58a65c;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75em;
        color: #fff;
      }

      /* Chat messages */
      .chat-msg {
        border-radius: 6px;
        padding: 8px 12px;
        margin-bottom: 8px;
        font-size: 0.9em;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .chat-msg.system {
        background: var(--vscode-textBlockQuote-background, #2a2a2a);
        border-left: 3px solid var(--vscode-textLink-foreground, #569cd6);
      }
      .chat-msg.user {
        background: var(--vscode-input-background, #1e1e1e);
        border-left: 3px solid #6b7bda;
      }
      .chat-msg.assistant {
        background: var(--vscode-input-background, #1e1e1e);
        border-left: 3px solid #58a65c;
      }
      .chat-msg.tool, .chat-msg.function {
        background: var(--vscode-input-background, #1e1e1e);
        border-left: 3px solid #c98a4b;
      }
      .chat-role {
        font-weight: 600;
        text-transform: uppercase;
        font-size: 0.75em;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
        opacity: 0.8;
      }

      /* Action links */
      .action-link {
        color: var(--vscode-textLink-foreground, #569cd6);
        cursor: pointer;
        text-decoration: underline;
        font-size: 0.85em;
        margin-right: 12px;
      }
      .action-link:hover { opacity: 0.8; }

      /* ── Indent helper ──────────────────────────── */
      .indent { display: inline-block; }
    `;
  }

  // ── JavaScript ─────────────────────────────────────────────────────────

  private getJs(traceJson: string, selectedSpanId: string): string {
    return /* js */ `
      const vscode = acquireVsCodeApi();
      const trace = ${traceJson};
      let selectedId = ${selectedSpanId};

      // ── Utilities ──────────────────────────────────
      function esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
      }

      function fmtDuration(ms) {
        if (ms < 1000) return Math.round(ms) + 'ms';
        if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
        const m = Math.floor(ms / 60000);
        const s = Math.round((ms % 60000) / 1000);
        return s > 0 ? m + 'm ' + s + 's' : m + 'm';
      }

      // ── Build flat ordered span list with depth ────
      function buildOrderedSpans() {
        const spans = trace.spans;
        const childMap = {};
        spans.forEach(s => {
          const pid = s.parentId || '__root__';
          if (!childMap[pid]) childMap[pid] = [];
          childMap[pid].push(s);
        });
        // Sort children by startTime
        Object.values(childMap).forEach(arr => arr.sort((a, b) => a.startTime - b.startTime));

        // Find root spans (no parentId or parentId not in trace)
        const idSet = new Set(spans.map(s => s.id));
        const roots = spans
          .filter(s => !s.parentId || !idSet.has(s.parentId))
          .sort((a, b) => a.startTime - b.startTime);

        const result = [];
        function walk(span, depth) {
          result.push({ span, depth });
          const children = childMap[span.id] || [];
          children.forEach(c => walk(c, depth + 1));
        }
        roots.forEach(r => walk(r, 0));
        return result;
      }

      // ── Waterfall ──────────────────────────────────
      function renderWaterfall() {
        const container = document.getElementById('waterfall');
        const ordered = buildOrderedSpans();
        if (ordered.length === 0) {
          container.innerHTML = '<em>No spans</em>';
          return;
        }

        const traceStart = trace.startTime;
        const traceDuration = trace.duration || 1;

        let html = '';
        ordered.forEach(({ span, depth }) => {
          const leftPct = ((span.startTime - traceStart) / traceDuration) * 100;
          const widthPct = Math.max((span.duration / traceDuration) * 100, 0.5);
          const indent = depth * 16;
          const sel = span.id === selectedId ? ' selected' : '';

          html += '<div class="wf-row' + sel + '" data-span-id="' + esc(span.id) + '">'
            + '<span class="wf-label" style="padding-left:' + indent + 'px">'
            + '<span class="indent" style="width:' + indent + 'px"></span>'
            + esc(span.name)
            + '</span>'
            + '<span class="wf-bar-track">'
            + '<span class="wf-bar" data-kind="' + esc(span.kind) + '" '
            + 'style="left:' + leftPct.toFixed(2) + '%;width:' + widthPct.toFixed(2) + '%">'
            + fmtDuration(span.duration)
            + '<span class="wf-bar-tooltip">' + esc(span.name) + ' — ' + fmtDuration(span.duration) + '</span>'
            + '</span>'
            + '</span>'
            + '</div>';
        });
        container.innerHTML = html;

        // Click handlers
        container.querySelectorAll('.wf-row').forEach(row => {
          row.addEventListener('click', () => {
            const sid = row.getAttribute('data-span-id');
            selectSpan(sid);
          });
        });
      }

      // ── Detail panel ───────────────────────────────
      function renderDetail(spanId) {
        const span = trace.spans.find(s => s.id === spanId);
        if (!span) return;
        const container = document.getElementById('detail');
        let html = '';

        // Basic info table
        html += '<div class="detail-section"><h3>Overview</h3><table class="kv-table">';
        html += kv('Name', span.name);
        html += kv('Kind', span.kind);
        html += kv('Status', span.status);
        html += kv('Duration', fmtDuration(span.duration));
        html += kv('Start', new Date(span.startTime).toLocaleString());
        html += kv('Source', span.source);
        if (span.error) html += kv('Error', span.error);
        html += '</table></div>';

        // Actions
        html += '<div class="detail-section">';
        if (span.sourceMapping) {
          html += '<a class="action-link" onclick="navSource(\\'' + escAttr(span.sourceMapping.filePath) + '\\',' + span.sourceMapping.lineNumber + ')">Go to source</a>';
        }
        if (span.kind === 'llm') {
          html += '<a class="action-link" onclick="openDiff(\\'' + escAttr(span.id) + '\\')">Open diff</a>';
        }
        html += '</div>';

        // LLM details
        if (span.llm) {
          html += '<div class="detail-section"><h3>Model</h3><table class="kv-table">';
          html += kv('Model', span.llm.model);
          if (span.llm.provider) html += kv('Provider', span.llm.provider);
          html += '</table></div>';

          // Token bar chart
          const usage = span.llm.tokenUsage;
          if (usage && usage.total > 0) {
            const pPct = (usage.prompt / usage.total) * 100;
            const cPct = (usage.completion / usage.total) * 100;
            html += '<div class="detail-section"><h3>Token Usage (' + usage.total.toLocaleString() + ')</h3>';
            html += '<div class="token-bar-container">';
            html += '<div class="token-bar-prompt" style="width:' + pPct.toFixed(1) + '%">Prompt ' + usage.prompt + '</div>';
            html += '<div class="token-bar-completion" style="width:' + cPct.toFixed(1) + '%">Completion ' + usage.completion + '</div>';
            html += '</div></div>';
          }

          // Input messages
          if (span.llm.inputMessages && span.llm.inputMessages.length) {
            html += '<div class="detail-section"><h3>Input Messages</h3>';
            html += renderMessages(span.llm.inputMessages);
            html += '</div>';
          }

          // Output messages
          if (span.llm.outputMessages && span.llm.outputMessages.length) {
            html += '<div class="detail-section"><h3>Output Messages</h3>';
            html += renderMessages(span.llm.outputMessages);
            html += '</div>';
          }
        }

        // Non-LLM input/output
        if (!span.llm) {
          if (span.input) {
            html += '<div class="detail-section"><h3>Input</h3><pre style="white-space:pre-wrap;word-break:break-word;">' + esc(span.input) + '</pre>';
            html += '<a class="action-link" onclick="copyText(\\'' + escAttr(span.input) + '\\')">Copy</a>';
            html += '</div>';
          }
          if (span.output) {
            html += '<div class="detail-section"><h3>Output</h3><pre style="white-space:pre-wrap;word-break:break-word;">' + esc(span.output) + '</pre>';
            html += '<a class="action-link" onclick="copyText(\\'' + escAttr(span.output) + '\\')">Copy</a>';
            html += '</div>';
          }
        }

        container.innerHTML = html;
      }

      function kv(key, val) {
        return '<tr><td>' + esc(key) + '</td><td>' + esc(String(val)) + '</td></tr>';
      }

      function renderMessages(msgs) {
        let h = '';
        msgs.forEach(m => {
          const role = m.role || 'unknown';
          h += '<div class="chat-msg ' + esc(role) + '">';
          h += '<div class="chat-role">' + esc(role) + '</div>';
          h += esc(m.content || '');
          if (m.toolCalls && m.toolCalls.length) {
            m.toolCalls.forEach(tc => {
              h += '<div style="margin-top:4px;opacity:0.8;font-size:0.85em">';
              h += '⚙ ' + esc(tc.function.name) + '(' + esc(tc.function.arguments) + ')';
              h += '</div>';
            });
          }
          h += '</div>';
        });
        return h;
      }

      function escAttr(s) {
        return String(s).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'").replace(/\\n/g, '\\\\n');
      }

      // ── Selection ──────────────────────────────────
      function selectSpan(sid) {
        selectedId = sid;
        // Update waterfall selection highlight
        document.querySelectorAll('.wf-row').forEach(r => {
          r.classList.toggle('selected', r.getAttribute('data-span-id') === sid);
        });
        renderDetail(sid);
      }

      // ── Outgoing messages ──────────────────────────
      window.navSource = function(fp, line) {
        vscode.postMessage({ type: 'navigateToSource', filePath: fp, line: line });
      };
      window.openDiff = function(sid) {
        vscode.postMessage({ type: 'openDiff', spanId: sid });
      };
      window.copyText = function(text) {
        vscode.postMessage({ type: 'copyText', text: text });
      };

      // ── Initial render ─────────────────────────────
      renderWaterfall();
      renderDetail(selectedId);
    `;
  }

  // ── Serialization ──────────────────────────────────────────────────────

  /**
   * Produce a JSON-safe version of the trace for embedding in the webview.
   * Strips fields that are too large or contain non-serializable data.
   */
  private serializeTrace(): object {
    return {
      id: this.trace.id,
      startTime: this.trace.startTime,
      endTime: this.trace.endTime,
      duration: this.trace.duration,
      source: this.trace.source,
      spans: this.trace.spans.map((s) => ({
        id: s.id,
        traceId: s.traceId,
        parentId: s.parentId,
        name: s.name,
        kind: s.kind,
        status: s.status,
        startTime: s.startTime,
        endTime: s.endTime,
        duration: s.duration,
        source: s.source,
        error: s.error,
        input: s.input,
        output: s.output,
        llm: s.llm
          ? {
              model: s.llm.model,
              provider: s.llm.provider,
              inputMessages: s.llm.inputMessages,
              outputMessages: s.llm.outputMessages,
              tokenUsage: s.llm.tokenUsage,
            }
          : undefined,
        sourceMapping: s.sourceMapping,
      })),
    };
  }

  // ── Nonce ──────────────────────────────────────────────────────────────

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }
}
