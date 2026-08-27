# 🚬 Sigara Takip Sistemi

Rol yapma sunucusu (veya benzeri işletme) için sigara dağıtım takip uygulaması.
Her oyuncu **4 saatte bir** sigara alabilir; kural hem arayüzde canlı geri sayımla,
hem de sunucu tarafında zorunlu olarak uygulanır.

## Kurulum

```bash
npm install
```

```bash
npm run seed
```

```bash
npm start
```

Tarayıcıdan `http://localhost:3000` adresine gidin.

### İlk adım: sistemi kendiniz kurun

**Sistem tamamen boş gelir** — hazır garson, sigara türü veya sigaracı hesabı yoktur.
Yalnızca bir yönetici hesabı oluşturulur; geri kalanını siz tanımlarsınız.

`admin` hesabıyla girip **Yönetim** sekmesinden sırasıyla:

1. **Garsonlar** — tek tek ya da toplu (her satıra bir ad)
2. **Sigara türleri** — tek tek ya da toplu
3. **Sigaracı hesapları** — kullanıcı adı + şifre belirleyip oluşturun

Garson ve sigara türü tanımlanana kadar kayıt açılamaz; Hızlı Kayıt sayfası
eksik olanı adıyla söyler ve yöneticiyi Yönetim sayfasına yönlendirir.

### İlk kurulum hesabı

| Kullanıcı | Şifre | Rol |
|---|---|---|
| `admin` | `ADMIN_SIFRESI` | yönetici |

> ⚠️ İlk girişten sonra bu şifreyi **Yönetim → Sigaracı Hesapları → Şifre** ile değiştirin
> ve `.env` içinde uzun rastgele bir `SESSION_SECRET` tanımlayın
> (`.env.example` dosyasını kopyalayın).

Sigaracı hesaplarını bu hesapla girip siz oluşturursunuz; sistemde kendi kendine
kayıt olma yoktur.

## Yapılandırma (`.env`)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Sunucu portu |
| `COOLDOWN_HOURS` | `4` | Sigara kuralı (saat). Değiştirince arayüz de otomatik uyum sağlar |
| `SESSION_SECRET` | — | Oturum çerezi imzalama anahtarı |
| `NODE_ENV` | `development` | `production` yapılırsa çerez `secure` (HTTPS) olur |
| `DAY_START_HOUR` | — | **Artık kullanılmıyor.** Yalnızca eski kurulumların geçmişini aktarırken bir kez okunur (aşağıya bakın) |

## Gün değişimi — gün sonu raporu ile

Gün değişimi **saate bağlı değildir.** İş günü, yönetici *Gün Sonu Raporu*'nu
**alana kadar** sürer; raporun alındığı an dönem kapanır ve yeni iş günü tam o
anda başlar.

- Rapor sayfasındaki **"Günü Kapat ve Raporu Al"** düğmesi bu işlemi yapar.
  Onay penceresi çıkar; ne kapatılacağı ve sonucu açıkça yazar.
- **Raporu yalnızca görüntülemek günü kapatmaz.** Sayfayı açmak, dönem seçmek,
  yazdırmak veya Excel'e aktarmak kapanış sayılmaz — kapanış yalnızca o düğmeyle olur.
- Kapanmış bir güne kayıt eklenemez ve o günün kayıtlarında **sigara değişimi yapılamaz**
  (değişim stoğu güncel döneme işlerken kaydı eski döneme bırakır, iki günün
  mutabakatı da bozulurdu).
- Aynı takvim gününde ikinci kez kapanış yapılırsa dönem etiketi `#2`, `#3` soneki alır.
- Dönemde hiç işlem yoksa sistem uyarır; yönetici isterse boş günü yine de kapatabilir.

Kapanışlar `day_closures` tablosunda tutulur: hangi dönem, ne zaman açıldı,
ne zaman ve **kim tarafından** kapatıldı, kapanış notu.

### Mevcut kurulumdan geçiş

Eskiden gün değişimi `DAY_START_HOUR` (varsayılan 06:00) ile hesaplanıyordu.
Yeni sürüm ilk çalıştığında geçmiş günleri bu eski kurala göre **geriye dönük
kapanış kayıtlarına çevirir** — eski gün sonu raporlarınız ve kaydedilmiş fiziksel
sayımlarınız aynen geçerli kalır. İçinde bulunduğunuz gün kapatılmaz, açık kalır.
Bu aktarım bir kez çalışır ve konsola kaç günün dönüştürüldüğünü yazar.

## Sigara değiştir

Misafir aldığı sigarayı başka bir türle değiştirmek isterse Hızlı Kayıt
sayfasındaki *Son Kayıtlar* listesinden **Değiştir** düğmesiyle yapılır.

Onay ekranı ne olacağını açıkça gösterir (`Marlboro ×2 → Parliament ×2`) ve tür
seçilmeden onay düğmesi açılmaz — yanlışlıkla değişim yapılmasını bu engeller.

Değişim yapıldığında:

- **İlk kayıt silinmez.** Arşivde `DEĞİŞTİRİLDİ` rozetiyle durur; yerine geçen
  kayda `superseded_by` ile bağlanır.
- Hangi sigaranın neyle değiştirildiği, adet, **tarih/saat** ve **işlemi yapan
  kullanıcı** `record_exchanges` tablosuna yazılır.
