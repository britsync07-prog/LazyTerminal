import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  parseServerMessage,
  serializeMessage,
  MAX_RAW_MESSAGE_BYTES,
  MAX_DATA_PAYLOAD_CHARS,
  ClientMessage,
  ServerMessage,
} from '../src/index.js';

describe('Protocol Validation', () => {
  describe('parseClientMessage', () => {
    it('parses valid terminal:create message with default dimensions', () => {
      const raw = JSON.stringify({
        type: 'terminal:create',
        requestId: 'req-1',
      });
      const result = parseClientMessage(raw);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('terminal:create');
        expect(result.data.requestId).toBe('req-1');
        expect(result.data.cols).toBe(80);
        expect(result.data.rows).toBe(24);
      }
    });

    it('parses valid terminal:create message with custom dimensions and cwd', () => {
      const raw = JSON.stringify({
        type: 'terminal:create',
        requestId: 'req-2',
        cols: 120,
        rows: 40,
        cwd: 'C:\\Users',
      });
      const result = parseClientMessage(raw);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cols).toBe(120);
        expect(result.data.rows).toBe(40);
        expect(result.data.cwd).toBe('C:\\Users');
      }
    });

    it('rejects invalid cols or rows dimensions', () => {
      // Too small cols
      const smallCols = JSON.stringify({
        type: 'terminal:create',
        requestId: 'req-3',
        cols: 5, // min is 10
        rows: 24,
      });
      expect(parseClientMessage(smallCols).success).toBe(false);

      // Too large cols
      const largeCols = JSON.stringify({
        type: 'terminal:resize',
        sessionId: 'sess-1',
        cols: 600, // max is 500
        rows: 24,
      });
      expect(parseClientMessage(largeCols).success).toBe(false);

      // Too small rows
      const smallRows = JSON.stringify({
        type: 'terminal:resize',
        sessionId: 'sess-1',
        cols: 80,
        rows: 1, // min is 2
      });
      expect(parseClientMessage(smallRows).success).toBe(false);

      // Non-integer dimensions
      const floatDims = JSON.stringify({
        type: 'terminal:resize',
        sessionId: 'sess-1',
        cols: 80.5,
        rows: 24,
      });
      expect(parseClientMessage(floatDims).success).toBe(false);
    });

    it('parses valid terminal:input message', () => {
      const raw = JSON.stringify({
        type: 'terminal:input',
        sessionId: 'sess-1',
        data: 'Get-Process\r\n',
      });
      const result = parseClientMessage(raw);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('terminal:input');
        expect(result.data.data).toBe('Get-Process\r\n');
      }
    });

    it('rejects oversized data in terminal:input message', () => {
      const longData = 'a'.repeat(MAX_DATA_PAYLOAD_CHARS + 1);
      const raw = JSON.stringify({
        type: 'terminal:input',
        sessionId: 'sess-1',
        data: longData,
      });
      const result = parseClientMessage(raw);
      expect(result.success).toBe(false);
    });

    it('rejects oversized raw JSON string', () => {
      const oversizedRaw = ' '.repeat(MAX_RAW_MESSAGE_BYTES + 10);
      const result = parseClientMessage(oversizedRaw);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('exceeds maximum limit');
      }
    });

    it('rejects unknown message type', () => {
      const raw = JSON.stringify({
        type: 'terminal:unknown_action',
        payload: 123,
      });
      const result = parseClientMessage(raw);
      expect(result.success).toBe(false);
    });

    it('rejects malformed JSON', () => {
      const raw = '{ invalid json ';
      const result = parseClientMessage(raw);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid JSON');
      }
    });

    it('parses terminal:interrupt and terminal:close messages', () => {
      const interruptMsg = JSON.stringify({
        type: 'terminal:interrupt',
        sessionId: 'sess-123',
      });
      expect(parseClientMessage(interruptMsg).success).toBe(true);

      const closeMsg = JSON.stringify({
        type: 'terminal:close',
        sessionId: 'sess-123',
      });
      expect(parseClientMessage(closeMsg).success).toBe(true);
    });

    it('parses ping message', () => {
      const pingMsg = JSON.stringify({
        type: 'ping',
        timestamp: 123456789,
      });
      const result = parseClientMessage(pingMsg);
      expect(result.success).toBe(true);
    });
  });

  describe('parseServerMessage and serializeMessage', () => {
    it('serializes and parses terminal:output message', () => {
      const serverMsg: ServerMessage = {
        type: 'terminal:output',
        sessionId: 'sess-1',
        data: 'PS C:\\> ',
      };
      const serialized = serializeMessage(serverMsg);
      const parsed = parseServerMessage(serialized);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual(serverMsg);
      }
    });

    it('serializes and parses terminal:error message', () => {
      const serverMsg: ServerMessage = {
        type: 'terminal:error',
        requestId: 'req-fail',
        code: 'SESSION_NOT_FOUND',
        message: 'No session with id sess-999',
      };
      const serialized = serializeMessage(serverMsg);
      const parsed = parseServerMessage(serialized);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual(serverMsg);
      }
    });
  });
});
