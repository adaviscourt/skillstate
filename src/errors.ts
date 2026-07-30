import { EXIT_BACKEND, EXIT_CONFIG, EXIT_FAILURE } from "./model.js";

export class SkillstateError extends Error {
  readonly exitCode: number;
  readonly hint: string | undefined;

  constructor(message: string, options?: { exitCode?: number; hint?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "SkillstateError";
    this.exitCode = options?.exitCode ?? EXIT_FAILURE;
    this.hint = options?.hint;
  }
}

export class ConfigError extends SkillstateError {
  constructor(message: string, hint?: string, cause?: unknown) {
    super(message, { exitCode: EXIT_CONFIG, ...(hint ? { hint } : {}), cause });
    this.name = "ConfigError";
  }
}

export class BackendError extends SkillstateError {
  constructor(message: string, hint?: string, cause?: unknown) {
    super(message, { exitCode: EXIT_BACKEND, ...(hint ? { hint } : {}), cause });
    this.name = "BackendError";
  }
}
