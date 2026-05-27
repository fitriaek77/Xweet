// src/lib/api/errors.ts
// Structured error classes — every error in the app is one of these.
// No raw Error throws in business logic.

export class AppError extends Error {
  readonly statusCode: number;
  readonly detail?: string | undefined;

  constructor(message: string, statusCode: number, detail?: string | undefined) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} not found: ${id}` : `${resource} not found`,
      404
    );
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 400, detail);
    this.name = "ValidationError";
  }
}

export class AuthError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
    this.name = "AuthError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export class TwitterApiError extends AppError {
  readonly twitterStatus: number;
  readonly errorClass?: string | undefined;

  constructor(message: string, twitterStatus: number, detail?: string | undefined, errorClass?: string | undefined) {
    super(message, 502, detail);
    this.name = "TwitterApiError";
    this.twitterStatus = twitterStatus;
    this.errorClass = errorClass;
  }
}

export class CircuitOpenError extends AppError {
  readonly cooldownUntil: Date;

  constructor(accountId: string, cooldownUntil: Date) {
    super(
      `Circuit open for account ${accountId}`,
      503,
      `Cooldown until ${cooldownUntil.toISOString()}`
    );
    this.name = "CircuitOpenError";
    this.cooldownUntil = cooldownUntil;
  }
}
