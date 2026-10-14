import { z } from 'zod';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MIN_COLS,
  MAX_COLS,
  MIN_ROWS,
  MAX_ROWS,
  MAX_DATA_PAYLOAD_CHARS,
  MAX_ID_LENGTH,
} from './constants.js';

const idSchema = z.string().min(1).max(MAX_ID_LENGTH);

// Client to Agent messages
export const TerminalCreateMessageSchema = z.object({
  type: z.literal('terminal:create'),
  requestId: idSchema,
  cols: z.number().int().min(MIN_COLS).max(MAX_COLS).optional().default(DEFAULT_COLS),
  rows: z.number().int().min(MIN_ROWS).max(MAX_ROWS).optional().default(DEFAULT_ROWS),
  cwd: z.string().max(1024).optional(),
});

export const TerminalInputMessageSchema = z.object({
  type: z.literal('terminal:input'),
  sessionId: idSchema,
  data: z.string().max(MAX_DATA_PAYLOAD_CHARS),
});

export const TerminalResizeMessageSchema = z.object({
  type: z.literal('terminal:resize'),
  sessionId: idSchema,
  cols: z.number().int().min(MIN_COLS).max(MAX_COLS),
  rows: z.number().int().min(MIN_ROWS).max(MAX_ROWS),
});

export const TerminalInterruptMessageSchema = z.object({
  type: z.literal('terminal:interrupt'),
  sessionId: idSchema,
});

export const TerminalCloseMessageSchema = z.object({
  type: z.literal('terminal:close'),
  sessionId: idSchema,
});

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
  timestamp: z.number().optional(),
});

export const AuthPairRequestMessageSchema = z.object({
  type: z.literal('auth:pair_request'),
  clientName: z.string().max(64).optional(),
});

export const AuthPairVerifyMessageSchema = z.object({
  type: z.literal('auth:pair_verify'),
  code: z.string().min(4).max(16),
});

export const AuthConnectMessageSchema = z.object({
  type: z.literal('auth:connect'),
  token: z.string().min(16).max(256),
});

export const SessionListMessageSchema = z.object({
  type: z.literal('session:list'),
  requestId: z.string().optional(),
});

export const SessionAttachMessageSchema = z.object({
  type: z.literal('session:attach'),
  sessionId: idSchema,
  cols: z.number().int().min(MIN_COLS).max(MAX_COLS).optional(),
  rows: z.number().int().min(MIN_ROWS).max(MAX_ROWS).optional(),
});

export const SessionDetachMessageSchema = z.object({
  type: z.literal('session:detach'),
  sessionId: idSchema,
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  TerminalCreateMessageSchema,
  TerminalInputMessageSchema,
  TerminalResizeMessageSchema,
  TerminalInterruptMessageSchema,
  TerminalCloseMessageSchema,
  SessionListMessageSchema,
  SessionAttachMessageSchema,
  SessionDetachMessageSchema,
  PingMessageSchema,
  AuthPairRequestMessageSchema,
  AuthPairVerifyMessageSchema,
  AuthConnectMessageSchema,
]);

// Agent to Client messages
export const TerminalCreatedMessageSchema = z.object({
  type: z.literal('terminal:created'),
  requestId: idSchema,
  sessionId: idSchema,
  cols: z.number().int().min(MIN_COLS).max(MAX_COLS),
  rows: z.number().int().min(MIN_ROWS).max(MAX_ROWS),
  title: z.string().optional(),
});

export const TerminalOutputMessageSchema = z.object({
  type: z.literal('terminal:output'),
  sessionId: idSchema,
  data: z.string(),
});

export const TerminalExitMessageSchema = z.object({
  type: z.literal('terminal:exit'),
  sessionId: idSchema,
  exitCode: z.number().int(),
});

export const TerminalErrorMessageSchema = z.object({
  type: z.literal('terminal:error'),
  requestId: idSchema.optional(),
  sessionId: idSchema.optional(),
  code: z.string(),
  message: z.string(),
});

export const PongMessageSchema = z.object({
  type: z.literal('pong'),
  timestamp: z.number().optional(),
});

export const AuthPairPromptMessageSchema = z.object({
  type: z.literal('auth:pair_prompt'),
  challenge: z.string(),
  expiresAt: z.number(),
});

export const AuthPairSuccessMessageSchema = z.object({
  type: z.literal('auth:pair_success'),
  token: z.string(),
});

export const AuthSuccessMessageSchema = z.object({
  type: z.literal('auth:success'),
});

export const SessionSummarySchema = z.object({
  sessionId: idSchema,
  shell: z.string(),
  cols: z.number().int().min(MIN_COLS).max(MAX_COLS),
  rows: z.number().int().min(MIN_ROWS).max(MAX_ROWS),
  createdAt: z.number(),
  attachedClients: z.number().int().nonnegative(),
  status: z.enum(['active', 'exited']),
  title: z.string().optional(),
});

export const ExternalProcessSummarySchema = z.object({
  pid: z.number().int(),
  name: z.string(),
  managed: z.literal(false),
  attachable: z.literal(false),
  description: z.string().optional(),
  windowTitle: z.string().optional(),
});

export const SessionListResponseMessageSchema = z.object({
  type: z.literal('session:list_response'),
  requestId: z.string().optional(),
  sessions: z.array(SessionSummarySchema),
  externalProcesses: z.array(ExternalProcessSummarySchema),
});

export const SessionAttachedMessageSchema = z.object({
  type: z.literal('session:attached'),
  sessionId: idSchema,
  cols: z.number().int().min(MIN_COLS).max(MAX_COLS),
  rows: z.number().int().min(MIN_ROWS).max(MAX_ROWS),
  recentOutput: z.string().optional(),
});

export const SessionDetachedMessageSchema = z.object({
  type: z.literal('session:detached'),
  sessionId: idSchema,
});

export const SessionCreatedMessageSchema = z.object({
  type: z.literal('session:created'),
  session: SessionSummarySchema,
});

export const SessionClosedMessageSchema = z.object({
  type: z.literal('session:closed'),
  sessionId: idSchema,
  exitCode: z.number().int().optional(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  TerminalCreatedMessageSchema,
  TerminalOutputMessageSchema,
  TerminalExitMessageSchema,
  TerminalErrorMessageSchema,
  SessionListResponseMessageSchema,
  SessionAttachedMessageSchema,
  SessionDetachedMessageSchema,
  SessionCreatedMessageSchema,
  SessionClosedMessageSchema,
  PongMessageSchema,
  AuthPairPromptMessageSchema,
  AuthPairSuccessMessageSchema,
  AuthSuccessMessageSchema,
]);