- **Stok:** eski tür stoğa geri döner, yeni türden düşer.
- **Rapor ve günlük adet:** toplamlar `superseded_by IS NULL` süzgeciyle
  hesaplanır, yani bir değişim dağıtılan paketi iki kat göstermez. Marka bazlı
  dağılımda sigara yeni markaya sayılır.
- **4 saat sayacı değişmez.** Değişim yeni bir hak kullanımı değildir; yerine
  geçen kayıt orijinalin saatini devralır. Değişimin kendi anı ayrıca tutulur.
- Değişim tekrarlanabilir (A → B → C); zincir korunur.
- Bir kayıt silinirse **zincirin tamamı** birlikte silinir ve yalnızca fiilen
  dışarıda olan sigara stoğa iade edilir.

Gün sonu raporunda *"Sigara Değişimleri"* başlığı altında ayrı listelenir.

## İptal Edilenler / Arşiv

Müşteri sigarayı aldıktan sonra iade ederse satış **iptal edilir**: aktif
kayıtlardan çıkar ama **silinmez** — tüm geçmişiyle `/iptal.html` sayfasında
arşivlenir. Arşivdeki *İptal Et* düğmesi (yönetici) bu işlemi yapar.

İptal edildiğinde:

- Kayıt aktif arşivde ve Son Kayıtlar listesinde **görünmez**; İptaller
  bölümüne taşınır. Satış tarihi, garson, sigaracı, adet, uyarı/erken alım
  rozetleri — hepsi korunur.
- **İptal nedeni, zamanı ve iptali yapan kullanıcı** `record_cancellations`
  tablosuna yazılır.
- Sigara **stoğa geri döner**.
- Oyuncunun **4 saat sayacı serbest kalır** — iptal edilen satış hak kullanımı
  sayılmaz, olmamış bir satış için oyuncu bekletilmez.
- İptal edilmiş bir satışta sigara değişimi yapılamaz.
- Sigara değişimiyle güncellenmiş bir kaydın iptali, **yerine geçen güncel
  kayıt** üzerinden yapılır; stok yalnızca fiilen dışarıda olan sigara için döner.

### Aynı gün iptal / geç iptal

Kapanmış bir günün raporu **değişmez** — "gün sonu raporu alındı" kavramının
tüm anlamı budur. Bu yüzden iptal, satışın dönemi hâlâ açık mı diye ikiye ayrılır:

| | Aynı dönemde iptal | Geç iptal (gün kapanmışken) |
|---|---|---|
| Satış o günün raporunda | **Çıkar** | **Kalır** — sigara o gün gerçekten satılmıştı |
| Stok iadesi | O dönemin tüketimini sıfırlar | **Cari döneme** düzeltme olarak düşer |
| 4 saat sayacı | Serbest kalır | Serbest kalır |

Geç iptalde iade, bugünün mutabakatında **DÜZELTME** sütununda görünür.
Muhasebedeki "geçmiş defteri düzeltilmez, cari döneme iade fişi kesilir"
kuralının karşılığıdır. İptaller listesinde ve gün sonu raporunda
**GEÇ İPTAL** rozetiyle işaretlenir.

Raporun (muhasebe) ve sayacın (hak) geç iptalde farklı davranması kasıtlıdır:
defter geçmişi korur, oyuncu ise olmamış bir satış yüzünden beklemez.

## Dosya yapısı

```
sigara/
├── server.js              Express giriş noktası, oturum, sayfa korumaları
├── config.js              Ortam değişkenleri + 4 saat kuralı sabitleri
├── db/
│   ├── database.js        SQLite bağlantısı + şema (CREATE TABLE)
│   └── seed.js            Başlangıç verisi (garson, tür, kullanıcı)
├── services/
│   ├── cooldown.js        4 SAAT KURALI — tek kaynak
│   ├── businessDay.js     Gün değişimi — KAPANIŞ tabanlı dönem hesapları
│   ├── exchange.js        Sigara değişimi — tek kaynak
│   ├── cancellation.js    Satış iptali / iade — tek kaynak
│   ├── reconciliation.js  Gün sonu stok sayımı / mutabakat
│   ├── flags.js           Modül 7 — özel onay / uyarı mantığı
│   └── stock.js           Modül 8 — stok hareketleri
├── middleware/
│   └── auth.js            requireAuth / requireAdmin
├── routes/
│   ├── auth.js            /api/auth/*
│   ├── lookups.js         /api/waiters, /api/cigarette-types
│   ├── users.js           /api/users — hesap yönetimi
│   ├── flags.js           /api/flags — oyuncu uyarıları
│   ├── stock.js           /api/stock — stok paneli
│   ├── reports.js         /api/reports — gün sonu raporu
│   └── admin.js           /api/admin — toplu silme / sıfırlama
│   └── records.js         /api/records/*
├── public/
│   ├── login.html         Giriş
│   ├── kayit.html         Hızlı kayıt + özet (giriş sonrası ana sayfa)
│   ├── arsiv.html         Filtreli arşiv
│   ├── sorgu.html         ID sorgulama
│   ├── stok.html          Stok paneli
│   ├── rapor.html         Gün sonu raporu (admin)
│   ├── yonetim.html       Garson / tür yönetimi (admin)
│   ├── css/style.css      Mobile-first responsive stil
│   └── js/
│       ├── api.js         Fetch sarmalayıcı, biçimleyiciler, toast
│       ├── autocomplete.js Uzun listeler için yazarak seçim bileşeni
│       ├── approval.js    Modül 7 — engel / onay ekranı
│       ├── degisim.js     Sigara değiştir — onay ekranı
│       ├── iptal.js       İptal Edilenler sayfası
│       ├── danger.js      Silme ve sıfırlama onay pencereleri
│       ├── layout.js      Ortak kabuk: üst bar, gezinme, oturum
│       ├── login.js  kayit.js  arsiv.js  sorgu.js  yonetim.js
└── data/                  SQLite dosyaları (git'e girmez)
```

