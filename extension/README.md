# Mindclub Chrome extension

Finish a puzzle, tap the game's Share button, and the result is logged to Mindclub.

## Install (unpacked)

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this `extension/` folder.
2. Click the extension's icon → **Connect to Mindclub**. Sign in on the site and it connects itself
   (the site's `?connect=extension` flow). Or sign in first and press **Connect extension** on Today.

## How it works

| File | Runs | Job |
|---|---|---|
| `bridge.js` | on the Mindclub site | Sets `<html data-mindclub-ext="installed|connected">`. Takes the device key the site posts on Connect (`create_device_token`) and hands it to the background. Protocol is defined in `app.js` (browser extension section). |
| `capture.js` | game pages, page's own JS world | Watches `clipboard.writeText`, `clipboard.write`, `copy` events and `navigator.share` for share text. Never blocks or changes the page's call. |
| `relay.js` | game pages, extension world | Passes captured text to the background and shows the result toast. |
| `background.js` | service worker | Parses with `parser.js`, works out the day like the site does, calls `log_result_via_token`. |
| `popup.*` | toolbar popup | Connect, game links, what was logged from this browser, disconnect. |

Game pages covered: `nytimes.com/games/*`, `nytimes.com/crosswords/*`, `linkedin.com/games/*`, `krillion.io`.
Text that isn't a game result is dropped inside the extension and never sent anywhere.

The device key only lets the extension add a result for its owner, for yesterday to tomorrow,
and never overwrites one already logged (see `supabase/migrations/*_device_tokens.sql`).
Disconnect in the popup forgets the key in this browser; **Disconnect extension** on the site
also revokes every key server-side.

## Keep in sync

`parser.js` here is a copy of the site's `parser.js`. After changing the site's parser:

```bash
cp parser.js extension/parser.js
```

`node --test tests/extension.test.mjs` fails if the copies differ, and covers the background
worker's logging paths with a fake Chrome API.
