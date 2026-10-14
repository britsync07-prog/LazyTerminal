export const PROTOCOL_VERSION = 1;

export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

export const MIN_COLS = 10;
export const MAX_COLS = 500;

export const MIN_ROWS = 2;
export const MAX_ROWS = 200;

/** Maximum length in bytes for raw JSON message */
export const MAX_RAW_MESSAGE_BYTES = 128 * 1024; // 128 KB

/** Maximum length of data payload inside input message */
export const MAX_DATA_PAYLOAD_CHARS = 64 * 1024; // 64K chars

/** Maximum length of identifiers */
export const MAX_ID_LENGTH = 128;

export const ERROR_CODES = {
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  MESSAGE_TOO_LARGE: 'MESSAGE_TOO_LARGE',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_LIMIT_REACHED: 'SESSION_LIMIT_REACHED',
  PTY_SPAWN_ERROR: 'PTY_SPAWN_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  AUTH_FAILED: 'AUTH_FAILED',
  PAIRING_EXPIRED: 'PAIRING_EXPIRED',
  MAX_ATTEMPTS_EXCEEDED: 'MAX_ATTEMPTS_EXCEEDED',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
