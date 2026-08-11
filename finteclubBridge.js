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

    var FIREBASE_ENABLED = typeof firebase !== 'undefined' &&
        FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';

    var fsSharedDoc = null;
    var fsActivityDoc = null;
    var fsPortfolioDoc = null;
    var fsUserPortfoliosDoc = null;
    var fsBalanceCommandsDoc = null;
    var ftcAuth = null;

    if (FIREBASE_ENABLED) {
        try {
            // Ayrı isimli bir app instance kullanıyoruz ('ftcBridge') — ileride
            // OPLab kendi ana Firebase kurulumunu eklerse çakışma olmasın diye.
            var ftcApp = firebase.initializeApp(FIREBASE_CONFIG, 'ftcBridge');
            var fs = ftcApp.firestore();
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
            // (Doğrulama sağlamlaştırması, 3. tur) Aynı 'ftcBridge' app instance'ı
            // üzerinden Authentication — FinTeClub'ın başvuru formunda oluşturulan
            // hesaplarla AYNI Firebase projesi/kullanıcı havuzuna bakıyor.
            ftcAuth = ftcApp.auth();
        } catch (e) {
            console.warn('FinTeClub bağlantısı kurulamadı, doğrulama devre dışı bırakıldı.', e);
            FIREBASE_ENABLED = false;
        }
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
    // (8 Ağustos 2026 — "admin panelinde anlık/canlı veri istiyorum") önceden
    // 20000ms'di; admin panelinin gerçekten "anlık" hissettirmesi için 5
    // saniyeye düşürüldü. Firestore yazma maliyeti düşük (tek belge, merge)
    // ve yarışmacı sayısı sınırlı olduğundan bu aralık güvenle desteklenir.
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
    function getKnownCloudRev() {
        try {
            var raw = localStorage.getItem(PORTFOLIO_KNOWN_REV_KEY);
            var n = raw === null ? 0 : parseInt(raw, 10);
            return isFinite(n) && n >= 0 ? n : 0;
        } catch (e) { return 0; }
    }
    function setKnownCloudRev(rev) {
        try { localStorage.setItem(PORTFOLIO_KNOWN_REV_KEY, String(rev)); } catch (e) { /* private mode */ }
    }
    // (8 Ağustos 2026 — admin panelinden bakiye ayarlama) bu cihaza en son
    // UYGULANAN bakiye komutunun requestedAt zaman damgası — aynı komutu
    // tekrar tekrar uygulayıp durmadan (reload sonrası onSnapshot yeniden
    // tetiklenebilir) emin olmak için.
    var BALANCE_CMD_APPLIED_KEY = 'optipulselab_balance_cmd_applied_v1';

    var lastSharedData = null;
    var loggedActivityForId = null; // aynı ziyarette Firestore'a tekrar tekrar yazmamak için
    var verifiedApp = null; // { id, name, email } — doğrulama başarılı olduğunda dolar, portföy push'u bunu kullanır
    var currentAuthUser = null; // Firebase Authentication kullanıcısı (giriş yapılmışsa)
    var hydrationCheckedThisSession = false; // bulut->yerel kontrolü sayfa yüklemesi başına SADECE BİR KEZ yapılır
    var balanceListenerAttached = false; // oplab_balance_commands dinleyicisi sadece bir kez bağlanır
    var portfolioListenerAttached = false; // oplab_user_portfolios dinleyicisi (çok cihazlı canlı senkron) sadece bir kez bağlanır
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
        if (match) {
            setBadgeVisible(true);
            setVerifyStatus('✓ Giriş başarılı — ' + match.name, 'ok');
            applyVerifiedProfile(match.name);
            logActivity(match);
            verifiedApp = { id: match.id, name: match.name, email: match.email };
            showModalWelcomeAndClose(match.name);
            // (6 Ağustos 2026 — çok cihazlı senkronizasyon düzeltmesi) Bu
            // kimlik için bulutta bu cihazdan FARKLI/daha güncel bir portföy
            // var mı diye SADECE bu sayfa yüklemesinde bir kez kontrol et —
            // checkApplicationStatus() birden çok tetiklenebildiği için
            // (bkz. hydrationCheckedThisSession tanımı) tekrar tekrar kontrol
            // edip gereksiz yenileme döngüsüne girmeyelim.
            if (!hydrationCheckedThisSession) {
                hydrationCheckedThisSession = true;
                hydratePortfolioFromCloudIfNeeded();
            }
            listenForBalanceCommands();
            // (9 Ağustos 2026 — "kökten çöz") tek seferlik hydratePortfolioFromCloudIfNeeded()
            // ile YARIŞ HALİNDE değil: ikisi de aynı applyCloudPortfolioRecordIfNewer()
            // guard'larını (kendi deviceId'si / zaten uygulanmış updatedAt) paylaşıyor,
            // bu yüzden aynı anda tetiklenseler bile en fazla BİR kez uygulanır.
            listenForPortfolioSync();
        } else {
            setBadgeVisible(false);
            setVerifyStatus(pastMatch
                ? 'Yarışma haftan sona erdi — bu hesap artık geçmiş yarışmacı statüsünde, canlı senkron/izlemeye dahil değil.'
                : 'Hesabına giriş yapıldı ama bu e-postayla onaylı bir FinteLig başvurusu yok (ya henüz onaylanmadı ya da hiç başvuru yapılmadı).', 'error');
            verifiedApp = null;
        }
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
        var equity = portfolio.balance + usedMargin + openPnl;

        // (8 Ağustos 2026 — "admin panelinde herşeyi görebilmem") admin artık
        // sadece açık pozisyonları değil, bekleyen (OCO) emirleri ve en son
        // kapanmış/açılmış işlemleri de görebiliyor — belge boyutu için her
        // ikisi de son 10 kayıtla sınırlı (asıl/tam veri zaten localStorage'da
        // ve pushFullPortfolioToCloud() ile oplab_user_portfolios'ta duruyor,
        // burası SADECE admin'in canlı izleme ekranı için özet).
        var pendingOut = (portfolio.pendingOrders || []).slice(0, 10).map(function (o) {
            return { symbol: o.symbol, qty: o.qty, upper: o.upper, lower: o.lower, market: 'NORMAL' };
        }).concat((portfolio.viopPendingOrders || []).slice(0, 10).map(function (o) {
            return { symbol: o.symbol, qty: o.qty, upper: o.upper, lower: o.lower, market: 'VIOP' };
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

    function pushPortfolioSnapshot() {
        // (8 Ağustos 2026 — "admin panelinde anlık/canlı veri istiyorum") daha
        // önce sekme arka plandaysa (document.hidden) push atlanıyordu — bu,
        // bir yarışmacı sekmeyi arka planda bıraktığında admin ekranının
        // "donması" ve tekrar öne gelince aniden zıplaması gibi görünüyordu.
        // Artık sekme arka planda da olsa periyodik push devam ediyor.
        if (!fsPortfolioDoc || !verifiedApp) return;
        var snap = computeLightPortfolioSnapshot();
        if (!snap) return;
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
            console.warn('OPLab canlı portföy verisi Firestore\'a yazılamadı.', e);
        });

        // (6 Ağustos 2026 — çok cihazlı senkronizasyon düzeltmesi) Yukarısı
        // SADECE admin'in izlemesi için özet gönderiyor — asıl kalıcı/gerçek
        // portföyü (bakiye/pozisyonlar/geçmiş) de AYNI anda kimlik bazlı
        // bulut kaydına yazıyoruz, böylece başka bir cihaz bunu okuyup
        // kendine uygulayabilir.
        pushFullPortfolioToCloud();
    }

    // (9 Ağustos 2026 — çift-satış kök neden düzeltmesi) ÖNCEDEN portföy
    // sadece periyodik 5 saniyelik pushPortfolioSnapshot() turunda buluta
    // gidiyordu — bir işlemden hemen sonra buluta gidene kadar geçen bu
    // (en kötü ihtimalle ~5 saniyelik) boşluk, başka bir cihazın AYNI
    // pozisyonu "hâlâ açık" sanıp tekrar satabilmesine izin veren asıl
    // pencereydi. requestImmediateSync() bu boşluğu ~400ms'ye indirir:
    // tradingEngine.js her portföy-değiştiren işlemden (savePortfolio())
    // sonra bunu çağırır. Kısa bir debounce (aynı anda/art arda birden
    // fazla tetiklenirse tek push'a birleştirmek için) dışında hemen
    // pushFullPortfolioToCloud()'u tetikler — o da rev-korumalı TRANSACTION
    // sayesinde, hangi cihaz gerçekten en güncel veriye dayanıyorsa SADECE
    // onun yazmasını garanti eder (bkz. pushFullPortfolioToCloud). Yani bu
    // fonksiyon çakışma PENCERESİNİ küçültür, gerçek güvenceyi ise
    // transaction'daki rev kontrolü sağlar — pencere hiç kapanmasa bile
    // (ör. çok kötü bir bağlantıda) çift-satışın parası kalıcı olarak
    // bakiyede KALAMAZ.
    var immediateSyncTimer = null;
    function requestImmediateSync() {
        if (!fsUserPortfoliosDoc || !verifiedApp) return;
        if (immediateSyncTimer) clearTimeout(immediateSyncTimer);
        immediateSyncTimer = setTimeout(function () {
            immediateSyncTimer = null;
            pushFullPortfolioToCloud();
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

    // (6 Ağustos 2026 — çok cihazlı senkronizasyon düzeltmesi) tradingEngine.js'in
    // localStorage'da tuttuğu TAM portföyü (bakiye/pozisyonlar/geçmiş —
    // computeLightPortfolioSnapshot'ın admin için ürettiği hafif özetten
    // FARKLI olarak burada hiçbir alan atlanmıyor/kısaltılmıyor, tradingEngine.js
    // sayfa yeniden yüklendiğinde bunu doğrudan geri yükleyebilsin) kimlik
    // bazlı ayrı bir belgeye yazar. Bu, "bir yarışmacı telefonda işlem
    // yapıyor ama PC'de açınca bakiyesi 100.000'e sıfırlanmış görünüyor"
    // hatasının kök çözümü — artık TEK doğru kaynak bu belge, localStorage
    // sadece hızlı yerel önbellek.
    // (9 Ağustos 2026 — "aynı hesabı 2-3 cihazdan art arda satabiliyorum"
    // kök neden düzeltmesi) ARTIK koşulsuz bir .set() DEĞİL — bkz.
    // PORTFOLIO_KNOWN_REV_KEY yorumundaki tam açıklama. Bu fonksiyon bir
    // Firestore TRANSACTION'ı içinde çalışır: bulutun O ANKİ gerçek rev'i,
    // bu cihazın bildiğinden (getKnownCloudRev()) daha yeniyse VE bu yeni
    // rev'i yazan cihaz kendisi değilse, bu cihazın kendi (bayat veriye
    // dayanan) sürümü buluta YAZILMAZ — çakışma tespit edilir, bu cihaz
    // buluttaki GERÇEK/güncel portföyü benimseyip kendini düzeltir. Rev
    // eşleşiyorsa (araya başka bir cihaz girmemiş), normal şekilde yazılır
    // ve rev bir artırılır.
    function pushFullPortfolioToCloud() {
        if (!fsUserPortfoliosDoc || !verifiedApp) return Promise.resolve();
        var portfolio = readLocalPortfolio();
        if (!portfolio || typeof portfolio.balance !== 'number') return Promise.resolve();
        var userId = String(verifiedApp.id);
        var deviceId = getDeviceId();
        var knownRev = getKnownCloudRev();
        var db = fsUserPortfoliosDoc.firestore;

        return db.runTransaction(function (tx) {
            return tx.get(fsUserPortfoliosDoc).then(function (doc) {
                var data = doc.exists ? (doc.data() || {}) : {};
                var users = data.users || {};
                var record = users[userId];
                var cloudRev = (record && typeof record.rev === 'number') ? record.rev : 0;

                // ÇAKIŞMA: bulutta bizim bildiğimizden DAHA YENİ bir sürüm
                // var VE bunu yazan biz değiliz — bu cihazın üzerine işlem
                // kurduğu taban veri ZATEN BAYAT (arada başka bir cihaz
                // işlem yapmış). Kendi sürümümüzü buluta yazıp doğru
                // veriyi ASLA ezmeyelim.
                if (record && cloudRev > knownRev && record.deviceId !== deviceId) {
                    return { conflict: true, record: record, cloudRev: cloudRev };
                }

                var nowIso = new Date().toISOString();
                var newRecord = {
                    name: verifiedApp.name || '',
                    email: verifiedApp.email || '',
                    portfolio: portfolio,
                    rev: cloudRev + 1,
                    deviceId: deviceId,
                    updatedAt: nowIso
                };
                var newUsers = {};
                newUsers[userId] = newRecord;
                // (9 Ağustos 2026 — merge:true'nun kendi açtığı "hayalet
                // pozisyon" düzeltmesi) DİKKAT: burada DÜZ {merge:true}
                // KULLANILAMAZ. Firestore'da merge:true, İÇ İÇE map
                // alanlarını (ör. portfolio.positions — sembol->pozisyon
                // sözlüğü) da REKURSİF olarak birleştirir; yani bir
                // pozisyon kapatılıp positions {} olsa bile, buluttaki
                // ESKİ kayıttan kalan sembol anahtarı SİLİNMEZ (merge sadece
                // EKLER/ÜZERİNE YAZAR, patch'te bulunmayan bir anahtarı asla
                // silmez) — kapatılmış bir pozisyon başka bir cihaza
                // senkronize olunca hayalet şekilde YENİDEN AÇIK görünür.
                // mergeFields ile 'users.<id>' yolunun TAMAMINI (bir bütün
                // olarak) DEĞİŞTİRİYORUZ — bu yolun altındaki her şey (rev,
                // portfolio.positions dahil) tam olarak newRecord'daki
                // değerle değişir, rekursif birleştirme YOK; aynı belgedeki
                // DİĞER kullanıcıların (users.<başkaId>) kayıtlarına ise hiç
                // dokunulmaz (mergeFields'ın asıl amacı zaten bu).
                tx.set(fsUserPortfoliosDoc, { users: newUsers }, { mergeFields: ['users.' + userId] });
                return { conflict: false, rev: cloudRev + 1, updatedAt: nowIso };
            });
        }).then(function (res) {
            if (res.conflict) {
                console.warn('Portföy push çakışması: buluttaki sürüm daha yeni, yerel işlem geri alınıp bulut benimseniyor.');
                applyCloudPortfolioRecordIfNewer(res.record, { force: true, reasonConflict: true });
                return { ok: false, conflict: true };
            }
            try {
                setKnownCloudRev(res.rev);
                localStorage.setItem(PORTFOLIO_CLOUD_SYNC_KEY, res.updatedAt);
            } catch (e) { /* private mode */ }
            return { ok: true };
        }).catch(function (e) {
            console.warn('Portföy bulut senkronizasyonu başarısız (oplab_user_portfolios).', e);
            return { ok: false, error: e };
        });
    }

    // (6 Ağustos 2026 sürümü: SADECE sayfa yüklemesinde bir kez .get() ile
    // kontrol ediyordu. 9 Ağustos 2026 — "kökten çöz, telefon/PC/tablet
    // nerede girilirse aynı bakiye/durum olsun" düzeltmesi: bu, "PC sekmesi
    // zaten açıkken telefonda işlem yapılırsa PC hiç haberdar olmuyor,
    // ancak sayfa YENİDEN yüklenirse düzeliyordu" boşluğunu bırakıyordu —
    // asıl şikayetin kökü buydu. Ortak uygulama mantığı artık
    // applyCloudPortfolioRecordIfNewer()'a taşındı; hem bu tek-seferlik
    // ilk kontrol hem de aşağıdaki GERÇEK ZAMANLI listenForPortfolioSync()
    // aynı fonksiyonu kullanıyor.)
    //
    // Bulutta bu kimlik için gerçekten daha güncel/farklı bir portföy var mı
    // diye bakar. Varsa VE bu kaydı gönderen cihaz bu cihazın kendisi
    // DEĞİLSE, yerel localStorage'ı bulut sürümüyle değiştirip sayfayı
    // yeniler — tradingEngine.js bir sonraki init()'inde doğru/gerçek
    // portföyü (bakiye dahil) yükler. Bulutta hiç kayıt yoksa (bu kullanıcı
    // için hiçbir cihazda henüz push olmadı), yereldekini bulut için
    // başlangıç kaydı olarak gönderir.
    //
    // (9 Ağustos 2026 — çift-satış kök neden düzeltmesi) ÖNCEDEN "hangi
    // cihaz en son push ederse o kazanır" diye BİLİNEN BİR SINIR olarak
    // belgelenmişti — bu artık DOĞRU DEĞİL: karar artık son yazan değil,
    // artan tam sayı rev'e (bkz. PORTFOLIO_KNOWN_REV_KEY) dayanıyor ve
    // pushFullPortfolioToCloud() içindeki Firestore TRANSACTION'ı iki
    // cihazın TAM OLARAK AYNI ANDA push atmasını bile güvenle çözüyor —
    // sadece rev'i doğru bilen (yani en güncel veriye dayanan) taraf
    // kazanıyor, ötekinin (bayat veriye dayanan, çift-satış içerebilecek)
    // sürümü asla kalıcı olarak buluta yazılmıyor.
    function applyCloudPortfolioRecordIfNewer(record, opts) {
        if (!record || !record.portfolio) return false;
        opts = opts || {};

        // Bulut kaydı bu cihazın kendi son gönderdiği kayıtsa yapacak
        // bir şey yok (force:true — push çakışması yolundan geliyorsa bu
        // kontrolü atla, çünkü orada zaten "bu bizim kendi kaydımız
        // DEĞİL" doğrulanmış oldu).
        if (!opts.force && record.deviceId === getDeviceId()) return false;

        var cloudRev = typeof record.rev === 'number' ? record.rev : 0;
        var knownRev = getKnownCloudRev();
        // Zaten bu sürümü (ya da daha yenisini) biliyorsak tekrar
        // uygulama/reload döngüsüne girme.
        if (!opts.force && cloudRev <= knownRev) return false;

        // (10 Ağustos 2026 — "SL/TP birden kayboldu, sanki sistem offline/
        // online oldu" kök neden düzeltmesi) Bu cihazda HENÜZ buluta
        // gönderilmemiş, requestImmediateSync()'in 400ms debounce'unda
        // bekleyen yerel bir değişiklik varsa (ör. az önce eklenen bir
        // Stop-Loss), o değişikliği hiç göz önünde bulundurmadan aşağıdaki
        // location.reload() yerel state'i SESSİZCE SİLERDİ — kullanıcıya
        // sanki bağlantı bir anlığına "offline" olup gelmiş gibi görünen
        // (sayfa birden yenilenip eski/eksik bir portföyle geri gelen) tam
        // olarak bu davranıştı. Kök çözüm: reload'a gitmeden ÖNCE bekleyen
        // push'u hemen (debounce'u atlayarak) gönderiyoruz — pushFullPortfolioToCloud()
        // zaten rev-korumalı bir TRANSACTION olduğundan, yerel değişiklik
        // gerçekten güncelse (ki genelde öyledir, kullanıcı SADECE ŞİMDİ
        // işlem yaptı) kazanır ve bu gelen 'record' otomatik olarak bayat
        // sayılır; gerçekten çakışma varsa (başka bir cihaz/hesap gerçekten
        // daha yeniyse) transaction'ın kendi conflict yolu zaten doğru
        // kaydı force:true ile uygulayıp reload'u kendisi tetikler — bu
        // çağrının burada devam edip ERKEN/eksik bir reload yapmasına hiç
        // gerek kalmaz.
        if (!opts.force && immediateSyncTimer) {
            clearTimeout(immediateSyncTimer);
            immediateSyncTimer = null;
            pushFullPortfolioToCloud();
            return false;
        }

        try {
            localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(record.portfolio));
            setKnownCloudRev(cloudRev);
            if (record.updatedAt) localStorage.setItem(PORTFOLIO_CLOUD_SYNC_KEY, record.updatedAt);
        } catch (e) { return false; /* private mode / quota — güvenle vazgeç, yerelde kalsın */ }

        var msg = opts.reasonConflict
            ? 'Bu cihazda yapılan son işlem başka bir cihazdaki daha güncel bir işlemle çakıştı ve geri alındı. Güncel/doğru portföyünüz yükleniyor...'
            : 'Portföyün başka bir cihazdan senkronize edildi, sayfa yenileniyor...';
        if (window.TradingEngine && typeof window.TradingEngine.showToast === 'function') {
            window.TradingEngine.showToast(msg);
        }
        setTimeout(function () { location.reload(); }, 900);
        return true;
    }

    function hydratePortfolioFromCloudIfNeeded() {
        if (!fsUserPortfoliosDoc || !verifiedApp) return;
        return fsUserPortfoliosDoc.get().then(function (doc) {
            if (!doc.exists) { return pushFullPortfolioToCloud(); }
            var data = doc.data() || {};
            var record = (data.users || {})[String(verifiedApp.id)];
            if (!record || !record.portfolio) { return pushFullPortfolioToCloud(); }
            var cloudRev = typeof record.rev === 'number' ? record.rev : 0;
            if (record.deviceId === getDeviceId()) {
                // Bu, bu cihazın kendi son gönderdiği kayıt — yerel veriye
                // dokunma, sadece bilinen rev'i hizala ki bir sonraki push
                // doğru taban üzerinden çakışma kontrolü yapabilsin.
                setKnownCloudRev(cloudRev);
                return;
            }
            applyCloudPortfolioRecordIfNewer(record);
        }).catch(function (e) {
            console.warn('Bulut portföy verisi okunamadı, yerel veriyle devam ediliyor.', e);
        });
    }

    // (9 Ağustos 2026 — "kökten çöz") hydratePortfolioFromCloudIfNeeded()
    // sadece sayfa AÇILIRKEN bir kez bakıyordu. Bu, tabletini/PC'ni sabah
    // açıp sekmeyi kapatmadan bütün gün öylece bırakan, arada telefondan
    // işlem yapan biri için hiç yeterli değildi: PC sekmesi hiçbir zaman
    // yeniden yüklenmediği için telefonun yaptığı değişiklikleri asla
    // görmüyordu. Bu fonksiyon, kimlik doğrulandığı anda (bir kez) bulut
    // kaydını GERÇEK ZAMANLI dinlemeye başlar — artık hangi cihaz ne zaman
    // trade yapsa, DİĞER açık cihaz(lar) sayfa yenilenmeden, birkaç saniye
    // içinde otomatik yakalar ve kendini günceller (bkz. applyCloudPortfolioRecordIfNewer).
    function listenForPortfolioSync() {
        if (!fsUserPortfoliosDoc || !verifiedApp || portfolioListenerAttached) return;
        portfolioListenerAttached = true;
        fsUserPortfoliosDoc.onSnapshot(function (doc) {
            if (!doc.exists || !verifiedApp) return;
            var data = doc.data() || {};
            var record = (data.users || {})[String(verifiedApp.id)];
            if (record) applyCloudPortfolioRecordIfNewer(record);
        }, function (e) {
            console.warn('Portföy senkronizasyon kanalı dinlenemedi.', e);
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
            applyBalanceCommand(cmd, cmd.requestedAt);
        }, function (e) {
            console.warn('Bakiye komut kanalı dinlenemedi.', e);
        });
    }

    // (9 Ağustos 2026) window.FTC_TRADING_STATE.halted'i güncel tutar —
    // updateAccessGate() ile HER ZAMAN birlikte çağrılır (aynı lastSharedData
    // kaynağından besleniyor), ama TAM EKRAN kilit YERİNE tradingEngine.js'in
    // kendi qt-submit buton/uyarı mantığını tetikler.
    function updateTradingHaltState() {
        window.FTC_TRADING_STATE.halted = !!(lastSharedData && lastSharedData.tradingHalted === true);
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
                    window.FTC_AUTH_STATE.loggedIn = !!user;
                    window.FTC_AUTH_STATE.email = user ? user.email : null;
                    window.dispatchEvent(new CustomEvent('ftc-auth-changed', { detail: window.FTC_AUTH_STATE }));
                    syncLoginUI();

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
                        checkApplicationStatus();
                    } else {
                        setBadgeVisible(false);
                        setVerifyStatus('', null);
                        verifiedApp = null;
                    }
                });
            }
            // Admin panelindeki Canlı İzleme / Kullanıcı Portföyleri sayfalarını
            // beslemek için: sadece doğrulanmış bir yarışmacı varsa ve sekme
            // görünürken periyodik olarak bakiye/özkaynak özetini gönder.
            // İlk gönderim birkaç saniye gecikmeli — tradingEngine.js'in fiyat
            // akışının (tickPrices) en az bir tur çalışmış olması için.
            setTimeout(pushPortfolioSnapshot, 5000);
            setInterval(pushPortfolioSnapshot, PORTFOLIO_PUSH_INTERVAL_MS);
        } else {
            // Firebase yok/engelli — kilit varsayılan AÇIK, giriş pasif.
            updateAccessGate();
            updateTradingHaltState();
            updateForcedThemeState();
            syncLoginUI();
        }
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
        pushFullPortfolioToCloud: function () { return pushFullPortfolioToCloud(); },
        hydratePortfolioFromCloudIfNeeded: function () { return hydratePortfolioFromCloudIfNeeded(); },
        getDeviceId: function () { return getDeviceId(); },
        getVerifiedApp: function () { return verifiedApp; },
        applyBalanceCommand: function (cmd, requestedAt) { return applyBalanceCommand(cmd, requestedAt); },
        listenForBalanceCommands: function () { return listenForBalanceCommands(); },
        pushPortfolioSnapshot: function () { return pushPortfolioSnapshot(); },
        computeLightPortfolioSnapshot: function () { return computeLightPortfolioSnapshot(); },
        listenForPortfolioSync: function () { return listenForPortfolioSync(); },
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
        requestImmediateSync: function () { return requestImmediateSync(); }
    };
})();
