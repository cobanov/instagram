// Uzantı ikonuna tıklandığında, aktif sekme instagram.com ise
// paneli sayfaya enjekte eder (script zaten kendi kendine
// mount/unmount toggle yapıyor, tekrar tıklarsan kapanır).
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
