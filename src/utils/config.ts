import * as vscode from 'vscode';
import { ConfigKeys, Defaults } from './constants';
import type { DataSource } from '../types/trace';
import type { TraceletConfig, LangSmithConfig, LangfuseConfig, OtelConfig } from '../types/config';

/**
 * Type-safe configuration reader for Tracelet settings.
 * Wraps vscode.workspace.getConfiguration with typed accessors.
 */
export class ConfigReader {
  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration();
  }

  /** Get the full Tracelet configuration */
  getAll(): TraceletConfig {
    return {
      activeProvider: this.getActiveProvider(),
      otel: this.getOtelConfig(),
      langsmith: this.getLangSmithConfig(),
      langfuse: this.getLangfuseConfig(),
      heatmap: {
        enabled: this.config.get<boolean>(ConfigKeys.HEATMAP_ENABLED, true),
        intensity: this.config.get<number>(ConfigKeys.HEATMAP_INTENSITY, Defaults.HEATMAP_INTENSITY),
      },
      codeLens: {
        enabled: this.config.get<boolean>(ConfigKeys.CODELENS_ENABLED, true),
      },
      autoRefresh: {
        enabled: this.config.get<boolean>(ConfigKeys.AUTO_REFRESH_ENABLED, false),
        intervalSeconds: this.config.get<number>(
          ConfigKeys.AUTO_REFRESH_INTERVAL,
          Defaults.AUTO_REFRESH_INTERVAL_SECONDS,
        ),
      },
      maxTraces: this.config.get<number>(ConfigKeys.MAX_TRACES, Defaults.MAX_TRACES),
      logLevel: this.config.get<string>(ConfigKeys.LOG_LEVEL, Defaults.LOG_LEVEL),
    };
  }

  getActiveProvider(): DataSource {
    return this.config.get<DataSource>(ConfigKeys.ACTIVE_PROVIDER, 'otel-local');
  }

  getOtelConfig(): OtelConfig {
    return {
      logDirectory: this.config.get<string>(ConfigKeys.OTEL_LOG_DIRECTORY, ''),
      filePattern: this.config.get<string>(ConfigKeys.OTEL_FILE_PATTERN, Defaults.OTEL_FILE_PATTERN),
    };
  }

  getLangSmithConfig(): LangSmithConfig {
    return {
      apiKey: this.config.get<string>(ConfigKeys.LANGSMITH_API_KEY, ''),
      baseUrl: this.config.get<string>(ConfigKeys.LANGSMITH_BASE_URL, Defaults.LANGSMITH_BASE_URL),
      projectName: this.config.get<string>(ConfigKeys.LANGSMITH_PROJECT_NAME, ''),
    };
  }

  getLangfuseConfig(): LangfuseConfig {
    return {
      publicKey: this.config.get<string>(ConfigKeys.LANGFUSE_PUBLIC_KEY, ''),
      secretKey: this.config.get<string>(ConfigKeys.LANGFUSE_SECRET_KEY, ''),
      host: this.config.get<string>(ConfigKeys.LANGFUSE_HOST, Defaults.LANGFUSE_HOST),
    };
  }

  /** Listen for configuration changes */
  onDidChange(callback: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tracelet')) {
        callback(e);
      }
    });
  }
}

export const configReader = new ConfigReader();