## Sayfalar

| Adres | İçerik | Erişim |
|---|---|---|
| `/login.html` | Giriş | herkes |
| `/kayit.html` | Hızlı kayıt + özet kartları + son 10 kayıt | oturum |
| `/arsiv.html` | Filtreler + tam arşiv + sayfalama | oturum |
| `/iptal.html` | İptal edilen satışlar + filtreler | oturum (iptal etmek: **admin**) |
| `/sorgu.html` | ID sorgulama, canlı geri sayım, geçmiş | oturum |
| `/stok.html` | Stok kartları, ikmal, sayım, hareket geçmişi | oturum |
| `/rapor.html` | Gün sonu raporu | **admin** |
| `/yonetim.html` | Garson, tür, hesap ve uyarı yönetimi | **admin** |

Oturumsuz erişim `/login.html` adresine yönlendirilir; `/yonetim.html` sigaracı
hesaplarında hem gezinme çubuğunda gizlenir hem de doğrudan açılamaz.

## Garson seçimi

Kadro kalabalık olabileceği için "Alan Garson" alanı açılır liste değil,
**yazarak seçim** alanıdır:

- Alana tıklayınca tüm garsonlar listelenir; yazdıkça daralır.
- Önce **adı o harflerle başlayanlar**, sonra içinde geçenler sıralanır;
  eşleşen harfler vurgulanır.
- Türkçe karakterlere duyarlıdır — `ILK` yazınca `Ilker`, `ıspanak` ile `Ispanak` eşleşir.
- Ok tuşları + Enter, ya da dokunma/tıklama ile seçilir.
- **Serbest metin kabul edilmez.** Listede olmayan bir ad yazılırsa alan kırmızıya döner
  ve kayıt gönderilmez; sunucu da geçersiz garson id'sini `400` ile reddeder.
- Tam ad yazılıp alandan çıkılırsa (ya da tek eşleşme kalırsa) otomatik seçilir —
  `zeynep` yazıp geçmek `Zeynep`'i seçer.
- Seçilen garson kayıttan sonra korunur; aynı vardiyada arka arkaya kayıt hızlanır.

Aynı alan Arşiv sayfasındaki garson filtresinde de kullanılır.

### Garson ekleme

Sistem **boş garson listesiyle** gelir; kadronuzu Yönetim sayfasından siz oluşturursunuz:

- **Tek tek:** ad yazıp *Ekle*.
- **Toplu:** her satıra bir ad yazıp *Listeyi Ekle*. Boş satırlar ve tekrarlar atlanır,
  sonuç `3 eklendi, 1 zaten kayıtlı` biçiminde özetlenir.

Aynı ad iki kez eklenemez (büyük/küçük harf farkı da aynı sayılır).

Kalıcı bir başlangıç kadrosu isterseniz [db/seed.js](db/seed.js) içindeki
`DEFAULT_WAITERS` dizisine adları yazın; `npm run seed` çalıştırıldığında eklenirler.
Dizi varsayılan olarak boştur.

Bir garson işten ayrılırsa **Sil** düğmesiyle listeden kaldırın. Geçmiş kayıtlar
bozulmaz — kayıtlarda garson adı snapshot olarak tutulduğu için arşivde görünmeye
devam eder.

Garsonlarda aktif/pasif ayrımı yoktur; listede olan herkes kayıt formunda seçilebilir.

### Garson veya tür tanımlı değilken

Hızlı Kayıt sayfasında ilgili alan devre dışı kalır ve 4 saat kuralı uygun olsa bile
*Kaydı Oluştur* düğmesi açılmaz. İpucu satırı eksik olanı adıyla söyler
(`Önce sisteme garson ve sigara türü eklenmeli.`). Yönetici uyarıdan doğrudan Yönetim
sayfasına geçebilir; sigaracıya yöneticiye başvurması söylenir.

## Erken alım — süresi dolmadan verme

4 saat kuralı **sert engel değildir**. Yüksek oynama miktarı gibi gerekçelerle hak
kazanan oyunculara, süresi dolmadan da sigara verilebilir — ancak yetkili onayıyla
ve iz bırakarak.

Akış:

1. Süresi dolmamış bir ID girildiğinde gösterge turuncu olur ve kalan süreyi sayar,
   ama **kayıt düğmesi açık kalır**. İpucu satırı ne olacağını söyler:
   *"Süre dolmadı — kaydetmek isterseniz yetkili onayı istenecek."*
