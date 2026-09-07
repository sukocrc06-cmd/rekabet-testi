# oplab — Appwrite kurulumu

Proje zaten oluşturuldu (`oplab`, endpoint `fra.cloud.appwrite.io/v1`). Şimdi Console'da şu adımları tamamla.

> **Not (7 Eylül 2026):** Appwrite yakın zamanda arayüz terminolojisini değiştirdi: "Collection" → **"Table"**, "Document" → **"Row"**, "Attribute" → **"Column"** oldu. Bu SADECE isimlendirme — alttaki sistem aynı, ve kodun kullandığı klasik `Databases` API'si (`getDocument`/`createDocument`/`updateDocument`) bu yeni "Table"lar üzerinde **hiçbir değişiklik yapmadan aynen çalışıyor** (Appwrite'ın kendi duyurusu: "old collection methods still work"). Yani `oplabAuth.js` kodunda HİÇBİR ŞEY değiştirmene gerek yok — sadece Console'da gördüğün buton/etiket isimleri aşağıdaki gibi farklı olacak.

## 1. E-posta/Şifre girişini kontrol et

Sol menüden **Auth** → **Settings** sekmesi → **Email/Password** yönteminin **açık (enabled)** olduğunu doğrula (genelde varsayılan olarak açıktır).

## 2. Veritabanı oluştur

Sol menüden **Databases** → **Create database**.
- **Database ID**: sağdaki "custom ID" seçeneğine tıklayıp tam olarak `oplab_db` yaz (otomatik üretilen rastgele ID'yi KULLANMA — kod bu ismi bekliyor).
- **Name**: `oplab_db` (aynısı olabilir).
- **Create**.

## 3. Tablo (eski adıyla koleksiyon) oluştur

Az önce oluşturduğun `oplab_db` veritabanının içine gir → **"No tables yet" → Create table** butonuna tıkla (senin ekranında gördüğün buton budur, doğru yer).
- **Table ID**: yine "custom ID" ile tam olarak `user_data` yaz (otomatik ID kullanma).
- **Name**: `user_data`.
- **Create**.

## 4. Kolonları (eski adıyla attribute) ekle

`user_data` tablosunun içindeyken **Columns** sekmesi (eskiden "Attributes") → **Create column** → **String** ile şu 4 alanı tek tek ekle (her birinde **Required** kapalı/No kalsın):

| Key | Size |
|---|---|
| `email` | 255 |
| `portfolio` | 200000 |
| `watchlist` | 20000 |
| `profileName` | 100 |

## 5. Satır güvenliğini aç

Aynı tablonun **Settings** sekmesine git → **"Row Security"** (bazı ekranlarda hâlâ "Document Security" yazabilir, ikisi de aynı özellik) seçeneğini **aç (enable)**. Bu, "her kullanıcı sadece kendi satırını/belgesini okuyup yazabilir" kuralının çalışması için gerekli — kod, her kaydı oluştururken o kaydın izinlerini otomatik olarak sadece o kullanıcıya tanımlıyor.

## 6. İzin (permission) ekle

Yine **Settings** sekmesinde **Permissions** bölümü → **Add role** → **Users** (herhangi bir giriş yapmış kullanıcı) seç → sadece **Create** kutucuğunu işaretli bırak (Read/Update/Delete'i işaretleme — onlar adım 5'teki güvenlik sayesinde otomatik olarak sadece kaydın sahibine açık olacak) → kaydet.

---

Bu 6 adım tamamlanınca sistem hazır: giriş yapan bir kullanıcının verisi otomatik olarak kendi kaydına yazılır/okunur, başka hiç kimse o kayda erişemez. Console'da "Table/Row/Column" görsen de kodun beklediği ID'ler (`oplab_db`, `user_data`, `email`, `portfolio`, `watchlist`, `profileName`) tamamen aynı kalıyor — hiçbir kod değişikliği gerekmiyor.
