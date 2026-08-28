/* Uploads the built snippet to VirusTotal so the security page's hash resolves
   to a real report instead of "unscanned".

   Every build produces a new hash, and VirusTotal only knows a file once
   someone submits it. That submission used to be a manual drag-and-drop that
   was easy to forget, which left the security page claiming an unscanned
   snippet for as long as nobody noticed.

   This drives the public upload form in a real browser rather than calling the
   API, so there is no VirusTotal API key to keep on a laptop. The key that the
   Cloudflare function reads stays where it belongs: a secret in the Pages
   project, unreadable from here on purpose.

   Playwright is not a dependency of this project. It is a large download and
   nothing else needs it, so the script asks for it only when it runs. */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "dist", "instagram-unfollower.one-line.js");
const UPLOAD_URL = "https://www.virustotal.com/gui/home/upload";

/* The page mounts the upload form more than once — some copies hidden — so
   every selector here matches several nodes. Each copy exposes a #fileSelector
   input inside a <vt-ui-main-upload-form> shadow root, and only the live one
   reacts to a change event; setting a file on a dead copy is silently ignored.
   Playwright's CSS engine pierces open shadow roots, so a plain selector reaches
   all of them. Which index is live moved between headed and headless runs, so
   the file goes to every input rather than to a guessed one — the extra writes
   are the no-ops. The visible-only filter on the buttons below is the same
   duplication seen from the other side. */

async function loadPlaywright() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    /* A global install is the common case on a machine that already has
       Playwright; Node will not resolve it from here without a nudge. */
    const { execSync } = await import("node:child_process");
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    try {
      return (await import(join(globalRoot, "playwright", "index.mjs"))).chromium;
    } catch {
      throw new Error(
        "Playwright is required for this script. Install it with:\n" +
          "  npm i -g playwright && npx playwright install chrome"
      );
    }
  }
}

async function main() {
  const bytes = readFileSync(BUNDLE);
  const hash = createHash("sha256").update(bytes).digest("hex");
  console.log(`Uploading ${BUNDLE}`);
  console.log(`SHA-256 ${hash}`);

  const chromium = await loadPlaywright();
  /* Headed on purpose. Headless Chrome loads the page and even opens the
     confirm dialog, but the submission itself never completes — the click
     lands and VirusTotal simply never navigates to an analysis page. A visible
     window is the only configuration observed to finish a real upload. */
  const browser = await chromium.launch({ channel: "chrome", headless: false });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" });

    /* The form is a lazily upgraded custom element: the inputs are in the DOM
       before they are wired up, and setting a file on one that is not yet wired
       is silently dropped. The visible "Choose file" button is rendered by the
       upgraded component, so it is the honest readiness signal — waiting for
       the input to merely exist is not enough. */
    await page.getByText("Choose file", { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 30000 });
    const inputs = page.locator("input[type=file]");
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      await inputs.nth(i).setInputFiles(BUNDLE);
    }

    /* Two things can happen once the file is attached. A hash VirusTotal has
       never seen raises a "Confirm upload" dialog that has to be clicked. A
       hash it already knows skips the dialog entirely and jumps straight to the
       existing report — re-running this script after a successful upload takes
       that path, and so does anyone who built the same bundle first. Waiting
       only for the dialog reads that second case as a failure. */
    const reportUrl = `https://www.virustotal.com/gui/file/${hash}`;
    const confirm = page.getByText("Confirm upload", { exact: false }).filter({ visible: true }).first();

    let outcome = null;
    for (let i = 0; i < 60 && !outcome; i++) {
      if (page.url().startsWith(reportUrl)) outcome = "known";
      else if (await confirm.count()) outcome = "confirm";
      else await page.waitForTimeout(500);
    }

    if (outcome === "known") {
      console.log(`Already on VirusTotal: ${reportUrl}/detection`);
      return;
    }
    if (!outcome) {
      throw new Error("VirusTotal showed neither an upload dialog nor a report; the page may have changed.");
    }

    await confirm.click();

    /* The submission redirects to a per-analysis URL first and only later
       settles on /file/<hash>. Either one means the file reached VirusTotal.

       This polls page.url() instead of using waitForURL: VirusTotal is a single
       page app that changes route with pushState, and waitForURL waits for a
       load event that never fires on such a change. */
    let landed = null;
    for (let i = 0; i < 120 && !landed; i++) {
      const url = page.url();
      if (/\/gui\/(file-analysis|file)\//.test(url)) landed = url;
      else await page.waitForTimeout(500);
    }
    if (!landed) throw new Error("Upload was confirmed but VirusTotal never navigated to an analysis page.");
    console.log(`Submitted: ${landed}`);

    /* Scanning takes a moment. Poll the hash page so the script exits with a
       verdict rather than leaving someone to check by hand. */
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.goto(`${reportUrl}/detection`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(10000);
      if (page.url().startsWith(reportUrl)) {
        console.log(`Report ready: ${reportUrl}/detection`);
        return;
      }
      console.log(`  still analysing (${attempt + 1}/12)`);
    }
    console.log(`Still analysing. Check ${reportUrl}/detection shortly.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
