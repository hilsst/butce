# Bütçe

Telefon ve masaüstünde çalışan, kurulabilir (PWA) kişisel bütçe uygulaması.

- Aylık plan / gerçekleşen, sabit giderler, haftalık mutfak ve genel masraf, kişisel harcamalar
- Kredi kartları: taksitler, kalan borç, 12 aylık ödeme öngörüsü
- Kamerayla fiş/fatura okuma (cihazda, internetsiz OCR) ve kategori seçimi
- Garanti BBVA hesap hareketleri Excel'inden bakiye güncelleme
- Firebase ile cihazlar arası senkronizasyon (`firebase-config.js`, kurallar: `firestore.rules`)

Kişisel veri bu depoda yer almaz; ilk açılışta yedek dosyasından yüklenir ya da Google girişiyle buluttan gelir.
`araclar/aktar.py` eski Excel bütçesinden yedek dosyası üretir.
