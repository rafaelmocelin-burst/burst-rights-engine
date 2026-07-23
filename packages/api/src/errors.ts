/**
 * Typed API errors. Each carries the HTTP status and a stable machine-readable
 * `code` so clients (including the UE5 thin client) can branch on the code
 * rather than parsing prose — the message is for humans and may change.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown): ApiError =>
  new ApiError(400, code, message, details);

export const unauthorized = (message = 'Missing or invalid credentials'): ApiError =>
  new ApiError(401, 'unauthorized', message);

export const forbidden = (message = 'Not permitted'): ApiError =>
  new ApiError(403, 'forbidden', message);

export const notFound = (code: string, message: string): ApiError =>
  new ApiError(404, code, message);

export const conflict = (code: string, message: string): ApiError =>
  new ApiError(409, code, message);

export const internal = (message = 'Internal error'): ApiError =>
  new ApiError(500, 'internal_error', message);
