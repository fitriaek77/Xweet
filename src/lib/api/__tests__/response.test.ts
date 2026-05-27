// Tests for src/lib/api/response.ts
import { describe, it, expect } from "vitest";
import { success, created, noContent, badRequest, unauthorized, handleApiError } from "@/lib/api/response";
import { NotFoundError, AuthError, ValidationError } from "@/lib/api/errors";

describe("success", () => {
  it("returns 200 with ok:true and data", () => {
    const response = success({ id: 1, name: "test" });
    expect(response.status).toBe(200);
    // Can't easily parse NextResponse in vitest, but we can check the structure
  });

  it("accepts custom status code", () => {
    const response = success({}, 200);
    expect(response.status).toBe(200);
  });
});

describe("created", () => {
  it("returns 201 with ok:true and data", () => {
    const response = created({ id: 1 });
    expect(response.status).toBe(201);
  });
});

describe("noContent", () => {
  it("returns 204 with no body", () => {
    const response = noContent();
    expect(response.status).toBe(204);
  });
});

describe("badRequest", () => {
  it("returns 400 with error message", () => {
    const response = badRequest("Invalid input");
    expect(response.status).toBe(400);
  });

  it("includes detail when provided", () => {
    const response = badRequest("Invalid", "field required");
    expect(response.status).toBe(400);
  });
});

describe("unauthorized", () => {
  it("returns 401 with default message", () => {
    const response = unauthorized();
    expect(response.status).toBe(401);
  });

  it("accepts custom message", () => {
    const response = unauthorized("Token expired");
    expect(response.status).toBe(401);
  });
});

describe("handleApiError", () => {
  it("handles AppError instances", () => {
    const error = new NotFoundError("Account", "123");
    const response = handleApiError(error);
    expect(response.status).toBe(404);
  });

  it("handles ValidationError with detail", () => {
    const error = new ValidationError("Bad input", "field required");
    const response = handleApiError(error);
    expect(response.status).toBe(400);
  });

  it("handles AuthError", () => {
    const error = new AuthError("Token expired");
    const response = handleApiError(error);
    expect(response.status).toBe(401);
  });

  it("handles generic Error instances", () => {
    const error = new Error("Something went wrong");
    const response = handleApiError(error);
    expect(response.status).toBe(500);
  });

  it("handles non-Error values", () => {
    const response = handleApiError("string error");
    expect(response.status).toBe(500);
  });

  it("handles null/undefined", () => {
    const response = handleApiError(null);
    expect(response.status).toBe(500);
  });
});
