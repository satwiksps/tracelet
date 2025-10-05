/**
 * Configuration types for Tracelet extension settings.
 */

import type { DataSource } from './trace';

/** Full Tracelet configuration */
export interface TraceletConfig {
  activeProvider: DataSource;
  otel: OtelConfig;
  langsmith: LangSmithConfig;
  langfuse: LangfuseConfig;
  heatmap: HeatmapConfig;
  codeLens: CodeLensConfig;
  autoRefresh: AutoRefreshConfig;
  maxTraces: number;
  logLevel: string;
}

/** OpenTelemetry local file provider config */
export interface OtelConfig {
  logDirectory: string;
  filePattern: string;
}

/** LangSmith API provider config */
export interface LangSmithConfig {
  apiKey: string;
  baseUrl: string;
  projectName: string;
}

/** Langfuse API provider config */
export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  host: string;
}

/** Heatmap display settings */
export interface HeatmapConfig {
  enabled: boolean;
  intensity: number;
}

/** CodeLens display settings */
export interface CodeLensConfig {
  enabled: boolean;
}

/** Auto-refresh settings */
export interface AutoRefreshConfig {
  enabled: boolean;
  intervalSeconds: number;
}
