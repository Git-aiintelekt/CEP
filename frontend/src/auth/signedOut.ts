/** Why the last session ended, for the login screen's notice: 'idle' (SessionIdleGuard), 'expired' (the API refused the session)
 * 'unknown-workspace' (the API knows no workspace by the code this tab was using) or 'ofbiz-signed-out' (a session opened
 * from OFBiz, ended because the user signed out of OFBiz). */
export const SIGNED_OUT_REASON_KEY = 'cep.signedOutReason'
