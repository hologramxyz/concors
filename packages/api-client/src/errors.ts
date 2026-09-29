/**
 * The API answered with a non-2xx status. `code` carries the machine-readable code when the server
 * sent one (or `INVALID_RESPONSE` when the answer did not match its schema); `status` is always set
 * so callers can special-case 401 (session expired or revoked).
 */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
}

/** The request never reached the API (offline, DNS, CORS, TLS). Nothing about the session changed. */
export class ApiNetworkError extends Error {
  override readonly name = "ApiNetworkError";

  constructor(baseUrl: string, cause: unknown) {
    super(`Could not reach the Concors API at ${baseUrl}`, { cause });
  }
}
