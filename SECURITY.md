# Security

Cobanov Instagram Unfollowers is a static website and browser-console snippet.
There is no Cobanov backend that receives Instagram account data.

## Verify Before Use

- Review `src/instagram-unfollower.js`.
- Compare the generated snippet hash with the hash shown on `security.html`.
- Review the VirusTotal report:
  <https://www.virustotal.com/gui/file/048d5406cbe26e88ee08f5d867c2de6f074a1beda8dac36f17628eb495659d7d/detection>
- The live VirusTotal summary is loaded through `/api/virustotal` using a
  Cloudflare environment secret. The API key is not exposed to the browser.
- Review the Semgrep workflow:
  <https://github.com/cobanov/instagram/actions/workflows/semgrep.yml>

## Current Snippet Hash

```text
SHA-256 048D5406CBE26E88EE08F5D867C2DE6F074A1BEDA8DAC36F17628EB495659D7D
```

## Reporting Issues

Please email security or privacy concerns to
[mertcobanov@gmail.com](mailto:mertcobanov@gmail.com).
