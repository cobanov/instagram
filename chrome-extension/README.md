# Instagram Unfollowers: Chrome Extension

**[English](#english) | [Türkçe](#türkçe)**

---

## English

Part of [cobanov/instagram](https://github.com/cobanov/instagram). The site
lives at [instagram.cobanov.dev](https://instagram.cobanov.dev).

This wraps the project's "paste into console" snippet in a Chrome extension.
The script itself is untouched, only the trigger changes: you click the
extension icon instead of pasting into DevTools.

### Install

1. Go to chrome://extensions.
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked".
4. Select this folder.

### Usage

1. Go to www.instagram.com and log in.
2. Click the extension icon in the browser toolbar.
3. Click "Scan now" in the panel that opens.

### instagram-unfollower.js is generated

`instagram-unfollower.js` in this folder is written by `scripts/build.js` from
`src/instagram-unfollower.js`. Do not edit it by hand, and run `npm run build`
after touching the source. The file is byte for byte the same as
`dist/instagram-unfollower.one-line.js`, so the SHA-256 published on the
[security page](https://instagram.cobanov.dev/security.html) verifies this copy
as well:

```
shasum -a 256 chrome-extension/instagram-unfollower.js
```

### Notes

- The extension calls Instagram's private GraphQL/API endpoints with your own
  session cookies (ds_user_id, csrftoken). You never type a password anywhere,
  it only reuses the browser session you are already logged into.
- Permissions are kept minimal: `activeTab`, `scripting`, and a host permission
  for www.instagram.com only.
- This kind of automation may conflict with Instagram's terms of service and can
  in theory lead to rate limiting or a temporary restriction. The script is slow
  on purpose (delays between requests, periodic pauses), but use it at your own
  risk.

---

## Türkçe

[cobanov/instagram](https://github.com/cobanov/instagram) projesinin parçası.
Sitesi: [instagram.cobanov.dev](https://instagram.cobanov.dev).

Bu klasör, projenin "console'a yapıştır" snippet'ini bir Chrome eklentisine
sarmalıyor. Script'in kendisi aynı, sadece tetikleme şekli değişiyor: DevTools'a
yapıştırmak yerine eklenti ikonuna tıklıyorsun.

### Kurulum

1. chrome://extensions adresine git.
2. Sağ üstten "Geliştirici modu"nu (Developer mode) aç.
3. "Paketlenmemiş öğe yükle" (Load unpacked) butonuna tıkla.
4. Bu klasörü seç.

### Kullanım

1. www.instagram.com'a git ve giriş yap.
2. Tarayıcı araç çubuğundaki eklenti ikonuna tıkla.
3. Açılan panelden "Taramayı başlat" de.

### instagram-unfollower.js üretilen dosyadır

Bu klasördeki `instagram-unfollower.js`, `scripts/build.js` tarafından
`src/instagram-unfollower.js`'ten üretilir. Elle düzenleme; kaynağı
değiştirdikten sonra `npm run build` çalıştır. Dosya
`dist/instagram-unfollower.one-line.js` ile byte byte aynı, yani
[güvenlik sayfasındaki](https://instagram.cobanov.dev/security.html) SHA-256 bu
kopyayı da doğrular:

```
shasum -a 256 chrome-extension/instagram-unfollower.js
```

### Notlar

- Eklenti, Instagram'ın herkese açık olmayan GraphQL/API uçlarına senin oturum
  çerezlerinle (ds_user_id, csrftoken) istek atar. Hiçbir yere şifre girmiyorsun,
  sadece zaten açık olan tarayıcı oturumun kullanılıyor.
- İzinler minimum tutuldu: `activeTab`, `scripting` ve yalnızca
  www.instagram.com için host izni.
- Bu tarz otomasyon Instagram'ın kullanım şartlarıyla çelişebilir, teorik olarak
  rate limit ya da geçici kısıtlamaya yol açabilir. Script bilerek yavaş çalışır
  (istekler arası gecikme, periyodik molalar), yine de riski bilerek kullan.
