# Chrome Web Store listing: Mindclub

Everything the developer dashboard asks for, in the order its tabs ask. Upload `mindclub-extension-<version>.zip`
(built by `store/build.ps1`) and paste the fields below.

## Package

- Zip: `store/mindclub-extension-1.1.0.zip` (contents of `extension/`, without README)
- Version comes from `extension/manifest.json`. Bump it there before uploading an update.

## Store listing tab

**Name** (from the manifest): Mindclub

**Summary** (from the manifest, 132 max):
Logs your daily puzzle results to Mindclub when you tap the game's Share button.

**Description:**

```
Finish your daily puzzle, tap the game's Share button, and your result is logged to Mindclub. No copying, no pasting.

Mindclub is a home for the daily word and logic puzzles you already play: keep your results in one place, follow your friends, and see who won today.

This extension removes the boring part. When you tap a supported game's own Share button, it recognises the result, adds it to your Mindclub account and shows a small confirmation on the page.

• Play on the games' own sites, the way you normally do.
• No spoilers: friends' scores stay hidden until you've played the same puzzle.
• Never overwrites a result you've already logged.
• The popup lists the supported games and shows what was logged from this browser.

Privacy: the extension only looks at the text a game copies when you tap Share, and only on supported game sites. Anything that isn't a game result is dropped inside your browser and never sent. No ads, no analytics, no tracking.

Getting started: install, click the Mindclub icon, then Connect. Sign in on Mindclub (email link, or try it as a guest) and the extension connects itself.

Mindclub is an independent project and isn't affiliated with any puzzle's publisher.
```

**Category:** Lifestyle → Games. If review objects because the extension isn't a game itself, use Lifestyle → Social Networking.

**Language:** English

**Graphics** (all in `store/`):
- Store icon 128×128: `extension/icons/128.png`
- Screenshots 1280×800: `screenshot-1-toast.png`, `screenshot-2-popup.png`, `screenshot-3-site.png`
- Small promo tile 440×280: `promo-small.png`

**Official URL:** none (it needs a Search Console-verified domain; github.io doesn't qualify). Leave empty.
**Homepage URL:** https://sovi11.github.io/mindclub-site/
**Support URL:** https://github.com/Sovi11/mindclub-site/issues

> Rejected once (Nov 2026, "keyword spam") for listing every supported game by name in the description.
> Keep game names out of the description: one or two examples at most. The popup and screenshots show the full list.

## Privacy tab

**Single purpose:**
Logs the user's daily puzzle results to their Mindclub account when they tap a supported game's Share button.

**Permission justifications:**

- `storage`: Keeps the user's Mindclub extension key (received when they click Connect on Mindclub) and a short list of results logged from this browser, shown in the popup.
- Host permission `https://kuiyymiwzsjiwgsgcxqk.supabase.co/*`: Mindclub's backend. The extension sends a recognised game result there to add it to the user's account.
- Content scripts on the game sites (nytimes.com/games, nytimes.com/crosswords, linkedin.com/games, krillion.io, merriam-webster.com/games, wafflegame.net, worldle.teuteuf.fr, globle-game.com, framed.wtf, nerdlegame.com): When the user taps a game's Share button, the page copies the result text. The script sees that text, checks it in the browser, and passes it on only if it is a game result. It also shows a small "logged" confirmation on the page. It runs only on these game sites.
- Content script on https://sovi11.github.io/mindclub-site/*: Lets the Mindclub site know the extension is installed, and receives the extension key when the user clicks Connect.

**Remote code:** No, I am not using remote code. (All JavaScript ships in the package; the backend call returns data only.)

**Data usage:** tick
- **Website content**: the share text of a game result (game, result, puzzle number).
- **Authentication information**: the Mindclub extension key stored on the device and sent with each result.

Leave everything else unticked: no personally identifiable info, health, financial, personal communications, location, web history or user activity.

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://sovi11.github.io/mindclub-site/privacy.html

## Distribution tab

- **Visibility:** Unlisted to start (installable by anyone with the link, not shown in search). Switch to Public later.
- **Regions:** All regions.
- **Payments:** Free.

## Test instructions (reviewers see these)

```
No account needed:
1. Click the extension icon, then "Connect to Mindclub". The Mindclub site opens.
2. Click "Try it now" to start a guest account. The extension connects by itself ("Extension connected" toast).
3. Open https://krillion.io/ (or any NYT game, e.g. https://www.nytimes.com/games/wordle), finish the puzzle and tap the game's Share button.
4. A "Mindclub: … logged" toast appears bottom-right, and the result shows on the Mindclub Today page and in the extension popup.
```

## Published

Approved and live (Unlisted) on 24 Nov 2026, v1.1.0: https://chromewebstore.google.com/detail/mindclub/mbjkoedlkpmpnnkhfnbdiopgcekjojam
Item ID `mbjkoedlkpmpnnkhfnbdiopgcekjojam`. The site links to it (`EXT_URL` in app.js, landing page in index.html).
To ship an update: bump `version` in extension/manifest.json, run `pwsh store/build.ps1`, upload the zip under Package, submit.
