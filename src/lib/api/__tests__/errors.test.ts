// Tests for src/lib/api/errors.ts
import { describe, it, expect } from "vitest";
import {
  AppError,
  NotFoundError,
  ValidationError,
  AuthError,
  ForbiddenError,
  ConflictError,
  TwitterApiError,
  CircuitOpenError,
} from "@/lib/api/errors";

describe("AppError", () => {
  it("creates error with message and statusCode", () => {
    const error = new AppError("test error", 400);
    expect(error.message).toBe("test error");
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe("AppError");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });

  it("creates error with optional detail", () => {
    const error = new AppError("test", 400, "detail info");
    expect(error.detail).toBe("detail info");
  });

  it("has undefined detail when not provided", () => {
    const error = new AppError("test", 400);
    expect(error.detail).toBeUndefined();
  });
});

describe("NotFoundError", () => {
  it("creates error with resource name and id", () => {
    const error = new NotFoundError("Account", "abc123");
    expect(error.message).toBe("Account not found: abc123");
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe("NotFoundError");
  });

  it("creates error with resource name only", () => {
    const error = new NotFoundError("Account");
    expect(error.message).toBe("Account not found");
    expect(error.statusCode).toBe(404);
  });

  it("is an instance of AppError", () => {
    const error = new NotFoundError("Resource");
    expect(error).toBeInstanceOf(AppError);
  });
});

describe("ValidationError", () => {
  it("creates error with message and detail", () => {
    const error = new ValidationError("Invalid input", "field required");
    expect(error.message).toBe("Invalid input");
    expect(error.statusCode).toBe(400);
    expect(error.detail).toBe("field required");
    expect(error.name).toBe("ValidationError");
  });

  it("creates error without detail", () => {
    const error = new ValidationError("Invalid input");
    expect(error.detail).toBeUndefined();
  });
});

describe("AuthError", () => {
  it("creates error with default message", () => {
    const error = new AuthError();
    expect(error.message).toBe("Unauthorized");
    expect(error.statusCode).toBe(401);
    expect(error.name).toBe("AuthError");
  });

  it("creates error with custom message", () => {
    const error = new AuthError("Token expired");
    expect(error.message).toBe("Token expired");
  });
});

describe("ForbiddenError", () => {
  it("creates error with default message", () => {
    const error = new ForbiddenError();
    expect(error.message).toBe("Forbidden");
    expect(error.statusCode).toBe(403);
    expect(error.name).toBe("ForbiddenError");
  });

  it("creates error with custom message", () => {
    const error = new ForbiddenError("Access denied");
    expect(error.message).toBe("Access denied");
  });
});

describe("ConflictError", () => {
  it("creates error with message", () => {
    const error = new ConflictError("Already exists");
    expect(error.message).toBe("Already exists");
    expect(error.statusCode).toBe(409);
    expect(error.name).toBe("ConflictError");
  });
});

describe("TwitterApiError", () => {
  it("creates error with message, twitterStatus, and detail", () => {
    const error = new TwitterApiError("API failed", 429, "rate limited");
    expect(error.message).toBe("API failed");
    expect(error.twitterStatus).toBe(429);
    expect(error.statusCode).toBe(502); // Always 502 for TwitterApiError
    expect(error.detail).toBe("rate limited");
    expect(error.name).toBe("TwitterApiError");
  });

  it("creates error without detail", () => {
    const error = new TwitterApiError("API failed", 500);
    expect(error.detail).toBeUndefined();
  });
});

describe("CircuitOpenError", () => {
  it("creates error with accountId and cooldownUntil", () => {
    const cooldown = new Date(Date.now() + 1800000);
    const error = new CircuitOpenError("account123", cooldown);
    expect(error.message).toContain("account123");
    expect(error.statusCode).toBe(503);
    expect(error.cooldownUntil).toBe(cooldown);
    expect(error.name).toBe("CircuitOpenError");
    expect(error.detail).toContain(cooldown.toISOString());
  });
});
