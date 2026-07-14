/**
 * Biometric Authentication — WebAuthn + Payment Authorization
 * Enables Face ID / Fingerprint for:
 * - Login authentication
 * - Payment authorization (replacing OTP)
 * - Recurring premium confirmation
 *
 * Offline-capable: credentials stored on device
 */

export interface BiometricCredential {
  credentialId: string;
  publicKey: string;
  type: 'platform' | 'cross-platform';
  transports: string[];
  createdAt: string;
}

export interface AuthenticateResult {
  success: boolean;
  credential_id: string;
  assertion: string;
  timestamp: string;
}

class BiometricAuthClient {
  private rpId: string;
  private rpName: string;

  constructor(rpId: string = 'insureportal.ng', rpName: string = 'InsurePortal') {
    this.rpId = rpId;
    this.rpName = rpName;
  }

  async isAvailable(): Promise<boolean> {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  async register(userId: string, userName: string): Promise<BiometricCredential | null> {
    if (!await this.isAvailable()) return null;

    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { id: this.rpId, name: this.rpName },
          user: {
            id: new TextEncoder().encode(userId),
            name: userName,
            displayName: userName,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256
            { type: 'public-key', alg: -257 },  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
        },
      }) as PublicKeyCredential;

      if (!credential) return null;

      const response = credential.response as AuthenticatorAttestationResponse;
      return {
        credentialId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
        publicKey: btoa(String.fromCharCode(...new Uint8Array(response.getPublicKey()!))),
        type: 'platform',
        transports: (response as any).getTransports?.() || ['internal'],
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[BiometricAuth] Registration failed:', error);
      return null;
    }
  }

  async authenticate(credentialId?: string): Promise<AuthenticateResult | null> {
    if (!await this.isAvailable()) return null;

    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const options: PublicKeyCredentialRequestOptions = {
        challenge,
        rpId: this.rpId,
        userVerification: 'required',
        timeout: 60000,
      };

      if (credentialId) {
        options.allowCredentials = [{
          type: 'public-key',
          id: Uint8Array.from(atob(credentialId), c => c.charCodeAt(0)),
          transports: ['internal'],
        }];
      }

      const assertion = await navigator.credentials.get({ publicKey: options }) as PublicKeyCredential;
      if (!assertion) return null;

      return {
        success: true,
        credential_id: btoa(String.fromCharCode(...new Uint8Array(assertion.rawId))),
        assertion: btoa(String.fromCharCode(...new Uint8Array((assertion.response as AuthenticatorAssertionResponse).signature))),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[BiometricAuth] Authentication failed:', error);
      return null;
    }
  }

  async authorizePayment(amount: number, description: string): Promise<boolean> {
    const result = await this.authenticate();
    if (!result?.success) return false;

    // In production: send assertion to server for verification
    console.log(`[BiometricAuth] Payment authorized: ₦${amount.toLocaleString()} - ${description}`);
    return true;
  }
}

export function createBiometricAuth(rpId?: string): BiometricAuthClient {
  return new BiometricAuthClient(rpId);
}

export default BiometricAuthClient;