2. *Kaydı Oluştur*'a basılınca **onay ekranı** açılır: oyuncunun ID'si, **kalan süre
   canlı sayaçla**, normal alım saati ve son alım bilgisi görünür.
3. Devam etmek için **onayı veren yetkilinin adı** zorunludur; gerekçe alanı opsiyoneldir.
   "Süresinin dolmadığını gördüm" kutusu işaretlenmeden onay düğmesi açılmaz.
4. Onaylanırsa kayıt oluşur; **kim onayladı, o an ne kadar süre kalmıştı ve gerekçe**
   kayda işlenir.
5. Vazgeçilirse kayıt oluşmaz.

Kural sunucu tarafında da uygulanır: onaysız istek `409` (`canOverride: true` ile),
onaylayan adı eksikse `428` döner.

**Bloke oyuncular istisnadır** — Modül 7'deki `blocked` seviyesi erken alımla da
aşılamaz, çünkü uyarı kontrolü süre kontrolünden sonra çalışır.

Erken alımlar arşivde ve son kayıtlar listesinde **ERKEN** rozetiyle işaretlenir,
gün sonu raporunda *"Süresi Dolmadan Verilenler"* başlığı altında ayrı listelenir.

## Yönetim sayfası

Yalnızca yönetici erişir. Üç bölümden oluşur:

**Garsonlar** — tek tek veya toplu ekleme, aktif/pasif.

**Sigara türleri** — aynı şekilde. Pasif tür kayıt formunda görünmez,
geçmiş kayıtlar etkilenmez.

**Sigaracı hesapları** — kullanıcı adı, ad soyad, şifre ve yetki (sigaracı / yönetici)
belirleyip hesap oluşturursunuz. *Şifreyi göster* kutusuyla yazdığınızı doğrulayıp
sigaracıya iletirsiniz. Her satırdaki **Şifre** düğmesi unutulan şifreyi sıfırlar.

Kural ve sınırlar:

- Kullanıcı adı 3–30 karakter; harf, rakam, nokta, tire, alt çizgi. Büyük/küçük harf
  farkı aynı sayılır (`Ahmet` ile `ahmet` çakışır).
- Şifre en az 6 karakter, `bcrypt` ile saklanır.
- Kendi hesabınızı pasife alamaz, kendi yönetici yetkinizi kaldıramazsınız.
- **Sistemde en az bir aktif yönetici kalmalıdır** — son yöneticiyi düşüren işlem reddedilir.
- Pasif hesap giriş yapamaz (`403`), ama geçmiş kayıtları arşivde durur.
- Hesap silme yoktur; ayrılan personeli pasife alın.

## Özel onay ve uyarı mekanizması (Modül 7)

Bazı oyuncular için önceden uyarı tanımlanabilir. **4 saatlik süre dolmuş ve sistem
yeşil yanıyor olsa bile**, bu oyuncularda kayıt açılmadan önce sigaracının önüne
engel ekranı çıkar.

Üç seviye vardır:

| Seviye | Ekranda | Geçiş şartı |
|---|---|---|
| **Uyarı** | `DİKKAT — UYARI KAYDI VAR` | Sigaracı uyarıyı okuduğunu onaylar |
| **Yetkili onayı** | `YETKİLİ ONAYI GEREKLİ` | Onayı veren yetkilinin **adı** girilir |
| **Bloke** | `BLOKE — SİGARA VERİLEMEZ` | **Geçiş yok** — onay düğmesi hiç görünmez |

Nasıl işler:

1. Sigaracı Oyuncu ID'yi yazar yazmaz, uyarı metni formda **büyük harflerle** bir şerit
   olarak belirir — kaydet düğmesine basmadan önce görür.
2. *Kaydı Oluştur*'a basınca tam ekran engel ekranı açılır. Uyarı notu büyük punto ve
   büyük harflerle, sayfanın ortasında durur.
3. *Yetkili onayı* seviyesinde onaylayan adı girilmeden ve "okudum" kutusu
   işaretlenmeden onay düğmesi açılmaz.
4. Onay verilirse kayıt oluşur; **onaylayan kişi, onay notu ve uyarı metni kayda
   snapshot olarak işlenir.** Uyarı sonradan kaldırılsa bile arşivde durur.
5. Kural sunucu tarafında da uygulanır: onaysız istek `428`, bloke oyuncu `423` döner.
   Tarayıcı engeli aşılsa bile kayıt açılamaz.

Uyarılar Yönetim sayfasından tanımlanır, kaldırılır ve geri getirilir. Her oyuncu için
tek aktif uyarı tutulur; aynı ID'ye yeniden tanımlama yapılırsa mevcut kayıt güncellenir.

## Stok yönetimi (Modül 8)

Her sigara türü bir **stok kartıdır**. Stok Paneli tüm türleri tek ekranda listeler.

- **Otomatik düşüş:** kayıt onaylanıp oluşturulduğunda verilen paket adedi ilgili
  karttan anında düşer. Düşüş, kayıt ekleme ile **aynı veritabanı işlemi** içindedir —
  kayıt başarısız olursa stok da düşmez.
- **Stok yetersizse kayıt açılamaz.** İstenen miktar mevcuttan fazlaysa sunucu `409`
  döndürür ve hangi türden kaç paket kaldığını bildirir.
