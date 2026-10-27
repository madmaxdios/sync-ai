import { ExitCode } from './exit-code';

export class AppError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = ExitCode.Error,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UsageError extends AppError {
  constructor(message: string) {
    super(message, ExitCode.Usage);
    this.name = 'UsageError';
  }
}
