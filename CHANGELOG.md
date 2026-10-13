# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Quieter logs: motions are no longer logged at the default level, and a failure that repeats
  (Ring unreachable, Gladys restarting, a library error) is logged once, then once more when it is
  over, instead of at every retry.
- Updated the Gladys integration SDK to 0.15 and the other dependencies. States keep reaching
  Gladys 5.2.0 without its polling, which only applies to devices created with `should_poll`.

## [1.2.0] - 2026-10-11

## [1.1.0] - 2026-10-11

### Added

- German and Spanish: the configuration, actions, scene triggers and actions, the doorbell widget
  and the messages are translated, and the device names can be created in German or Spanish.

## [1.0.2] - 2026-10-09

## [1.0.1] - 2026-10-09

### Added

- Ring video doorbells and cameras: snapshot as the Gladys camera image, doorbell press and motion
  in real time (push notifications), battery level, floodlight/spotlight light and siren control,
  online/offline badge.
- Ring Alarm: alarm mode (disarmed, home, away), read-only unless allowed in the configuration;
  contact sensors and motion detectors with tamper and battery.
- Ring Alarm flood & freeze sensor, water sensor, freeze sensor, smoke alarm, CO alarm, Smoke & CO
  Listener and Kidde smoke/CO alarm: leak, freeze, smoke and carbon monoxide detection.
- Sign-in from the Configuration screen with two-step verification (send then confirm a code), or
  with a refresh token from `ring-auth-cli`. The token Ring renews is kept in `/data`.
- Scene triggers: doorbell pressed, motion detected (person, vehicle, package, other motion),
  alarm mode changed. Scene actions: take a snapshot, set the alarm mode.
- Dashboard widget "Ring doorbell": last snapshot, last ring and motion with their time, battery,
  connection, snapshot, light and siren buttons.
- Snapshots above the Gladys 150 KB limit are downsized.
- English and French documentation.

[Unreleased]: https://github.com/guim31/gladys-ring/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/guim31/gladys-ring/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/guim31/gladys-ring/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/guim31/gladys-ring/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-ring/releases/tag/v1.0.1
