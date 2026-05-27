// src/types/api.ts
// API request/response types.

export interface ApiResponse<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  detail?: string;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

export interface PaginatedResponse<T> extends ApiResponse<T> {
  data: T;
  meta: { total: number; limit: number; offset: number };
}