- **İkmal:** yeni koli geldiğinde Stok Paneli'nden mevcut stoğun üzerine eklenir.
  Sigaracılar da ikmal girebilir.
- **Sayım düzeltmesi:** fiziksel sayım farkı için stok doğrudan hedef değere ayarlanır.
- **Kritik uyarı:** stok kritik eşiğin altına düşünce kart kırmızı `KRİTİK`, sıfırlanınca
  `TÜKENDİ` gösterir. Kayıt sonrası sigaracıya ayrıca bildirim çıkar. Eşik tür başına
  ayarlanır (varsayılan 5 paket), yönetici tablodan tıklayarak değiştirir.
- **Hareket geçmişi:** her giriş/çıkış/düzeltme kim tarafından, ne zaman, hangi bakiyeyle
  yapıldığı ile birlikte `stock_movements` tablosunda tutulur.

> Birim **pakettir**: kayıttaki "adet" alanı kaç paket verildiğini gösterir ve stoktan
> o kadar düşer.

## Gün sonu raporu (Modül 9)

Yalnızca yöneticiye açıktır. İki kapsamı vardır:

**Tek Gün** (varsayılan) — asıl kullanım. Sayfa açıldığında içinde bulunulan iş günü
seçili gelir; *Bugün* ve *Dün* kısayolları vardır. Başlık seçili günü ve saat aralığını
açıkça yazar: `25 Ağustos 2026 günü — 06:00 / 05:59`.

**Tarih Aralığı** — haftalık/aylık dökümler için. Başlangıç ve bitiş seçilir,
*Son 7 gün* ve *Son 30 gün* kısayolları vardır. Tek gün modunda seçili olan tarih,
aralık moduna geçince başlangıç olarak taşınır.

*Yazdır* düğmesi sayfayı sade, beyaz zeminli bir çıktıya dönüştürür.

Bölümler:

1. **Özet** — toplam işlem, dağıtılan paket, farklı oyuncu, garson, sigaracı, özel onaylı
2. **Marka bazlı dağıtım** — hangi türden kaç paket, kaç işlem
3. **Garson bazlı dağılım** — her garsonun dağıttığı paket, işlem ve oyuncu sayısı
4. **Sigaracı bazlı işlemler** — kim kaç işlem girdi, ilk ve son işlem saati
5. **Özel onay ile verilenler** — hangi oyuncu, hangi uyarı, **kimin onayıyla**, hangi not
6. **Kalan stok raporu** — anlık paket sayıları, kritik eşikler ve dönem içi ikmaller

## Veri silme ve sıfırlama

Yönetici her veriyi silebilir. **Silme geri alınamaz**, bu yüzden her yıkıcı işlem
onay ister.

### Tek tek silme

| Nerede | Ne silinir | Sonuç |
|---|---|---|
| Yönetim → Garsonlar | Garson | Geçmiş kayıtlarda adı kalır |
| Yönetim → Sigara Türleri | Tür | **Stok kartı ve kalan paketler de gider**; arşivde tür adı kalır |
| Yönetim → Sigaracı Hesapları | Hesap | Kişi bir daha giremez; açtığı kayıtlar arşivde adıyla kalır |
| Yönetim → Oyuncu Uyarıları | Uyarı | Tamamen silinir |
| Arşiv → satır sonundaki **Sil** | Tek kayıt | **Verilen paketler stoğa geri eklenir** (düzeltme hareketi olarak loglanır) |

Her birinde ne olacağını anlatan bir onay penceresi çıkar.

### Toplu sıfırlama

Yönetim sayfasının altındaki **Veri Sıfırlama** bölümü hangi veriden kaç kayıt
olduğunu gösterir ve iki düğme sunar:

- **Seçerek Sil** — hangi kapsamların silineceğini siz işaretlersiniz
- **Her Şeyi Sıfırla** — tüm kapsamlar baştan işaretli gelir

Kapsamlar: kayıt arşivi, stok hareket geçmişi, stok sayaçları, oyuncu uyarıları,
garsonlar, sigara türleri, diğer hesaplar.

Onay penceresinde **`SIFIRLA`** kelimesini yazmadan silme düğmesi açılmaz. Sunucu da
aynı kelimeyi ister (`428` döner) — yani yanlışlıkla yapılan bir API çağrısı veri silemez.

### Korumalar

- Tüm silme uçları yalnızca **yöneticiye** açıktır (sigaracı denerse `403`)
- **Kendi hesabınızı** silemez veya pasife alamazsınız
- **Son aktif yönetici** silinemez — sistem yöneticisiz kalamaz
- Sıfırlamada kendi hesabınız her zaman korunur

### Yedek alma

Silmeden önce sunucudaki veritabanını kopyalayın:

```bash
copy data\sigara.db data\yedek-sigara.db
```

Geri yüklemek için uygulamayı durdurup dosyayı geri kopyalayın (`.db-wal` ve `.db-shm`
dosyalarını silin).

## Gün değişimi (iş günü)

Sistemde gün **gece yarısında değil, sabah 06:00'da** değişir. `DAY_START_HOUR`
ayarıyla değiştirilebilir.

