/**
 * Minimal type stub for the `openid` package (v2.0.x).
 * No @types/openid exists on DefinitelyTyped. These types cover only the
 * surface used by the Steam OpenID routes.
 */
declare module "openid" {
  export interface VerifyResult {
    authenticated: boolean;
    claimedIdentifier?: string;
  }

  type AuthCallback = (err: Error | null, authUrl: string | null) => void;
  type VerifyCallback = (err: Error | null, result: VerifyResult) => void;

  export class RelyingParty {
    constructor(
      returnUrl: string,
      realm: string | null,
      stateless: boolean,
      strict: boolean,
      extensions: unknown[],
    );
    authenticate(
      identifier: string,
      immediate: boolean,
      callback: AuthCallback,
    ): void;
    verifyAssertion(
      requestOrUrl: string,
      callback: VerifyCallback,
    ): void;
  }
}
