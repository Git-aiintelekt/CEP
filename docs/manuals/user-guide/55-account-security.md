# Account Security

**Where:** The account menu at the top right → Account Security.

## What this page is for

Your own second step when you sign in: a six-digit code from an authenticator app on your phone. Set it up here, keep the recovery codes, and turn it off when it is not required.

## Who can use it

| | |
|---|---|
| Permission | Everyone, for their own account. When Settings → Security requires it for everyone, it cannot be turned off. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Turn On | Shows a QR code to scan with Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar, and the key to type when scanning is not possible. | |
| Code | The six digits the app shows, to confirm. | Multi-factor authentication is on from the next sign-in. |
| Recovery codes | Ten one-time codes shown once, to sign in when the phone is lost. Store them somewhere safe. | |
| The status | Since when, and how many recovery codes are left; a warning when two or fewer remain. | |
| Turn Off | With the current code. Refused while the workspace requires it. | To get a new set of recovery codes, turn it off and on again. |

## How to

**Set it up.** Turn On → scan → type the code → store the recovery codes → Done. Sign out and in again to see the second step.

**Lost the phone.** Sign in with a recovery code, then turn it off and on again with the new phone.

## What happens behind the scenes

The code is time-based (TOTP); the secret is stored encrypted. A recovery code works once. When the workspace requires it, a user without it is walked through this set-up on their next sign-in before anything else; single sign-on users are covered by the identity provider instead.

## Things to know

- Nobody can set it up for you, and support cannot read your codes; a lost phone and lost recovery codes mean an administrator sends a new password link and you set it up afresh.
