import * as vscode from 'vscode';
import { InvocationDetector } from './detector';
import { Commands } from '../utils/constants';
import { logger } from '../utils/logger';

/**
 * CodeLens provider that injects clickable annotations above LLM invocations.
 * Detects patterns from OpenAI, Anthropic, LangChain, LlamaIndex, Vercel AI, etc.
 */
export class TraceletCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  private detector = new InvocationDetector();

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];

    try {
      const detections = this.detector.detect(document);

      for (const detection of detections) {
        const lens = new vscode.CodeLens(detection.range, {
          title: `$(telescope) Tracelet: View Traces — ${detection.sdkName}`,
          tooltip: `Show execution traces for ${detection.functionName || 'this invocation'} (${detection.sdkName})`,
          command: Commands.SHOW_TRACES,
          arguments: [
            {
              functionName: detection.functionName,
              filePath: document.uri.fsPath,
              lineNumber: detection.lineNumber,
              sdkName: detection.sdkName,
            },
          ],
        });

        codeLenses.push(lens);
      }
    } catch (err) {
      logger.warn('CodeLens detection error:', err);
    }

    return codeLenses;
  }

  /** Force VS Code to re-query CodeLenses */
  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}
