/* ════════════════════════════════════════════════════════════════════
   OptiPulseLab × FinTeClub Entegrasyonu — "FinteLig Yarışmacısı" Doğrulama
   ════════════════════════════════════════════════════════════════════
   Bu dosya, FinTeClub tarafında admin onayı almış FinteLig yarışmacılarının
   OPLab'a geldiklerinde profil panelinde "✓ FinteLig Yarışmacısı" rozetiyle
   görünmesini sağlar. Doğrulama, FinTeClub'ın (index.html/admin.html) zaten
   kullandığı AYNI Firebase Firestore veritabanına (finteclub/shared_state
   belgesi) karşı yapılır — sahte bir e-posta veya URL parametresiyle rozet
   kazanılamaz, admin panelinde gerçekten "onaylı" (status: 'onayli') bir
   başvuru olması gerekir.

   Nasıl tetiklenir:
   1) FinTeClub'dan "OPLab'a Git" ile gelindiyse, e-posta URL'ye otomatik
      eklenir (?ftc_email=...) ve doğrulama sayfa açılır açılmaz başlar.
   2) Doğrudan/bookmark ile gelindiyse, kullanıcı profil panelindeki
      "FinteLig Doğrulama — E-posta" alanına kendi e-postasını yazarak
      kendi kendine doğrulayabilir.
   Her iki yol da AYNI attemptVerification() fonksiyonundan geçer.

   Ayrıca admin FinTeClub panelinden OPLab erişimini kapatırsa (oplabEnabled:
   false), bu dosya tam ekran bir "Platform Geçici Olarak Kapalı" kilidi
   gösterir. Firebase'e hiç ulaşılamıyorsa (CDN engelli/offline) kilit
   VARSAYILAN OLARAK AÇIK kabul edilir — bağlantı sorunu asla gerçek
   kullanıcıları yanlışlıkla kilitlemez.

   Bu dosya, mevcut dev kod tabanına (tradingEngine.js vb.) hiç dokunmadan,
   tamamen ek/bağımsız olarak çalışacak şekilde tasarlandı; tek paylaştığı
   şey, tradingEngine.js'in zaten okuduğu 'optipulselab_profile_name_v1'
   localStorage anahtarıdır (bkz. applyVerifiedProfile()).
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
        } catch (e) {
            console.warn('FinTeClub bağlantısı kurulamadı, doğrulama devre dışı bırakıldı.', e);
            FIREBASE_ENABLED = false;
        }
    }

    var VERIFY_CACHE_KEY = 'optipulselab_ftc_verify_v1';
    var PROFILE_NAME_KEY = 'optipulselab_profile_name_v1'; // tradingEngine.js ile AYNI anahtar
    var PORTFOLIO_STORAGE_KEY = 'optipulselab_paper_portfolio_v1'; // tradingEngine.js ile AYNI anahtar
    var PORTFOLIO_PUSH_INTERVAL_MS = 20000;

    var lastSharedData = null;
    var loggedActivityForId = null; // aynı ziyarette Firestore'a tekrar tekrar yazmamak için
    var verifiedApp = null; // { id, name, email } — doğrulama başarılı olduğunda dolar, portföy push'u bunu kullanır

    function byId(id) { return document.getElementById(id); }

    function readCachedVerify() {
        try {
            var raw = localStorage.getItem(VERIFY_CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function writeCachedVerify(data) {
        try {
            if (data) localStorage.setItem(VERIFY_CACHE_KEY, JSON.stringify(data));
            else localStorage.removeItem(VERIFY_CACHE_KEY);
        } catch (e) { /* private mode / kota dolu — sorun değil, sonraki yüklemede tekrar doğrulanır */ }
    }

    function setBadgeVisible(visible) {
        var badge = byId('ftc-badge');
        if (badge) badge.classList.toggle('hidden', !visible);
    }

    function setVerifyStatus(text, kind) {
        var el = byId('ftc-verify-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'ftc-verify-status' + (kind ? ' ftc-status-' + kind : '');
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

    function attemptVerification(rawEmail) {
        var email = (rawEmail || '').trim().toLowerCase();
        if (!email) {
            writeCachedVerify(null);
            setBadgeVisible(false);
            setVerifyStatus('', null);
            verifiedApp = null;
            return;
        }
        if (!lastSharedData) {
            setVerifyStatus(FIREBASE_ENABLED ? 'Doğrulanıyor...' : 'Doğrulama şu anda kullanılamıyor (bağlantı yok).', 'pending');
            return;
        }
        var apps = lastSharedData.applications || [];
        var match = apps.filter(function (a) {
            return (a.email || '').toLowerCase() === email && a.status === 'onayli';
        })[0];
        if (match) {
            writeCachedVerify({ id: match.id, name: match.name, email: match.email });
            setBadgeVisible(true);
            setVerifyStatus('✓ Doğrulandı — ' + match.name, 'ok');
            applyVerifiedProfile(match.name);
            logActivity(match);
            verifiedApp = { id: match.id, name: match.name, email: match.email };
        } else {
            writeCachedVerify(null);
            setBadgeVisible(false);
            setVerifyStatus('Bu e-posta ile onaylı bir FinteLig başvurusu bulunamadı.', 'error');
            verifiedApp = null;
        }
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
        return {
            balance: portfolio.balance,
            equity: equity,
            openPnl: openPnl,
            positionsCount: positionsCount,
            positions: positionsOut
        };
    }

    function pushPortfolioSnapshot() {
        if (!fsPortfolioDoc || !verifiedApp || document.hidden) return;
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
            updatedAt: new Date().toISOString()
        };
        fsPortfolioDoc.set(payload, { merge: true }).catch(function (e) {
            console.warn('OPLab canlı portföy verisi Firestore\'a yazılamadı.', e);
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

    function getUrlEmail() {
        try {
            var params = new URLSearchParams(window.location.search);
            return (params.get('ftc_email') || '').trim();
        } catch (e) { return ''; }
    }

    function init() {
        var emailInput = byId('ftc-email-input');
        var cached = readCachedVerify();
        var urlEmail = getUrlEmail();
        var initialEmail = urlEmail || (cached && cached.email) || '';

        if (emailInput && initialEmail) emailInput.value = initialEmail;

        // İyimser UI: Firestore cevabı gelmeden önce, önceki oturumdan
        // doğrulanmış bir durum varsa rozeti hemen göster (yanıp sönmeyi/
        // gecikmeyi önler). Firestore cevabı gelince gerçek veriyle teyit
        // edilir/güncellenir.
        if (cached && cached.name) {
            setBadgeVisible(true);
            setVerifyStatus('✓ Doğrulandı — ' + cached.name, 'ok');
            applyVerifiedProfile(cached.name);
        }

        var debounceTimer = null;
        function scheduleVerify() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                attemptVerification(emailInput ? emailInput.value : '');
            }, 500);
        }
        if (emailInput) emailInput.addEventListener('input', scheduleVerify);

        if (FIREBASE_ENABLED && fsSharedDoc) {
            fsSharedDoc.onSnapshot(function (doc) {
                lastSharedData = doc.exists ? doc.data() : null;
                updateAccessGate();
                var currentEmail = emailInput ? emailInput.value : initialEmail;
                if (currentEmail) attemptVerification(currentEmail);
            }, function (err) {
                console.warn('FinTeClub verisi dinlenemedi.', err);
                updateAccessGate();
            });
            // Admin panelindeki Canlı İzleme / Kullanıcı Portföyleri sayfalarını
            // beslemek için: sadece doğrulanmış bir yarışmacı varsa ve sekme
            // görünürken periyodik olarak bakiye/özkaynak özetini gönder.
            // İlk gönderim birkaç saniye gecikmeli — tradingEngine.js'in fiyat
            // akışının (tickPrices) en az bir tur çalışmış olması için.
            setTimeout(pushPortfolioSnapshot, 5000);
            setInterval(pushPortfolioSnapshot, PORTFOLIO_PUSH_INTERVAL_MS);
        } else {
            // Firebase yok/engelli — kilit varsayılan AÇIK, canlı doğrulama pasif
            // (yalnızca yukarıdaki önbellekli/iyimser rozet gösterimi geçerli).
            updateAccessGate();
            if (initialEmail && !cached) {
                setVerifyStatus('Doğrulama şu anda kullanılamıyor (bağlantı yok).', 'pending');
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
