import * as vscode from 'vscode';
import { Commands, Views, TRACE_PREVIEW_SCHEME } from './utils/constants';
import { logger } from './utils/logger';
import { configReader } from './utils/config';

// Core features
import { TraceletCodeLensProvider } from './codelens';
import { TraceDocumentContentProvider } from './diff/content-provider';
import { DiffViewManager } from './diff';
import { HeatmapManager } from './heatmap';

// Views
import { TraceTreeProvider } from './views/trace-tree';
import { TraceDetailPanel } from './views/trace-detail';

// Services
import { TraceStore } from './services/trace-store';
import { SourceMapper } from './services/source-mapper';

// Providers
import { createProvider } from './providers';
import type { TelemetryProvider } from './providers/base';
import type { TraceSpan, FetchOptions } from './types';

// ─── Global State ────────────────────────────────────────────────────────────

let activeProvider: TelemetryProvider;
let traceStore: TraceStore;
let sourceMapper: SourceMapper;
let codeLensProvider: TraceletCodeLensProvider;
let traceDocProvider: TraceDocumentContentProvider;
let diffViewManager: DiffViewManager;
let heatmapManager: HeatmapManager;
let traceTreeProvider: TraceTreeProvider;
let statusBarItem: vscode.StatusBarItem;
let autoRefreshTimer: NodeJS.Timeout | undefined;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  logger.info('Tracelet is activating...');

  const config = configReader.getAll();
  logger.setLevel(config.logLevel);

  // ── Initialize Services ──────────────────────────────────────────────────

  traceStore = new TraceStore(config.maxTraces);
  sourceMapper = new SourceMapper();
  activeProvider = createProvider(config.activeProvider, config);

  logger.info(`Active provider: ${activeProvider.displayName}`);

  // ── Register TextDocumentContentProvider ─────────────────────────────────

  traceDocProvider = new TraceDocumentContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      TRACE_PREVIEW_SCHEME,
      traceDocProvider,
    ),
  );

  // ── Initialize Feature Managers ──────────────────────────────────────────

  diffViewManager = new DiffViewManager(traceDocProvider);
  heatmapManager = new HeatmapManager(config.heatmap.intensity);

  // ── Register CodeLens Provider ───────────────────────────────────────────

  codeLensProvider = new TraceletCodeLensProvider();
  if (config.codeLens.enabled) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        [
          { language: 'python', scheme: 'file' },
          { language: 'typescript', scheme: 'file' },
          { language: 'javascript', scheme: 'file' },
        ],
        codeLensProvider,
      ),
    );
  }

  // ── Register Tree View ───────────────────────────────────────────────────

  traceTreeProvider = new TraceTreeProvider();
  const treeView = vscode.window.createTreeView(Views.TRACE_EXPLORER, {
    treeDataProvider: traceTreeProvider,
    showCollapseAll: true,
    canSelectMany: false,
  });
  context.subscriptions.push(treeView);

  // ── Register Status Bar ──────────────────────────────────────────────────

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = Commands.SELECT_PROVIDER;
  updateStatusBar('ready');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── Register Commands ────────────────────────────────────────────────────

  context.subscriptions.push(
    // Fetch traces from active provider
    vscode.commands.registerCommand(Commands.FETCH_TRACES, async () => {
      await fetchTraces();
    }),

    // Show traces for a specific function (from CodeLens) or open trace detail (from tree view)
    vscode.commands.registerCommand(
      Commands.SHOW_TRACES,
      async (arg?: any) => {
        // If called from Tree View with a span, open the detail panel
        const span = extractSpan(arg);
        if (span) {
          const trace = traceStore.getTraceById(span.traceId);
          if (trace) {
            TraceDetailPanel.createOrShow(context, span, trace);
          }
          return;
        }

        // Otherwise treat as CodeLens metadata
        const meta = arg as { functionName?: string; filePath?: string; lineNumber?: number; sdkName?: string } | undefined;
        if (!meta || !meta.functionName) {
          await fetchTraces();
          return;
        }

        logger.info(`Showing traces for: ${meta.functionName} (${meta.sdkName})`);

        // First fetch if store is empty
        if (traceStore.traceCount === 0) {
          await fetchTraces();
        }

        // Find matching spans
        const spans = traceStore.getByFunction(meta.functionName);
        if (spans.length === 0) {
          const action = await vscode.window.showInformationMessage(
            `No traces found for "${meta.functionName}". Would you like to fetch traces?`,
            'Fetch Traces',
            'Open Settings',
          );
          if (action === 'Fetch Traces') {
            await fetchTraces();
          } else if (action === 'Open Settings') {
            await vscode.commands.executeCommand(Commands.OPEN_SETTINGS);
          }
          return;
        }

        // Open diff view for the most recent LLM span, or show tree
        const llmSpan = spans.find((s) => s.kind === 'llm');
        if (llmSpan) {
          await diffViewManager.openDiff(llmSpan);
        } else {
          // Focus the trace explorer and show traces
          await vscode.commands.executeCommand(`${Views.TRACE_EXPLORER}.focus`);
        }
      },
    ),

    // Open prompt diff view
    vscode.commands.registerCommand(
      Commands.OPEN_DIFF,
      async (spanOrItem?: TraceSpan | { span?: TraceSpan }) => {
        const span = extractSpan(spanOrItem);
        if (!span) {
          vscode.window.showWarningMessage('No trace span selected.');
          return;
        }
        await diffViewManager.openDiff(span);
      },
    ),

    // View hydrated prompt
    vscode.commands.registerCommand(
      Commands.OPEN_HYDRATED_PROMPT,
      async (spanOrItem?: TraceSpan | { span?: TraceSpan }) => {
        const span = extractSpan(spanOrItem);
        if (!span) {
          vscode.window.showWarningMessage('No trace span selected.');
          return;
        }
        await diffViewManager.openHydratedView(span);
      },
    ),

    // Toggle token heatmap
    vscode.commands.registerCommand(Commands.TOGGLE_HEATMAP, () => {
      heatmapManager.toggle();
      const editor = vscode.window.activeTextEditor;
      if (editor && heatmapManager.isEnabled) {
        const filePath = editor.document.uri.fsPath;
        const spans = traceStore.getByFile(filePath);
        heatmapManager.applyHeatmap(editor, spans);
      }
    }),

    // Refresh explorer
    vscode.commands.registerCommand(Commands.REFRESH_EXPLORER, async () => {
      await fetchTraces();
    }),



    // Clear cache
    vscode.commands.registerCommand(Commands.CLEAR_CACHE, () => {
      traceStore.clear();
      traceTreeProvider.clear();
      heatmapManager.clearHeatmap();
      sourceMapper.clearCache();
      codeLensProvider.refresh();
      updateStatusBar('ready');
      vscode.window.showInformationMessage('Tracelet: Trace cache cleared.');
      logger.info('Trace cache cleared');
    }),

    // Open settings
    vscode.commands.registerCommand(Commands.OPEN_SETTINGS, () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:tracelet.tracelet',
      );
    }),

    // Install Python SDK
    vscode.commands.registerCommand(Commands.INSTALL_SDK, () => {
      const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Tracelet');
      terminal.show();
      terminal.sendText('pip install tracelet-sdk');
      vscode.window.showInformationMessage('Installing tracelet-sdk in your active Python environment...');
    }),

    // Open trace in external dashboard
    vscode.commands.registerCommand(
      Commands.OPEN_IN_DASHBOARD,
      async (spanOrItem?: TraceSpan | { span?: TraceSpan }) => {
        const span = extractSpan(spanOrItem);
        if (!span) {
          return;
        }
        const url = getDashboardUrl(span);
        if (url) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        } else {
          vscode.window.showInformationMessage(
            'Dashboard URL not available for this trace source.',
          );
        }
      },
    ),

    // Select provider
    vscode.commands.registerCommand(Commands.SELECT_PROVIDER, async () => {
      const options = [
        { label: '$(file-code) OpenTelemetry Local', description: 'Read from local OTLP JSON files', value: 'otel-local' as const },
        { label: '$(cloud) LangSmith', description: 'Fetch from LangSmith API', value: 'langsmith' as const },
        { label: '$(database) Langfuse', description: 'Fetch from Langfuse API', value: 'langfuse' as const },
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select a telemetry provider',
        title: 'Tracelet: Select Provider',
      });

      if (selected) {
        await vscode.workspace
          .getConfiguration()
          .update('tracelet.activeProvider', selected.value, vscode.ConfigurationTarget.Workspace);
      }
    }),
  );

  // ── Listen for Configuration Changes ─────────────────────────────────────

  context.subscriptions.push(
    configReader.onDidChange((_e) => {
      const newConfig = configReader.getAll();
      logger.setLevel(newConfig.logLevel);

      // Switch provider if changed
      const newProviderName = newConfig.activeProvider;
      if (newProviderName !== activeProvider.name) {
        activeProvider = createProvider(newProviderName, newConfig);
        logger.info(`Switched to provider: ${activeProvider.displayName}`);
        updateStatusBar('ready');
      }

      // Update heatmap intensity
      heatmapManager.setIntensity(newConfig.heatmap.intensity);

      // Handle auto-refresh changes
      setupAutoRefresh(newConfig.autoRefresh.enabled, newConfig.autoRefresh.intervalSeconds);
    }),
  );

  // ── Listen for Editor Changes (heatmap reapply) ──────────────────────────

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && heatmapManager.isEnabled) {
        const filePath = editor.document.uri.fsPath;
        const spans = traceStore.getByFile(filePath);
        if (spans.length > 0) {
          heatmapManager.applyHeatmap(editor, spans);
        } else {
          heatmapManager.clearHeatmap();
        }
      }
    }),
  );

  // ── Wire TraceStore Events to UI ─────────────────────────────────────────

  context.subscriptions.push(
    traceStore.onTracesUpdated((traces) => {
      traceTreeProvider.setTraces(traces);
      codeLensProvider.refresh();
      updateStatusBar('connected', traceStore.spanCount);

      // Reapply heatmap if active
      const editor = vscode.window.activeTextEditor;
      if (editor && heatmapManager.isEnabled) {
        const filePath = editor.document.uri.fsPath;
        const spans = traceStore.getByFile(filePath);
        heatmapManager.applyHeatmap(editor, spans);
      }
    }),
  );

  // ── Setup Auto-Refresh ───────────────────────────────────────────────────

  setupAutoRefresh(config.autoRefresh.enabled, config.autoRefresh.intervalSeconds);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  context.subscriptions.push({
    dispose: () => {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
      }
      heatmapManager.dispose();
    },
  });

  logger.info('Tracelet activated successfully \u2713');
}

