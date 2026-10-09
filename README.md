# Ring for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings **Ring
video doorbells, cameras and the Ring Alarm** into Gladys:

- doorbell presses and motions as **real-time scene triggers** (with Ring's person / vehicle /
  package detection when your plan has it), and as device features;
- the **camera snapshot** as the Gladys camera image, refreshed on events, on request and on a
  schedule;
- **battery level**, **floodlight / spotlight** and **siren** control;
- a **Ring doorbell dashboard widget**: last snapshot, last ring and motion with their time,
  buttons for the snapshot, the light and the siren;
- the **Ring Alarm** mode (disarmed / home / away), its contact sensors and motion detectors.

> **Developed without the hardware: feedback welcome.** Everything is tested against recorded and
> anonymized Ring API data, not real devices. Please report how it behaves with your models in the
> [issues](https://github.com/guim31/gladys-ring/issues) or on the Gladys forum.

**Not affiliated with, endorsed by or sponsored by Ring LLC or Amazon.** "Ring" is a trademark of
Ring LLC.

The user documentation, re-hosted by Gladys in the Configuration screen, is in
[`docs/en.md`](docs/en.md) (English) and [`docs/fr.md`](docs/fr.md) (French).

## Requirements

- Gladys Assistant **5.1.0 or later** (scene triggers, scene actions and widgets).
- A Ring account. Ring Protect is only needed for Ring's smart alerts (person, vehicle, package).
- Outgoing access from the Gladys host to Ring's cloud and to `mtalk.google.com:5228` (the push
  notifications that carry presses and motions).

## Installation

1. In Gladys, open **Integrations**, find **Ring** in the catalog and install it.
2. In its **Configuration** tab, sign in to Ring, either:
   - with your Ring email and password, then the **Send a verification code** and **Confirm the
     verification code** actions (Ring requires two-step verification); or
   - by pasting a refresh token generated on a computer with
     `npx -p ring-client-api ring-auth-cli`.
3. Add your devices from the **Discovery** tab, and the _Ring doorbell_ widget to a dashboard.

The token Ring keeps renewing is saved in the integration's `/data` folder: you sign in once. The
full walkthrough is in [`docs/en.md`](docs/en.md).

## Limits

- No live video and no recordings (recordings need Ring Protect): snapshots only.
- Cloud only (Ring devices have no local API). No published quota: the integration keeps the pace
  of the Home Assistant and Homebridge integrations (camera status every 60 s for the whole
  account, push notifications for events, WebSocket for the alarm, snapshots every 30 min by
  default).
- Ring Alarm: security panel, contact sensors and motion detectors only for now. No Ring Smart
  Lighting, Chime, Intercom or third-party cameras.
- Arming and disarming the Ring Alarm from Gladys is off by default (a configuration switch).
- Memory: about 120 MB at rest, about 190 MB at worst while shrinking a large snapshot, in the
  256 MB Gladys sandbox (measured on Node 22, glibc; not yet measured inside the Alpine image).

## How it works

| File                                | Role                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `index.js`                          | SDK wiring only: every handler registered before `connect()`                |
| `src/app.js`                        | Ring ↔ Gladys: discovery, states, events, snapshots, commands, sign-in      |
| `src/ring/session.js`               | One signed-in ring-client-api session: locations, cameras, alarm devices    |
| `src/auth/tokenStore.js`            | The rotating refresh token and the hardware id, persisted in `/data`        |
| `src/auth/signIn.js`                | Two-step sign-in from the Configuration screen actions                      |
| `src/devices/camera.js`, `alarm.js` | Gladys device payloads and states, from the raw Ring data                   |
| `src/states.js`                     | Publishes only the changes; republishes everything when a device is created |
| `src/events.js`                     | Push notifications → presses and motions; last ones kept in `/data`         |
| `src/image.js`                      | Shrinks a snapshot above the Gladys 150 KB limit (sharp)                    |
| `src/widgets.js`, `src/scenes.js`   | The dashboard widget and the scene actions                                  |
| `gladys-assistant-integration.json` | Manifest: config form, actions, scene triggers and actions, widget          |
| `test/`                             | `node --test`; fixtures in `test/fixtures/ring/`, no network                |

`test/gladys-rules.test.js` checks every device built from the fixtures (seven camera models, the
alarm and its sensors) against the category/type table, units and polling rules of the Gladys core
(`test/fixtures/gladys-feature-table.json`).

## Development

```bash
npm ci                 # .npmrc sets ignore-scripts: ring-client-api's ffmpeg is never downloaded
npm run format:check   # Prettier (Markdown included)
npm run lint           # ESLint
npm test               # node --test
npx -y github:GladysAssistant/integration-store .   # store admission checks
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="<selector>" \
RING_DATA_DIR="./data" \
LOG_LEVEL=debug \
npm start
```

`RING_DATA_DIR` replaces `/data` outside the container. Project rules for contributors and coding
assistants are in [`CLAUDE.md`](CLAUDE.md).

### Releasing

Versions belong to the **Release** workflow (Actions → Release → Run workflow): it bumps
`package.json`, the manifest `version` and `docker_image` tag, rolls `CHANGELOG.md`, pushes the
tag, builds the multi-arch image to `ghcr.io/guim31/gladys-ring` and publishes the GitHub Release.

> Prefer the terminal? A hand-pushed `vX.Y.Z` tag triggers the same image build and Release, but
> touches no file: bump `version` in `package.json` and in `gladys-assistant-integration.json`
> (with the `docker_image` tag) and commit it **before** tagging.

## Credits

- [ring-client-api](https://github.com/dgreif/ring) by Dusty Greif and contributors (MIT), which
  does all the talking to Ring: authentication, push notifications, snapshots, alarm WebSocket.
- The Home Assistant [Ring integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/ring)
  (Apache 2.0) and its [python-ring-doorbell](https://github.com/python-ring-doorbell/python-ring-doorbell)
  library: reference for the behavior and the polling pace. The test fixtures are shaped after the
  Home Assistant ones and the ring-client-api types, anonymized and rewritten.
- [sharp](https://sharp.pixelplumbing.com) (Apache 2.0) to shrink large snapshots.
- Started from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## License

Apache-2.0