Yani 25 Ağustos saat 23:00'te başlayan gün, **26 Ağustos 05:59'a kadar** sürer.
26 Ağustos 06:00'da yeni gün başlar.

| İşlem saati | Ait olduğu iş günü |
|---|---|
| 25 Ağu 23:00 | 25 Ağustos |
| 26 Ağu 03:00 | **25 Ağustos** |
| 26 Ağu 05:59 | **25 Ağustos** |
| 26 Ağu 06:00 | 26 Ağustos |
| 26 Ağu 12:00 | 26 Ağustos |

Bu kural şuralarda geçerlidir:

- **Gün sonu raporu** — tek gün seçimi ve tüm kısayollar. 25 Ağustos seçmek
  25 Ağu 06:00 – 26 Ağu 05:59 aralığını getirir; başlıkta bu aralık açıkça yazar.
- **Arşiv tarih filtresi** — aynı mantık. Gece 03:00'te açılan bir kayıt, önceki
  günün filtresinde görünür.
- **Hızlı Kayıt özet kartları** — "Bugün Kayıt / Bugün Adet" içinde bulunulan iş
  gününü sayar. Sayfa başlığında hangi iş gününde olunduğu yazar.

4 saat kuralı bundan **etkilenmez** — o, son alımdan itibaren kayan bir penceredir,
gün sınırıyla ilgisi yoktur. Gece 05:00'te sigara alan biri 09:00'da tekrar alabilir,
araya gün değişimi girmiş olması bir şey değiştirmez.

Ayar tek yerdedir: [services/businessDay.js](services/businessDay.js) sunucu tarafında,
`businessRangeISO()` ([public/js/api.js](public/js/api.js)) arayüzde. Saat
`/api/config` ile arayüze bildirilir.

## Gün sonu stok sayımı (mutabakat)

İşletmenin Excel'de tuttuğu gün sonu sayım tablosunun karşılığıdır. Gün Sonu Raporu
sayfasının en üstünde yer alır:

| NO | SİGARA ADI | DEVİR | GİRİŞ | TÜKETİM | KALAN | SAYIM | FARK | TUTAR |
|---|---|---|---|---|---|---|---|---|
| 1 | Camel | 9 | +20 | −3 | 26 | 24 | −2 | 328,23 ₺ |

Denklem: **DEVİR + GİRİŞ − TÜKETİM = KALAN**

