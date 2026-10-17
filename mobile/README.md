# Skorly mobile

First increment: mock Login and persistent Server Settings. Successful login shows
the account role on a temporary screen; the five-tab league home is next.

From the repository root, install and launch:

```powershell
npm --prefix mobile install; if ($LASTEXITCODE -eq 0) { npm --prefix mobile start }
```

Open Expo Go on your Android phone and scan the terminal QR code. Keep phone and
laptop on the same Wi-Fi. For an installed emulator, run `npm --prefix mobile run android`.

```powershell
npm --prefix mobile run typecheck
```

Demo password: `Nascon@26`. Emails: `admin@nascon.test`,
`organizer@nascon.test`, `manager@nascon.test`, `player@nascon.test`,
`viewer@nascon.test`. Authentication is mocked in `src/services/api.ts`.
Tokens and the server address use SecureStore. Mock mode never contacts the server.

Verify this increment on device:

- At 360×640 and in landscape, scroll to every field and button with the keyboard open.
- Submit empty fields and incorrect credentials; confirm readable error messages.
- Sign in with each demo account; confirm its role, then sign out.
- Open Server address, try an invalid URL, then save a valid address and reopen the app.
- Increase system font size and verify controls remain usable with TalkBack labels.

Android APK build configuration and the remaining screens will follow after the
first screen is verified. No APK has been produced yet.
