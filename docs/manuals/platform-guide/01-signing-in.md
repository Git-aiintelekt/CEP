# Signing In and the Two Kinds of Staff

**Where:** `/admin/login/`, and the account's own page in the React app for the second factor.

## What this is for

The back-office is Django's admin with the Unfold skin. It signs in with a session, not with the app's tokens, and only accounts marked as staff may open it. A staff member who has enrolled an authenticator must pass it on every new admin session before any page opens.

## Who can use it

| | |
|---|---|
| Staff | An account with *Staff* set (People and access → Users → Platform staff). Staff can open the back-office and read everything; what they can change follows Django's permissions. |
| Platform administrator | *Platform administrator* set as well: can change everything, for every tenant. |
| Second factor | Enrolled in the React app under Account Security. The global parameter `security.mfa_required_for_staff` makes it compulsory for every staff account. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Email, Password | The staff account's sign-in. A staff account belongs to a tenant like any other user; the platform's own tenant is the usual home. | |
| The code page | After the password, the six digits from the authenticator app, when enrolled or required. | The session opens only after it. |
| Account menu → Log out | Ends the admin session. | |

## How to

**Make someone staff.** Users → open the account → Platform staff → tick Staff; tick Platform administrator only for those who may change anything. A staff account's password is never typed in the back-office: Create password link and send it.

**Require the second factor for staff.** Global parameters → `security.mfa_required_for_staff` → yes. A staff member without an enrolled authenticator is asked to enrol in the app first.

## What happens behind the scenes

The admin session is separate from the app's tokens: signing out of one does not sign out of the other. Everything a staff member changes goes to the change audit trail with their name.

## Things to know

- A support session into a workspace is opened from the user's page here (the Users chapter), never by knowing a user's password.
- Suspending a tenant does not lock its staff out of the back-office; only *Staff* decides that.