// ─── Deactivation ────────────────────────────────────────────────────────────

export function deactivate(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  logger.info('Tracelet deactivated');
}

// ─── Helper Functions ────────────────────────────────────────────────────────

async function fetchTraces(options?: FetchOptions): Promise<void> {
  if (!activeProvider.isConfigured()) {
    const action = await vscode.window.showWarningMessage(
      `Tracelet: ${activeProvider.displayName} is not configured.`,
      'Open Settings',
      'Select Provider',
    );
    if (action === 'Open Settings') {
      await vscode.commands.executeCommand(Commands.OPEN_SETTINGS);
    } else if (action === 'Select Provider') {
      await vscode.commands.executeCommand(Commands.SELECT_PROVIDER);
    }
    return;
  }

  updateStatusBar('fetching');

  try {
    const spans = await activeProvider.fetchTraces(options);
    logger.info(`Fetched ${spans.length} spans from ${activeProvider.displayName}`);

    // Source-map the spans
    await sourceMapper.mapSpans(spans);

    // Add to store (this triggers UI updates via events)
    traceStore.addTraces(spans);

    vscode.window.showInformationMessage(
      `Tracelet: Loaded ${spans.length} spans from ${activeProvider.displayName}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch traces:', error);
    updateStatusBar('error');
    vscode.window.showErrorMessage(`Tracelet: Failed to fetch traces. ${message}`);
  }
}



function setupAutoRefresh(enabled: boolean, intervalSeconds: number): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = undefined;
  }

  if (enabled && intervalSeconds > 0) {
    autoRefreshTimer = setInterval(
      () => {
        fetchTraces({ since: new Date(Date.now() - intervalSeconds * 2000) });
      },
      intervalSeconds * 1000,
    );
    logger.info(`Auto-refresh enabled: every ${intervalSeconds}s`);
  }
}

function updateStatusBar(
  state: 'ready' | 'fetching' | 'connected' | 'error',
  spanCount?: number,
): void {
  switch (state) {
    case 'ready':
      statusBarItem.text = `$(pulse) Tracelet`;
      statusBarItem.tooltip = `Tracelet: ${activeProvider.displayName} (click to switch)`;
      statusBarItem.backgroundColor = undefined;
      break;
    case 'fetching':
      statusBarItem.text = `$(sync~spin) Tracelet`;
      statusBarItem.tooltip = `Fetching traces from ${activeProvider.displayName}...`;
      statusBarItem.backgroundColor = undefined;
      break;
    case 'connected':
      statusBarItem.text = `$(pulse) Tracelet (${spanCount ?? 0})`;
      statusBarItem.tooltip = `Tracelet: ${spanCount ?? 0} spans loaded from ${activeProvider.displayName}`;
      statusBarItem.backgroundColor = undefined;
      break;
    case 'error':
      statusBarItem.text = `$(warning) Tracelet`;
      statusBarItem.tooltip = 'Tracelet: Connection error (click to switch provider)';
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground',
      );
      break;
  }
}

function getDashboardUrl(span: TraceSpan): string | null {
  switch (span.source) {
    case 'langsmith': {
      const config = configReader.getLangSmithConfig();
      return `${config.baseUrl.replace('api.', '')}/o/default/projects/p/${span.traceId}`;
    }
    case 'langfuse': {
      const config = configReader.getLangfuseConfig();
      return `${config.host}/trace/${span.traceId}`;
    }
    default:
      return null;
  }
}

/**
 * Extract a TraceSpan from various command argument shapes.
 * Commands can be invoked from tree items, CodeLens, or directly.
 */
function extractSpan(
  arg?: TraceSpan | { span?: TraceSpan } | unknown,
): TraceSpan | undefined {
  if (!arg) {
    return undefined;
  }
  // Direct TraceSpan
  if (typeof arg === 'object' && arg !== null && 'traceId' in arg && 'kind' in arg) {
    return arg as TraceSpan;
  }
  // Tree item with span property
  if (typeof arg === 'object' && arg !== null && 'span' in arg) {
    return (arg as { span?: TraceSpan }).span;
  }
  return undefined;
}
