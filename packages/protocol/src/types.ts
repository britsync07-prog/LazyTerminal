import { z } from 'zod';
import {
  ClientMessageSchema,
  ServerMessageSchema,
  TerminalCreateMessageSchema,
  TerminalInputMessageSchema,
  TerminalResizeMessageSchema,
  TerminalInterruptMessageSchema,
  TerminalCloseMessageSchema,
  PingMessageSchema,
  AuthPairRequestMessageSchema,
  AuthPairVerifyMessageSchema,
  AuthConnectMessageSchema,
  TerminalCreatedMessageSchema,
  TerminalOutputMessageSchema,
  TerminalExitMessageSchema,
  TerminalErrorMessageSchema,
  PongMessageSchema,
  AuthPairPromptMessageSchema,
  AuthPairSuccessMessageSchema,
  AuthSuccessMessageSchema,
  SessionListMessageSchema,
  SessionAttachMessageSchema,
  SessionDetachMessageSchema,
  SessionSummarySchema,
  ExternalProcessSummarySchema,
  SessionListResponseMessageSchema,
  SessionAttachedMessageSchema,
  SessionDetachedMessageSchema,
  SessionCreatedMessageSchema,
  SessionClosedMessageSchema,
} from './schemas.js';

export type ClientMessage = z.input<typeof ClientMessageSchema>;
export type ParsedClientMessage = z.output<typeof ClientMessageSchema>;

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type TerminalCreateMessage = z.input<typeof TerminalCreateMessageSchema>;
export type ParsedTerminalCreateMessage = z.output<typeof TerminalCreateMessageSchema>;

export type TerminalInputMessage = z.infer<typeof TerminalInputMessageSchema>;
export type TerminalResizeMessage = z.infer<typeof TerminalResizeMessageSchema>;
export type TerminalInterruptMessage = z.infer<typeof TerminalInterruptMessageSchema>;
export type TerminalCloseMessage = z.infer<typeof TerminalCloseMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;

export type AuthPairRequestMessage = z.infer<typeof AuthPairRequestMessageSchema>;
export type AuthPairVerifyMessage = z.infer<typeof AuthPairVerifyMessageSchema>;
export type AuthConnectMessage = z.infer<typeof AuthConnectMessageSchema>;

export type SessionListMessage = z.infer<typeof SessionListMessageSchema>;
export type SessionAttachMessage = z.infer<typeof SessionAttachMessageSchema>;
export type SessionDetachMessage = z.infer<typeof SessionDetachMessageSchema>;

export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type ExternalProcessSummary = z.infer<typeof ExternalProcessSummarySchema>;
export type SessionListResponseMessage = z.infer<typeof SessionListResponseMessageSchema>;
export type SessionAttachedMessage = z.infer<typeof SessionAttachedMessageSchema>;
export type SessionDetachedMessage = z.infer<typeof SessionDetachedMessageSchema>;
export type SessionCreatedMessage = z.infer<typeof SessionCreatedMessageSchema>;
export type SessionClosedMessage = z.infer<typeof SessionClosedMessageSchema>;

export type TerminalCreatedMessage = z.infer<typeof TerminalCreatedMessageSchema>;
export type TerminalOutputMessage = z.infer<typeof TerminalOutputMessageSchema>;
export type TerminalExitMessage = z.infer<typeof TerminalExitMessageSchema>;
export type TerminalErrorMessage = z.infer<typeof TerminalErrorMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;

export type AuthPairPromptMessage = z.infer<typeof AuthPairPromptMessageSchema>;
export type AuthPairSuccessMessage = z.infer<typeof AuthPairSuccessMessageSchema>;
export type AuthSuccessMessage = z.infer<typeof AuthSuccessMessageSchema>;

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; issues: z.ZodIssue[] };
