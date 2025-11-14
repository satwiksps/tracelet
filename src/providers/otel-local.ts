import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TelemetryProvider } from './base';
import { parseOtlpExport } from '../schemas/openinference';
import { logger } from '../utils/logger';
import type { TraceSpan, FetchOptions, ConnectionResult, OtelConfig } from '../types';

/**
 * OpenTelemetry local file provider.
 * Reads OTLP JSON export files from a configured local directory.
 */
export class OtelLocalProvider extends TelemetryProvider {
  readonly name = 'otel-local' as const;
  readonly displayName = 'OpenTelemetry (Local)';

  private config: OtelConfig;

  constructor(config: OtelConfig) {
    super();
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.logDirectory.length > 0;
  }

  async fetchTraces(options?: FetchOptions): Promise<TraceSpan[]> {
    if (!this.isConfigured()) {
      throw new Error('OTel local provider: log directory not configured.');
    }

    const dir = this.resolveDirectory(this.config.logDirectory);
    if (!fs.existsSync(dir)) {
      throw new Error(`OTel log directory does not exist: ${dir}`);
    }

    const pattern = this.config.filePattern || '*.json';
    const files = this.getMatchingFiles(dir, pattern);
    logger.info(`Found ${files.length} OTel trace files in ${dir}`);

    const allSpans: TraceSpan[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const json = JSON.parse(content);
        const spans = parseOtlpExport(json);
        allSpans.push(...spans);
      } catch (err) {
        logger.warn(`Skipping malformed OTel file: ${file}`, err);
      }
    }

    // Sort by start time descending
    allSpans.sort((a, b) => b.startTime - a.startTime);

    // Apply limit
    const limit = options?.limit ?? 200;
    return allSpans.slice(0, limit);
  }

  async fetchTraceById(traceId: string): Promise<TraceSpan[]> {
    const allSpans = await this.fetchTraces({ limit: 5000 });
    return allSpans.filter((s) => s.traceId === traceId);
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      if (!this.isConfigured()) {
        return {
          success: false,
          message: 'Log directory not configured.',
          latencyMs: Date.now() - start,
          provider: 'otel-local',
        };
      }
      const dir = this.resolveDirectory(this.config.logDirectory);
      const exists = fs.existsSync(dir);
      return {
        success: exists,
        message: exists
          ? `Directory exists: ${dir}`
          : `Directory not found: ${dir}`,
        latencyMs: Date.now() - start,
        provider: 'otel-local',
      };
    } catch (err) {
      return {
        success: false,
        message: `Error: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - start,
        provider: 'otel-local',
      };
    }
  }

  private resolveDirectory(dir: string): string {
    if (dir.includes('${workspaceFolder}')) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        return dir.replace('${workspaceFolder}', workspaceFolders[0].uri.fsPath);
      }
    }
    return dir;
  }

  private getMatchingFiles(dir: string, pattern: string): string[] {
    try {
      const entries = fs.readdirSync(dir);
      const regex = this.globToRegex(pattern);
      return entries
        .filter((entry) => regex.test(entry))
        .map((entry) => path.join(dir, entry))
        .filter((fullPath) => fs.statSync(fullPath).isFile());
    } catch {
      return [];
    }
  }

  /** Simple glob-to-regex converter for file matching */
  private globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }
}
