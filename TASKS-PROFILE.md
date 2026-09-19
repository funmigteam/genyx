# Tasks and profile update

This update does not change financial worker code, payout policy or environment flags.

## Task configuration

- CHANNEL_JOIN: set `channelChatId` to `@username` or `-100…` and `actionUrl` to the public/invite HTTPS link. The bot must be a channel administrator. Claim calls Telegram getChatMember; left/kicked and restricted non-members cannot claim. This enforces membership for that task, not a global ban on other app sections.
- EXTERNAL_LINK: HTTPS link (including YouTube); rewards are available without verification of viewing, intentionally. This is not a claim of verified watching.
- XP_REACHED: cumulative server XP threshold.
- LEVEL_REACHED: server level threshold, 1–30, using existing progression rules.
- GAME_PLAYED: game key and required round count. Only trusted server records count; there is no browser score submission endpoint. Non-daily tasks count records since task start; daily tasks count only the active season day.
- MANUAL_REVIEW: approval queue remains available.
- Daily tasks join the task snapshot on the next season day; existing days are not rewritten.

`POST /v1/admin/game-activity` requires an authenticated SUPER_ADMIN and accepts `{userId, gameKey, rounds, eventKey}`. Repeated identical event keys do not double count. Conflicting reuse is rejected. This is a manual trusted attestation API, not an automatic integration with an external game. The actual game engine must provide verifiable results before automatic game completion is possible; do not put an admin token into a browser game.

## Profile

Authenticated users can view the profile without an active package, save their display name and language preference. Preference storage is not a full translation of the application. Telegram ID cannot be overwritten through this endpoint. No wallet ownership or payout rules are changed.

## Deployment

Schema additions are in `apps/api/prisma/migrations/20260907230000_task_conditions/migration.sql`. Production already uses db push without an established migration baseline; do not blindly run all migrations. Back up the database, build new images and apply the reviewed schema update before starting the new API. Do not use accept-data-loss to skip an unexpected warning. Keep `.env*`, `secrets/` and `backups/` excluded from rsync.

## Verification

Unit tests cover membership statuses, Telegram API failure, XP/level/game thresholds. Integration tests use only an opt-in isolated local database and mocked Telegram responses, covering claim rejection, successful settlement, and replay protection. No live Telegram identity, game provider, or financial transfer is used in these tests.
