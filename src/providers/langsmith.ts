import * as https from 'https';
import * as http from 'http';
import { TelemetryProvider } from './base';
import { parseLangSmithRun } from '../schemas/langsmith';
import { logger } from '../utils/logger';
import type { TraceSpan, FetchOptions, ConnectionResult, LangSmithConfig } from '../types';

/**
 * LangSmith API telemetry provider.
 * Fetches run data from the LangSmith REST API.
 */
export class LangSmithProvider extends TelemetryProvider {
  readonly name = 'langsmith' as const;
  readonly displayName = 'LangSmith';

  private config: LangSmithConfig;
  private lastRequestTime = 0;
  private readonly minRequestIntervalMs = 100; // Rate limit: ~10 req/s

  constructor(config: LangSmithConfig) {
    super();
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.apiKey.length > 0;
  }

  async fetchTraces(options?: FetchOptions): Promise<TraceSpan[]> {
    if (!this.isConfigured()) {
      throw new Error('LangSmith API key not configured.');
    }

    const body: Record<string, unknown> = {
      limit: options?.limit ?? 20,
    };

    if (options?.functionName) {
      body.filter = `eq(name, "${options.functionName}")`;
    }
    if (options?.since) {
      body.start_time = options.since.toISOString();
    }
    if (options?.traceId) {
      body.trace = options.traceId;
    }

    const response = await this.request<{ runs: unknown[] }>(
      'POST',
      '/api/v1/runs/query',
      body,
    );

    const spans: TraceSpan[] = [];
    for (const run of response.runs || []) {
      try {
        const span = parseLangSmithRun(run);
        if (span) {
          spans.push(span);
        }
      } catch (err) {
        logger.warn('Failed to parse LangSmith run:', err);
      }
    }

    return spans.sort((a, b) => b.startTime - a.startTime);
  }

  async fetchTraceById(traceId: string): Promise<TraceSpan[]> {
    return this.fetchTraces({ traceId, limit: 100 });
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      if (!this.isConfigured()) {
        return {
          success: false,
          message: 'API key not configured.',
          latencyMs: Date.now() - start,
          provider: 'langsmith',
        };
      }

      await this.request('POST', '/api/v1/runs/query', { limit: 1 });
      return {
        success: true,
        message: 'Connected to LangSmith successfully.',
        latencyMs: Date.now() - start,
        provider: 'langsmith',
      };
    } catch (err) {
      return {
        success: false,
        message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - start,
        provider: 'langsmith',
      };
    }
  }

  /** Make an authenticated HTTP request to the LangSmith API with retry logic */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 1,
  ): Promise<T> {
    // Rate limiting
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minRequestIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();

    const url = new URL(path, this.config.baseUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const postData = body ? JSON.stringify(body) : undefined;

    return new Promise<T>((resolve, reject) => {
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data) as T);
              } catch {
                reject(new Error(`Invalid JSON response from LangSmith`));
              }
            } else if (res.statusCode === 429 && attempt < 3) {
              // Retry with exponential backoff
              const delay = Math.pow(2, attempt) * 1000;
              logger.warn(`LangSmith rate limited, retrying in ${delay}ms...`);
              setTimeout(() => {
                this.request<T>(method, path, body, attempt + 1)
                  .then(resolve)
                  .catch(reject);
              }, delay);
            } else {
              reject(
                new Error(
                  `LangSmith API error ${res.statusCode}: ${data.substring(0, 200)}`,
                ),
              );
            }
          });
        },
      );

      req.on('error', (err) => {
        if (attempt < 3) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.warn(`LangSmith request failed, retrying in ${delay}ms...`, err);
          setTimeout(() => {
            this.request<T>(method, path, body, attempt + 1)
              .then(resolve)
              .catch(reject);
          }, delay);
        } else {
          reject(err);
        }
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }
}