| Sütun | Nereden gelir |
|---|---|
| **DEVİR** | İş günü başlamadan önceki son stok bakiyesi |
| **GİRİŞ** | Gün içi ikmal (Stok Paneli'nden girilen koli/paket) |
| **TÜKETİM** | Gün içi kayıtlardan çıkan paket |
| **KALAN** | Sistemin hesapladığı bakiye |
| **SAYIM** | Fiziksel sayımda bulunan — elle girilir |
| **FARK** | SAYIM − KALAN. Eksi ise kayıp, artı ise fazla; sıfırsa yeşil |
| **TUTAR** | Tüketim × birim fiyat |

Sayım kutusuna yazdıkça fark anlık hesaplanır. **Sayımı Kaydet** ile o iş gününe
kaydedilir (aynı gün tekrar girilirse güncellenir), rapor sonra açıldığında girilen
değerler yerinde durur.

**Excel'e Aktar** düğmesi tabloyu CSV olarak indirir — noktalı virgül ayraçlı ve BOM'lu
olduğu için Türkçe Excel'de çift tıklamayla doğru açılır, sütunlar ayrışır.

### Birim fiyat

İki yol var, ikisi de Stok Paneli'nde ve yalnızca yöneticiye açıktır:

**Tek tek** — tablodaki **Birim Fiyat** hücresine tıklayın, değeri yazıp ✓ ile kaydedin.

**Toplu** — **Toplu Birim Fiyat** kutusuna her satıra bir ürün ve fiyat yazın:

```
CAMEL YELLOW	104,65
PARLIAMENT BLUE BOX;118.90
MARLBORO RED BOX 125
```

Ayraç olarak **sekme, noktalı virgül veya boşluk** kullanılabilir — Excel'den iki sütunu
kopyalayıp doğrudan yapıştırabilirsiniz. Ondalık için virgül de nokta da olur, sondaki
`₺` / `TL` yok sayılır. Ürün adı eşleşmesi büyük/küçük harf duyarsızdır.

İşlem sonunda kaç ürünün güncellendiği, hangilerinin sistemde bulunamadığı ve hangi
satırların okunamadığı listelenir — yanlış yazılan bir ad sessizce atlanmaz.

Gün sonu raporundaki TUTAR ve toplam tutar bu fiyattan hesaplanır.

### Tutarsızlık işareti

Bir türün adının yanında **?** rozeti çıkıyorsa, stok kartındaki değer ile hareket
geçmişinden hesaplanan kalan ayrışmış demektir (örneğin veritabanına elle müdahale
edilmişse). Sayım girip kaydederek düzeltebilirsiniz.

## Responsive davranış

Arayüz mobile-first kurulmuştur; 320 px genişliğe kadar yatay taşma yoktur.

| Genişlik | Gezinme | Tablolar | Özet kartları | Form |
|---|---|---|---|---|
| < 640 px | Ekran altında sabit sekme çubuğu | Satırlar karta dönüşür, başlıklar etiket olur | 2 sütun | tek sütun |
| 640–1023 px | 768 px'den itibaren üstte yatay sekmeler | Normal tablo | 3 sütun | iki sütun |
| ≥ 1024 px | Üstte yatay sekmeler | Normal tablo | 6 sütun | iki sütun |

Ayrıntılar:

- **Dokunma hedefleri** en az 44 px yüksekliğinde (WCAG 2.5.5).
- **Form alanları 16 px** yazı boyutunda — daha küçük değerler iOS Safari'de
  odaklanınca sayfayı otomatik yakınlaştırır.
- **Geri sayım sayacı** `clamp()` ile ekran genişliğine göre 26–34 px arasında ölçeklenir.
- Üst bar ve gezinme tek bir yapışkan sarmalayıcıdadır; sayfa kaydırılınca birbirine girmez.
- Bildirimler telefonda alt sekme çubuğunun üstünde, masaüstünde sağ altta belirir.
- iPhone çentik/alt çubuk alanı `env(safe-area-inset-*)` ile hesaba katılır.
- `prefers-reduced-motion` tercihi olan kullanıcılarda animasyonlar kapanır.


## Veritabanı şeması

| Tablo | Amaç |
|---|---|
| `users` | Sigaracılar ve yöneticiler (bcrypt şifre) |
| `waiters` | Önceden tanımlı garsonlar — form dropdown kaynağı |
| `cigarette_types` | Sigara türleri — form dropdown kaynağı |
| `records` | Dağıtım arşivi (onay bilgisi snapshot'ı dahil) |
| `daily_counts` | Gün sonu fiziksel sayım kayıtları |
| `player_flags` | Oyuncu bazlı özel uyarı / onay / bloke tanımları |
| `stock_movements` | Her stok hareketi (ikmal, çıkış, düzeltme) |

`records` tablosunda garson adı ve sigaracı kullanıcı adı **snapshot** olarak da
tutulur: bir garson sonradan pasife alınsa veya adı değişse bile geçmiş kayıtlar bozulmaz.

Zaman damgaları ISO-8601 UTC (`2026-08-23T15:04:05.123Z`) saklanır. Bu format hem
kronolojik hem sözlüksel sıralandığı için tarih aralığı filtresi doğrudan
`created_at BETWEEN ?` ile çalışır. Arayüz saatleri kullanıcının yerel saat dilimine çevirir.

## API

Tüm uçlar oturum çerezi ister (`/api/auth/login` hariç).

| Metot | Uç | Açıklama |
|---|---|---|
| `POST` | `/api/auth/login` | Giriş |
| `POST` | `/api/auth/logout` | Çıkış |
| `GET` | `/api/auth/me` | Oturumdaki kullanıcı |
| `GET` | `/api/config` | Kural süresi, gün değişimi saati, sunucu saati |
| `GET` | `/api/waiters` | Garson listesi (dropdown) |
| `POST` | `/api/waiters` | Garson ekle *(admin)* |
| `PATCH` | `/api/waiters/:id` | Garson aktif/pasif *(admin)* |
| `GET` | `/api/cigarette-types` | Sigara türleri |
| `PATCH` | `/api/cigarette-types/:id` | Tür aktif/pasif *(admin)* |
| `GET` | `/api/users` | Yöneticiye tam liste, diğerlerine yalnızca adlar |
| `POST` | `/api/users` | Hesap oluştur *(admin)* |
| `PATCH` | `/api/users/:id` | Aktif/pasif, şifre sıfırlama, rol *(admin)* |
| `DELETE` | `/api/users/:id` | Hesabı sil *(admin)* |
| `DELETE` | `/api/waiters/:id` | Garsonu sil *(admin)* |
| `DELETE` | `/api/cigarette-types/:id` | Türü sil *(admin)* |
| `DELETE` | `/api/flags/:id` | Uyarıyı sil *(admin)* |
| `DELETE` | `/api/records/:id` | Kaydı sil, stoğu iade et *(admin)* |
| `GET` | `/api/admin/overview` | Hangi veriden kaç kayıt var *(admin)* |
| `POST` | `/api/admin/reset` | Toplu sıfırlama, `confirm: "SIFIRLA"` *(admin)* |
| `GET` | `/api/flags` | Tanımlı oyuncu uyarıları |
| `GET` | `/api/flags/:playerId` | Tek oyuncunun uyarısı |
| `POST` | `/api/flags` | Uyarı tanımla / güncelle *(admin)* |
| `PATCH` | `/api/flags/:id` | Uyarıyı kaldır / geri getir *(admin)* |
| `GET` | `/api/stock` | Stok kartları + özet |
| `GET` | `/api/stock/movements` | Son stok hareketleri |
| `POST` | `/api/stock/add` | İkmal (stok ekleme) |
| `POST` | `/api/stock/set` | Sayım düzeltmesi |
| `PATCH` | `/api/stock/:id/critical` | Kritik eşik *(admin)* |
| `GET` | `/api/reports/daily?from=&to=` | Gün sonu raporu *(admin)* |
| `GET` | `/api/reports/reconciliation?day=` | Gün sonu stok mutabakatı *(admin)* |
| `POST` | `/api/reports/counts` | Fiziksel sayımı kaydet *(admin)* |
| `GET` | `/api/reports/reconciliation.csv?day=` | Sayım tablosunu CSV indir *(admin)* |
| `PATCH` | `/api/stock/:id/price` | Birim fiyat *(admin)* |
| `POST` | `/api/cigarette-types` | Tür ekle *(admin)* |
| `GET` | `/api/records/check?playerId=X` | **4 saat kontrolü** — kalan süre, son alım |
| `POST` | `/api/records` | Yeni kayıt (süre dolmadıysa `409`; `early_approved` + `early_approved_by` ile erken alım) |
| `GET` | `/api/records` | Filtreli arşiv + sayfalama |
| `GET` | `/api/records/stats` | Panel özet kartları |

### Arşiv filtre parametreleri

`playerId` (kısmi arama), `waiter`, `type`, `user`, `from`, `to` (ISO tarih-saat),
`page`, `pageSize` (varsayılan 50, en fazla 500).

### `/api/records/check` yanıtı

```json
{
  "ok": true,
  "status": {
    "playerId": "1247",
    "allowed": false,
    "firstTime": false,
    "remainingMs": 14382738,
    "lastAt": "2026-08-23T15:15:23.328Z",
    "nextAvailableAt": "2026-08-23T19:15:23.328Z",
    "lastRecord": { "cigarette_type": "Marlboro Kirmizi", "quantity": 2, "waiter_name": "Furkan", "username": "sigaraci1" },
    "totalRecords": 1,
    "cooldownHours": 4,
    "serverTime": "2026-08-23T15:15:40.590Z"
  }
}
```

## 4 saat kuralı nasıl işliyor?

1. Sigaracı **Oyuncu ID** alanına yazdıkça, 350 ms gecikmeyle (debounce)
   `GET /api/records/check` çağrılır.
2. Süre dolmadıysa **turuncu gösterge** çıkar, `03:57:12` biçiminde **canlı geri sayım**
   ve ilerleme çubuğu döner. Son alımın türü, adedi, garsonu ve kaydı yapan sigaracı da
   gösterilir. Kayıt düğmesi kilitlenmez — basılırsa erken alım onay ekranı açılır
   (bkz. *Erken alım*).
3. Süre dolduysa veya ID ilk kez alıyorsa **yeşil onay** çıkar, buton açılır.
4. Geri sayım sıfırlandığı anda sunucuya yeniden sorulur — arada başka bir sigaracı
   kayıt açmış olabilir.
5. Kayıt gönderilirken sunucu kuralı **tekrar** doğrular; onay yoksa `409` döner.
   Yani tarayıcı tarafındaki akış atlansa bile onaysız erken alım yapılamaz.

Geri sayım, sunucudan gelen `remainingMs` üzerinden yerel saat eksenine çevrilir;
böylece istemci ile sunucu saatleri arasındaki fark sayacı bozmaz.

## Sorun giderme

**Güncelleme sonrası eski arayüz / `... is not defined` hatası** — tarayıcı eski
JS dosyasını önbellekten kullanıyordur. Sunucu artık statik dosyalara `no-cache`
gönderiyor (dosya değişmediyse `304`, değiştiyse yenisi iner), ayrıca dosya
adreslerinde sürüm etiketi var. Yine de takılırsa sert yenileme yapın:
masaüstünde `Ctrl+Shift+R`, telefonda site verilerini temizleyin.

**`Failed to fetch` / ekranda hiçbir veri yok** — bu bir veritabanı arızası değil,
tarayıcı sunucuya hiç ulaşamıyor demektir. İki nedeni olur:

1. **Sunucu kapalı.** Terminalde `npm start` çalışır durumda olmalı; pencereyi kapatmak
   veya `Ctrl+C` sunucuyu durdurur. Uygulama artık bu durumda "Sunucuya ulaşılamıyor"
   uyarısı ve *Yeniden dene* düğmesi gösterir.
2. **Sayfa dosyadan açıldı.** `kayit.html` dosyasına çift tıklarsanız adres çubuğunda
   `file:///...` yazar ve hiçbir API çağrısı çalışmaz. Her zaman `npm start` çalıştırıp
   tarayıcıdan `http://localhost:3000` adresine gidin. (Bu durumda da açıklayıcı bir
   uyarı ekranı çıkar.)

**`EADDRINUSE: address already in use :::3000`** — 3000 portunda zaten bir sunucu var.
Genellikle uygulama başka bir pencerede açık kalmıştır; önce `http://localhost:3000`
adresini deneyin. Kapatmak için:

```bash
netstat -ano | findstr :3000
```

Çıktının son sütunundaki PID ile:

```bash
taskkill /F /PID 13960
```

Alternatif olarak `.env` dosyasına `PORT=3001` yazıp farklı portta çalıştırabilirsiniz.

## Notlar

- Oyuncu ID'leri kaydedilirken kırpılır ve büyük harfe çevrilir; `" 1247 "` ile `"1247"`
  aynı oyuncu sayılır.
- Oturumlar `data/sessions.db` içinde saklanır, sunucu yeniden başlayınca düşmez.
  Çerez ömrü 12 saat (bir vardiya).
- Kullanıcı verisi arayüze basılırken kaçışlanır (XSS koruması).
