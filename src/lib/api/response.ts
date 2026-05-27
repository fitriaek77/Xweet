// src/lib/api/response.ts
// Standardized API response helpers.
// Every route handler uses these — consistent shape, no ad-hoc responses.

import { NextResponse } from "next/server";
import { AppError } from "./errors";

type SuccessData<T> = { ok: true; data: T };
type ErrorData = { ok: false; error: string; detail?: string | undefined };

export function success<T>(data: T, status = 200): NextResponse<SuccessData<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function created<T>(data: T): NextResponse<SuccessData<T>> {
  return NextResponse.json({ ok: true, data }, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message: string, detail?: string | undefined): NextResponse<ErrorData> {
  return NextResponse.json(
    { ok: false, error: message, ...(detail !== undefined && { detail }) },
    { status: 400 }
  );
}

export function unauthorized(message = "Unauthorized"): NextResponse<ErrorData> {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden"): NextResponse<ErrorData> {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

export function notFound(message = "Not found"): NextResponse<ErrorData> {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export function conflict(message: string): NextResponse<ErrorData> {
  return NextResponse.json({ ok: false, error: message }, { status: 409 });
}

export function handleApiError(error: unknown): NextResponse<ErrorData> {
  if (error instanceof AppError) {
    return NextResponse.json(
      { ok: false, error: error.message, ...(error.detail !== undefined && { detail: error.detail }) },
      { status: error.statusCode }
    );
  }

  if (error instanceof Error) {
    process.stderr.write(`[API Error] ${error.message} ${error.stack ?? ""}\n`);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }

  process.stderr.write(`[API Error] Unknown error: ${String(error)}\n`);
  return NextResponse.json(
    { ok: false, error: "Internal server error" },
    { status: 500 }
  );
}
