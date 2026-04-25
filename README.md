# Instagram Unfollowers

Static GitHub Pages site plus the pasteable browser-console snippet for finding
Instagram accounts that do not follow you back.

## Build

```powershell
npm run check
npm run build
```

The generated one-line snippet is written to
`dist/instagram-unfollower.one-line.js` and is loaded by `index.html`.

## Scanner Logic

The current implementation scans only `edge_follow`, the accounts the viewer
follows. Each returned node includes Instagram's `follows_viewer` field, so the
tool can identify non-followers without separately scraping the full follower
list.
