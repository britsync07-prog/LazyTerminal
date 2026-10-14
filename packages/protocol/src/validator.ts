import { MAX_RAW_MESSAGE_BYTES } from './constants.js';
import { ClientMessageSchema, ServerMessageSchema } from './schemas.js';
import { ClientMessage, ParsedClientMessage, ServerMessage, ParseResult } from './types.js';

export function parseClientMessage(raw: unknown): ParseResult<ParsedClientMessage> {
  let parsedJson: unknown = raw;

  if (typeof raw === 'string') {
    if (raw.length > MAX_RAW_MESSAGE_BYTES) {
      return {
        success: false,
        error: `Message size ${raw.length} exceeds maximum limit of ${MAX_RAW_MESSAGE_BYTES} bytes`,
        issues: [],
      };
    }
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      return {
        success: false,
        error: `Invalid JSON: ${(err as Error).message}`,
        issues: [],
      };
    }
  }

  const result = ClientMessageSchema.safeParse(parsedJson);
  if (!result.success) {
    return {
      success: false,
      error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      issues: result.error.issues,
    };
  }

  return { success: true, data: result.data };
}

export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  let parsedJson: unknown = raw;

  if (typeof raw === 'string') {
    if (raw.length > MAX_RAW_MESSAGE_BYTES) {
      return {
        success: false,
        error: `Message size ${raw.length} exceeds maximum limit of ${MAX_RAW_MESSAGE_BYTES} bytes`,
        issues: [],
      };
    }
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      return {
        success: false,
        error: `Invalid JSON: ${(err as Error).message}`,
        issues: [],
      };
    }
  }

  const result = ServerMessageSchema.safeParse(parsedJson);
  if (!result.success) {
    return {
      success: false,
      error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      issues: result.error.issues,
    };
  }

  return { success: true, data: result.data };
}

export function serializeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
