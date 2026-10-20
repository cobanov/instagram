<p align="center">
  <img src="assets/panel.png" alt="The scanner panel counting through the accounts you follow" width="620">
</p>

<p align="center">
  Find the Instagram accounts that do not follow you back.<br>
  In your own browser tab, in your own session, with no password given to anyone.
</p>

<p align="center">
  <a href="https://instagram.cobanov.dev">instagram.cobanov.dev</a> ·
  <a href="https://instagram.cobanov.dev/security.html">how to verify it</a>
</p>

<p align="center">
  <a href="https://github.com/cobanov/instagram/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/cobanov/instagram?color=e56192&labelColor=1a1a1a"></a>
  <img alt="tests" src="https://img.shields.io/badge/tests-passing-e56192?labelColor=1a1a1a">
  <img alt="extension" src="https://img.shields.io/badge/Chrome-MV3%20extension-e56192?labelColor=1a1a1a">
  <a href="https://github.com/cobanov/instagram/actions/workflows/semgrep.yml"><img alt="semgrep" src="https://github.com/cobanov/instagram/actions/workflows/semgrep.yml/badge.svg"></a>
</p>

---

Every tool that answers this question wants something first: your password, an OAuth
grant, or your follower list uploaded to somewhere you cannot see. None of that is
needed. Instagram already makes your following and follower lists available to the
logged-in browser. The whole job is comparing those lists inside the tab.

So this is a script you paste into your own DevTools console on your own Instagram
tab. It uses the session already in the browser. Nothing is sent anywhere: the site
is static, and there is no server on this side to receive anything.

- **It checks follow-back locally.** Like upstream, the scanner loads following first,
  then followers, and compares the two lists inside the tab.
- **Nothing leaves the tab.** No backend, no upload, no key. What the panel shows is
  what the browser already had.
- **Unfollowing is slow on purpose.** Rate limits, blocks and `checkpoint_required`
  are detected and stop the run rather than being retried into a ban.
- **A floating panel, TR and EN**, with search, filters, hide/unhide and copy.
- **The exact bytes are published.** The security page shows the SHA-256 of the file
  it is serving.

## Install

Two ways to run it. They execute the same file, byte for byte.

**The console snippet.** Sign in at `https://www.instagram.com`, open DevTools
Console, copy the snippet from [instagram.cobanov.dev](https://instagram.cobanov.dev),
paste it and press Enter. If Chrome refuses the paste, type `allow pasting` in the
console first.

**The Chrome extension**, if you would rather not touch a console. Download the zip
from the [latest release](https://github.com/cobanov/instagram/releases/latest),
unpack it, and load it unpacked from `chrome://extensions` with developer mode on.
Clicking its toolbar icon injects the same script. Contributed by
[yavuzmeteafsar](https://github.com/yavuzmeteafsar); see
[chrome-extension/README.md](chrome-extension/README.md).

## Use

Click **Scan now**. The panel walks your following and follower lists, then shows the
accounts that do not follow you back. When Instagram omits unavailable followed
accounts, a notice explains how many accounts the results cover.

Instagram hands followers out about 24 per page, so a large account is a few hundred
requests and can still take many minutes. Version 2.3.4 follows upstream's current
two-stage randomized scan pacing and lets you set the requested page size from 1 to 200 under Settings;
Instagram can ignore that value and return smaller pages. Keep the tab in front while it runs:
Chrome can heavily throttle background timers. Instagram can still interrupt scans,
especially on large accounts; slower requests do not guarantee completion.

If Instagram cuts the scan short (signs you out, rate-limits, asks for a checkpoint),
progress is kept in the tab's `localStorage` for a day. **No non-follower results or
unfollow actions are available before the required checks finish.** Wait for the restriction
to clear, sign in again if necessary, then press **Resume**. A rate limit stops the
scan immediately; it is not retried automatically. Instagram often sends its rate limit as
a 401 with `require_login` and "Please wait a few minutes"; since 2.4.1 that is reported as
a rate limit, not a sign-out, because signing in again does not lift it. The panel names a
time to resume, and until then Resume sends nothing: one hour after a rate limit, three
hours after a block or a long run of empty pages.

Instagram sometimes sends a run of empty pages in the middle of a list, or ends a list
while still claiming there is more. Since 2.4.1 the scan steps over up to ten empty pages
in a row and treats a missing or repeated cursor as the end of the list. In the following
list that can only miss non-followers. In the follower list it could show a follower as a
non-follower, so those results are marked unverified and unfollowing stays off; the data
file method at `/export` gives exact results. A longer run of empty pages stops the scan.
A failed scan shows one line with the version, the list, how far it got and what Instagram
sent.

When upgrading from a version older than **2.3.2**, refresh the Instagram tab before running the new code or
reloading the updated extension. Earlier versions could keep a scan running after
closing the panel, so simply pasting over the old panel is not enough to stop those
old requests. Version 2.3.2 stops its requests when closed or replaced, including
when switching between the console script and Chrome extension.

Unfollowing from the panel is deliberately unhurried. Instagram answers a burst of
unfollows with `feedback_required`, a spam flag, a checkpoint, or an HTTP 429, and
each of those is treated as a stop rather than as something to retry. An HTTP 401
means the session died and also stops the run. Pushing through any of them is how
accounts get restricted.

## How to verify it before pasting

Pasting a stranger's JavaScript into a logged-in Instagram tab is a real thing to be
careful about, so the point of the security page is to make the file checkable rather
than to ask for trust.

```sh
npm run build      # prints the SHA-256 it just wrote
shasum -a 256 dist/instagram-unfollower.one-line.js
```

That value must match the hash shown on
[security.html](https://instagram.cobanov.dev/security.html). The page derives its
hash from the bytes it is actually serving rather than from a constant in this
repository, so it cannot go stale and vouch for a file nobody is downloading.
`src/instagram-unfollower.js` is the source of all of it and is short enough to read.

The extension's copy is generated by the same build step rather than hand-copied, so
it is byte-identical to `dist/` and the published hash verifies it too.

## Development

```
npm run build   # bundles src/ into dist/ and prints the new snippet hash
npm run check   # syntax checks and regression tests
npm run pack    # builds, then zips chrome-extension/ into .pack/ for a release
```

The tests cover the part that is genuinely dangerous: what counts as a successful
unfollow, and which failures must stop the run. An HTTP 200 carrying
`status: "fail"`, an HTML login page served with 200, a spam flag, a checkpoint, a
429 and a 401 are each asserted to be handled as themselves rather than as generic
retryable errors. The scan tests cover the current friendship-list endpoints,
pagination, repeated-cursor protection, and the local following/follower comparison.
They also verify cancellation, duplicate-start prevention, immediate rate-limit
stops, HTTP 200 errors, silently truncated lists, and disabled partial results.
The rest check that no language file is missing a key or leaves one empty.

## Sponsorship

Around **53.8k unique visitors per 30 days**, on the March 26 to April 25, 2026
Cloudflare Analytics snapshot.

If it is useful to you, you can sponsor it at
[github.com/sponsors/cobanov](https://github.com/sponsors/cobanov).

Thanks to the people who have backed it:

- [rmncr](https://github.com/rmncr), $25
- [Fatih Guzel](https://www.instagram.com/fatihguzeldev/), $10
- [Woosal](https://www.instagram.com/woosal1337/), $10

## Prior art

The workflow comes from
[davidarroyo1234/InstagramUnfollowers](https://github.com/davidarroyo1234/InstagramUnfollowers).
