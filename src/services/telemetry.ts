/**
 * Anonymous extension usage telemetry (stub).
 *
 * This is a placeholder implementation that:
 *  - Respects the VS Code `telemetry.telemetryLevel` setting.
 *  - Logs events to the debug output channel instead of sending them externally.
 *  - Provides a stable API surface for future telemetry integration.
 *
 * No data leaves the user's machine.
 */

import * as vscode from 'vscode';
import { logger } from '../utils/logger';

// ─── Telemetry Levels ────────────────────────────────────────────────────────

/** Subset of telemetry levels we care about. */
type TelemetryLevel = 'off' | 'crash' | 'error' | 'all';

// ─── ExtensionTelemetry ──────────────────────────────────────────────────────

export class ExtensionTelemetry {
  private level: TelemetryLevel;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Read the initial telemetry level from VS Code settings
    this.level = this.readLevel();

    // Watch for changes to the telemetry setting
    const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('telemetry.telemetryLevel')) {
        this.level = this.readLevel();
        logger.debug(`Telemetry level changed to "${this.level}"`);
      }
    });
    this.disposables.push(watcher);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Track a named event with optional string properties.
   * Currently a no-op that logs to the debug channel.
   */
  trackEvent(name: string, properties?: Record<string, string>): void {
    if (!this.isEnabled()) {
      return;
    }
    logger.debug(
      `[Telemetry] event: ${name}`,
      properties ? properties : '',
    );
  }

  /**
   * Track an error with optional string properties.
   * Currently a no-op that logs to the debug channel.
   */
  trackError(error: Error, properties?: Record<string, string>): void {
    if (!this.isErrorEnabled()) {
      return;
    }
    logger.debug(
      `[Telemetry] error: ${error.message}`,
      properties ? properties : '',
    );
  }

  /** Dispose watchers. */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Read the current `telemetry.telemetryLevel` from VS Code configuration.
   * Falls back to 'all' if the setting is absent (matches VS Code's default).
   */
  private readLevel(): TelemetryLevel {
    const config = vscode.workspace.getConfiguration('telemetry');
    const raw = config.get<string>('telemetryLevel', 'all');

    switch (raw) {
      case 'off':
        return 'off';
      case 'crash':
        return 'crash';
      case 'error':
        return 'error';
      case 'all':
      default:
        return 'all';
    }
  }

  /** Whether general event telemetry is enabled. */
  private isEnabled(): boolean {
    return this.level === 'all';
  }

  /** Whether error/crash telemetry is enabled. */
  private isErrorEnabled(): boolean {
    return this.level === 'all' || this.level === 'error' || this.level === 'crash';
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

/** Shared telemetry instance for the entire extension. */
export const telemetry = new ExtensionTelemetry();
