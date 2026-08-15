# Security

Cobanov Instagram Unfollowers is a static website and browser-console snippet.
There is no Cobanov backend that receives Instagram account data.

## Verify Before Use

- Review `src/instagram-unfollower.js`.
- Compare the generated snippet hash with the hash shown on `security.html`.
- Review the VirusTotal report. `security.html` links to the report for the exact
  file it serves; the link is built from the hash of those bytes, not from a
  constant checked into this repository.
- The live VirusTotal summary is loaded through `/api/virustotal` using a
  Cloudflare environment secret. The API key is not exposed to the browser.
- Review the Semgrep workflow:
  <https://github.com/cobanov/instagram/actions/workflows/semgrep.yml>

## Current Snippet Hash

The hash is derived from the built file rather than pinned here, so it cannot go
stale and vouch for a file nobody is downloading. To reproduce it locally:

```sh
npm run build      # prints the SHA-256 it just wrote
shasum -a 256 dist/instagram-unfollower.one-line.js
```

Compare that value with the one shown on `security.html`. They must match.

## Reporting Issues

Please email security or privacy concerns to
[mertcobanov@gmail.com](mailto:mertcobanov@gmail.com).
