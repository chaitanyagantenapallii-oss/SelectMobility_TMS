# Building the Android and iOS apps — free

This is the step-by-step for turning `apps/driver-app` and `apps/client-app`
into installable apps on a phone, **without paying anything and without a
Google Play or Apple developer account.**

---

## Why this route

You do not need Android Studio, Xcode, a Mac, or the $25 Play Store fee.
Expo's build service compiles the app on its own machines and hands you a
download link.

| | Cost | Store account needed | How it installs |
|---|---|---|---|
| **APK sideload (this guide)** | **$0** | No | Open a link on the phone |
| Google Play | $25 once | Yes | Play Store |
| Apple App Store | $99/year | Yes | App Store |

The free tier includes **15 Android builds and 15 iOS builds per month**, with
a 45-minute build timeout, on a low-priority queue. That is ample: you build
once, then ship changes over the air without rebuilding at all (see
[Updating without rebuilding](#updating-without-rebuilding)).

---

## What you need

- A free Expo account — sign up at <https://expo.dev/signup>. No card.
- Node.js 18+ on your computer.
- An Android phone to install onto.

---

## One-time setup

Run these once. Everything below uses `apps/driver-app` as the example; repeat
with `apps/client-app` for the client app.

```bash
cd apps/driver-app
npm install
npm install -g eas-cli
eas login          # your free Expo account
eas init           # links this folder to a project in your account
```

`eas init` writes a `projectId` into `app.json` and creates the project in your
Expo account. It may ask whether to create one — say yes.

### Point the app at your server

The API address lives in `app.json` under `extra.apiOrigin`. It already points
at the live deployment:

```json
"extra": {
  "apiOrigin": "https://e818ce755fb54546ab1b9ebe3aea875c.sg.agentos-app.run"
}
```

Change it if you move the server. Note the app reaches this over the public
internet, so the server must be deployed and reachable — it does **not** talk to
a server running on your laptop.

---

## Build the APK

```bash
eas build --platform android --profile preview
```

That is the whole build. `preview` is already configured in `eas.json` to
produce a **sideloadable APK**:

```json
"preview": {
  "distribution": "internal",
  "android": { "buildType": "apk" }
}
```

- `distribution: "internal"` means it does not go to a store.
- `buildType: "apk"` means it is a file you can install directly. (The
  alternative, `app-bundle`, is for Play Store uploads and cannot be
  sideloaded.)

The build takes roughly 10–20 minutes in the free queue. Expo prints a URL and
emails you when it finishes.

---

## Install it on the phone

1. Open the build URL on the Android phone, or open
   <https://expo.dev> → your project → **Builds** and scan the QR code.
2. The phone downloads the `.apk` and asks permission to install it.
   Android will warn about installing from an unknown source — this is expected
   for an app distributed outside the Play Store. Allow it for your browser.
3. Open **SMI Driver** and sign in with the account the transport desk issued.

Or over USB, if the phone is connected and has debugging enabled:

```bash
eas build --platform android --profile preview --local --output ./smi-driver.apk
adb install ./smi-driver.apk
```

The `--local` form builds on your own machine. It still needs the Android SDK,
so unless you already have it, use the cloud build.

---

## Sharing it with your drivers

Every build produces a **permanent install link** that does not expire:

```
https://expo.dev/accounts/<your-account>/projects/smi-driver/builds/<build-id>
```

Give that link to drivers directly. They open it, it installs, done. There is no
app store involved and no review wait.

For a small fleet you can also use the **internal distribution** page in the
Expo dashboard, which generates a QR code you can print and hand out.

---

## Updating without rebuilding

Because the apps use Expo's update channel, a JavaScript-only change — a label,
a field, a bug fix in the app code — can be pushed without a new build:

```bash
eas update --branch preview --message "Fix manifest ordering"
```

Drivers get the change the next time they open the app. This is free for up to
1,000 monthly active users.

A change to native code (a new permission, a new native library, a version bump)
still needs a fresh `eas build`.

---

## Building for iPhone

The same command works:

```bash
eas build --platform ios --profile preview
```

The `preview` profile sets `ios.simulator: true`, which produces a build for the
iOS **Simulator** rather than a device. Installing on a real iPhone requires an
Apple Developer account ($99/year) — Apple does not permit any other route.

So: **Android is genuinely free; iPhone device installs are not.** For a mixed
fleet, the web apps at `/driver.html` and `/client.html` work on iPhone today —
"Safari → Share → Add to Home Screen" gives iPhone users an icon and offline
access with no account and no fee.

---

## Troubleshooting

**"App not installed" on Android**
Usually a leftover install with a different signature. Uninstall the old copy
first, then install again.

**Sign-in fails immediately**
The phone cannot reach `extra.apiOrigin`. Open that URL in the phone's browser —
if it does not load, the server is down or the address is wrong. Remember a
`localhost` address will never work from a phone.

**The build fails with "no projectId"**
Run `eas init` in that app folder. It is a one-time step and is easy to miss
because it is not part of `npm install`.

**Builds queue for a long time**
The free tier is low priority. It is slower at peak times but it does complete.

---

## What is and is not in these folders

```
apps/
  mobile-shared/     API client, theme, sign-in screen — used by both apps
  driver-app/        Today, Manifest, History, Log (breakdown + fuel), Me
  client-app/        Live, Staff, History, Statement, Requests
```

Both apps talk to the same backend as the web apps, and every screen's data is
scoped by the server to the signed-in account. A driver can only ever see their
own trips, and a client only their own organisation's staff, regardless of what
the app asks for.
