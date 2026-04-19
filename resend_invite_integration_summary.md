# studioTrac Resend invite email integration

## Status

The invite email integration has been completed and pushed to the `main` branch.

| Item | Status |
|---|---|
| Repository | `https://github.com/peterdaleo/studiotrac` |
| Branch pushed | `main` |
| Commit | `3c6cb6c` |
| Local validation | `pnpm check` passed, `pnpm build` passed |
| Deployment trigger | Railway auto-deploy should run from the new push |

## Resend API key

I did **not** create a new Resend API key myself. I used the key you supplied during this task:

`re_5enirFwU_JDi3JbhnzPT8yvyX4Uh1hCJ2`

## Railway environment variable to add

Add the following variable in Railway for the production service:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | `re_5enirFwU_JDi3JbhnzPT8yvyX4Uh1hCJ2` |

After adding the variable, trigger a redeploy or restart the service if Railway does not redeploy automatically.

## Summary of changes made

### 1. Added real invite email delivery with Resend

A new email helper was added at `server/_core/email.ts` using the `resend` package. Invitation emails are sent from:

`studioTrac <invites@studiotrac.app>`

The email includes a professional HTML layout, a clear call-to-action button, a plain-text fallback, and the invited user’s assigned role.

### 2. Added secure invite token generation and validation

A new helper was added at `server/_core/invite.ts`.

This creates signed invite tokens using the existing JWT secret and builds signup links in the format:

`https://studiotrac-production.up.railway.app/signup?invite=TOKEN`

The token includes the invited email address, assigned role, team member ID, and invite metadata, with a 7-day expiration.

### 3. Updated the Team invite flow on the server

The `teamMembers.invite` mutation in `server/routers.ts` now:

1. Creates the team member placeholder record.
2. Creates a secure invite token.
3. Builds a signup URL.
4. Attempts to send the invite email through Resend.
5. Keeps invite creation successful even if email delivery fails.

Email sending is wrapped so delivery failures are non-blocking, exactly as requested.

### 4. Updated signup so invite links actually assign access correctly

The signup route in `server/_core/oauth.ts` now accepts an optional `inviteToken`.

When present, the server:

- validates the token,
- requires the signup email to match the invited email,
- applies the invited role during account creation,
- links the new user account back to the invited team member record.

### 5. Updated the client signup page

`client/src/pages/Signup.tsx` now preserves the `invite` query parameter and submits it during signup. It also shows invited users guidance to sign up with the same email address that received the invitation.

### 6. Updated the Team page feedback

`client/src/pages/Team.tsx` now shows admins whether the invite email was actually sent or whether only the invite record was created.

### 7. Added environment variable documentation

The README now documents `RESEND_API_KEY` and includes it in the local `.env` example.

## Dependency added

| Package | Purpose |
|---|---|
| `resend` | Sends invite emails from the backend |

## Notes

The checked-in app structure is Vite/React plus Express rather than a standard Next.js layout, but the requested functionality was implemented cleanly within the existing architecture.

The production build completed successfully. There were pre-existing build warnings related to analytics placeholders in `index.html`, but they did not block the build and were unrelated to the invite email work.
