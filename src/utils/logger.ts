import * as vscode from 'vscode';
import { OUTPUT_CHANNEL_NAME } from './constants';

/**
 * Structured logger wrapping a VS Code OutputChannel.
 * Respects the configured log level from extension settings.
 */
export class Logger {
  private static instance: Logger;
  private channel: vscode.OutputChannel;
  private level: LogLevel;

  private constructor() {
    this.channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    this.level = LogLevel.Info;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: string): void {
    switch (level.toLowerCase()) {
      case 'debug':
        this.level = LogLevel.Debug;
        break;
      case 'info':
        this.level = LogLevel.Info;
        break;
      case 'warn':
        this.level = LogLevel.Warn;
        break;
      case 'error':
        this.level = LogLevel.Error;
        break;
      default:
        this.level = LogLevel.Info;
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.Debug) {
      this.log('DEBUG', message, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.Info) {
      this.log('INFO', message, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.Warn) {
      this.log('WARN', message, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.Error) {
      this.log('ERROR', message, ...args);
    }
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private log(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formatted = args.length > 0
      ? `[${timestamp}] [${level}] ${message} ${args.map((a) => this.stringify(a)).join(' ')}`
      : `[${timestamp}] [${level}] ${message}`;
    this.channel.appendLine(formatted);
  }

  private stringify(value: unknown): string {
    if (value instanceof Error) {
      return `${value.message}\n${value.stack ?? ''}`;
    }
    if (typeof value === 'object' && value !== null) {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
}

enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

/** Convenience singleton accessor */
export const logger = Logger.getInstance();
