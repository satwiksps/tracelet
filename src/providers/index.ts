import { TelemetryProvider } from './base';
import { OtelLocalProvider } from './otel-local';
import { LangSmithProvider } from './langsmith';
import { LangfuseProvider } from './langfuse';
import type { DataSource, TraceletConfig } from '../types';

export { TelemetryProvider } from './base';
export { OtelLocalProvider } from './otel-local';
export { LangSmithProvider } from './langsmith';
export { LangfuseProvider } from './langfuse';

/**
 * Factory function to create the appropriate telemetry provider
 * based on the configured data source.
 */
export function createProvider(source: DataSource, config: TraceletConfig): TelemetryProvider {
  switch (source) {
    case 'otel-local':
      return new OtelLocalProvider(config.otel);
    case 'langsmith':
      return new LangSmithProvider(config.langsmith);
    case 'langfuse':
      return new LangfuseProvider(config.langfuse);
    default:
      return new OtelLocalProvider(config.otel);
  }
}
