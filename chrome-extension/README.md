# Instagram Unfollowers (cobanov) — Chrome Extension

**[English](#english) | [Türkçe](#türkçe)**

---

## English

Original project: https://github.com/cobanov/instagram (Mert Cobanov / @cobanov)
Original site: https://cobanov.dev/instagram

This wraps the original project's "paste into console" script in a
Chrome extension. The script's own logic is unchanged — only the
trigger method changed (clicking the extension icon instead of
pasting into the console).

This was shared with the original project owner's permission.

### Install

1. Go to chrome://extensions.
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked".
4. Select this folder.

### Usage

1. Go to www.instagram.com and log in.
2. Click the extension icon in the browser toolbar.
3. Click "Start scan" in the panel that opens.

### Important notes

- This extension calls Instagram's private (internal) GraphQL/API
  endpoints using your own session cookies (ds_user_id, csrftoken).
  You never enter your password anywhere — it just uses your
  already-logged-in browser session.
- This kind of automation may violate Instagram's Terms of Service
  and could theoretically lead to rate limiting or a temporary
  restriction. The script is deliberately slow (delays between
  requests, periodic pauses) to reduce that risk, but use it at
  your own risk.
- All credit and the original implementation belong to the upstream
  project: github.com/cobanov/instagram

---

## Türkçe

Orijinal proje: https://github.com/cobanov/instagram (Mert Cobanov / @cobanov)
Orijinal site: https://cobanov.dev/instagram

Bu, o projenin "console'a yapıştır" script'ini bir Chrome eklentisine
sarmalayan bir fork'tur. Script'in kendi mantığında hiçbir
değişiklik yapılmadı; sadece tetikleme şekli değişti (console yerine
eklenti ikonuna tıklama).

Bu fork, orijinal projenin sahibinden yayınlama izni alınarak
paylaşılmıştır.

### Kurulum

1. chrome://extensions adresine git.
2. Sağ üstten "Geliştirici modu"nu (Developer mode) aç.
3. "Paketlenmemiş öğe yükle" (Load unpacked) butonuna tıkla.
4. Bu klasörü seç.

### Kullanım

1. www.instagram.com'a git ve giriş yap.
2. Tarayıcı araç çubuğundaki eklenti ikonuna tıkla.
3. Açılan panelden "Taramayı başlat" de.

### Önemli notlar

- Bu eklenti Instagram'ın herkese açık olmayan (internal) GraphQL/API
  uçlarını kullanıyor ve senin oturum çerezlerinle (ds_user_id, csrftoken)
  istek atıyor. Şifreni hiçbir yere girmiyorsun, sadece zaten giriş yapmış
  olduğun tarayıcı oturumunu kullanıyor.
- Bu tarz otomasyon Instagram'ın kullanım şartlarına aykırı sayılabilir ve
  teorik olarak hesap kısıtlamasına (rate limit / geçici blok) yol açabilir.
  Script bunu bilerek yavaş çalışacak şekilde tasarlanmış (istekler arası
  gecikme + periyodik molalar), yine de riski bilerek kullan.
- Tüm kredi ve asıl geliştirme orijinal projeye aittir: github.com/cobanov/instagram
