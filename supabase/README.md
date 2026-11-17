# Database

Supabase project `mindclub` (ref `kuiyymiwzsjiwgsgcxqk`, ap-south-1).

`migrations/` holds every migration applied to that project, byte-identical to
`supabase_migrations.schema_migrations` as of 2026-11-17. Nothing exists in the live
database outside these files. New schema changes go in a new
`migrations/<yyyymmddhhmmss>_<name>.sql` file, applied with the Supabase MCP
`apply_migration` (or `supabase db push`), so the two stay in sync.

## Model

| Table | Access |
|---|---|
| `profiles` | one per auth user, created by the `on_auth_user_created` trigger. Read: self and anyone connected (follow either way, or a challenge). Update: own row. |
| `results` | one per user, game, day. Direct read/write of own rows only. |
| `follows`, `challenges`, `game_suggestions`, `game_suggestion_votes` | no direct access; only through the functions below. |
| `private.device_tokens` | browser-extension keys, sha256 hash only. No direct access. |

Friends' scores are never read directly: `following_board` and `my_challenges` reveal a
score only after the caller has logged the same game on the same day.

## Functions the site calls (`/rest/v1/rpc/...`)

- People: `set_handle`, `find_people`, `my_people`, `follow`, `unfollow`, `remove_follower`
- Feed: `following_board(p_from, p_to)` (max 62-day range)
- Challenges: `send_challenge` (followers only, today ±1, 100/day), `my_challenges`;
  `decline_challenge` and `cancel_challenge` exist but the UI does not call them yet
- Games: `list_game_suggestions`, `suggest_game`, `vote_game_suggestion`
- Extension: `create_device_token` (keeps 5 newest per user), `revoke_device_tokens`,
  `log_result_via_token` (callable by `anon`; token only logs for its owner, today ±1, never overwrites)

## Scheduled

`pg_cron` job `delete-stale-guests` (03:17 UTC daily) deletes anonymous users idle for 30 days.
