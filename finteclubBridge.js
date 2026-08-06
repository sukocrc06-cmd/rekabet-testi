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
   tamamen ek/bağımsız olarak çalışacak şekilde tasarlandı; tek paylaştığı
   şey, tradingEngine.js'in zaten okuduğu 'optipulselab_profile_name_v1'
   localStorage anahtarıdır (bkz. applyVerifiedProfile()). Bu giriş ekranı
   sadece "FinteLig Yarışmacısı" rozetini/takibini almak isteyenler için —
   genel ziyaretçiler OPLab'ı hiç giriş yapmadan, olduğu gibi kullanabilir.
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
        var match = apps.filter(function (a) {
            return (a.email || '').toLowerCase() === email && a.status === 'onayli';
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
            setVerifyStatus('Hesabına giriş yapıldı ama bu e-postayla onaylı bir FinteLig başvurusu yok (ya henüz onaylanmadı ya da hiç başvuru yapılmadı).', 'error');
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
    function pushFullPortfolioToCloud() {
        if (!fsUserPortfoliosDoc || !verifiedApp) return;
        var portfolio = readLocalPortfolio();
        if (!portfolio || typeof portfolio.balance !== 'number') return;
        var nowIso = new Date().toISOString();
        var payload = { users: {} };
        payload.users[String(verifiedApp.id)] = {
            name: verifiedApp.name || '',
            email: verifiedApp.email || '',
            portfolio: portfolio,
            deviceId: getDeviceId(),
            updatedAt: nowIso
        };
        return fsUserPortfoliosDoc.set(payload, { merge: true }).then(function () {
            try { localStorage.setItem(PORTFOLIO_CLOUD_SYNC_KEY, nowIso); } catch (e) { /* private mode */ }
        }).catch(function (e) {
            console.warn('Portföy bulut senkronizasyonu başarısız (oplab_user_portfolios).', e);
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
    // BİLİNEN SINIR: aynı hesap AYNI ANDA iki cihazda açıksa (örn. hem
    // telefon hem PC canlı işlem yapıyor), gerçek zamanlı çakışma çözümü
    // yapılmıyor — hangi cihaz en son push ederse o kazanır. Yarışma
    // sırasında her yarışmacının TEK cihazdan aktif işlem yapması önerilir;
    // bu düzeltme "başka bir cihaza geçince görünmeyen/eski veri" sorununu
    // (artık sayfa yenilemeden de) çözüyor — iki cihazın AYNI ANDA aktif
    // trade yapmasını değil (bu, çok daha büyük bir çakışma-çözümleme
    // projesi gerektirir).
    function applyCloudPortfolioRecordIfNewer(record) {
        if (!record || !record.portfolio) return false;

        // Bulut kaydı bu cihazın kendi son gönderdiği kayıtsa yapacak
        // bir şey yok.
        if (record.deviceId === getDeviceId()) return false;

        var lastApplied = null;
        try { lastApplied = localStorage.getItem(PORTFOLIO_CLOUD_SYNC_KEY); } catch (e) { /* private mode */ }
        if (lastApplied && record.updatedAt && lastApplied === record.updatedAt) return false;

        try {
            localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(record.portfolio));
            if (record.updatedAt) localStorage.setItem(PORTFOLIO_CLOUD_SYNC_KEY, record.updatedAt);
        } catch (e) { return false; /* private mode / quota — güvenle vazgeç, yerelde kalsın */ }

        if (window.TradingEngine && typeof window.TradingEngine.showToast === 'function') {
            window.TradingEngine.showToast('Portföyün başka bir cihazdan senkronize edildi, sayfa yenileniyor...');
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
        // Admin'in canlı izleme ekranı yeni bakiyeyi/sıfırlanmış portföyü
        // HEMEN görsün diye anında bir özet daha gönderiyoruz.
        pushFullPortfolioToCloud();
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
                checkApplicationStatus();
            }, function (err) {
                console.warn('FinTeClub verisi dinlenemedi.', err);
                updateAccessGate();
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
        listenForPortfolioSync: function () { return listenForPortfolioSync(); }
    };
})();
