import EventEmitter from 'node:events';
import crypto from 'node:crypto';
import { ERROR_CODES } from '@lazyterminal/protocol';

export interface PairingRequest {
  code: string;
  clientName: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  confirmedOnPc: boolean;
}

export interface PairingResult {
  success: boolean;
  token?: string;
  error?: string;
  code?: string;
}

export class PairingManager extends EventEmitter {
  private activeRequest: PairingRequest | null = null;
  private readonly validTokens = new Set<string>();
  private readonly pairingTimeoutMs: number;
  private readonly maxAttempts: number;

  constructor(options?: { pairingTimeoutMs?: number; maxAttempts?: number }) {
    super();
    this.pairingTimeoutMs = options?.pairingTimeoutMs ?? 60_000; // 60 seconds
    this.maxAttempts = options?.maxAttempts ?? 3;
  }

  public requestPairing(clientName = 'Unknown Device', autoConfirm = false): {
    expiresAt: number;
    challenge: string;
    code: string;
  } {
    // Generate a secure 6-digit pairing code
    const code = crypto.randomInt(100000, 1000000).toString();
    const now = Date.now();
    const expiresAt = now + this.pairingTimeoutMs;

    this.activeRequest = {
      code,
      clientName,
      createdAt: now,
      expiresAt,
      attempts: 0,
      confirmedOnPc: autoConfirm,
    };

    console.log('\n================================================================');
    console.log(` [PAIRING REQUEST] From client: "${clientName}"`);
    console.log(` >>> PAIRING CODE: ${code} <<<`);
    console.log(` This code expires in ${Math.round(this.pairingTimeoutMs / 1000)} seconds.`);
    console.log(' Enter this code in your LazyTerminal mobile app to pair.');
    console.log('================================================================\n');

    this.emit('pairing_requested', {
      clientName,
      code,
      expiresAt,
    });

    return {
      code,
      expiresAt,
      challenge: 'Enter the 6-digit code shown on your Windows PC screen',
    };
  }

  public confirmOnPc(): boolean {
    if (!this.activeRequest) return false;
    this.activeRequest.confirmedOnPc = true;
    return true;
  }

  public verifyPairingCode(inputCode: string): PairingResult {
    if (!this.activeRequest) {
      return {
        success: false,
        code: ERROR_CODES.AUTH_FAILED,
        error: 'No active pairing request found. Please initiate pairing again.',
      };
    }

    if (Date.now() > this.activeRequest.expiresAt) {
      this.activeRequest = null;
      return {
        success: false,
        code: ERROR_CODES.PAIRING_EXPIRED,
        error: 'Pairing code has expired. Please initiate pairing again.',
      };
    }

    this.activeRequest.attempts += 1;

    // Constant-time comparison to prevent timing attacks
    const expectedBuffer = Buffer.from(this.activeRequest.code, 'utf-8');
    const inputBuffer = Buffer.from(inputCode, 'utf-8');

    const matches =
      expectedBuffer.length === inputBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, inputBuffer);

    if (!matches) {
      if (this.activeRequest.attempts >= this.maxAttempts) {
        this.activeRequest = null;
        return {
          success: false,
          code: ERROR_CODES.MAX_ATTEMPTS_EXCEEDED,
          error: `Maximum pairing attempts (${this.maxAttempts}) exceeded. Pairing request cancelled.`,
        };
      }

      return {
        success: false,
        code: ERROR_CODES.AUTH_FAILED,
        error: `Incorrect pairing code. (${this.maxAttempts - this.activeRequest.attempts} attempts remaining)`,
      };
    }

    // Success: Generate a cryptographically strong 256-bit token
    const token = crypto.randomBytes(32).toString('hex');
    this.validTokens.add(token);
    const clientName = this.activeRequest.clientName;
    this.activeRequest = null;

    console.log(`[PairingManager] Device "${clientName}" paired successfully.`);
    this.emit('paired', { clientName, token });

    return {
      success: true,
      token,
    };
  }

  public validateToken(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    return this.validTokens.has(token);
  }

  public revokeToken(token: string): void {
    this.validTokens.delete(token);
  }

  public getActiveRequest(): Readonly<PairingRequest> | null {
    if (!this.activeRequest) return null;
    if (Date.now() > this.activeRequest.expiresAt) {
      this.activeRequest = null;
      return null;
    }
    return this.activeRequest;
  }
}
