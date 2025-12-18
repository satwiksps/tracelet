import * as vscode from 'vscode';
import { getHeatmapColor, getIntensityLabel } from './colors';
import { Commands } from '../utils/constants';
import { logger } from '../utils/logger';
import type { TraceSpan } from '../types';

/**
 * Manages inline token heatmap decorations in the editor.
 * Maps token usage data to source code lines with color-coded intensity.
 */
export class HeatmapManager {
  private decorationTypes: vscode.TextEditorDecorationType[] = [];
  private _isEnabled = true;
  private intensityMultiplier: number;

  /** Number of discrete intensity levels for decorations */
  private static readonly LEVELS = 10;

  constructor(intensityMultiplier = 0.6) {
    this.intensityMultiplier = intensityMultiplier;
    this.createDecorationTypes();
  }

  get isEnabled(): boolean {
    return this._isEnabled;
  }

  setIntensity(value: number): void {
    this.intensityMultiplier = Math.max(0.1, Math.min(1.0, value));
    // Recreate decorations with new intensity
    this.dispose();
    this.createDecorationTypes();
  }

  /**
   * Apply heatmap decorations to the active editor based on trace span data.
   */
  applyHeatmap(editor: vscode.TextEditor, spans: TraceSpan[]): void {
    if (!this._isEnabled || spans.length === 0) {
      this.clearHeatmap();
      return;
    }

    // Filter to spans that have source mappings and token usage
    const mappedSpans = spans.filter(
      (s) => s.sourceMapping && s.llm?.tokenUsage,
    );

    if (mappedSpans.length === 0) {
      this.clearHeatmap();
      return;
    }

    // Find max token usage for normalization
    const maxTokens = Math.max(
      ...mappedSpans.map((s) => s.llm!.tokenUsage.total),
      1,
    );

    // Group decorations by intensity level
    const buckets: vscode.DecorationOptions[][] = Array.from(
      { length: HeatmapManager.LEVELS },
      () => [],
    );

    for (const span of mappedSpans) {
      const mapping = span.sourceMapping!;
      const tokens = span.llm!.tokenUsage;
      const intensity = Math.min(tokens.total / maxTokens, 1.0);
      const levelIndex = Math.min(
        Math.floor(intensity * HeatmapManager.LEVELS),
        HeatmapManager.LEVELS - 1,
      );
      const label = getIntensityLabel(intensity);

      const line = mapping.lineNumber - 1; // Convert to 0-indexed
      if (line < 0 || line >= editor.document.lineCount) {
        continue;
      }

      const lineLength = editor.document.lineAt(line).text.length;
      const range = new vscode.Range(line, 0, line, lineLength);

      const hoverMessage = new vscode.MarkdownString(
        `### 🔥 Token Usage — ${label}\n\n` +
          `| Metric | Value |\n` +
          `|--------|-------|\n` +
          `| **Model** | ${span.llm!.model} |\n` +
          `| **Prompt tokens** | ${tokens.prompt.toLocaleString()} |\n` +
          `| **Completion tokens** | ${tokens.completion.toLocaleString()} |\n` +
          `| **Total** | ${tokens.total.toLocaleString()} |\n` +
          `| **Duration** | ${span.duration}ms |\n\n` +
          `[View Trace Diff](command:${Commands.OPEN_DIFF} "${encodeURIComponent(JSON.stringify(span))}")`,
      );
      hoverMessage.isTrusted = true;

      const decoration: vscode.DecorationOptions = {
        range,
        hoverMessage,
        renderOptions: {
          after: {
            contentText: ` ← ${tokens.total.toLocaleString()} tokens`,
            color: 'rgba(150, 150, 150, 0.7)',
            fontStyle: 'italic',
            margin: '0 0 0 2em',
          },
        },
      };

      buckets[levelIndex].push(decoration);
    }

    // Apply each bucket to its decoration type
    this.decorationTypes.forEach((type, i) => {
      editor.setDecorations(type, buckets[i]);
    });

    logger.debug(`Applied heatmap: ${mappedSpans.length} spans across ${editor.document.fileName}`);
  }

  /** Remove all heatmap decorations from the current editor */
  clearHeatmap(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.decorationTypes.forEach((type) => {
        editor.setDecorations(type, []);
      });
    }
  }

  /** Toggle heatmap on/off */
  toggle(): void {
    this._isEnabled = !this._isEnabled;
    if (!this._isEnabled) {
      this.clearHeatmap();
    }
    vscode.window.showInformationMessage(
      `Tracelet: Token heatmap ${this._isEnabled ? 'enabled' : 'disabled'}.`,
    );
    logger.info(`Heatmap toggled: ${this._isEnabled ? 'ON' : 'OFF'}`);
  }

  /** Dispose all decoration types */
  dispose(): void {
    this.decorationTypes.forEach((type) => type.dispose());
    this.decorationTypes = [];
  }

  private createDecorationTypes(): void {
    this.decorationTypes = [];
    const opacity = this.intensityMultiplier;

    for (let i = 0; i < HeatmapManager.LEVELS; i++) {
      const intensity = (i + 0.5) / HeatmapManager.LEVELS;
      const colors = getHeatmapColor(intensity, opacity);

      const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: colors.backgroundColor,
        overviewRulerColor: colors.gutterColor,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        isWholeLine: true,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        light: { backgroundColor: colors.backgroundColor },
        dark: { backgroundColor: colors.backgroundColor },
      });

      this.decorationTypes.push(decorationType);
    }
  }
}
