/* ════════════════════════════════════════════════════════════════════
   OptiPulseLab × FinTeClub Entegrasyonu — "FinteLig Yarışmacısı" Doğrulama
   ════════════════════════════════════════════════════════════════════
   Bu dosya, FinTeClub tarafında admin onayı almış FinteLig yarışmacılarının
   OPLab'a geldiklerinde profil panelinde "✓ FinteLig Yarışmacısı" rozetiyle
   görünmesini sağlar. Doğrulama, FinTeClub'ın (index.html/admin.html) zaten
   kullandığı AYNI Firebase Firestore veritabanına (finteclub/shared_state
   belgesi) karşı yapılır.

   (Doğrulama sağlamlaştırması — 3. ve son tur) Sürüm geçmişi:
   1) İLK SÜRÜM e-posta adresine karşı doğruluyordu — e-postayı bilen/tahmin
      eden herkes rozeti çalabiliyordu.
   2) İKİNCİ SÜRÜM tahmin edilemez bir "verifyToken"a karşı doğruluyordu —
      ama bu kod, FinTeClub'ın herkese açık "Başvuru Durumu Sorgula"
      sayfasında (sadece e-posta bilmek yeterli) gösterildiği için, sorun
      aslında çözülmemiş, sadece bir seviye ötelenmişti.
   3) ŞİMDİ: gerçek bir GİRİŞ EKRANI var. FinteLig başvuru formunda
      belirlenen e-posta/şifreyle GERÇEK bir Firebase Authentication hesabı
      oluşturuluyor (bkz. FinTeClub index.html pubBasvuruForm handler'ı).
      Burada aynı e-posta/şifreyle giriş yapılıyor — şifre hiçbir yerde düz
      metin olarak saklanmıyor/gösterilmiyor, doğrulama Firebase'in kendi
      güvenli altyapısında yapılıyor (parola hash'leme, kaba kuvvet koruması
      dahil). Giriş başarılıysa VE o e-postaya ait FinteLig başvurusu admin
      tarafından onaylıysa ("status: 'onayli'") rozet kazanılıyor.

   Oturum kalıcılığı Firebase Authentication'ın kendi mekanizmasıyla
   sağlanıyor (varsayılan: tarayıcıda kalıcı) — özel bir localStorage
   önbelleğine artık ihtiyaç yok.

   Ayrıca admin FinTeClub panelinden OPLab erişimini kapatırsa (oplabEnabled:
   false), bu dosya tam ekran bir "Platform Geçici Olarak Kapalı" kilidi
   gösterir. Firebase'e hiç ulaşılamıyorsa (CDN engelli/offline) kilit
   VARSAYILAN OLARAK AÇIK kabul edilir — bağlantı sorunu asla gerçek
   kullanıcıları yanlışlıkla kilitlemez.

   Bu dosya, mevcut dev kod tabanına (tradingEngine.js vb.) hiç dokunmadan,
   tamamen ek/bağımsız olarak çalışacak şekilde tasarlandı; paylaştığı şey,
   tradingEngine.js'in zaten okuduğu 'optipulselab_profile_name_v1'/
   'optipulselab_paper_portfolio_v1' localStorage anahtarları (bkz.
   applyVerifiedProfile()/readLocalPortfolio()). Bu giriş ekranı sadece
   "FinteLig Yarışmacısı" rozetini/takibini almak isteyenler için — genel
   ziyaretçiler OPLab'ı hiç giriş yapmadan, olduğu gibi kullanabilir.

   (9 Ağustos 2026 — çift-satış kök neden düzeltmesi) TEK bir BİLİNÇLİ
   istisna: window.FinteClubBridge.requestImmediateSync() artık
   tradingEngine.js tarafından her işlemden sonra çağrılıyor (bkz. o
   fonksiyonun ve tradingEngine.js'teki savePortfolio()'nun yorumları) —
   çok cihazlı çift-satışı önlemek için gerekliydi, aksi halde iki cihaz
   arasında periyodik senkronun bıraktığı boşlukta aynı pozisyon birden
   fazla kez satılıp her seferinde ödeniyordu.
   ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // FinTeClub'ın (index.html/admin.html) kullandığı FIREBASE_CONFIG ile
    // BİREBİR AYNI olmalıdır — aynı proje/veritabanına bağlanıyoruz.
    var FIREBASE_CONFIG = {
        apiKey: "AIzaSyA9OmfHaqZizxVB1ATnBDedU1YV0a7aiWQ",
        authDomain: "finte-bf5f7.firebaseapp.com",
        projectId: "finte-bf5f7",
        storageBucket: "finte-bf5f7.firebasestorage.app",
        messagingSenderId: "267255127844",
        appId: "1:267255127844:web:9d8a65057cc822375b9db1"
    };

    // (22 Eylül 2026 — Madde 5/6 kök neden düzeltmesi: "cihazlar farklı
    // bakiye gösteriyor") FIREBASE_ENABLED önceden SABİT ve sayfa açılır
    // açılmaz TEK SEFERLİK, SESSİZCE hesaplanıyordu — tıpkı FinTeClub/ADMİN
    // index.html'de daha önce bulunup düzeltilen (Madde 4) AYNI hata sınıfı.
    // OPLab'ın kendi index.html'i Firebase script'lerini `defer` ile
    // yüklüyor (bkz. o dosyanın <head>'i) — bu SIRALAMAYI garanti eder ama
    // script'lerden biri ağ hatasıyla hiç YÜKLENEMEZSE (mobil veri/okul
    // wifi titreşimi — kablolu lab bilgisayarlarında çok daha nadir) yine
    // aynı sonuç: `typeof firebase` tanımsız kalır. Bu olduğunda, bu
    // dosyanın kurduğu SOFİSTİKE çok-cihazlı senkronizasyon sisteminin
    // (rev-korumalı transaction + gerçek zamanlı onSnapshot, bkz. aşağıdaki
    // pushFullPortfolioToCloud/listenForPortfolioSync) TAMAMI o cihazda
    // KALICI olarak devre dışı kalıyordu — cihaz kendi başına, izole
    // çalışmaya devam ediyordu, hiçbir uyarı olmadan. Artık: (1) ilk deneme
    // başarısız olursa startFtcBridgeRetryLoop() birkaç saniye arayla
    // birkaç kez otomatik yeniden dener, sonra arka planda daha seyrek
    // aralıklarla denemeye devam eder (bağlantı geç de olsa geri gelirse
    // kendini iyileştirir); (2) ftcConnState 'failed' olduğu sürece ekranda
    // kalıcı, göz ardı edilemez bir uyarı bandı gösterilir (bkz.
    // showSyncWarningBanner) — işlem yapmayı ENGELLEMEZ (yarışma sırasında
    // kilitlememek için, bkz. bu dosyanın "bir altyapı sorunu gerçek
    // kullanıcıları asla yanlışlıkla kilitlememeli" ilkesi) ama artık
    // sessiz de değil.
    var FIREBASE_ENABLED = typeof firebase !== 'undefined' &&
        FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';
    // 'ok' | 'retrying' | 'failed'
    var ftcConnState = FIREBASE_ENABLED ? 'ok' : 'retrying';

    var fsSharedDoc = null;
    var fsActivityDoc = null;
    var fsPortfolioDoc = null;
    var fsUserPortfoliosDoc = null; // (24 Eylül 2026) artık SADECE eski kayıtları taşımak için okunuyor
    var fsFirestore = null;
    var fsBalanceCommandsDoc = null;
    var fsActionCommandsDoc = null;
    var ftcAuth = null;

    function tryInitFtcBridge() {
        if (!FIREBASE_ENABLED) return false;
        try {
            // Ayrı isimli bir app instance kullanıyoruz ('ftcBridge') — ileride
            // OPLab kendi ana Firebase kurulumunu eklerse çakışma olmasın diye.
            // (22 Eylül 2026) Bu fonksiyon bir yeniden deneme sonrası tekrar
            // çağrılabildiğinden, aynı isimli app zaten varsa yeniden
            // initializeApp() ÇAĞIRMIYORUZ — Firebase bunu hata sayar.
            var existing = (firebase.apps || []).filter(function (a) { return a.name === 'ftcBridge'; })[0];
            var ftcApp = existing || firebase.initializeApp(FIREBASE_CONFIG, 'ftcBridge');
            var fs = ftcApp.firestore();
            fsFirestore = fs;
            fsSharedDoc = fs.collection('finteclub').doc('shared_state');
            fsActivityDoc = fs.collection('finteclub').doc('oplab_activity');
            // (Admin panel "Canlı İzleme" / "Kullanıcı Portföyleri" entegrasyonu)
            // Doğrulanmış her yarışmacının anlık bakiye/özkaynak/açık pozisyon
            // özetini bu belgeye periyodik olarak yazıyoruz — bkz. pushPortfolioSnapshot().
            fsPortfolioDoc = fs.collection('finteclub').doc('oplab_live_portfolio');
            // (6 Ağustos 2026 — çok cihazlı senkronizasyon düzeltmesi) fsPortfolioDoc
            // yukarısı SADECE admin panelinin izleme ekranı için hafif bir özet
            // ("bakiye/özkaynak") — kimlik doğrulaması yapılmış bir kullanıcının
            // GERÇEK portföyünü (bakiye/pozisyonlar/geçmiş) hiçbir yerde
            // saklamıyordu, o SADECE o cihazın localStorage'ındaydı. Bu belge
            // artık kimlik (verifiedApp.id) bazında TAM portföyün TEK doğru
            // kaynağı — bir yarışmacı telefonda işlem yapıp PC'de açtığında
            // bakiyesinin 100.000'e "sıfırlanmış" görünmesinin kök nedeni
            // buydu (bkz. hydratePortfolioFromCloudIfNeeded/pushFullPortfolioToCloud).
            fsUserPortfoliosDoc = fs.collection('finteclub').doc('oplab_user_portfolios');
            // (8 Ağustos 2026 — admin panelinden bakiye ayarlama) Admin panelinin
            // "Kullanıcı Portföyleri" sayfasından bir yarışmacının bakiyesini
            // manuel değiştirebilmesi için tek yönlü bir komut kanalı: admin
            // buraya {commands: {<userId>: {newBalance, requestedAt}}} yazar,
            // bu dosya gerçek zamanlı dinleyip (bkz. listenForBalanceCommands)
            // kendi kimliğine ait bir komut görürse yerel bakiyeyi günceller ve
            // uygulandığını (appliedAt) aynı belgeye geri yazar.
            fsBalanceCommandsDoc = fs.collection('finteclub').doc('oplab_balance_commands');
            // (11 Ağustos 2026 — Madde #132: admin canlı izleme/iptal köprüsü)
            // Admin'in "Canlı İzleme" ekranından bir yarışmacının BEKLEYEN
            // EMRİNİ iptal edebilmesi veya AÇIK POZİSYONUNU kapatabilmesi için
            // AYRI bir komut kanalı — bilerek oplab_balance_commands'tan AYRI
            // bir belge: o belgedeki {commands:{<id>:{...}}} tek bir komut
            // nesnesi Firestore merge:true ile REKURSİF birleşiyor, yani eski
            // bir bakiye komutundan kalan stale newBalance/reset alanları hâlâ
            // orada dururken yeni bir aksiyon komutu eklersem applyBalanceCommand
            // içindeki öncelik sırası (reset > newBalance > ...) o eski komutu
            // YANLIŞLIKLA tekrar uygulayabilirdi. Ayrı belge = ayrı, çakışmasız
            // durum. Şekli: {commands: {<userId>: {type:'cancelOco'|'closePosition',
            // orderId?, symbol?, market?, requestedAt}}}.
            fsActionCommandsDoc = fs.collection('finteclub').doc('oplab_action_commands');
            // (Doğrulama sağlamlaştırması, 3. tur) Aynı 'ftcBridge' app instance'ı
            // üzerinden Authentication — FinTeClub'ın başvuru formunda oluşturulan
            // hesaplarla AYNI Firebase projesi/kullanıcı havuzuna bakıyor.
            ftcAuth = ftcApp.auth();
            return true;
        } catch (e) {
            console.warn('FinTeClub bağlantısı kurulamadı, doğrulama devre dışı bırakıldı.', e);
            FIREBASE_ENABLED = false;
            return false;
        }
    }

    // (22 Eylül 2026 — Madde 5/6) Firebase SDK script'lerini (OPLab'ın kendi
    // index.html'inde <head>'e `defer` ile eklenenlerle AYNI 3 URL — bu
    // dosya Storage kullanmıyor) dinamik olarak yeniden yükleyip birkaç kez
    // dener. Sıralı yükleniyor — firestore/auth-compat script'leri 'firebase'
    // global'ının app-compat tarafından önceden tanımlanmış olmasına bağımlı.
    var FTC_FIREBASE_SDK_URLS = [
        'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
        'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js'
    ];
    function ftcLoadScriptOnce(url) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('yüklenemedi: ' + url)); };
            document.head.appendChild(s);
        });
    }
    function ftcReloadFirebaseSdkOnce() {
        return FTC_FIREBASE_SDK_URLS.reduce(function (chain, url) {
            return chain.then(function () { return ftcLoadScriptOnce(url); });
        }, Promise.resolve());
    }
    // Bir yeniden bağlanma başarılı olduğunda, sadece Firestore/Auth
    // referanslarını kurmak yetmez — init()'in normalde SADECE sayfa
    // açılışında bir kez çalıştırdığı gerçek zamanlı dinleyicileri de
    // (fsSharedDoc.onSnapshot, ftcAuth.onAuthStateChanged, periyodik
    // portföy özeti) BAŞLATMAK gerekir — bkz. startRealtimeFeatures()
    // ve onun çağrıldığı init()/retry başarı yolu.
    function startFtcBridgeRetryLoop() {
        var attempt = 0;
        var FAST_ATTEMPTS = 5, FAST_DELAY_MS = 3000, SLOW_DELAY_MS = 20000;
        function onRecovered() {
            ftcConnState = 'ok';
            console.log('[FinTeClub köprüsü] Yeniden bağlantı başarılı (deneme ' + attempt + ').');
            hideSyncWarningBanner();
            startRealtimeFeatures();
        }
        function scheduleNext() {
            var delay = attempt < FAST_ATTEMPTS ? FAST_DELAY_MS : SLOW_DELAY_MS;
            if (attempt === FAST_ATTEMPTS) {
                ftcConnState = 'failed';
                console.warn('[FinTeClub köprüsü] İlk ' + FAST_ATTEMPTS + ' deneme başarısız — arka planda daha seyrek denemeye devam ediliyor, bu cihaz senkronize olana kadar uyarı gösterilecek.');
                showSyncWarningBanner();
            }
            setTimeout(attemptOnce, delay);
        }
        function attemptOnce() {
            attempt++;
            ftcReloadFirebaseSdkOnce().then(function () {
                FIREBASE_ENABLED = typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';
                if (FIREBASE_ENABLED && tryInitFtcBridge()) { onRecovered(); return; }
                scheduleNext();
            }).catch(function (e) {
                console.warn('[FinTeClub köprüsü] Yeniden yükleme denemesi ' + attempt + ' başarısız:', e.message);
                scheduleNext();
            });
        }
        attemptOnce();
    }

    // Ekranın en altında, kaybolmayan, göz ardı edilemez bir uyarı bandı —
    // sadece ftcConnState 'failed' iken görünür. İşlem yapmayı ENGELLEMEZ
    // (bkz. yukarıdaki "bir altyapı sorunu gerçek kullanıcıları asla
    // yanlışlıkla kilitlememeli" ilkesi) — sadece kullanıcıya bu cihazın
    // ŞU AN diğer cihazlarla senkronize olmadığını açıkça bildirir.
    var SYNC_WARNING_BANNER_ID = 'ftcSyncWarningBanner';
    var PERMISSION_BANNER_TEXT = '⚠ Portföy senkronizasyonu sunucu tarafından reddedildi (güvenlik kuralları) — bu cihazdaki işlemler diğer cihazlarına yansımayabilir. Lütfen yöneticiye haber ver.';
    function showSyncWarningBanner(text) {
        var existing = byId(SYNC_WARNING_BANNER_ID);
        if (existing) { if (text) existing.textContent = text; return; }
        var bar = document.createElement('div');
        bar.id = SYNC_WARNING_BANNER_ID;
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999999;' +
            'background:#7c2d12;color:#fed7aa;font:600 12.5px/1.5 system-ui,sans-serif;' +
            'padding:10px 16px;text-align:center;box-shadow:0 -2px 10px rgba(0,0,0,0.35);';
        bar.textContent = text || '⚠ Bu cihaz şu an diğer cihazlarınla senkronize DEĞİL (sunucuya bağlanılamıyor) — burada yaptığın işlemler diğer cihazlarına/admin paneline geç yansıyabilir. İnternetini kontrol edip sayfayı yenilemeyi dene.';
        (document.body || document.documentElement).appendChild(bar);
    }
    function hideSyncWarningBanner() {
        var el = byId(SYNC_WARNING_BANNER_ID);
        if (el) el.remove();
    }

    // (22 Eylül 2026) İlk (senkron) deneme — script'ler başarıyla yüklendiyse
    // (yaygın/beklenen durum) burada anında kurulur, hiçbir gecikme/uyarı
    // olmaz. Başarısızsa arka planda otomatik yeniden bağlanma başlar.
    if (FIREBASE_ENABLED && tryInitFtcBridge()) {
        ftcConnState = 'ok';
    } else {
        ftcConnState = 'retrying';
        startFtcBridgeRetryLoop();
    }

    /* (5 Ağustos 2026 — "giriş yapmadan önce bakiye hep 0 olsun, sadece
       gezebilsin; giriş yapanların gerçek bakiyesi gözüksün") tradingEngine.js
       artık demo bakiyeyi/işlem yapma iznini burada tutulan GERÇEK giriş
       durumuna göre kapı gibi kullanıyor. Bu obje BİLEREK script parse
       edilir edilmez (DOMContentLoaded'dan, hatta init()'ten bile önce)
       tanımlanıyor — script sırası yüzünden tradingEngine.js'in ilk
       render'ı bu durumu okumadan önce çalışırsa, varsayılan "giriş
       yapılmamış" (bakiye 0) kabul edilsin; gerçek durum (Firebase
       kullanılamıyorsa YA DA az sonra onAuthStateChanged gelince) hemen
       ardından 'ftc-auth-changed' event'iyle düzeltilir.
       - available:false  → giriş sistemi hiç çalışmıyor (CDN engelli vb.)
         Bu durumda tradingEngine.js ESKİ davranışa döner (bakiye her zaman
         gerçek/kullanılabilir) — bir altyapı sorunu gerçek kullanıcıyı
         asla yanlışlıkla kilitlememeli.
       - available:true, loggedIn:false → giriş sistemi çalışıyor ama bu
         ziyaretçi henüz giriş yapmadı → bakiye 0, sadece gezinebilir.
       - available:true, loggedIn:true  → gerçek bakiye kullanılabilir. */
    window.FTC_AUTH_STATE = {
        available: !!(FIREBASE_ENABLED && ftcAuth),
        loggedIn: false,
        email: null
    };

    // (9 Ağustos 2026 — Madde: piyasa saatlerinden bağımsız admin durdurma)
    // finteclub/shared_state belgesindeki yeni `tradingHalted` alanı — admin
    // FinTeClub panelindeki "OPLab (Alım-Satım Sitesi) Kontrolü" sayfasından
    // bunu AÇIK/KAPALI (oplabEnabled — tüm siteyi kilitler) anahtarından
    // AYRI, daha hafif bir "Alım-Satım Durumu" anahtarıyla ayarlar: site
    // görüntülenmeye devam eder, sadece YENİ emir gönderimi engellenir.
    // tradingEngine.js bunu doğrudan okur (bkz. isTradingHaltedByAdmin()).
    // Firebase'e hiç ulaşılamazsa (CDN engelli/offline) varsayılan olarak
    // false (durdurulmamış) kabul edilir — bir altyapı sorunu gerçek
    // kullanıcıları asla yanlışlıkla kilitlememeli (updateAccessGate()
    // ile AYNI felsefe).
    window.FTC_TRADING_STATE = { halted: false };

    var PROFILE_NAME_KEY = 'optipulselab_profile_name_v1'; // tradingEngine.js ile AYNI anahtar
    var PORTFOLIO_STORAGE_KEY = 'optipulselab_paper_portfolio_v1'; // tradingEngine.js ile AYNI anahtar
    // (24 Eylül 2026) Yerel değişiklik KONTROL aralığı — ağa çıkış değil.
    // syncTick() her 5 saniyede bir yerel portföyü buluttakiyle karşılaştırır;
    // yalnızca bir şey değiştiyse yazar (önceden her 5 saniyede koşulsuz 2
    // yazma yapılıyordu, bkz. aşağıdaki "ÇOK CİHAZLI SENKRON" açıklaması).
    var PORTFOLIO_PUSH_INTERVAL_MS = 5000;
    // (6 Ağustos 2026 — çok cihazlı senkronizasyon düzeltmesi) DEVICE_ID_KEY:
    // bu tarayıcıyı/cihazı kalıcı olarak tanımlayan rastgele bir id — bir
    // cihazın bulutta gördüğü son kaydın KENDİ gönderdiği kayıt olup
    // olmadığını anlamak için (öyleyse kendi verisini kendine geri
    // yükleyip gereksiz sayfa yenilemesi yapmaması gerekir).
    // PORTFOLIO_CLOUD_SYNC_KEY: bu cihaza en son UYGULANAN bulut sürümünün
    // zaman damgası — aynı sürümü tekrar tekrar uygulayıp durmadan
    // (reload döngüsü) emin olmak için.
    var DEVICE_ID_KEY = 'optipulselab_device_id_v1';
    var PORTFOLIO_CLOUD_SYNC_KEY = 'optipulselab_portfolio_cloud_sync_v1';
    // (9 Ağustos 2026 — "aynı hesabı 2-3 cihazdan art arda satabiliyorum,
    // her seferinde parasını alıyorum" kök neden düzeltmesi) ÖNCEKİ tasarımın
    // açığı: pushFullPortfolioToCloud() KOŞULSUZ bir .set({merge:true}) idi
    // — hangi cihaz EN SON yazarsa o kazanıyordu, ama "en son" olmak
    // BAŞARISIZ/bayat bir işlemi meşrulaştırmıyordu. Telefon satıp parayı
    // alıyor, PC (henüz telefonun yazdığını görmediği için) AYNI pozisyonu
    // yine "açık" sanıp tekrar satıyor ve PARA YİNE VERİLİYOR — iki cihaz da
    // kendi (birbirinden habersiz) sürümünü buluta yazınca, ikisinin de
    // "kazandığı" nakit kalıcı olarak bakiyede kalıyordu (çift/üçlü ödeme).
    //
    // Kök çözüm: her bulut kaydına artan bir tam sayı sürüm numarası (rev)
    // eklendi. Bir cihaz push ATMADAN ÖNCE, en son GÖRDÜĞÜ bulut rev'ini
    // (PORTFOLIO_KNOWN_REV_KEY) bilir. push, düz bir .set() DEĞİL, bir
    // Firestore TRANSACTION'ı içinde yapılır: transaction bulutun O ANKİ
    // gerçek rev'ini okur; eğer bulutta, bu cihazın bildiğinden DAHA YENİ
    // (başka bir cihazın arada yazdığı) bir rev varsa, bu cihazın kendi
    // (muhtemelen bayat veriye dayanan, belki çift-satış içeren) sürümü
    // ASLA buluta yazılıp doğru veriyi EZMEZ — push reddedilir, bunun
    // yerine bu cihaz buluttaki GERÇEK/doğru sürümü benimseyip kendini
    // düzeltir (bkz. pushFullPortfolioToCloud). Firestore transaction'ları
    // ATOMİK olduğundan (okuma+yazma arasına başka bir yazma girerse
    // otomatik olarak yeniden denenir), iki cihaz TAM OLARAK AYNI ANDA
    // push atmaya çalışsa bile sadece biri kazanır — ötekinin çift ödemesi
    // asla kalıcı olarak bakiyede kalamaz, birkaç saniye içinde geri alınır.
    var PORTFOLIO_KNOWN_REV_KEY = 'optipulselab_portfolio_known_rev_v1';
    // (24 Eylül 2026) Artık KULLANICI BAŞINA tutuluyor (anahtar::e-posta) —
    // paylaşılan bir bilgisayarda bir yarışmacının rev değeri başka bir
    // yarışmacının çakışma kontrolünü bozmasın diye. Kullanıcı yoksa eski
    // ortak anahtar kullanılır.
    function knownRevStorageKey() {
        var k = currentUserKey();
        return k ? PORTFOLIO_KNOWN_REV_KEY + '::' + k : PORTFOLIO_KNOWN_REV_KEY;
    }
    function getKnownCloudRev() {
        try {
            var raw = localStorage.getItem(knownRevStorageKey());
            var n = raw === null ? 0 : parseInt(raw, 10);
            return isFinite(n) && n >= 0 ? n : 0;
        } catch (e) { return 0; }
    }
    // (24 Eylül 2026) Varsayılan olarak GERİYE GİTMEZ — geç gelen bir yanıt,
    // bir anlık görüntünün az önce yükselttiği değeri düşürmesin. Sadece
    // kayıt sıfırlandığında (allowDecrease) bilinçli olarak düşürülür.
    function setKnownCloudRev(rev, allowDecrease) {
        try {
            var n = Number(rev) || 0;
            if (!allowDecrease && n < getKnownCloudRev()) return;
            localStorage.setItem(knownRevStorageKey(), String(n));
        } catch (e) { /* private mode */ }
    }
    // (8 Ağustos 2026 — admin panelinden bakiye ayarlama) bu cihaza en son
    // UYGULANAN bakiye komutunun requestedAt zaman damgası — aynı komutu
    // tekrar tekrar uygulayıp durmadan (reload sonrası onSnapshot yeniden
    // tetiklenebilir) emin olmak için.
    var BALANCE_CMD_APPLIED_KEY = 'optipulselab_balance_cmd_applied_v1';
    // (11 Ağustos 2026 — Madde #132) BALANCE_CMD_APPLIED_KEY ile AYNI mantık,
    // ama oplab_action_commands (iptal/kapatma) için bağımsız bir anahtar —
    // ikisi FARKLI belgeleri dinlediğinden requestedAt değerleri çakışabilir,
    // paylaşılan bir anahtar bir kanalın komutunun diğerini "zaten uygulandı"
    // sanıp atlamasına yol açabilirdi.
    var ACTION_CMD_APPLIED_KEY = 'optipulselab_action_cmd_applied_v1';

    var lastSharedData = null;
    var loggedActivityForId = null; // aynı ziyarette Firestore'a tekrar tekrar yazmamak için
    var verifiedApp = null; // { id, name, email } — doğrulama başarılı olduğunda dolar, portföy push'u bunu kullanır
    var currentAuthUser = null; // Firebase Authentication kullanıcısı (giriş yapılmışsa)
    var balanceListenerAttached = false; // oplab_balance_commands dinleyicisi sadece bir kez bağlanır
    var actionListenerAttached = false; // oplab_action_commands (iptal/kapatma) dinleyicisi sadece bir kez bağlanır
    // (17 Ağustos 2026 düzeltmesi) Kullanıcının açık isteği: modal HER
    // AÇILIŞTA gösterilsin — daha önce "devam et" denmiş olması ya da
    // kullanıcının zaten oturum açmış olması modalı ATLAMASIN. Bu yüzden
    // artık localStorage'a kalıcı bir "dismissed" bayrağı YAZILMIYOR;
    // modalDecisionMade sadece AYNI sayfa yüklemesi içinde modalın birden
    // fazla kez açılmasını (onAuthStateChanged birden çok tetiklenebilir)
    // önlemek için var, sayfa yeniden yüklendiğinde her zaman false'tan başlar.
    var modalDecisionMade = false;

    function byId(id) { return document.getElementById(id); }

    function setBadgeVisible(visible) {
        var badge = byId('ftc-badge');
        if (badge) badge.classList.toggle('hidden', !visible);
    }

    function setVerifyStatus(text, kind) {
        // Aynı mesaj hem profil panelindeki formda hem de (açıksa) açılış
        // modalındaki formda görünür — kullanıcı hangisiyle etkileşime
        // girdiyse geri bildirimi orada görsün diye ikisi de güncellenir.
        ['ftc-verify-status', 'ftc-modal-login-status'].forEach(function (id) {
            var el = byId(id);
            if (!el) return;
            el.textContent = text || '';
            el.className = 'ftc-verify-status' + (kind ? ' ftc-status-' + kind : '');
        });
    }

    function applyVerifiedProfile(name) {
        var trimmed = (name || '').trim();
        if (!trimmed) return;
        var display = byId('profile-name-display');
        var avatar = byId('profile-avatar');
        var nameInput = byId('profile-name-input');
        if (display) display.textContent = trimmed;
        if (avatar) avatar.textContent = trimmed.charAt(0).toUpperCase();
        // Kullanıcı daha önce KENDİ manuel ismini girmediyse (localStorage'da
        // kayıt yoksa), doğrulanan ismi hem input'a hem de tradingEngine.js'in
        // okuduğu localStorage anahtarına yazıyoruz — bir sonraki sayfa
        // yüklemesinde tradingEngine.js'in kendi setupProfilePanel()'i bunu
        // otomatik uygular, finteclubBridge.js'in her seferinde yetişmesi
        // gerekmez.
        try {
            if (!localStorage.getItem(PROFILE_NAME_KEY)) {
                localStorage.setItem(PROFILE_NAME_KEY, trimmed);
            }
        } catch (e) { /* ignore */ }
        if (nameInput && !nameInput.value) nameInput.value = trimmed;
    }

    function logActivity(app) {
        if (!fsActivityDoc || !app || loggedActivityForId === app.id) return;
        loggedActivityForId = app.id;
        var payload = { visitors: {} };
        payload.visitors[String(app.id)] = {
            name: app.name || '',
            email: app.email || '',
            lastVisit: new Date().toISOString(),
            visitCount: firebase.firestore.FieldValue.increment(1)
        };
        fsActivityDoc.set(payload, { merge: true }).catch(function (e) {
            console.warn('OPLab aktivasyon kaydı Firestore\'a yazılamadı.', e);
        });
    }

    /* ── Açılış giriş modalı (zorunlu değil) ──
       Sayfa HER yüklendiğinde gösterilir (giriş yapılmış/daha önce "devam
       et" denmiş olması fark etmez — bu davranış kullanıcının kendi
       seçimiydi). Genel ziyaretçiler istedikleri an "giriş yapmadan devam
       et" ile kapatabilir; bu sadece o anki sayfa görüntülemesi için
       geçerlidir, bir sonraki açılışta modal yine görünür. Zaten giriş
       yapmış bir yarışmacı için checkApplicationStatus() eşleşme bulduğunda
       modalı kısa bir "✓ Hoşgeldin" mesajıyla değiştirip otomatik kapatır
       (showModalWelcomeAndClose). */
    function showLoginModal() {
        var overlay = byId('ftc-login-modal-overlay');
        if (overlay) overlay.classList.remove('hidden');
    }
    function hideLoginModal() {
        var overlay = byId('ftc-login-modal-overlay');
        if (overlay) overlay.classList.add('hidden');
    }
    function isLoginModalOpen() {
        var overlay = byId('ftc-login-modal-overlay');
        return !!overlay && !overlay.classList.contains('hidden');
    }
    // Modal açıkken başarılı bir giriş+onay eşleşmesi olursa formu "✓ Hoşgeldin"
    // mesajıyla değiştirip kısa bir süre sonra modalı otomatik kapatır. Modal
    // zaten kapalıysa (kullanıcı profil panelinden giriş yaptıysa) hiçbir şey
    // yapmaz — panel zaten kendi durum mesajını gösteriyor.
    function showModalWelcomeAndClose(name) {
        if (!isLoginModalOpen()) return;
        var form = byId('ftc-login-modal-form');
        var welcome = byId('ftc-login-modal-welcome');
        if (form) form.classList.add('hidden');
        if (welcome) {
            welcome.textContent = '✓ Hoşgeldin, ' + name + '!';
            welcome.classList.remove('hidden');
        }
        setTimeout(function () {
            hideLoginModal();
            if (form) form.classList.remove('hidden');
            if (welcome) welcome.classList.add('hidden');
        }, 1600);
    }

    // Firebase Authentication girişi başarılı olduktan SONRA çalışır: o
    // e-postaya ait, admin onaylı bir FinteLig başvurusu var mı diye bakar.
    // Giriş yapmış olmak (kimlik doğru) ile onaylı olmak (yarışmaya erişim
    // hakkı) İKİ AYRI şeydir — biri Firebase'in işi, öteki FinTeClub admin
    // panelinin işi; ikisi de burada birlikte kontrol ediliyor.
    function checkApplicationStatus() {
        if (!currentAuthUser) return;
        if (!lastSharedData) {
            setVerifyStatus('Doğrulanıyor...', 'pending');
            return;
        }
        var email = (currentAuthUser.email || '').toLowerCase();
        var apps = lastSharedData.applications || [];
        // (11 Ağustos 2026 — Madde #130: haftalık kota/kohort sistemi) Admin
        // panelinde bir haftanın süresi/kotası dolunca o haftanın onaylı
        // yarışmacıları `pastCompetitor:true` ile geçmişe alınıyor — status
        // KENDİSİ 'onayli' olarak KALIYOR (geçmişte gerçekten onaylanmıştı),
        // bu yüzden burada AYRICA !pastCompetitor kontrol ediliyor. Aksi
        // halde haftası bitmiş biri giriş yapmaya devam ettiğinde hâlâ
        // "✓ FinteLig Yarışmacısı" rozetini görür ve senkron/canlı izleme
        // akışına veri göndermeye devam ederdi — kotanın/haftanın bittiğini
        // görünmez kılardı.
        var pastMatch = apps.filter(function (a) {
            return (a.email || '').toLowerCase() === email && a.status === 'onayli' && a.pastCompetitor;
        })[0];
        var match = apps.filter(function (a) {
            return (a.email || '').toLowerCase() === email && a.status === 'onayli' && !a.pastCompetitor;
        })[0];
        // (26 Eylül 2026 — Lig: sezon planı) Sezon planı açıkken yalnızca AKTİF
        // haftanın (currentCohortId) yarışmacısı yarışmacı olarak doğrulanır;
        // ileri bir haftaya onaylanmış biri kendi haftası başlayana kadar bekler.
        var futureWeek = null;
        if (match && seasonOn() && Number(match.cohortId) !== Number(lastSharedData.currentCohortId)) {
            futureWeek = seasonWeek(match.cohortId);
            match = null;
        }
        if (match) {
            setBadgeVisible(true);
            setVerifyStatus('✓ Giriş başarılı — ' + match.name + (Number(match.penaltyTotal) > 0 ? ' · Kural ihlali kesintisi: ₺' + Number(match.penaltyTotal).toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' (sıralamada portföy değerinden düşülür)' : ''), 'ok');
            applyVerifiedProfile(match.name);
            logActivity(match);
            verifiedApp = { id: match.id, name: match.name, email: match.email };
            showModalWelcomeAndClose(match.name);
            // (24 Eylül 2026) Kişisel bulut kaydını bir kez oku (gerekirse eski
            // ortak belgeden taşı) ve gerçek zamanlı dinlemeye başla. Aynı
            // kullanıcı için ikinci kez çağrılırsa hiçbir şey yapmaz.
            // (Admin bakiye/iptal komut kanalları artık senkron hazır olunca
            // startPortfolioSyncForCurrentUser() içinden dinlenmeye başlıyor.)
            startPortfolioSyncForCurrentUser();
        } else {
            setBadgeVisible(false);
            setVerifyStatus(futureWeek
                ? ('Başvurun onaylı — yarışma haftan: Hafta ' + futureWeek.no + (futureWeek.start ? ' (' + fmtDm(futureWeek.start) + '–' + fmtDm(futureWeek.end) + ')' : '') + '. OPLab portföyün o hafta başladığında açılır.')
                : pastMatch
                ? 'Yarışma haftan sona erdi — bu hesap artık geçmiş yarışmacı statüsünde, canlı senkron/izlemeye dahil değil.'
                : 'Hesabına giriş yapıldı ama bu e-postayla onaylı bir FinteLig başvurusu yok (ya henüz onaylanmadı ya da hiç başvuru yapılmadı).', futureWeek ? 'pending' : 'error');
            verifiedApp = null;
            stopPortfolioSync();
        }
        updateTradingHaltState(); // kişisel kısıtlar verifiedApp'e bağlı — hemen tazele
    }

    function loginErrorMessage(err) {
        switch (err && err.code) {
            case 'auth/invalid-email': return 'Geçersiz e-posta adresi.';
            case 'auth/user-disabled': return 'Bu hesap devre dışı bırakılmış.';
            case 'auth/user-not-found':
            case 'auth/wrong-password':
            case 'auth/invalid-credential': return 'E-posta veya şifre hatalı.';
            case 'auth/too-many-requests': return 'Çok fazla hatalı deneme yapıldı. Lütfen biraz sonra tekrar dene.';
            case 'auth/network-request-failed': return 'Ağ bağlantısı hatası. İnternet bağlantını kontrol et.';
            default: return 'Giriş başarısız. E-posta/şifreni kontrol edip tekrar dene.';
        }
    }

    function attemptLogin(email, password) {
        if (!ftcAuth) { setVerifyStatus('Giriş şu anda kullanılamıyor (bağlantı yok).', 'pending'); return; }
        if (!email || !password) { setVerifyStatus('E-posta ve şifreni gir.', 'error'); return; }
        setVerifyStatus('Giriş yapılıyor...', 'pending');
        ftcAuth.signInWithEmailAndPassword(email, password).catch(function (err) {
            setVerifyStatus(loginErrorMessage(err), 'error');
        });
        // Başarılı olursa onAuthStateChanged zaten tetiklenip checkApplicationStatus()'u çağıracak.
    }

    function syncLoginUI() {
        var loginBtn = byId('ftc-login-btn'), logoutBtn = byId('ftc-logout-btn'),
            emailInput = byId('ftc-login-email'), pwInput = byId('ftc-login-password');
        var loggedIn = !!currentAuthUser;
        if (loginBtn) loginBtn.classList.toggle('hidden', loggedIn);
        if (logoutBtn) logoutBtn.classList.toggle('hidden', !loggedIn);
        if (emailInput) emailInput.classList.toggle('hidden', loggedIn);
        if (pwInput) pwInput.classList.toggle('hidden', loggedIn);
    }

    /* ── Admin panel "Canlı İzleme" / "Kullanıcı Portföyleri" için hafif
       portföy özeti ── tradingEngine.js'e HİÇ dokunmuyoruz: sadece onun
       zaten yazdığı localStorage anahtarını (PORTFOLIO_STORAGE_KEY) okuyup,
       yine onun dışa açtığı window.TradingEngine.getPrice() ile aynı
       özkaynak/K-Z formülünü (tradingEngine.js'teki computeAccountSnapshot
       ile birebir aynı) burada bağımsızca yeniden hesaplıyoruz. */
    function readLocalPortfolio() {
        try {
            var raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function computeLightPortfolioSnapshot() {
        var portfolio = readLocalPortfolio();
        if (!portfolio || typeof portfolio.balance !== 'number') return null;
        if (typeof window.TradingEngine === 'undefined' || typeof window.TradingEngine.getPrice !== 'function') return null;

        var usedMargin = 0, openPnl = 0, positionsCount = 0;
        var positionsOut = [];
        var books = [
            { positions: portfolio.positions || {}, market: 'NORMAL' },
            { positions: portfolio.viopPositions || {}, market: 'VIOP' }
        ];
        books.forEach(function (book) {
            Object.keys(book.positions).forEach(function (symbol) {
                var pos = book.positions[symbol];
                if (!pos || !pos.qty) return;
                var current = window.TradingEngine.getPrice(symbol) || pos.avgPrice;
                var leverage = pos.leverage || 1;
                var margin = (pos.avgPrice * pos.qty) / leverage;
                usedMargin += margin;
                var pnl = pos.side === 'LONG'
                    ? (current - pos.avgPrice) * pos.qty
                    : (pos.avgPrice - current) * pos.qty;
                openPnl += pnl;
                positionsCount++;
                // Firestore belge boyutunu makul tutmak için sadece ilk 25
                // pozisyon detaylı gönderilir (özet sayılar yine de tam).
                if (positionsOut.length < 25) {
                    positionsOut.push({
                        symbol: symbol, market: book.market, side: pos.side,
                        qty: pos.qty, avgPrice: pos.avgPrice, currentPrice: current, pnl: pnl
                    });
                }
            });
        });
        // (25 Eylül 2026 — kural 9.2/9.4: portföy değeri) Bekleyen limit/sıradaki
        // emirler için kilitlenen teminat bakiyeden düşülmüş durumda ama hâlâ
        // yarışmacının parası — portföy değerine geri ekleniyor. Önceden
        // yarışma sonunda bekleyen emri olan biri sıralamada olduğundan
        // düşük görünüyordu.
        var reserved = 0;
        (portfolio.pendingOrders || []).concat(portfolio.viopPendingOrders || []).forEach(function (o) {
            if (o && typeof o.reservedAmount === 'number' && o.reservedAmount > 0) reserved += o.reservedAmount;
        });
        var equity = portfolio.balance + usedMargin + openPnl + reserved;

        // (8 Ağustos 2026 — "admin panelinde herşeyi görebilmem") admin artık
        // sadece açık pozisyonları değil, bekleyen (OCO) emirleri ve en son
        // kapanmış/açılmış işlemleri de görebiliyor — belge boyutu için her
        // ikisi de son 10 kayıtla sınırlı (asıl/tam veri zaten localStorage'da
        // ve pushFullPortfolioToCloud() ile oplab_user_portfolios'ta duruyor,
        // burası SADECE admin'in canlı izleme ekranı için özet).
        // (11 Ağustos 2026 — Madde #132) `id` alanı eklendi — admin'in "İPTAL
        // ET" butonu, hangi spesifik OCO emrinin iptal edileceğini bu id ile
        // (cancelOcoOrder(orderId)) belirtiyor; önceden burada hiç id
        // gönderilmiyordu, admin sadece emri GÖREBİLİYORDU, iptal edemezdi.
        var pendingOut = (portfolio.pendingOrders || []).slice(0, 10).map(function (o) {
            return { id: o.id, symbol: o.symbol, qty: o.qty, upper: o.upper, lower: o.lower, market: 'NORMAL' };
        }).concat((portfolio.viopPendingOrders || []).slice(0, 10).map(function (o) {
            return { id: o.id, symbol: o.symbol, qty: o.qty, upper: o.upper, lower: o.lower, market: 'VIOP' };
        }));
        var histOut = (portfolio.history || []).slice(0, 10).map(function (h) {
            return { symbol: h.symbol, side: h.side, qty: h.qty, price: h.price, type: h.type, pnl: h.pnl, ts: h.ts, market: 'NORMAL' };
        }).concat((portfolio.viopHistory || []).slice(0, 10).map(function (h) {
            return { symbol: h.symbol, side: h.side, qty: h.qty, price: h.price, type: h.type, pnl: h.pnl, ts: h.ts, market: 'VIOP' };
        })).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 10);

        return {
            balance: portfolio.balance,
            equity: equity,
            openPnl: openPnl,
            positionsCount: positionsCount,
            positions: positionsOut,
            pendingOrders: pendingOut,
            recentTrades: histOut
        };
    }

    /* ════════════════════════════════════════════════════════════════════
       (24 Eylül 2026) ÇOK CİHAZLI SENKRON — YENİDEN YAPILANMA
       ════════════════════════════════════════════════════════════════════
       ESKİ tasarımın (6-10 Ağustos 2026 sürümleri) üç yapısal sorunu vardı ve
       "telefonda alınan hisse PC'de görünmüyor" şikayetinin asıl kökü
       bunlardı:

       1) TÜM yarışmacıların TAM portföyü (bakiye + pozisyonlar + işlem
          geçmişi) TEK bir belgede (finteclub/oplab_user_portfolios) duruyordu.
          Firestore'da bir belge en fazla 1 MB olabilir — geçmişler büyüdükçe
          bu sınır dolar ve dolduğu an HERKESİN kaydı durur. Ayrıca 20 kişi
          aynı belgeye aynı anda transaction ile yazdığında yazmalar birbirini
          bekletip reddediliyordu.
       2) Açık her sekme, hiçbir şey DEĞİŞMESE BİLE her 5 saniyede bir 2 yazma
          (bu belge + admin özeti) yapıyordu; her yazma da o dev belgeyi
          dinleyen BÜTÜN cihazlara yeniden indiriliyordu. 20 kişiyle ücretsiz
          planın günlük 20.000 yazma / 50.000 okuma hakkı dakikalar içinde
          bitiyor, Firebase o gün için duruyordu. (Test ortamında ölçüldü:
          20 kişi × 2 cihaz, 1 saat → eski: ~22.400 yazma / ~192.000 okuma;
          yeni: ~1.500 yazma / ~2.100 okuma.)
       3) Her 5 saniyelik yazma "yeni sürüm" (rev+1) sayıldığından, aynı kişi
          iki cihazda açıkken cihazlar birbirinin yazmasını görüp SAYFAYI
          YENİLİYORDU (location.reload) — sonra o yazıyor, bu sefer öteki
          yenileniyordu (ping-pong).

       YENİ tasarım:
       - Her yarışmacının KENDİ belgesi var: oplab_portfolios/{e-posta}. Belge
         kimliği Firebase Authentication e-postası olduğu için güvenlik
         kuralları "herkes SADECE kendi belgesine yazabilir" diyebiliyor.
       - Buluta SADECE içerik gerçekten DEĞİŞTİĞİNDE yazılıyor (sıralı-anahtar
         özetiyle karşılaştırma, bkz. hashPortfolio).
       - Diğer cihazdan gelen değişiklik SAYFA YENİLENMEDEN, yerinde uygulanıyor
         (tradingEngine.js applySyncedPortfolio). İçeriği aynı olan güncelleme
         sessizce yok sayılıyor — ping-pong bitti.
       - rev + transaction tabanlı çift-satış koruması (9 Ağustos 2026) AYNEN
         korunuyor. Her belgenin ayrıca bir "epoch" kimliği var: belge silinip
         yeniden oluşursa (kayıt silindi / yeniden başvurdu) eski cihazlar
         bunu anlayıp eski portföyü buluta geri yazmıyor, yenisini benimsiyor.
       - Paylaşılan (okul/lab) bilgisayar koruması: localStorage'daki portföyün
         KİME ait olduğu kaydediliyor (PORTFOLIO_OWNER_KEY). Aynı tarayıcıda
         başka biri giriş yaptığı AN (onaylı olsun olmasın) önceki kişinin
         portföyü ekrandan kaldırılıyor ve asla yeni kişinin hesabına
         yazılmıyor (bkz. guardForeignLocalPortfolio).
       - Eski ortak belgedeki kayıt, yarışmacı ilk girişinde otomatik olarak
         kişisel belgesine taşınıyor (bkz. migrateFromLegacy).
       - Admin canlı özeti (finteclub/oplab_live_portfolio) artık sadece
         değişiklik olduğunda + açık pozisyon varken fiyat güncellemesi için
         2 dakikada bir (sekme arka plandaysa / son işlemi yapan cihaz bu
         değilse 10 dakikada bir) yazılıyor.
       ════════════════════════════════════════════════════════════════════ */
    var PORTFOLIOS_COLLECTION = 'oplab_portfolios';
    var PORTFOLIO_OWNER_KEY = 'optipulselab_portfolio_owner_v1';
    var PORTFOLIO_KNOWN_EPOCH_KEY = 'optipulselab_portfolio_known_epoch_v1';
    var FOREIGN_OWNER_MARK = '__baska_kullanici__'; // hiçbir e-postaya eşit olamaz
    var LIVE_REFRESH_VISIBLE_MS = 120000;
    var LIVE_REFRESH_HIDDEN_MS = 600000;
    var FRESH_PORTFOLIO_BALANCE = 100000; // tradingEngine.js DEFAULT_BALANCE ile AYNI

    var myPortfolioRef = null;       // oplab_portfolios/{e-posta}
    var myPortfolioKey = null;       // o anki kullanıcının e-postası (küçük harf)
    var myPortfolioUnsub = null;     // onSnapshot aboneliği
    var syncStartedForKey = null;    // senkron hangi kullanıcı için başlatıldı
    var syncGen = 0;                 // her başlat/durdur'da artar — eski async zincirleri kendini iptal eder
    var syncReady = false;           // ilk yükleme/taşıma bitti mi (bitmeden buluta yazılmaz)
    var lastSyncedHash = null;       // buluttakiyle aynı olduğunu bildiğimiz yerel içeriğin özeti
    var pushInFlight = null;         // aynı cihazdan üst üste binen yazmaları sıraya koymak için
    var pushQueued = false;
    var pushBackoffUntil = 0;        // kalıcı hata (yetki reddi vb.) sonrası tekrar denemeyi seyrelt
    var pushFailStreak = 0;
    var lastLiveKey = null;          // admin özetinin son gönderilen içeriği
    var lastLivePushAt = 0;
    var lastCloudWriterDevice = null; // kişisel kayda en son hangi cihaz yazdı
    var CONFLICT_MSG = 'Bu cihazda yapılan son işlem başka bir cihazdaki daha güncel bir işlemle çakıştı ve geri alındı. Güncel portföyün yüklendi.';
    var SYNC_MSG = 'Portföyün diğer cihazından güncellendi.';

    function currentUserKey() {
        return (currentAuthUser && currentAuthUser.email) ? String(currentAuthUser.email).trim().toLowerCase() : null;
    }

    // JSON.stringify anahtar sırasına bağlıdır; Firestore ise map anahtarlarını
    // kendi sırasıyla döndürür. İçerik karşılaştırması sıradan etkilenmesin
    // diye anahtarlar sıralanarak yazılıyor.
    function stableStringify(v) {
        if (v === undefined) return 'null';
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
        return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
            .map(function (k) { return JSON.stringify(k) + ':' + stableStringify(v[k]); }).join(',') + '}';
    }
    function hashPortfolio(p) {
        if (!p) return null;
        var s = stableStringify(p);
        var h1 = 5381, h2 = 52711;
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            h1 = ((h1 << 5) + h1 + c) | 0;
            h2 = ((h2 << 5) + h2 + c) | 0;
        }
        return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + ':' + s.length;
    }
    function newEpoch() {
        return 'ep_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }

    function getLocalPortfolioOwner() {
        try { return localStorage.getItem(PORTFOLIO_OWNER_KEY); } catch (e) { return null; }
    }
    function setLocalPortfolioOwner(key) {
        try { if (key) localStorage.setItem(PORTFOLIO_OWNER_KEY, key); } catch (e) { /* private mode */ }
    }
    function localPortfolioBelongsToCurrentUser() {
        var key = currentUserKey();
        return !!key && getLocalPortfolioOwner() === key;
    }
    function getKnownEpoch() {
        var k = currentUserKey();
        if (!k) return null;
        try { return localStorage.getItem(PORTFOLIO_KNOWN_EPOCH_KEY + '::' + k); } catch (e) { return null; }
    }
    function setKnownEpoch(epoch) {
        var k = currentUserKey();
        if (!k) return;
        try {
            if (epoch) localStorage.setItem(PORTFOLIO_KNOWN_EPOCH_KEY + '::' + k, epoch);
            else localStorage.removeItem(PORTFOLIO_KNOWN_EPOCH_KEY + '::' + k);
        } catch (e) { /* private mode */ }
    }
    function freshPortfolio() {
        return { balance: FRESH_PORTFOLIO_BALANCE, positions: {}, history: [], pendingOrders: [], viopPositions: {}, viopHistory: [], viopPendingOrders: [] };
    }

    function getMyPortfolioRef() {
        var key = currentUserKey();
        if (!fsFirestore || !verifiedApp || !key) return null;
        if (myPortfolioKey !== key || !myPortfolioRef) {
            myPortfolioRef = fsFirestore.collection(PORTFOLIOS_COLLECTION).doc(key);
            myPortfolioKey = key;
        }
        return myPortfolioRef;
    }

    function buildCloudRecord(portfolio, rev, hash, epoch) {
        return {
            appId: String(verifiedApp.id),
            name: verifiedApp.name || '',
            email: currentUserKey(),
            portfolio: portfolio,
            rev: rev,
            epoch: epoch,
            deviceId: getDeviceId(),
            updatedAt: new Date().toISOString(),
            contentHash: hash
        };
    }

    // Buluttan gelen (ya da sıfırlanan) bir portföyü bu cihaza uygular. Normal
    // yol: sayfa YENİLENMEDEN (tradingEngine.js applySyncedPortfolio).
    // tradingEngine.js'in eski bir sürümü önbellekte kalmışsa eski güvenli yola
    // (localStorage + yenileme) düşülür — veri asla kaybolmaz.
    function applyPortfolioLocally(portfolio, message, ownerOverride) {
        var applied = false;
        if (window.TradingEngine && typeof window.TradingEngine.applySyncedPortfolio === 'function') {
            try { applied = window.TradingEngine.applySyncedPortfolio(portfolio) !== false; } catch (e) { applied = false; }
        }
        setLocalPortfolioOwner(ownerOverride || currentUserKey());
        if (applied) {
            lastSyncedHash = hashPortfolio(readLocalPortfolio());
            if (message && window.TradingEngine && typeof window.TradingEngine.showToast === 'function') {
                window.TradingEngine.showToast(message);
            }
            return { applied: true, reloading: false };
        }
        try { localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(portfolio)); } catch (e) { return { applied: false, reloading: false }; }
        if (window.TradingEngine && typeof window.TradingEngine.showToast === 'function') {
            window.TradingEngine.showToast((message || 'Portföyün güncellendi.') + ' Sayfa yenileniyor...');
        }
        setTimeout(function () { location.reload(); }, 900);
        return { applied: true, reloading: true };
    }

    // (24 Eylül 2026 — paylaşılan bilgisayar koruması) Bir hesaba giriş
    // yapıldığı AN çağrılır — hesap onaylı olsun olmasın. Bu tarayıcıdaki
    // portföy başka birine aitse ekrandan kaldırılır (boş portföy gösterilir)
    // ve sahiplik "başkası" olarak işaretlenir; böylece (a) yeni kişi önceki
    // kişinin pozisyonlarını görüp üzerinde işlem yapamaz, (b) önceki kişi
    // tekrar girdiğinde bu cihazdaki (artık yabancı) veri onun hesabına
    // yazılmaz, onun bulut kaydı yüklenir.
    function guardForeignLocalPortfolio(email) {
        var key = email ? String(email).trim().toLowerCase() : null;
        if (!key) return;
        var owner = getLocalPortfolioOwner();
        if (!owner || owner === key) return;
        if (owner === FOREIGN_OWNER_MARK) return;
        stopPortfolioSync();
        applyPortfolioLocally(freshPortfolio(), null, FOREIGN_OWNER_MARK);
    }

    // Bir cihazın bilinen rev değeri KULLANICI BAŞINA tutuluyor (bkz.
    // getKnownCloudRev). Yeni sürüme ilk geçişte, bu cihazın portföyü bu
    // kullanıcıya aitse eski (ortak) anahtardaki değer devralınır.
    function ensureKnownRevInitialized(localIsMine) {
        var key = currentUserKey();
        if (!key) return;
        try {
            if (localStorage.getItem(PORTFOLIO_KNOWN_REV_KEY + '::' + key) !== null) return;
            var legacyRaw = localStorage.getItem(PORTFOLIO_KNOWN_REV_KEY);
            var legacy = legacyRaw === null ? 0 : parseInt(legacyRaw, 10);
            localStorage.setItem(PORTFOLIO_KNOWN_REV_KEY + '::' + key, String(localIsMine && isFinite(legacy) && legacy > 0 ? legacy : 0));
        } catch (e) { /* private mode */ }
    }

    // Admin panelinin "Canlı İzleme" ekranı ve herkese açık sonuç sayfası için
    // hafif özet (finteclub/oplab_live_portfolio). Yalnızca: (a) içerik
    // değiştiyse, (b) açık pozisyon varken fiyatlar oynadığı için belli
    // aralıklarla, ya da (c) force ile yazılıyor.
    function pushLiveSnapshot(force) {
        if (!fsPortfolioDoc || !verifiedApp || !syncReady) return;
        if (!localPortfolioBelongsToCurrentUser()) return;
        var snap = computeLightPortfolioSnapshot();
        if (!snap) return;
        var contentKey = stableStringify({
            b: snap.balance,
            p: snap.positions.map(function (p) { return [p.symbol, p.market, p.side, p.qty, p.avgPrice]; }),
            o: snap.pendingOrders,
            t: snap.recentTrades,
            n: snap.positionsCount,
            nm: verifiedApp.name || ''
        });
        var now = Date.now();
        // Aynı yarışmacının birden çok cihazı açıksa fiyat yenilemesini sık
        // aralıkla SADECE en son işlem yapılan (ve ekranı açık) cihaz yapar;
        // diğerleri yalnızca seyrek aralıkla (o cihaz kapandıysa admin
        // ekranı yine de tamamen donmasın diye).
        var iAmLastWriter = !lastCloudWriterDevice || lastCloudWriterDevice === getDeviceId();
        var interval = (iAmLastWriter && !document.hidden) ? LIVE_REFRESH_VISIBLE_MS : LIVE_REFRESH_HIDDEN_MS;
        var changed = contentKey !== lastLiveKey;
        var refreshDue = snap.positionsCount > 0 && (now - lastLivePushAt) >= interval;
        if (!force && !changed && !refreshDue) return;
        lastLiveKey = contentKey;
        lastLivePushAt = now;
        var payload = { competitors: {} };
        payload.competitors[String(verifiedApp.id)] = {
            name: verifiedApp.name || '',
            email: verifiedApp.email || '',
            balance: snap.balance,
            equity: snap.equity,
            openPnl: snap.openPnl,
            positionsCount: snap.positionsCount,
            positions: snap.positions,
            pendingOrders: snap.pendingOrders,
            recentTrades: snap.recentTrades,
            updatedAt: new Date().toISOString()
        };
        fsPortfolioDoc.set(payload, { merge: true }).catch(function (e) {
            lastLiveKey = null; // bir sonraki turda tekrar denensin
            console.warn('OPLab canlı portföy verisi Firestore\'a yazılamadı.', e);
        });
    }

    // Admin komutları (bakiye/iptal) ve test yardımcıları için: hem kişisel
    // kaydı hem admin özetini HEMEN günceller.
    function pushPortfolioSnapshot() {
        pushFullPortfolioToCloud({ ignoreBackoff: true });
        pushLiveSnapshot(true);
    }

    // 5 saniyede bir çalışır ama ağa SADECE bir şey değiştiyse çıkar.
    function syncTick() {
        if (!verifiedApp || !syncReady) return;
        pushFullPortfolioToCloud();
        pushLiveSnapshot(false);
    }

    // (9 Ağustos 2026 — çift-satış kök neden düzeltmesi) tradingEngine.js her
    // portföy-değiştiren işlemden (savePortfolio()) sonra bunu çağırır; kısa
    // bir debounce ile hemen buluta yazılır. Asıl çift-ödeme güvencesi
    // pushFullPortfolioToCloud() içindeki rev-korumalı TRANSACTION'dır.
    var immediateSyncTimer = null;
    function requestImmediateSync() {
        if (!verifiedApp || !syncReady) return;
        if (immediateSyncTimer) clearTimeout(immediateSyncTimer);
        immediateSyncTimer = setTimeout(function () {
            immediateSyncTimer = null;
            pushFullPortfolioToCloud({ ignoreBackoff: true });
        }, 400);
    }

    // Bu cihazı kalıcı olarak tanımlayan rastgele bir id — bkz. DEVICE_ID_KEY
    // yorumundaki açıklama.
    function getDeviceId() {
        try {
            var id = localStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
                localStorage.setItem(DEVICE_ID_KEY, id);
            }
            return id;
        } catch (e) { return 'dev_unknown_' + Math.random().toString(36).slice(2, 10); }
    }

    // Kişisel bulut kaydı silinmiş ya da başka bir "epoch"la yeniden
    // oluşturulmuşsa (kayıt silindi / aynı e-postayla yeniden başvurdu), bu
    // cihazın eldeki eski portföyü ESKİ hesaba ait sayılır: bilinen rev/epoch
    // sıfırlanır, yerel veri yabancı işaretlenir ve senkron baştan kurulur —
    // eski portföy yeni kayda ASLA geri yazılmaz.
    function handleCloudRecordReset() {
        setKnownEpoch(null);
        setKnownCloudRev(0, true);
        setLocalPortfolioOwner(FOREIGN_OWNER_MARK);
        stopPortfolioSync();
        startPortfolioSyncForCurrentUser();
    }

    // Yerel portföyü kişisel bulut kaydına yazar — SADECE içerik değiştiyse.
    // (9 Ağustos 2026 rev koruması aynen:) Bulutta bu cihazın bildiğinden
    // DAHA YENİ bir sürüm varsa VE onu başka bir cihaz yazdıysa, bu cihazın
    // (bayat veriye dayanan) sürümü ASLA yazılmaz — bulut benimsenir.
    function pushFullPortfolioToCloud(opts) {
        opts = opts || {};
        var ref = getMyPortfolioRef();
        if (!ref) return Promise.resolve({ ok: false, skipped: 'no-user' });
        if (!syncReady) return Promise.resolve({ ok: false, skipped: 'not-ready' });
        if (!localPortfolioBelongsToCurrentUser()) return Promise.resolve({ ok: false, skipped: 'foreign-local' });
        if (!opts.ignoreBackoff && Date.now() < pushBackoffUntil) return Promise.resolve({ ok: false, skipped: 'backoff' });
        if (pushInFlight) { pushQueued = true; return pushInFlight; }
        var portfolio = readLocalPortfolio();
        if (!portfolio || typeof portfolio.balance !== 'number') return Promise.resolve({ ok: false, skipped: 'no-portfolio' });
        var hash = hashPortfolio(portfolio);
        if (!opts.force && hash === lastSyncedHash) return Promise.resolve({ ok: true, unchanged: true });
        var deviceId = getDeviceId();
        var knownRev = getKnownCloudRev();
        var knownEpoch = getKnownEpoch();
        var gen = syncGen;

        pushInFlight = fsFirestore.runTransaction(function (tx) {
            return tx.get(ref).then(function (doc) {
                var rec = doc.exists ? (doc.data() || {}) : null;
                if (!rec) {
                    // Belge yok: bu cihaz daha önce bir epoch biliyorsa belge
                    // SİLİNMİŞ demektir — eski veriyi yeniden oluşturma.
                    if (knownEpoch) return { deleted: true };
                    var epoch = newEpoch();
                    tx.set(ref, buildCloudRecord(portfolio, knownRev + 1, hash, epoch));
                    return { written: true, rev: knownRev + 1, epoch: epoch };
                }
                if (rec.epoch && knownEpoch && rec.epoch !== knownEpoch) return { reset: true, record: rec };
                var cloudRev = typeof rec.rev === 'number' ? rec.rev : 0;
                if (rec.contentHash === hash) return { same: true, rev: cloudRev, epoch: rec.epoch };
                if (cloudRev > knownRev && rec.deviceId !== deviceId) {
                    return { conflict: true, record: rec };
                }
                tx.set(ref, buildCloudRecord(portfolio, cloudRev + 1, hash, rec.epoch || knownEpoch || newEpoch()));
                return { written: true, rev: cloudRev + 1, epoch: rec.epoch || knownEpoch };
            });
        }).then(function (res) {
            if (gen !== syncGen) return { ok: false, skipped: 'sync-restarted' };
            pushFailStreak = 0;
            pushBackoffUntil = 0;
            if (res.deleted || res.reset) {
                console.warn('Kişisel portföy kaydı silinmiş/yeniden oluşturulmuş — bu cihazdaki eski veri yeni kayda yazılmıyor, senkron baştan kuruluyor.');
                handleCloudRecordReset();
                return { ok: false, reset: true };
            }
            if (res.conflict) {
                console.warn('Portföy push çakışması: buluttaki sürüm daha yeni, yerel işlem geri alınıp bulut benimseniyor.');
                applyCloudPortfolioRecordIfNewer(res.record, { force: true, reasonConflict: true });
                return { ok: false, conflict: true };
            }
            setKnownCloudRev(res.rev);
            if (res.epoch) setKnownEpoch(res.epoch);
            lastSyncedHash = hash;
            if (res.written) lastCloudWriterDevice = deviceId;
            try { localStorage.setItem(PORTFOLIO_CLOUD_SYNC_KEY, new Date().toISOString()); } catch (e) { /* private mode */ }
            if (res.written) pushLiveSnapshot(false);
            return { ok: true, written: !!res.written };
        }).catch(function (e) {
            console.warn('Portföy bulut senkronizasyonu başarısız (oplab_portfolios).', e);
            // Kalıcı hatalarda (yetki reddi, çok büyük belge) her 5 saniyede
            // boşuna okuma harcamamak için tekrar denemeyi seyrelt.
            pushFailStreak++;
            pushBackoffUntil = Date.now() + Math.min(300000, 5000 * Math.pow(2, pushFailStreak));
            if (e && e.code === 'permission-denied') showSyncWarningBanner(PERMISSION_BANNER_TEXT);
            return { ok: false, error: e };
        }).then(function (result) {
            pushInFlight = null;
            if (pushQueued) { pushQueued = false; pushFullPortfolioToCloud(); }
            return result;
        });
        return pushInFlight;
    }

    // Buluttaki kayıt bu cihazın bildiğinden yeniyse ve içerik gerçekten
    // farklıysa yerel portföye (sayfa yenilemeden) uygular.
    function applyCloudPortfolioRecordIfNewer(record, opts) {
        if (!record || !record.portfolio) return false;
        opts = opts || {};
        var cloudRev = typeof record.rev === 'number' ? record.rev : 0;
        if (record.deviceId) lastCloudWriterDevice = record.deviceId;

        // Epoch kontrolü: bu cihaz farklı bir epoch biliyorsa kayıt silinip
        // yeniden oluşturulmuş demektir — rev karşılaştırması anlamsız,
        // bulut kaydı olduğu gibi benimsenir.
        var knownEpoch = getKnownEpoch();
        if (record.epoch && knownEpoch && record.epoch !== knownEpoch) {
            setKnownEpoch(record.epoch);
            setKnownCloudRev(cloudRev, true);
            return applyPortfolioLocally(record.portfolio, SYNC_MSG);
        }
        if (record.epoch && !knownEpoch) setKnownEpoch(record.epoch);

        // Bu cihazın kendi yazması geri geldiyse (yankı): sadece rev'i hizala.
        if (!opts.force && record.deviceId === getDeviceId()) {
            if (cloudRev > getKnownCloudRev()) setKnownCloudRev(cloudRev);
            return false;
        }
        if (!opts.force && cloudRev <= getKnownCloudRev()) return false;

        // (10 Ağustos 2026 düzeltmesi korunuyor) Bu cihazda henüz buluta
        // gitmemiş, debounce'ta bekleyen bir değişiklik varsa önce onu gönder —
        // transaction gerçekten kimin güncel olduğuna karar verir. Gönderilecek
        // bir şey çıkmazsa (içerik aslında değişmemişse) gelen kayıt hemen
        // yeniden değerlendirilir.
        if (!opts.force && immediateSyncTimer) {
            clearTimeout(immediateSyncTimer);
            immediateSyncTimer = null;
            pushFullPortfolioToCloud({ ignoreBackoff: true }).then(function (r) {
                if (r && (r.unchanged || r.skipped)) applyCloudPortfolioRecordIfNewer(record, opts);
            });
            return false;
        }

        setKnownCloudRev(cloudRev, !!opts.force);
        var cloudHash = record.contentHash || hashPortfolio(record.portfolio);
        var local = readLocalPortfolio();
        if (local && localPortfolioBelongsToCurrentUser() && hashPortfolio(local) === cloudHash) {
            lastSyncedHash = cloudHash; // içerik zaten aynı — ekrana dokunma
            return false;
        }
        var message = opts.reasonConflict ? CONFLICT_MSG : (opts.quiet ? null : SYNC_MSG);
        return applyPortfolioLocally(record.portfolio, message);
    }

    // Eski ortak belgede bu cihazın EN SON kimin adına yazdığını bulur
    // (sahiplik bilgisi olmayan, yeni sürümden önceki cihazlar için).
    function latestLegacyRecordByThisDevice(users) {
        var myDevice = getDeviceId();
        var latest = null;
        Object.keys(users || {}).forEach(function (id) {
            var r = users[id];
            if (r && r.deviceId === myDevice && (!latest || String(r.updatedAt || '') > String(latest.r.updatedAt || ''))) {
                latest = { id: id, r: r };
            }
        });
        return latest;
    }
    function readLegacyUsers() {
        if (!fsUserPortfoliosDoc) return Promise.resolve({});
        return fsUserPortfoliosDoc.get()
            .then(function (d) { return d.exists ? ((d.data() || {}).users || {}) : {}; })
            .catch(function () { return {}; });
    }

    // Kişisel belge henüz yokken çağrılır: eski ortak belgeden tek seferlik
    // taşıma (ya da yeni yarışmacı için ilk kayıt).
    function migrateFromLegacy(ref, gen) {
        var key = currentUserKey();
        var appId = String(verifiedApp.id);
        var myDevice = getDeviceId();
        return readLegacyUsers().then(function (users) {
            if (gen !== syncGen) return;
            var legacy = users[appId] || null;
            var owner = getLocalPortfolioOwner();
            var local = readLocalPortfolio();
            var localIsMine;
            if (owner) {
                localIsMine = owner === key;
            } else {
                var latest = latestLegacyRecordByThisDevice(users);
                localIsMine = !latest || latest.id === appId;
            }
            ensureKnownRevInitialized(localIsMine);
            var legacyRev = (legacy && typeof legacy.rev === 'number') ? legacy.rev : 0;

            var chosen = null, message = null;
            if (legacy && legacy.portfolio && (!localIsMine || !local || (legacy.deviceId !== myDevice && legacyRev > getKnownCloudRev()))) {
                chosen = legacy.portfolio;
                message = localIsMine ? 'Portföyün buluttan yüklendi.' : 'Hesabının portföyü yüklendi.';
            } else if (local && localIsMine) {
                chosen = local;
            } else if (!localIsMine) {
                chosen = freshPortfolio();
                message = 'Hesabının portföyü yüklendi.';
            }
            if (!chosen) { setLocalPortfolioOwner(key); return; } // taşınacak hiçbir şey yok — ilk işlemde belge oluşur
            if (chosen !== local) applyPortfolioLocally(chosen, message);
            setLocalPortfolioOwner(key);

            var toStore = readLocalPortfolio() || chosen;
            var hash = hashPortfolio(toStore);
            var newRev = Math.max(legacyRev, getKnownCloudRev()) + 1;
            var epoch = newEpoch();
            return fsFirestore.runTransaction(function (tx) {
                return tx.get(ref).then(function (doc) {
                    if (doc.exists) return { existed: true, record: doc.data() };
                    tx.set(ref, buildCloudRecord(toStore, newRev, hash, epoch));
                    return { existed: false };
                });
            }).then(function (res) {
                if (gen !== syncGen) return;
                if (res.existed) { applyCloudPortfolioRecordIfNewer(res.record, { force: true, quiet: true }); return; }
                setKnownCloudRev(newRev);
                setKnownEpoch(epoch);
                lastSyncedHash = hash;
            });
        });
    }

    // Kişisel belge zaten varken, sayfa açılışında bir kez çalışır.
    // legacyUsers: sadece sahiplik bilgisi OLMAYAN cihazlarda (yeni sürüme
    // geçişin ilk açılışı) eski ortak belgeden okunur — bkz. aşağıdaki not.
    function hydrateFromRecord(rec, legacyUsers) {
        var key = currentUserKey();
        var myDevice = getDeviceId();
        if (rec.deviceId) lastCloudWriterDevice = rec.deviceId;
        var owner = getLocalPortfolioOwner();
        var local = readLocalPortfolio();
        var cloudRev = typeof rec.rev === 'number' ? rec.rev : 0;
        var knownEpoch = getKnownEpoch();

        // Bu cihaz bu kaydın başka bir epoch'unu biliyorsa kayıt silinip
        // yeniden oluşturulmuş — bulut esas.
        if (rec.epoch && knownEpoch && rec.epoch !== knownEpoch) {
            setKnownEpoch(rec.epoch);
            setKnownCloudRev(cloudRev, true);
            applyPortfolioLocally(rec.portfolio, 'Hesabının portföyü yüklendi.');
            return;
        }

        var localIsMine = !!local && (owner === key || (!owner && rec.deviceId === myDevice));
        // (Yeni sürüme geçiş günü için) Sahiplik bilgisi olmayan bir cihaz,
        // eski sürümde açık kalmış bir sekmeden geliyor olabilir: telefon yeni
        // sürüme geçip kaydı taşıdıktan SONRA bu cihaz eski sürümde işlem
        // yapmışsa, o işlemler sadece ESKİ ortak belgeye yazılmıştır. Eski
        // belgede bu cihazın bu kullanıcı adına yazdığı kayıt, kişisel
        // kayıttan daha yeniyse bu cihazın verisi hem bu kullanıcıya ait hem
        // de daha günceldir — atılmaz, buluta yazılır.
        var localIsNewerThanCloud = false;
        if (!owner && local && legacyUsers) {
            var legacy = legacyUsers[String(verifiedApp.id)];
            var latest = latestLegacyRecordByThisDevice(legacyUsers);
            if (legacy && legacy.deviceId === myDevice && (!latest || latest.id === String(verifiedApp.id)) &&
                String(legacy.updatedAt || '') > String(rec.updatedAt || '')) {
                localIsMine = true;
                localIsNewerThanCloud = true;
            }
        }
        ensureKnownRevInitialized(localIsMine);
        if (rec.epoch) setKnownEpoch(rec.epoch);

        if (!localIsMine) {
            // Bu tarayıcıdaki portföy başka birine ait ya da hiç yok — bulut esas.
            setKnownCloudRev(cloudRev, true);
            applyPortfolioLocally(rec.portfolio, owner && owner !== key ? 'Hesabının portföyü yüklendi.' : null);
            return;
        }
        setLocalPortfolioOwner(key);
        if (localIsNewerThanCloud) {
            // Çakışma kontrolüne takılmadan yazılabilsin diye bulutun rev'ini
            // "biliyoruz" — syncReady olunca pushFullPortfolioToCloud yazar.
            setKnownCloudRev(cloudRev, true);
            lastSyncedHash = null;
            return;
        }
        if (rec.deviceId === myDevice) {
            if (cloudRev > getKnownCloudRev()) setKnownCloudRev(cloudRev);
            if (hashPortfolio(local) === rec.contentHash) lastSyncedHash = rec.contentHash;
            return;
        }
        applyCloudPortfolioRecordIfNewer(rec);
    }

    /* ══════════════════════════════════════════════════════════════════
       (24 Eylül 2026) GRAFİK ÇİZİMLERİ SENKRONU — oplab_drawings/{e-posta}
       ──────────────────────────────────────────────────────────────────
       tradingChart.js çizimleri sembol başına tarayıcıda saklıyor ve her
       değişiklikte 'optipulse-drawings-changed' olayı yayınlıyor. Burada:
         - giriş yapan kullanıcının kendi belgesi dinlenir; başka cihazdan
           gelen daha yeni sembol çizimleri grafiğe uygulanır,
         - bu cihazdaki değişiklikler 2,5 sn bekletilip TEK yazmada
           (sembol → {t, d}) buluta gönderilir (sürükleme sırasında her
           harekette yazma yok — Firestore kotası korunur),
         - ilk bağlantıda bu cihazda olup bulutta olmayan/daha eski olan
           semboller buluta yüklenir.
       Çakışmada sembol bazında EN SON değiştirilen kazanır. Portföy
       senkronundan tamamen ayrı bir belge — biri diğerini etkilemez. */
    var DRAWINGS_COLLECTION = 'oplab_drawings';
    var DRAWINGS_WRITE_DELAY_MS = 2500;
    var DRAWINGS_MAX_SYMBOL_BYTES = 200000;
    var drawingsOwner = null;
    var drawingsUnsub = null;
    var drawingsPending = {};
    var drawingsTimer = null;
    var drawingsRemoteSizes = {};
    var DRAWINGS_MAX_DOC_BYTES = 900000; // Firestore belge sınırı 1 MiB

    function byteLength(str) {
        try { return new TextEncoder().encode(str).length; } catch (e) { return String(str).length * 2; }
    }

    function stopDrawingsSync() {
        if (drawingsTimer) { clearTimeout(drawingsTimer); drawingsTimer = null; }
        flushDrawingsWrites();
        if (drawingsUnsub) { try { drawingsUnsub(); } catch (e) { /* yok say */ } }
        drawingsUnsub = null;
        drawingsOwner = null;
        drawingsPending = {};
    }

    function startDrawingsSync() {
        var email = currentUserKey();
        if (!fsFirestore || !email) { stopDrawingsSync(); return; }
        if (drawingsOwner === email && drawingsUnsub) return;
        stopDrawingsSync();
        drawingsOwner = email;
        var ref = fsFirestore.collection(DRAWINGS_COLLECTION).doc(email);
        drawingsUnsub = ref.onSnapshot(function (snap) {
            if (drawingsOwner !== email) return;
            var data = snap.exists ? (snap.data() || {}) : {};
            var syms = data.symbols || {};
            var parsed = {};
            drawingsRemoteSizes = {};
            Object.keys(syms).forEach(function (k) {
                var ent = syms[k];
                if (!ent || typeof ent.d !== 'string') return;
                drawingsRemoteSizes[k] = byteLength(ent.d) + 64;
                try { parsed[k] = { t: Number(ent.t) || 0, d: JSON.parse(ent.d) }; } catch (e) { /* bozuk kayıt */ }
            });
            var TC = window.TradingChart;
            if (TC && typeof TC.applyRemoteDrawings === 'function') TC.applyRemoteDrawings(parsed, email);
            // Önbellekten gelen (sunucuyu henüz görmemiş) görüntüye göre
            // yükleme yapılmaz — sunucudaki daha yeni veri ezilmesin.
            if (snap.metadata && snap.metadata.fromCache) return;
            // HER sunucu görüntüsünde: bu cihazda buluttakinden DAHA YENİ olan
            // sembol varsa (ör. çevrimdışıyken yapılmış, ya da gecikmiş eski
            // bir yazma buluttakini geriye götürmüşse) tekrar yüklenir —
            // cihazlar kalıcı olarak ayrışık kalmaz.
            if (TC && typeof TC.exportDrawingsStore === 'function') {
                var local = TC.exportDrawingsStore(email) || {};
                Object.keys(local).forEach(function (k) {
                    var lt = Number(local[k] && local[k].t) || 0;
                    var rt = parsed[k] ? parsed[k].t : 0;
                    var pend = drawingsPending[k];
                    if (lt > rt && Array.isArray(local[k].d) && !(pend && pend.t >= lt)) queueDrawingsWrite(k, lt, local[k].d);
                });
            }
        }, function (err) {
            console.warn('[Çizim senkronu] Bulut çizim kanalı dinlenemedi (güvenlik kuralları yayınlanmamış olabilir).', err);
        });
    }

    function queueDrawingsWrite(ticker, t, shapes) {
        var json;
        try { json = JSON.stringify(shapes || []); } catch (e) { return; }
        if (byteLength(json) > DRAWINGS_MAX_SYMBOL_BYTES) {
            console.warn('[Çizim senkronu] ' + ticker + ' çizimleri çok büyük (' + json.length + ' bayt) — sadece bu cihazda saklanıyor.');
            return;
        }
        drawingsPending[ticker] = { t: t, d: json };
        if (drawingsTimer) clearTimeout(drawingsTimer);
        drawingsTimer = setTimeout(flushDrawingsWrites, DRAWINGS_WRITE_DELAY_MS);
    }

    function flushDrawingsWrites() {
        if (drawingsTimer) { clearTimeout(drawingsTimer); drawingsTimer = null; }
        var email = drawingsOwner;
        var batch = drawingsPending;
        if (!email || !fsFirestore || !Object.keys(batch).length) return;
        drawingsPending = {};
        // Belgenin toplam boyutu 1 MiB'ı aşmasın: sığmayan semboller sadece
        // bu cihazda kalır (sonsuz reddedilen yazma döngüsü olmasın).
        var sizes = Object.assign({}, drawingsRemoteSizes);
        Object.keys(batch).forEach(function (k) { sizes[k] = byteLength(batch[k].d) + 64; });
        var total = Object.keys(sizes).reduce(function (a, k) { return a + sizes[k]; }, 0);
        if (total > DRAWINGS_MAX_DOC_BYTES) {
            Object.keys(batch).sort(function (x, y) { return sizes[y] - sizes[x]; }).forEach(function (k) {
                if (total <= DRAWINGS_MAX_DOC_BYTES) return;
                total -= sizes[k] - (drawingsRemoteSizes[k] || 0);
                delete batch[k];
                console.warn('[Çizim senkronu] Toplam çizim boyutu sınırı aşıldı — ' + k + ' çizimleri sadece bu cihazda saklanıyor.');
            });
            if (!Object.keys(batch).length) return;
        }
        fsFirestore.collection(DRAWINGS_COLLECTION).doc(email).set({
            email: email,
            symbols: batch,
            updatedAt: new Date().toISOString(),
            deviceId: getDeviceId()
        }, { merge: true }).catch(function (err) {
            var code = err && err.code;
            if (code === 'permission-denied' || code === 'invalid-argument' || code === 'failed-precondition' || code === 'resource-exhausted') {
                console.warn('[Çizim senkronu] Bulut yazmayı reddetti (' + code + ') — çizimler bu cihazda saklanmaya devam ediyor. Güvenlik kurallarının yayınlandığından emin ol.', err);
                return;
            }
            console.warn('[Çizim senkronu] Buluta yazılamadı, 15 sn sonra tekrar denenecek.', err);
            if (drawingsOwner !== email) return;
            Object.keys(batch).forEach(function (k) {
                if (!drawingsPending[k] || drawingsPending[k].t < batch[k].t) drawingsPending[k] = batch[k];
            });
            if (!drawingsTimer) drawingsTimer = setTimeout(flushDrawingsWrites, 15000);
        });
    }

    window.addEventListener('optipulse-drawings-changed', function (e) {
        var d = e && e.detail;
        if (!d || !drawingsOwner || d.owner !== drawingsOwner || !d.ticker) return;
        queueDrawingsWrite(d.ticker, d.t, d.shapes);
    });
    // Sekme kapanırken/arka plana geçerken bekleyen yazmayı hemen gönder.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushDrawingsWrites();
    });
    window.addEventListener('pagehide', flushDrawingsWrites);

    function stopPortfolioSync() {
        syncGen++;
        if (myPortfolioUnsub) { try { myPortfolioUnsub(); } catch (e) { /* ignore */ } }
        myPortfolioUnsub = null;
        syncStartedForKey = null;
        syncReady = false;
        lastSyncedHash = null;
        lastLiveKey = null;
        lastLivePushAt = 0;
        lastCloudWriterDevice = null;
        pushQueued = false;
        pushBackoffUntil = 0;
        pushFailStreak = 0;
        if (immediateSyncTimer) { clearTimeout(immediateSyncTimer); immediateSyncTimer = null; }
    }

    // Kimlik doğrulandığında (checkApplicationStatus) çağrılır: önce bulut
    // kaydını bir kez okur (yoksa eski belgeden taşır), sonra kişisel belgeyi
    // GERÇEK ZAMANLI dinlemeye başlar. Admin komut kanalları da ancak bundan
    // SONRA dinlenir — bir komut, cihaz buluttaki gerçek portföyü yüklemeden
    // önce eski/yerel veriye uygulanmasın.
    function startPortfolioSyncForCurrentUser() {
        var ref = getMyPortfolioRef();
        if (!ref) return Promise.resolve();
        if (syncStartedForKey === myPortfolioKey) return Promise.resolve();
        stopPortfolioSync();
        var gen = syncGen;
        var key = myPortfolioKey;
        syncStartedForKey = key;
        var needLegacyForOwnerless = !getLocalPortfolioOwner();
        return ref.get().then(function (doc) {
            if (gen !== syncGen) return;
            if (!doc.exists) {
                // Bu cihaz bu kaydın bir epoch'unu biliyorsa belge silinmiş.
                if (getKnownEpoch()) {
                    setKnownEpoch(null);
                    setKnownCloudRev(0, true);
                    setLocalPortfolioOwner(FOREIGN_OWNER_MARK);
                }
                return migrateFromLegacy(ref, gen);
            }
            var rec = doc.data() || {};
            if (needLegacyForOwnerless) {
                return readLegacyUsers().then(function (users) {
                    if (gen !== syncGen) return;
                    hydrateFromRecord(rec, users);
                });
            }
            hydrateFromRecord(rec, null);
        }).catch(function (e) {
            console.warn('Bulut portföy verisi okunamadı, yerel veriyle devam ediliyor.', e);
            if (e && e.code === 'permission-denied') showSyncWarningBanner(PERMISSION_BANNER_TEXT);
        }).then(function () {
            if (gen !== syncGen) return;
            syncReady = true;
            myPortfolioUnsub = ref.onSnapshot(function (doc) {
                if (gen !== syncGen || !doc.exists) return;
                applyCloudPortfolioRecordIfNewer(doc.data() || {});
            }, function (e) {
                console.warn('Portföy senkronizasyon kanalı dinlenemedi.', e);
                if (e && e.code === 'permission-denied') showSyncWarningBanner(PERMISSION_BANNER_TEXT);
            });
            listenForBalanceCommands();
            listenForActionCommands();
            pushFullPortfolioToCloud({ ignoreBackoff: true });
            pushLiveSnapshot(true);
        });
    }

    // (22 Eylül 2026 — Madde 6) Dışa aktarma (CSV/XLSX) öncesi tek seferlik
    // tazelik kontrolü. Bulutta daha yeni kayıt varsa artık SAYFA YENİLENMEDEN
    // uygulanıyor; tradingEngine.js yalnızca reloading:true dönerse iptal eder.
    function checkForNewerCloudRecordSync() {
        var ref = getMyPortfolioRef();
        if (!ref || !syncReady) return Promise.resolve({ hasNewer: false });
        return ref.get().then(function (doc) {
            if (!doc.exists) return { hasNewer: false };
            var rec = doc.data() || {};
            var cloudRev = typeof rec.rev === 'number' ? rec.rev : 0;
            var epochChanged = !!(rec.epoch && getKnownEpoch() && rec.epoch !== getKnownEpoch());
            var isNewer = epochChanged || (cloudRev > getKnownCloudRev() && rec.deviceId !== getDeviceId());
            if (!isNewer) return { hasNewer: false };
            var res = applyCloudPortfolioRecordIfNewer(rec);
            return { hasNewer: true, reloading: !!(res && res.reloading) };
        }).catch(function (e) {
            console.warn('Dışa aktarma öncesi bulut tazelik kontrolü başarısız (bağlantı sorunu olabilir), yerel veriyle devam ediliyor.', e);
            return { hasNewer: false };
        });
    }

    // (8 Ağustos 2026 — "anında olsun, sayfa yenilenmeden") Admin panelinin
    // Kullanıcı Portföyleri sayfasından gönderdiği bir bakiye-güncelleme YA DA
    // portföy-sıfırlama komutunu uygular. ÖNCEKİ tasarım localStorage'ı
    // doğrudan yazıp sayfayı yeniliyordu — bu her zaman görünür bir gecikme/
    // "flash" yaratıyordu ("bir iki saniye içinde olacak" şikayeti buydu).
    // Artık tradingEngine.js'in kendi dışa açtığı (ve zaten var olan "Sıfırla"
    // butonunun da kullandığı, test edilmiş) setBalance()/resetPortfolio()
    // fonksiyonlarını DOĞRUDAN çağırıyoruz — bunlar SENKRON çalışır, anında
    // ekranı güncelleyip kaydeder, sayfa yenilemeye hiç gerek kalmaz.
    // window.TradingEngine her zaman bu dosyadan ÖNCE yüklendiği için (bkz.
    // index.html script sırası) normalde hep mevcuttur; olağanüstü bir
    // durumda (script sırası bozulursa) yine de veri kaybolmasın diye eski
    // localStorage+reload yoluna güvenle geri dönülür.
    function applyBalanceCommand(cmd, requestedAt) {
        var applied = false;
        if (cmd.reset === true) {
            if (window.TradingEngine && typeof window.TradingEngine.resetPortfolio === 'function') {
                window.TradingEngine.resetPortfolio();
                applied = true;
            }
        } else if (typeof cmd.newBalance === 'number') {
            if (window.TradingEngine && typeof window.TradingEngine.setBalance === 'function') {
                applied = window.TradingEngine.setBalance(cmd.newBalance) !== false;
            }
        }

        if (!applied) {
            // Yedek yol: tradingEngine.js henüz yüklenmemiş/API'si yoksa,
            // eski (localStorage + reload) yöntemle uygula — hiçbir zaman
            // sessizce vazgeçme.
            var portfolio = readLocalPortfolio();
            if (!portfolio) return;
            if (cmd.reset === true) {
                portfolio = { balance: 100000, positions: {}, history: [], pendingOrders: [], viopPositions: {}, viopHistory: [], viopPendingOrders: [] };
            } else if (typeof cmd.newBalance === 'number') {
                portfolio.balance = cmd.newBalance;
            } else {
                return;
            }
            try { localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(portfolio)); } catch (e) { return; }
            setTimeout(function () { location.reload(); }, 300);
        }

        try { localStorage.setItem(BALANCE_CMD_APPLIED_KEY, requestedAt); } catch (e) { /* private mode */ }

        // Admin'e "uygulandı" bilgisini geri yaz — aynı komut kaydına
        // merge:true ile appliedAt eklenir, newBalance/reset/requestedAt
        // SİLİNMEZ (Firestore'un iç içe alan birleştirme davranışı, bu
        // dosyadaki diğer tüm push fonksiyonlarında da aynı şekilde
        // kullanılıyor).
        if (fsBalanceCommandsDoc && verifiedApp) {
            var ack = { commands: {} };
            ack.commands[String(verifiedApp.id)] = { appliedAt: new Date().toISOString(), appliedDeviceId: getDeviceId() };
            fsBalanceCommandsDoc.set(ack, { merge: true }).catch(function (e) {
                console.warn('Bakiye güncellemesi onaylanamadı (appliedAt yazılamadı).', e);
            });
        }
        // Admin'in canlı izleme ekranı (oplab_live_portfolio/fsPortfolioDoc)
        // yeni bakiyeyi/sıfırlanmış portföyü HEMEN görsün diye anında bir
        // özet daha gönderiyoruz. (6 Ağustos 2026 — genel entegrasyon
        // taraması) Burada önceden SADECE pushFullPortfolioToCloud()
        // çağrılıyordu — o fonksiyon SADECE oplab_user_portfolios'a (cihazlar
        // arası senkron belgesi) yazar, admin'in izlediği oplab_live_portfolio
        // belgesine HİÇ dokunmaz. Yani bu yorumun vaat ettiği "anında"
        // bilgi hiçbir zaman admin'e ulaşmıyordu — admin en fazla bir sonraki
        // periyodik 5 saniyelik pushPortfolioSnapshot() turunda görüyordu.
        // pushPortfolioSnapshot() zaten pushFullPortfolioToCloud()'u da
        // kendi içinde çağırıyor, o yüzden onu çağırmak HER İKİ belgeyi de
        // gerçekten anında günceller.
        pushPortfolioSnapshot();
    }

    // Doğrulanmış kimlik bilindiği anda (ve sadece bir kez) oplab_balance_commands
    // belgesini GERÇEK ZAMANLI dinlemeye başlar — hydratePortfolioFromCloudIfNeeded
    // gibi tek seferlik bir kontrol DEĞİL, çünkü admin bakiyeyi kullanıcı
    // sayfadayken HERHANGİ bir anda değiştirebilir.
    function listenForBalanceCommands() {
        if (!fsBalanceCommandsDoc || !verifiedApp || balanceListenerAttached) return;
        balanceListenerAttached = true;
        fsBalanceCommandsDoc.onSnapshot(function (doc) {
            if (!doc.exists || !verifiedApp) return;
            var data = doc.data() || {};
            var cmd = (data.commands || {})[String(verifiedApp.id)];
            if (!cmd || !cmd.requestedAt) return;
            if (cmd.reset !== true && typeof cmd.newBalance !== 'number') return;
            var lastApplied = null;
            try { lastApplied = localStorage.getItem(BALANCE_CMD_APPLIED_KEY); } catch (e) { /* private mode */ }
            if (lastApplied === cmd.requestedAt) return; // bu komut zaten uygulandı
            // (24 Eylül 2026) Komut BAŞKA bir cihazda zaten uygulanıp onaylandıysa
            // (appliedAt >= requestedAt) tekrar uygulama — sonucu zaten bulut
            // senkronuyla bu cihaza geliyor. Önceden, yarışmacı YENİ bir cihazda
            // ilk kez giriş yaptığında (o cihazda "uygulandı" kaydı olmadığı
            // için) günler önceki eski bir bakiye komutu yeniden uygulanıp
            // gerçek bakiyesinin üzerine yazılabiliyordu.
            if (cmd.appliedAt && String(cmd.appliedAt) >= String(cmd.requestedAt)) {
                try { localStorage.setItem(BALANCE_CMD_APPLIED_KEY, cmd.requestedAt); } catch (e) { /* private mode */ }
                return;
            }
            applyBalanceCommand(cmd, cmd.requestedAt);
        }, function (e) {
            console.warn('Bakiye komut kanalı dinlenemedi.', e);
        });
    }

    // (11 Ağustos 2026 — Madde #132: admin canlı izleme/iptal köprüsü)
    // listenForBalanceCommands() ile TAMAMEN AYNI desen, ayrı belge/anahtar
    // üzerinde: admin'in "Canlı İzleme" ekranından bir yarışmacının bekleyen
    // OCO emrini iptal etmesini veya açık pozisyonunu kapatmasını GERÇEK
    // ZAMANLI olarak uygular.
    function applyActionCommand(cmd, requestedAt) {
        var applied = false;
        if (cmd.type === 'cancelOco' && cmd.orderId) {
            if (window.TradingEngine && typeof window.TradingEngine.cancelOcoOrder === 'function') {
                applied = window.TradingEngine.cancelOcoOrder(cmd.orderId, 'ADMIN') === true;
            }
        } else if (cmd.type === 'closePosition' && cmd.symbol) {
            if (window.TradingEngine && typeof window.TradingEngine.closePosition === 'function') {
                window.TradingEngine.closePosition(cmd.symbol, 'ADMIN', cmd.market === 'VIOP' ? 'VIOP' : 'NORMAL');
                applied = true; // closePosition kendi içinde pozisyon yoksa/fiyat alınamıyorsa sessizce çıkar — burada "denendi" olarak işaretliyoruz, aşağıdaki anlık snapshot admin'e gerçek sonucu (pozisyon hâlâ duruyorsa) zaten gösterir.
            }
        }

        try { localStorage.setItem(ACTION_CMD_APPLIED_KEY, requestedAt); } catch (e) { /* private mode */ }

        // Admin'e "uygulandı" bilgisini geri yaz — applyBalanceCommand'daki
        // AYNI ack deseni (merge:true, requestedAt/type/orderId/symbol SİLİNMEZ).
        if (fsActionCommandsDoc && verifiedApp) {
            var ack = { commands: {} };
            ack.commands[String(verifiedApp.id)] = { appliedAt: new Date().toISOString(), applied: applied, appliedDeviceId: getDeviceId() };
            fsActionCommandsDoc.set(ack, { merge: true }).catch(function (e) {
                console.warn('Aksiyon komutu onaylanamadı (appliedAt yazılamadı).', e);
            });
        }
        // applyBalanceCommand'daki AYNI gerekçe: admin'in canlı izleme ekranı
        // (pozisyon/emir listesi) değişikliği ANINDA görsün, bir sonraki
        // periyodik 5 saniyelik turu beklemesin.
        pushPortfolioSnapshot();
    }

    function listenForActionCommands() {
        if (!fsActionCommandsDoc || !verifiedApp || actionListenerAttached) return;
        actionListenerAttached = true;
        fsActionCommandsDoc.onSnapshot(function (doc) {
            if (!doc.exists || !verifiedApp) return;
            var data = doc.data() || {};
            var cmd = (data.commands || {})[String(verifiedApp.id)];
            if (!cmd || !cmd.requestedAt || !cmd.type) return;
            var lastApplied = null;
            try { lastApplied = localStorage.getItem(ACTION_CMD_APPLIED_KEY); } catch (e) { /* private mode */ }
            if (lastApplied === cmd.requestedAt) return; // bu komut zaten uygulandı
            // (24 Eylül 2026) Başka bir cihazda zaten uygulanmış komutu tekrar
            // uygulama — bkz. listenForBalanceCommands'taki aynı not.
            if (cmd.appliedAt && String(cmd.appliedAt) >= String(cmd.requestedAt)) {
                try { localStorage.setItem(ACTION_CMD_APPLIED_KEY, cmd.requestedAt); } catch (e) { /* private mode */ }
                return;
            }
            applyActionCommand(cmd, cmd.requestedAt);
        }, function (e) {
            console.warn('Aksiyon komut kanalı dinlenemedi.', e);
        });
    }

    // (9 Ağustos 2026) window.FTC_TRADING_STATE.halted'i güncel tutar —
    // updateAccessGate() ile HER ZAMAN birlikte çağrılır (aynı lastSharedData
    // kaynağından besleniyor), ama TAM EKRAN kilit YERİNE tradingEngine.js'in
    // kendi qt-submit buton/uyarı mantığını tetikler.
    function updateTradingHaltState() {
        var st = computeTradingState(Date.now());
        window.FTC_TRADING_STATE.halted = st.halted;
        window.FTC_TRADING_STATE.message = st.message || '';
        window.FTC_TRADING_STATE.viopDisabled = st.viopDisabled;
        var season = seasonOn() ? lastSharedData.season : null;
        window.FTC_MARKET_HOLIDAYS = season && Array.isArray(season.holidays) ? season.holidays.slice() : [];
        window.FTC_MARKET_HALFDAYS = season && season.halfDays ? season.halfDays : {};
        renderAnnouncement();
    }

    /* ── (26 Eylül 2026) LİG: sezon planı, seans saatleri, kişisel kısıtlar ──
       Admin panelindeki "Sezon & Hafta Planı / Yarışma Günü / Yaptırım"
       sayfaları finteclub/shared_state'e yazar; burada yalnızca OKUNUR.
       Öncelik: genel durdurma → diskalifiye → inceleme (12.3) → 15 dk kuralı
       (15.3) → ihlal kısıtlaması (21.2) → eşitlik ek süresi (9.11) →
       yarışma/seans saatleri ve tatiller (7.2, 7.3). */
    var IST_OFF_MS = 3 * 3600000;
    function seasonOn() {
        var s = lastSharedData && lastSharedData.season;
        return !!(s && s.enabled && s.weeks && s.weeks.length);
    }
    function seasonWeek(no) {
        var s = lastSharedData && lastSharedData.season;
        if (!s || !s.weeks) return null;
        for (var i = 0; i < s.weeks.length; i++) if (Number(s.weeks[i].no) === Number(no)) return s.weeks[i];
        return null;
    }
    function istDateStr(ms) { return new Date(ms + IST_OFF_MS).toISOString().slice(0, 10); }
    function istMsAt(date, hm) { return Date.parse(date + 'T' + (hm || '00:00') + ':00+03:00'); }
    function fmtDm(d) { return d ? d.slice(8, 10) + '.' + d.slice(5, 7) : ''; }
    function fmtHm(ms) { return new Date(ms + IST_OFF_MS).toISOString().slice(11, 16); }
    function myAppRecord() {
        if (!verifiedApp || !lastSharedData) return null;
        var apps = lastSharedData.applications || [];
        for (var i = 0; i < apps.length; i++) if (String(apps[i].id) === String(verifiedApp.id)) return apps[i];
        return null;
    }
    function computeTradingState(now) {
        var d = lastSharedData;
        var out = { halted: false, message: '', viopDisabled: false };
        if (!d) return out;
        if (d.tradingHalted === true) { out.halted = true; out.message = 'Alım-satım şu anda yönetici tarafından geçici olarak durduruldu (kural 13.3). Portföyün korunuyor.'; return out; }
        if (!seasonOn()) return out;
        var s = d.season;
        var app = myAppRecord();
        if (!app) {
            // Giriş yapmış ama bu haftanın doğrulanmış yarışmacısı değil (ör. ileri bir haftaya onaylı):
            // kendi haftası başlamadan işlem yapıp avantaj sağlamasın (kural 4.1).
            if (currentAuthUser) { out.halted = true; out.message = 'İşlem yapma hakkı yalnızca bu haftanın onaylı yarışmacılarına açık. Yarışma haftan başladığında işlemlerin otomatik açılır.'; }
            return out;
        }
        var week = seasonWeek(d.currentCohortId);
        out.viopDisabled = !!(week && week.viop === false);
        if (app.disqualified) { out.halted = true; out.message = 'Yarışmadan diskalifiye edildin' + (app.dqReason ? ' (' + app.dqReason + ')' : '') + '. İşlem yapamazsın (kural 21).'; return out; }
        if (app.reviewHalt) { out.halted = true; out.message = 'Hesabın yarışma yönetimi incelemesi nedeniyle geçici olarak işleme kapatıldı (kural 12.3). İnceleme bitince otomatik açılır.'; return out; }
        if (app.lockedOut) { out.halted = true; out.message = 'Yarışma başladıktan sonraki ' + (s.lateMinutes || 15) + ' dakika içinde katılmadığın için bu haftanın yarışmasına alınmadın (kural 15.3). Bir hata olduğunu düşünüyorsan görevliye başvur.'; return out; }
        if (app.tradeLockUntil && now < app.tradeLockUntil) { out.halted = true; out.message = 'Kural ihlali nedeniyle ' + fmtHm(app.tradeLockUntil) + '\'e kadar işlem kısıtlaması uygulanıyor (kural 21.2).'; return out; }
        var tb = d.tieBreak;
        if (tb && !tb.done && now < tb.endsAt) {
            if ((tb.appIds || []).indexOf(String(app.id)) !== -1) return out; // eşitlik ek süresi — yalnızca eşitler işlem yapar
            out.halted = true; out.message = 'Yarışma sona erdi. Şu an yalnızca eşitlik bozma ek süresindeki yarışmacılar işlem yapabilir (kural 9.11).'; return out;
        }
        if (!d.competitionActive) { out.halted = true; out.message = 'Yarışma şu anda aktif değil — işlemler yarışma başladığında açılır.'; return out; }
        var today = istDateStr(now);
        var dow = new Date(today + 'T12:00:00Z').getUTCDay();
        if ((s.holidays || []).indexOf(today) !== -1) { out.halted = true; out.message = 'Bugün resmî tatil — Borsa İstanbul kapalı, işlem yapılamaz (kural 7.3). Portföyün bir sonraki işlem gününe devam eder.'; return out; }
        if (dow === 0 || dow === 6) { out.halted = true; out.message = 'Hafta sonu — işlemler bir sonraki işlem günü ' + (s.sessionStart || '10:00') + '\'da açılır (kural 7.2).'; return out; }
        if (week && week.start && week.end && (today < week.start || today > week.end)) { out.halted = true; out.message = 'Bugün yarışma haftanın işlem günü değil (Hafta ' + week.no + ': ' + fmtDm(week.start) + '–' + fmtDm(week.end) + ').'; return out; }
        var open = istMsAt(today, s.sessionStart || '10:00');
        var close = istMsAt(today, (s.halfDays || {})[today] || s.sessionEnd || '18:00');
        if (now < open || now >= close) { out.halted = true; out.message = 'Yarışma seansı dışında — işlemler yalnızca ' + (s.sessionStart || '10:00') + '–' + ((s.halfDays || {})[today] || s.sessionEnd || '18:00') + ' arasında yapılabilir (kural 7.2).'; return out; }
        return out;
    }
    // Duyuru bandı (admin → Yarışma Günü → OPLab Duyurusu)
    var ANNOUNCE_DISMISS_KEY = 'ftc_announce_dismissed_v1';
    function renderAnnouncement() {
        var a = lastSharedData && lastSharedData.oplabAnnouncement;
        var bar = byId('ftc-announce');
        var dismissed = null;
        try { dismissed = localStorage.getItem(ANNOUNCE_DISMISS_KEY); } catch (e) { /* private mode */ }
        if (!a || !a.text || String(a.at) === dismissed) { if (bar) bar.style.display = 'none'; return; }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'ftc-announce';
            bar.setAttribute('role', 'status');
            bar.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:99990;max-width:min(760px,calc(100vw - 24px));display:flex;align-items:center;gap:12px;padding:10px 14px 10px 16px;border-radius:10px;font:600 13.5px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);';
            bar.innerHTML = '<span data-ftc-ann-icon aria-hidden="true"></span><span data-ftc-ann-text style="flex:1;min-width:0;"></span><button type="button" aria-label="Kapat" style="background:none;border:none;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:.8;padding:0 2px;">×</button>';
            bar.querySelector('button').addEventListener('click', function () {
                try { localStorage.setItem(ANNOUNCE_DISMISS_KEY, bar.getAttribute('data-at') || ''); } catch (e) { /* private mode */ }
                bar.style.display = 'none';
            });
            document.body.appendChild(bar);
        }
        var warn = a.level === 'warn';
        bar.style.background = warn ? '#7c2d12' : '#1e3a8a';
        bar.style.color = '#fff';
        bar.style.border = '1px solid ' + (warn ? '#f97316' : '#60a5fa');
        bar.setAttribute('data-at', String(a.at));
        bar.querySelector('[data-ftc-ann-icon]').textContent = warn ? '⚠' : '📣';
        bar.querySelector('[data-ftc-ann-text]').textContent = 'FinteLig duyurusu: ' + a.text;
        bar.style.display = 'flex';
    }

    // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü)
    // finteclub/shared_state.oplabFintechTheme — admin.html'deki "Tema
    // (Kurumsal Mavi)" anahtarından yazılır. AYNI felsefe: Firebase'e hiç
    // ulaşılamazsa (lastSharedData null) varsayılan olarak KAPALI kabul
    // edilir — bir altyapı sorunu asla kullanıcıya istemediği bir görsel
    // deneyimi dayatmamalı. tradingEngine.js henüz init() edilmemişse
    // (script sırası/DOMContentLoaded zamanlaması) window.TradingEngine
    // tanımlı olsa bile setAdminForcedTheme henüz DOM'daki butonu bulamayabilir
    // — bu durumda applyTheme zaten sayfa yüklendiğinde tekrar çağrılıyor
    // olduğundan bir sonraki snapshot/tekrar denemede kendiliğinden düzelir.
    function updateForcedThemeState() {
        var forced = !!(lastSharedData && lastSharedData.oplabFintechTheme === true);
        if (window.TradingEngine && typeof window.TradingEngine.setAdminForcedTheme === 'function') {
            window.TradingEngine.setAdminForcedTheme(forced);
        }
    }

    function updateAccessGate() {
        var gate = byId('ftc-oplab-gate');
        if (!gate) return;
        // Veri yoksa (Firebase engelli/offline/henüz gelmedi) varsayılan
        // olarak AÇIK kabul edilir — asla gerçek kullanıcıları yanlışlıkla
        // kilitlemeyiz.
        var enabled = !lastSharedData || lastSharedData.oplabEnabled !== false;
        gate.classList.toggle('hidden', enabled);
    }

    function init() {
        var loginBtn = byId('ftc-login-btn');
        var logoutBtn = byId('ftc-logout-btn');
        var emailInput = byId('ftc-login-email');
        var pwInput = byId('ftc-login-password');
        var modalLoginBtn = byId('ftc-modal-login-btn');
        var modalEmailInput = byId('ftc-modal-login-email');
        var modalPwInput = byId('ftc-modal-login-password');
        var modalSkipBtn = byId('ftc-login-modal-skip');

        if (loginBtn) {
            loginBtn.addEventListener('click', function () {
                attemptLogin(emailInput ? emailInput.value.trim() : '', pwInput ? pwInput.value : '');
            });
        }
        if (pwInput) {
            pwInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); if (loginBtn) loginBtn.click(); }
            });
        }
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function () {
                if (ftcAuth) ftcAuth.signOut();
            });
        }
        // Açılış modalındaki giriş formu — profil panelindeki formla AYNI
        // attemptLogin()'i kullanır, sadece farklı input alanlarından okur.
        if (modalLoginBtn) {
            modalLoginBtn.addEventListener('click', function () {
                attemptLogin(modalEmailInput ? modalEmailInput.value.trim() : '', modalPwInput ? modalPwInput.value : '');
            });
        }
        if (modalPwInput) {
            modalPwInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); if (modalLoginBtn) modalLoginBtn.click(); }
            });
        }
        if (modalSkipBtn) {
            modalSkipBtn.addEventListener('click', function () {
                // Kalıcı bir "bir daha gösterme" bayrağı YOK — bu sadece o anki
                // görüntülemeyi kapatır, bir sonraki sayfa açılışında modal
                // yine görünür (kullanıcının "her açılışta göster" seçimi).
                hideLoginModal();
            });
        }

        if (FIREBASE_ENABLED && fsSharedDoc) {
            startRealtimeFeatures();
        } else {
            // Firebase yok/engelli — kilit varsayılan AÇIK, giriş pasif.
            // (22 Eylül 2026) startFtcBridgeRetryLoop() zaten başlatılmış
            // durumda (bkz. dosyanın en üstü) — başarılı olursa
            // startRealtimeFeatures() o zaman çağrılacak, aşağıdaki
            // "pasif" durum sadece o ana kadar geçerli.
            updateAccessGate();
            updateTradingHaltState();
            updateForcedThemeState();
            syncLoginUI();
        }
    }

    // (22 Eylül 2026 — Madde 5/6) init()'teki gerçek zamanlı kurulum bloğu
    // buraya taşındı ki hem normal (ilk denemede Firebase hazır) yoldan hem
    // de geç bir otomatik yeniden bağlanma başarılı olduğunda ÇAĞRILABİLSİN.
    // realtimeFeaturesStarted koruması, bir sayfa yüklemesinde bu kurulumun
    // yanlışlıkla İKİ KEZ çalışıp dinleyicileri/periyodik push'u ikiye
    // katlamasını önler.
    var realtimeFeaturesStarted = false;
    function startRealtimeFeatures() {
        if (realtimeFeaturesStarted || !FIREBASE_ENABLED || !fsSharedDoc) return;
        realtimeFeaturesStarted = true;
        fsSharedDoc.onSnapshot(function (doc) {
            lastSharedData = doc.exists ? doc.data() : null;
            updateAccessGate();
            updateTradingHaltState();
            updateForcedThemeState();
            checkApplicationStatus();
        }, function (err) {
            console.warn('FinTeClub verisi dinlenemedi.', err);
            updateAccessGate();
            updateTradingHaltState();
            updateForcedThemeState();
        });
        if (ftcAuth) {
            ftcAuth.onAuthStateChanged(function (user) {
                currentAuthUser = user;
                // (bkz. yukarıdaki FTC_AUTH_STATE tanımı) tradingEngine.js'in
                // bakiye kapısını gerçek zamanlı güncellemesi için.
                window.FTC_AUTH_STATE.available = true;
                window.FTC_AUTH_STATE.loggedIn = !!user;
                window.FTC_AUTH_STATE.email = user ? user.email : null;
                window.dispatchEvent(new CustomEvent('ftc-auth-changed', { detail: window.FTC_AUTH_STATE }));
                syncLoginUI();
                // (24 Eylül 2026) Grafik çizimleri senkronu — onay beklemeden,
                // giriş yapan her kullanıcının kendi belgesiyle çalışır.
                if (user) startDrawingsSync(); else stopDrawingsSync();

                // (Modal her açılışta gösterilir) Bu karar, checkApplicationStatus()
                // ÇAĞRILMADAN ÖNCE verilir — zaten giriş yapmış bir yarışmacı için
                // showModalWelcomeAndClose() modalın AÇIK olmasını bekler; sıralama
                // ters olsaydı (önce checkApplicationStatus, sonra modal açılışı)
                // eşleşme bulunsa bile modal henüz kapalı olduğundan "Hoşgeldin"
                // mesajı hiç görünmezdi. modalDecisionMade sadece AYNI sayfa
                // yüklemesinde onAuthStateChanged birden fazla tetiklenirse modalın
                // tekrar tekrar açılmasını önler — sayfa yeniden yüklendiğinde
                // (F5 / siteyi kapat-aç) her zaman sıfırdan başlar.
                if (!modalDecisionMade) {
                    modalDecisionMade = true;
                    showLoginModal();
                }

                if (user) {
                    // (24 Eylül 2026) Paylaşılan bilgisayar koruması — bkz.
                    // guardForeignLocalPortfolio. Onay kontrolünden ÖNCE.
                    guardForeignLocalPortfolio(user.email);
                    checkApplicationStatus();
                } else {
                    setBadgeVisible(false);
                    setVerifyStatus('', null);
                    verifiedApp = null;
                    stopPortfolioSync();
                }
            });
        }
        // Admin panelindeki Canlı İzleme / Kullanıcı Portföyleri sayfalarını
        // beslemek için: sadece doğrulanmış bir yarışmacı varsa ve sekme
        // görünürken periyodik olarak bakiye/özkaynak özetini gönder.
        // İlk gönderim birkaç saniye gecikmeli — tradingEngine.js'in fiyat
        // akışının (tickPrices) en az bir tur çalışmış olması için.
        // (24 Eylül 2026) Artık her turda koşulsuz yazma YOK — syncTick() yalnızca
        // bir şey değiştiyse (ya da açık pozisyonların fiyatı için belirli
        // aralıklarla) buluta çıkar. Bkz. pushFullPortfolioToCloud/pushLiveSnapshot.
        setInterval(syncTick, PORTFOLIO_PUSH_INTERVAL_MS);
        // (26 Eylül 2026) Seans açılış/kapanışı ve süreli kısıtlar veri değişmeden
        // de geçerliliğini yitirir — işlem durumunu periyodik olarak tazele.
        setInterval(updateTradingHaltState, 5000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // (6 Ağustos 2026 — çok cihazlı senkronizasyon düzeltmesi) tradingEngine.js'teki
    // debugGet*/debugIs* ailesiyle AYNI amaç: hiçbir üretim kodu bunlara
    // bağımlı değil, sadece Playwright testlerinde çok-cihazlı senkronizasyonu
    // (bulut<->yerel) gerçek zamanlayıcıları/reload'ı beklemeden doğrudan
    // tetikleyip doğrulamak için.
    window.__ftcBridgeDebug = {
        pushFullPortfolioToCloud: function (opts) { return pushFullPortfolioToCloud(opts); },
        startPortfolioSyncForCurrentUser: function () { return startPortfolioSyncForCurrentUser(); },
        stopPortfolioSync: function () { return stopPortfolioSync(); },
        pushLiveSnapshot: function (force) { return pushLiveSnapshot(force); },
        syncTick: function () { return syncTick(); },
        hashPortfolio: function (p) { return hashPortfolio(p); },
        isSyncReady: function () { return syncReady; },
        getLocalPortfolioOwner: function () { return getLocalPortfolioOwner(); },
        getKnownEpoch: function () { return getKnownEpoch(); },
        getDeviceId: function () { return getDeviceId(); },
        getVerifiedApp: function () { return verifiedApp; },
        applyBalanceCommand: function (cmd, requestedAt) { return applyBalanceCommand(cmd, requestedAt); },
        listenForBalanceCommands: function () { return listenForBalanceCommands(); },
        applyActionCommand: function (cmd, requestedAt) { return applyActionCommand(cmd, requestedAt); },
        listenForActionCommands: function () { return listenForActionCommands(); },
        pushPortfolioSnapshot: function () { return pushPortfolioSnapshot(); },
        computeLightPortfolioSnapshot: function () { return computeLightPortfolioSnapshot(); },
        getKnownCloudRev: function () { return getKnownCloudRev(); },
        setKnownCloudRev: function (n) { return setKnownCloudRev(n); },
        requestImmediateSyncNow: function () { if (immediateSyncTimer) { clearTimeout(immediateSyncTimer); immediateSyncTimer = null; } return pushFullPortfolioToCloud(); },
        // (9 Ağustos 2026 — çoklu cihaz test desteği) Gerçek girişte
        // verifiedApp, tam Firebase Authentication + FinTeClub başvuru
        // eşleştirme akışından SONRA dolar — bu, Playwright testlerinde
        // gerçek bir hesap/şifre/onay akışı kurmadan çok-cihazlı senkron
        // MANTIĞINI (push/hydrate/listen/transaction) doğrudan test etmeyi
        // imkansız kılardı. Diğer debug fonksiyonları gibi hiçbir üretim
        // kodu buna bağımlı değildir.
        setVerifiedAppForTest: function (app) { verifiedApp = app; },
        setAuthUserForTest: function (user) { currentAuthUser = user; },
        applyCloudPortfolioRecordIfNewer: function (record, opts) { return applyCloudPortfolioRecordIfNewer(record, opts); }
    };

    // (9 Ağustos 2026 — çift-satış kök neden düzeltmesi) Bu dosyanın
    // başındaki tasarım ilkesi ("tradingEngine.js'e hiç dokunmadan çalışır")
    // burada BİLEREK, tek ve dar bir noktada esnetildi: tradingEngine.js,
    // her portföy-değiştiren işlemden sonra (savePortfolio() içinden) bu
    // objeyi (varsa) çağırıp anlık bulut senkronizasyonu TALEP EDER. Bu,
    // önceki periyodik-SADECE (5 saniyelik) senkronun bıraktığı, iki
    // cihazın aynı pozisyonu art arda satabilmesine izin veren boşluğu
    // kapatmak için gerekliydi — bkz. requestImmediateSync() yorumu.
    // window.FinteClubBridge yoksa (bu dosya hiç yüklenemediyse / Firebase
    // engelliyse) tradingEngine.js'teki çağrı güvenle no-op olur, hiçbir
    // üretim davranışı buna bağımlı değildir.
    window.FinteClubBridge = {
        requestImmediateSync: function () { return requestImmediateSync(); },
        // (22 Eylül 2026 — Madde 6) tradingEngine.js'in dışa aktarma
        // öncesinde çağırdığı tazelik kontrolü — bkz. checkForNewerCloudRecordSync
        // yorumu. Her zaman bir Promise<{hasNewer:boolean}> döner, asla reddetmez.
        checkForNewerCloudRecordSync: function () { return checkForNewerCloudRecordSync(); }
    };
})();
