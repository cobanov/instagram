# Cobanov Instagram Unfollowers

A lightweight GitHub Pages site and browser-console snippet for finding Instagram
accounts that do not follow you back.

[Open the site](https://cobanov.dev/instagram)

## Features

- Scans only the accounts you follow.
- Uses Instagram's `follows_viewer` field instead of scraping your full follower list.
- Includes search, filters, hide/unhide, copy, and slow unfollow controls.
- Has a clean floating UI with TR/EN language support.
- Includes a security page with source links, verification notes, and the current snippet hash.
- Links to VirusTotal and Semgrep scan results for extra transparency.
- Loads the VirusTotal summary server-side through Cloudflare without exposing the API key.

## Usage

1. Sign in at `https://www.instagram.com`.
2. Open DevTools Console.
3. Copy the snippet from [cobanov.dev/instagram](https://cobanov.dev/instagram).
4. Paste it into the console and press Enter.
5. Click **Scan now**.

If Chrome blocks pasting, type `allow pasting` in the console first.

## Sponsorship

The project receives about **53.8k unique visitors per 30 days** based on the
March 26 - April 25, 2026 Cloudflare Analytics snapshot.

For sponsorships, contact [mertcobanov@gmail.com](mailto:mertcobanov@gmail.com).

## Credits

Inspired by the original workflow from
[davidarroyo1234/InstagramUnfollowers](https://github.com/davidarroyo1234/InstagramUnfollowers).
