# Movyza — Supabase Auth email setup

The client now supports these real flows:

- Signup confirmation via a 6-digit email OTP (verifyOtp, type signup) or the secure confirmation link.
- A resend action with a client-side cooldown and clear rate-limit feedback.
- Password recovery via a 6-digit OTP (verifyOtp, type recovery) or the secure recovery link.
- Updating the password only after the OTP or recovery-link session has been verified.

## Apply the branded templates in Supabase

These files are ready to paste into **Supabase Dashboard → Authentication → Email Templates**:

- Signup / confirmation: supabase/templates/confirmation.html
  - Suggested subject: رمز تأكيد حسابك في Movyza
- Password recovery: supabase/templates/recovery.html
  - Suggested subject: رمز استعادة كلمة المرور — Movyza

The templates intentionally include both {{ .Token }} (six-digit OTP) and {{ .ConfirmationURL }} (secure link). Do not delete the variables or replace them with a fixed code.

## Configure sender name and delivery

The sender display name cannot be changed by frontend code. In **Authentication → SMTP Settings**, configure a real SMTP provider and set:

- Sender name: Movyza
- From address: a verified address on movyza.sbs, for example no-reply@movyza.sbs
- SMTP host, port, username and password from the email provider

Verify the sending domain with the provider and publish its required SPF/DKIM DNS records (and DMARC where supported). Never commit SMTP credentials to this repository or ship them in the APK.

**Important:** Supabase's built-in email sender is for testing, only sends to project-team-authorized addresses, and is heavily rate-limited. This is consistent with the observed over_email_send_rate_limit response. The code prevents rapid repeated submissions, but only project-level SMTP configuration enables reliable delivery to regular users.

## URL allow-list

In **Authentication → URL Configuration**:

- Set Site URL to https://movyza.sbs
- Add https://movyza.sbs/** to Redirect URLs
- Ensure https://movyza.sbs/auth/callback and https://movyza.sbs/reset-password are included if your project uses exact URLs instead of a wildcard
- Add local development URLs only for the development environment

## Safe verification checklist

1. Create a test account with a new email address.
2. Confirm that the email arrives with the display name Movyza.
3. Verify with the six-digit code; then test the link path separately.
4. Request a password reset, verify the recovery code, and sign in with the new password.
5. Confirm rapid resend attempts show a cooldown/rate-limit message rather than encouraging repeated signup calls.
6. Keep password confirmation and profile/watchlist data inside the authenticated session; do not add service-role credentials to the client.
