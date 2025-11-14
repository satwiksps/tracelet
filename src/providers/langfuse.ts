import * as https from 'https';
import * as http from 'http';
import { TelemetryProvider } from './base';
import { parseLangfuseObservation } from '../schemas/langfuse';
import { logger } from '../utils/logger';
import type { TraceSpan, FetchOptions, ConnectionResult, LangfuseConfig } from '../types';

/**
 * Langfuse API telemetry provider.
 * Fetches traces and observations from the Langfuse REST API.
 */
export class LangfuseProvider extends TelemetryProvider {
  readonly name = 'langfuse' as const;
  readonly displayName = 'Langfuse';

  private config: LangfuseConfig;

  constructor(config: LangfuseConfig) {
    super();
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.publicKey.length > 0 && this.config.secretKey.length > 0;
  }

  async fetchTraces(options?: FetchOptions): Promise<TraceSpan[]> {
    if (!this.isConfigured()) {
      throw new Error('Langfuse credentials not configured.');
    }

    // Step 1: Fetch trace list
    const limit = options?.limit ?? 20;
    let tracesUrl = `/api/public/traces?limit=${limit}`;
    if (options?.since) {
      tracesUrl += `&fromTimestamp=${options.since.toISOString()}`;
    }

    const tracesResp = await this.request<{ data: Array<{ id: string }> }>('GET', tracesUrl);
    const traceIds = (tracesResp.data || []).map((t) => t.id);

    // Step 2: Fetch observations for each trace
    const allSpans: TraceSpan[] = [];
    for (const traceId of traceIds) {
      try {
        const obsResp = await this.request<{ data: unknown[] }>(
          'GET',
          `/api/public/observations?traceId=${traceId}&type=GENERATION`,
        );
        for (const obs of obsResp.data || []) {
          try {
            const span = parseLangfuseObservation(obs);
            if (span) {
              allSpans.push(span);
            }
          } catch (err) {
            logger.warn('Failed to parse Langfuse observation:', err);
          }
        }
      } catch (err) {
        logger.warn(`Failed to fetch observations for trace ${traceId}:`, err);
      }
    }

    return allSpans.sort((a, b) => b.startTime - a.startTime);
  }

  async fetchTraceById(traceId: string): Promise<TraceSpan[]> {
    if (!this.isConfigured()) {
      throw new Error('Langfuse credentials not configured.');
    }

    const obsResp = await this.request<{ data: unknown[] }>(
      'GET',
      `/api/public/observations?traceId=${traceId}`,
    );

    const spans: TraceSpan[] = [];
    for (const obs of obsResp.data || []) {
      try {
        const span = parseLangfuseObservation(obs);
        if (span) {
          spans.push(span);
        }
      } catch (err) {
        logger.warn('Failed to parse Langfuse observation:', err);
      }
    }

    return spans;
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      if (!this.isConfigured()) {
        return {
          success: false,
          message: 'Langfuse credentials not configured.',
          latencyMs: Date.now() - start,
          provider: 'langfuse',
        };
      }

      await this.request('GET', '/api/public/traces?limit=1');
      return {
        success: true,
        message: 'Connected to Langfuse successfully.',
        latencyMs: Date.now() - start,
        provider: 'langfuse',
      };
    } catch (err) {
      return {
        success: false,
        message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - start,
        provider: 'langfuse',
      };
    }
  }

  /** Make an authenticated HTTP request to the Langfuse API */
  private async request<T>(method: string, urlPath: string): Promise<T> {
    const auth = Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString(
      'base64',
    );

    const url = new URL(urlPath, this.config.host);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    return new Promise<T>((resolve, reject) => {
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
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
                reject(new Error('Invalid JSON response from Langfuse'));
              }
            } else {
              reject(
                new Error(
                  `Langfuse API error ${res.statusCode}: ${data.substring(0, 200)}`,
                ),
              );
            }
          });
        },
      );

      req.on('error', reject);
      req.end();
    });
  }
}
