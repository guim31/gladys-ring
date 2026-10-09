# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Ring video doorbells and cameras: snapshot as the Gladys camera image, doorbell press and motion
  in real time (push notifications), battery level, floodlight/spotlight light and siren control,
  online/offline badge.
- Ring Alarm: alarm mode (disarmed, home, away), read-only unless allowed in the configuration;
  contact sensors and motion detectors with tamper and battery.
- Sign-in from the Configuration screen with two-step verification (send then confirm a code), or
  with a refresh token from `ring-auth-cli`. The token Ring renews is kept in `/data`.
- Scene triggers: doorbell pressed, motion detected (person, vehicle, package, other motion),
  alarm mode changed. Scene actions: take a snapshot, set the alarm mode.
- Dashboard widget "Ring doorbell": last snapshot, last ring and motion with their time, battery,
  connection, snapshot, light and siren buttons.
- Snapshots above the Gladys 150 KB limit are downsized.
- English and French documentation.

[Unreleased]: https://github.com/guim31/gladys-ring/commits/main
