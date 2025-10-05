/**
 * Type re-exports for convenient importing.
 * Usage: import { TraceSpan, DataSource } from '../types';
 */

export type {
  DataSource,
  SpanKind,
  SpanStatus,
  Message,
  ToolCall,
  TokenUsage,
  LLMData,
  SourceMapping,
  TraceSpan,
  Trace,
  TokenUsageAggregate,
  FetchOptions,
  ConnectionResult,
} from './trace';

export type {
  TraceletConfig,
  OtelConfig,
  LangSmithConfig,
  LangfuseConfig,
  HeatmapConfig,
  CodeLensConfig,
  AutoRefreshConfig,
} from './config';
