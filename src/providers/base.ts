import type { DataSource, FetchOptions, TraceSpan, ConnectionResult } from '../types';

/**
 * Abstract base class for all telemetry data providers.
 * Each provider fetches trace data from a specific backend and normalizes
 * it into the unified TraceSpan format.
 */
export abstract class TelemetryProvider {
  /** Unique identifier for this provider */
  abstract readonly name: DataSource;

  /** Human-readable display name */
  abstract readonly displayName: string;

  /** Check if the provider has valid configuration (API keys, paths, etc.) */
  abstract isConfigured(): boolean;

  /** Fetch traces from the backend, optionally with filters */
  abstract fetchTraces(options?: FetchOptions): Promise<TraceSpan[]>;

  /** Fetch all spans belonging to a specific trace */
  abstract fetchTraceById(traceId: string): Promise<TraceSpan[]>;

  /** Test the connection to the backend and report results */
  abstract testConnection(): Promise<ConnectionResult>;
}
