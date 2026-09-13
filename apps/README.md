# Mobile apps

Two React Native (Expo) apps that talk to the same backend as the web
application, plus two installable web apps that need no build at all.

## What to use when

| | Where | Cost | Install |
|---|---|---|---|
| **Web apps** | `/driver.html`, `/client.html` | — | Already live. Open in a browser, "Add to Home Screen" |
| **Native apps** | this folder | Free to build | See [BUILD-APK.md](./BUILD-APK.md) |

The web apps work on every phone today, including iPhone, and work offline. The
native apps give you an app icon in the launcher, a proper app switcher entry,
and over-the-air updates — and building one costs nothing.

## Layout

```
mobile-shared/          Both apps use these
  api.js                API client; token storage via AsyncStorage
  theme.js              Colours and formatters, matching the web apps
  SignIn.js             Sign-in screen

driver-app/             Driver app
  App.js                Today, Manifest, History, Log, Me
  app.json              Expo config (name, bundle id, API origin)
  eas.json              Build profiles - `preview` produces a free APK
  assets/               Icon, adaptive icon, splash

client-app/             Client app
  App.js                Live, Staff, History, Statement, Requests
  app.json / eas.json / assets/   Same shape as the driver app
```

## Running one locally

```bash
cd driver-app
npm install
npx expo start
```

Then press `a` for an Android emulator, or scan the QR code with **Expo Go** on
your phone. Expo Go is enough to try the app; you only need a full build to get
an installable file.

### Set the server address first

Both apps read `extra.apiOrigin` from `app.json`. It defaults to the live
deployment. When running against your own machine, change it to your computer's
LAN address — **not** `localhost`, because a phone resolves `localhost` to
itself:

```json
"extra": { "apiOrigin": "http://192.168.1.20:4000" }
```

## Accounts to test with

| App | Email | Password |
|---|---|---|
| Driver | `driver@selectmobility.in` | `Driver@2026` |
| Client | `client@selectmobility.in` | `Client@2026` |

Change these before anyone real uses the system. They exist so the apps can be
demonstrated and tested.

## A note on what the apps are allowed to do

None of the scoping lives in this code. The server decides, on every request,
which trips a driver may see and which staff a client may see. The apps simply
ask, and a request outside the caller's scope comes back `403`.

That is deliberate. These apps are installed onto phones the company does not
control, so anything shipped in the bundle is readable by whoever holds the
phone. Treating the app as untrusted is what keeps one client from seeing
another's staff list.

## Checking the sources without the toolchain

`npm run test:rn` at the repository root runs a fast structural check over these
files — bracket balance, unterminated strings, JSX mistakes, and that the API
paths and field names still match the server. It takes milliseconds, so a typo
is caught long before a 20-minute build would have found it.
