// Clicking the toolbar icon injects the panel into the active tab, but only on
// instagram.com. The script mounts and unmounts itself, so a second click
// closes the panel again.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !tab.url.startsWith("https://www.instagram.com")) {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["instagram-unfollower.js"]
    });
  } catch (err) {
    console.error("[iu-extension] injection failed:", err);
  }
});
