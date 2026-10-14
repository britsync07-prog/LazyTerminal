import { describe, it, expect } from 'vitest';
import { PairingManager } from '../src/pairing-manager.js';
import { ERROR_CODES } from '@lazyterminal/protocol';

describe('PairingManager', () => {
  it('generates a 6-digit code and challenge', () => {
    const manager = new PairingManager({ pairingTimeoutMs: 30000 });
    const req = manager.requestPairing('Pixel 8 Pro');

    expect(req.code).toMatch(/^\d{6}$/);
    expect(req.expiresAt).toBeGreaterThan(Date.now());
    expect(req.challenge).toBeDefined();
  });

  it('successfully verifies correct code and issues token', () => {
    const manager = new PairingManager();
    const req = manager.requestPairing('Pixel 8 Pro');

    const result = manager.verifyPairingCode(req.code);
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe('string');
    expect(result.token!.length).toBe(64); // 32 bytes hex

    // Token must now be valid
    expect(manager.validateToken(result.token!)).toBe(true);
  });

  it('rejects incorrect code and enforces attempt limits', () => {
    const manager = new PairingManager({ maxAttempts: 3 });
    const req = manager.requestPairing('Pixel 8 Pro');

    // Attempt 1: wrong code
    const res1 = manager.verifyPairingCode('000000');
    expect(res1.success).toBe(false);
    expect(res1.code).toBe(ERROR_CODES.AUTH_FAILED);

    // Attempt 2: wrong code
    const res2 = manager.verifyPairingCode('111111');
    expect(res2.success).toBe(false);
    expect(res2.code).toBe(ERROR_CODES.AUTH_FAILED);

    // Attempt 3: wrong code -> exceeds max attempts
    const res3 = manager.verifyPairingCode('222222');
    expect(res3.success).toBe(false);
    expect(res3.code).toBe(ERROR_CODES.MAX_ATTEMPTS_EXCEEDED);

    // Next attempt: request is wiped out
    const res4 = manager.verifyPairingCode(req.code);
    expect(res4.success).toBe(false);
  });

  it('rejects expired pairing requests', async () => {
    // 50ms expiration for test
    const manager = new PairingManager({ pairingTimeoutMs: 50 });
    const req = manager.requestPairing('Pixel 8 Pro');

    await new Promise((r) => setTimeout(r, 80));

    const result = manager.verifyPairingCode(req.code);
    expect(result.success).toBe(false);
    expect(result.code).toBe(ERROR_CODES.PAIRING_EXPIRED);
  });

  it('allows token revocation', () => {
    const manager = new PairingManager();
    const req = manager.requestPairing('Pixel 8 Pro');
    const result = manager.verifyPairingCode(req.code);
    expect(result.success).toBe(true);
    const token = result.token!;

    expect(manager.validateToken(token)).toBe(true);
    manager.revokeToken(token);
    expect(manager.validateToken(token)).toBe(false);
  });
});
