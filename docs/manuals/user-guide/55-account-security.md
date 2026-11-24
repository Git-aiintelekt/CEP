# Account Security

**Where:** The account menu at the top right → Account Security.

## What this page is for

Your own second step when you sign in: a six-digit code from an authenticator app on your phone. Set it up here, keep the recovery codes, and turn it off when it is not required. With it on, a stolen password is not enough to get into your account.

## Who can use it

| | |
|---|---|
| Permission | Everyone, for their own account. When Settings → Security requires it for everyone, it cannot be turned off, and a person without it lands here at sign-in: *Your workspace requires multi-factor authentication. Set it up to continue: nothing else is available until you do.* |
| Single sign-on | Someone who signs in through the company's identity provider sees *You sign in through your company's single sign-on. The second step, if any, is managed there.* and nothing to set up. |
| Visiting another workspace | A platform administrator who entered another workspace with Switch Workspace sees *Managed in Your Own Workspace*: their sign-in belongs to their own workspace. |

Each account has its own second step: someone with an account in two workspaces (Staging and Production) sets it up in each, and can use the same authenticator app for both (it shows two entries).

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Set Up | Shown while it is off (*Multi-factor authentication is off*). | Shows a QR code to scan with Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar, and under *Cannot scan? Type this key* the key to type instead. Nothing is switched on yet. |
| Code | The six digits the app shows. | Checks that the app was set up correctly. |
| Turn On | Enabled once six characters are typed. A wrong code is refused: *That code is not right. Check the time on your phone and try the next code.* | Multi-factor authentication is on: from the next sign-in, the password alone is not enough. The ten recovery codes appear. |
| Cancel | Next to Turn On; not offered when the workspace makes you set it up before anything else. | Leaves it off; nothing is stored as on. |
| Recovery codes | Ten one-time codes, shown once, with Copy Codes. Store them somewhere safe, away from your phone. | Each one signs you in once when the phone is lost, in place of the six digits. |
| I Have Saved Them | Closes the codes. | The page shows the status below. The codes are never shown again. If the workspace required it, the rest of C360 opens. |
| The status | *Multi-factor authentication is on*, since when, and how many recovery codes are left; a warning when two or fewer remain. | Nothing; it tells you whether you can still sign in without the phone. |
| Turn Off | Not shown while it is required (*Your workspace requires it, so it cannot be turned off.*). Opens the Current Code field. | Nothing until confirmed below. |
| Current Code | A code from the app, or an unused recovery code, then Turn Off (or Cancel). | Multi-factor authentication is off: your password alone signs you in. The app's entry and the recovery codes stop working. A wrong code is refused: *Enter a current code from your authenticator to turn it off.* |
| Back to Platform | Shown only to a platform administrator visiting another workspace, under *Managed in Your Own Workspace*. | Ends the visit and returns to the platform, where their own second step can be seen or changed. |

## How to

**Set it up.** Set Up → scan the QR code → type the code → Turn On → store the recovery codes → I Have Saved Them. Sign out and in again to see the second step.

**Lost the phone.** Sign in with a recovery code, then Turn Off (with another recovery code) and Set Up again with the new phone.

**Get new recovery codes.** Turn Off, then Set Up again: a new set of ten replaces the old one.

## What happens behind the scenes

The code is time-based (TOTP) and changes every 30 seconds; each code works once. The key is stored encrypted. A recovery code works once and is then crossed off. When the workspace requires it, a user without it is walked through this set-up on their next sign-in before anything else; single sign-on users are covered by the identity provider instead.

## Things to know

- Nobody can set it up for you, and support cannot read your codes. A new password link does not switch it off: with both the phone and the recovery codes lost, ask the platform team, who can switch it off for your account in the back-office; then set it up afresh.
- Support sessions and visiting platform administrators can never change anyone's second step.
