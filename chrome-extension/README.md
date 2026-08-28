# Instagram Unfollowers (cobanov) — Chrome Eklentisi

Orijinal proje: https://github.com/cobanov/instagram (Mert Cobanov / @cobanov)
Orijinal site: https://cobanov.dev/instagram

Bu, o projenin "console'a yapıştır" script'ini bir Chrome eklentisine
sarmalayan bir fork'tur. Script'in kendi mantığında hiçbir
değişiklik yapılmadı; sadece tetikleme şekli değişti (console yerine
eklenti ikonuna tıklama).

Bu fork, orijinal projenin sahibinden yayınlama izni alınarak
paylaşılmıştır.

## Kurulum

1. chrome://extensions adresine git.
2. Sağ üstten "Geliştirici modu"nu (Developer mode) aç.
3. "Paketlenmemiş öğe yükle" (Load unpacked) butonuna tıkla.
4. Bu klasörü seç.

## Kullanım

1. www.instagram.com'a git ve giriş yap.
2. Tarayıcı araç çubuğundaki eklenti ikonuna tıkla.
3. Açılan panelden "Taramayı başlat" de.

## Önemli notlar

- Bu eklenti Instagram'ın herkese açık olmayan (internal) GraphQL/API
  uçlarını kullanıyor ve senin oturum çerezlerinle (ds_user_id, csrftoken)
  istek atıyor. Şifreni hiçbir yere girmiyorsun, sadece zaten giriş yapmış
  olduğun tarayıcı oturumunu kullanıyor.
- Bu tarz otomasyon Instagram'ın kullanım şartlarına aykırı sayılabilir ve
  teorik olarak hesap kısıtlamasına (rate limit / geçici blok) yol açabilir.
  Script bunu bilerek yavaş çalışacak şekilde tasarlanmış (istekler arası
  gecikme + periyodik molalar), yine de riski bilerek kullan.
- Tüm kredi ve asıl geliştirme orijinal projeye aittir: github.com/cobanov/instagram
