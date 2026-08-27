/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB TRADING ENGINE (Demo / Paper Trading)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Responsibilities:
 *   - Market watchlist: searchable BIST100 list with simulated live prices
 *   - Quick trade ticket: Buy/Sell, Market/Limit, quantity, cost estimate
 *   - Paper trading portfolio: balance, positions, order history (localStorage)
 *   - Account summary + mark-to-market
 *
 * IMPORTANT: This is a SANDBOX / NON-LIVE simulation. No real orders are
 * placed anywhere. Prices are client-side simulated random walks seeded
 * from realistic BIST base prices — this is a demo/competition site, not
 * a brokerage connection.
 *
 * Exposed as window.TradingEngine.
 * Depends on: window.DataController, window.TradingChart
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const TradingEngine = (() => {

    const STORAGE_KEY = 'optipulselab_paper_portfolio_v1';
    const LAST_SYMBOL_STORAGE_KEY = 'optipulselab_last_symbol_v1';
    // (23 Temmuz 2026 düzeltmesi) Kullanıcı geri bildirimi: "izleme listesine
    // hisse ekleme çıkarma yerlerini değiştirme vb özellikleri ekleyelim" —
    // önceden "İzleme Listesi" her zaman TÜM BIST100'ü (97 sembol) gösteriyor,
    // Sembol Ara kutusu da yalnızca bu sabit listeyi filtreliyordu (satırları
    // gizleyip/gösteriyordu, gerçek bir "ekleme/çıkarma" yoktu). Artık
    // kullanıcının kendi seçtiği, kalıcı bir izleme listesi var.
    const WATCHLIST_STORAGE_KEY = 'optipulselab_watchlist_symbols_v1';
    const DEFAULT_BALANCE = 100000;
    const TICK_MS = 2000;

    let DC = null;
    let priceProfiles = {};
    let portfolio = null;

    /* (5 Ağustos 2026 — "giriş yapmadan önce bakiye hep 0 olsun, sadece
       gezebilsin; giriş yapanların gerçek bakiyesi gözüksün") FinTeClub
       girişi (finteclubBridge.js) yapılmadan bu demo portföyün bakiyesi
       her yerde (header, risk hesaplayıcı, pozisyon açma marjı kontrolü)
       0 olarak GÖRÜNÜR ve KULLANILIR — gerçek portfolio.balance
       localStorage'da olduğu gibi korunur, sadece giriş yapılana kadar
       erişilemez/görünmez olur. Giriş yapılınca gerçek değer anında
       geri döner. finteclubBridge.js hiç yüklenemezse (CDN engeli vb.)
       kapı devre dışı kalır ve eski davranışa (bakiye her zaman gerçek)
       sessizce dönülür — bir altyapı sorunu gerçek kullanıcıyı asla
       kilitlememeli. */
    function isFtcGateActive() {
        return !!(window.FTC_AUTH_STATE && window.FTC_AUTH_STATE.available);
    }
    function isFtcLoggedIn() {
        return !isFtcGateActive() || !!window.FTC_AUTH_STATE.loggedIn;
    }
    // (9 Ağustos 2026 — kullanıcı bildirimi: "hafta sonu piyasa kapalıyken
    // alım yapabildim") Önceden submitOrder() hiçbir piyasa-saati kontrolü
    // yapmıyordu — sadece tickPrices() (fiyat simülasyonu) ve grafik/çoklu
    // ızgara ticking'i DC.isMarketOpenNow() ile korunuyordu, emir gönderimi
    // korunmuyordu. Aynı DC.isMarketOpenNow() (dataController.js'teki TEK
    // gerçek kaynak) burada da kullanılıyor ki header rozetiyle, fiyat
    // ticking'iyle ve emir engelleme mantığıyla ASLA çelişmesin.
    function isMarketOpenForTrading() {
        return !DC || !DC.isMarketOpenNow || DC.isMarketOpenNow();
    }
    // Admin, FinTeClub panelinden piyasa saatlerinden BAĞIMSIZ olarak da
    // alım-satımı anında durdurabilir (bkz. finteclubBridge.js'teki
    // window.FTC_TRADING_STATE ataması, finteclub/shared_state belgesindeki
    // yeni tradingHalted alanından besleniyor). Bu, tam platform kilidinden
    // (oplabEnabled/FTC_AUTH_STATE ile ilgisiz — o TÜM siteyi kilitler) daha
    // hafif bir araç: kullanıcılar grafik/portföylerini görmeye devam eder,
    // sadece YENİ emir gönderemezler.
    function isTradingHaltedByAdmin() {
        return !!(window.FTC_TRADING_STATE && window.FTC_TRADING_STATE.halted);
    }
    function isTradingAllowedNow() {
        return isMarketOpenForTrading() && !isTradingHaltedByAdmin();
    }
    function tradingBlockedReason() {
        if (isTradingHaltedByAdmin()) return 'Alım-satım şu anda yönetici tarafından geçici olarak durduruldu.';
        if (!isMarketOpenForTrading()) return 'Piyasa şu anda kapalı — BIST seans saatleri: hafta içi 09:55–18:00 (TRT). Emir gönderilemez.';
        return '';
    }
    // qt-submit butonunun etkin/pasif durumunu VE üstündeki kalıcı uyarı
    // kutusunu (qt-trading-status-notice) günceller. tickPrices() piyasa
    // kapalıyken erken çıktığı için (bkz. o fonksiyondaki DC.isMarketOpenNow()
    // koruması) bu fonksiyon KENDİ setInterval'ında ayrıca çalıştırılır —
    // aksi halde piyasa kapanış/açılış anında buton durumu F5 atılmadan
    // güncellenmezdi (header rozetindeki aynı köklü hatanın bir benzeri).
    function updateTradeAvailabilityUI() {
        const submitBtn = byId('qt-submit');
        const notice = byId('qt-trading-status-notice');
        // (9 Ağustos 2026 — "piyasa kapalıyken kuyruğa emir alma" özelliği)
        // Admin durdurması HER ZAMAN tam blok (kuyruğa bile alınamaz — bkz.
        // submitOrder()). Piyasa kapalı olması ise artık OCO HARİÇ tam blok
        // DEĞİL: Market/Limit emirleri hâlâ girilebilir, sadece hemen değil
        // piyasa açılınca sıradan otomatik gerçekleşir (bkz. submitOrder(),
        // queuePendingMarketOrder, checkPendingOcoOrders). OCO bu kapsamın
        // dışında tutuldu, o yüzden piyasa kapalıyken OCO seçiliyse buton
        // yine tam pasif.
        const haltedByAdmin = isTradingHaltedByAdmin();
        const marketClosed = !isMarketOpenForTrading();
        const blockedHard = haltedByAdmin || (marketClosed && state.orderType === 'OCO');
        if (submitBtn) {
            submitBtn.disabled = blockedHard;
            submitBtn.title = blockedHard ? tradingBlockedReason() : (marketClosed ? 'Piyasa kapalı — emriniz sıraya alınıp açılışta otomatik gerçekleştirilecek.' : '');
        }
        if (notice) {
            if (blockedHard) {
                notice.textContent = '⛔ ' + tradingBlockedReason();
                notice.style.display = '';
                notice.classList.remove('qt-alert-info');
                notice.classList.add('qt-alert-error');
            } else if (marketClosed) {
                notice.textContent = 'ℹ️ Piyasa şu anda kapalı — gireceğiniz Piyasa/Limit emri sıraya alınır, gereken teminat şimdi bakiyenizden kilitlenir, piyasa açılınca (hafta içi 09:55–18:00 TRT) otomatik gerçekleştirilir.';
                notice.style.display = '';
                notice.classList.remove('qt-alert-error');
                notice.classList.add('qt-alert-info');
            } else {
                notice.style.display = 'none';
            }
        }
    }
    function effectiveBalance() {
        return isFtcLoggedIn() ? portfolio.balance : 0;
    }
    // Set<string> — kullanıcının izleme listesindeki semboller. İlk çalıştırmada
    // (localStorage'da hiç kayıt yoksa) TÜM BIST100 ile başlatılıyor, böylece
    // mevcut kullanıcılar için görünüm ANINDA değişmiyor — yalnızca bundan sonra
    // ekleme/çıkarma yaptıklarında liste küçülüp büyüyebiliyor.
    let watchlistSymbols = new Set();

    function loadWatchlistSymbols() {
        try {
            const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) return new Set(arr);
            }
        } catch (e) { /* bozuk/erişilemeyen depolama — varsayılana düş */ }
        const all = new Set(DC.BIST100.map(s => s.symbol));
        saveWatchlistSymbols(all);
        return all;
    }
    function saveWatchlistSymbols(set) {
        try { localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(Array.from(set || watchlistSymbols))); } catch (e) { /* private mode vb. */ }
    }
    function addToWatchlist(symbol) {
        if (watchlistSymbols.has(symbol)) return;
        watchlistSymbols.add(symbol);
        saveWatchlistSymbols();
        showToast(`${symbol} izleme listesine eklendi.`);
    }
    function removeFromWatchlist(symbol) {
        if (!watchlistSymbols.has(symbol)) return;
        watchlistSymbols.delete(symbol);
        saveWatchlistSymbols();
        showToast(`${symbol} izleme listesinden çıkarıldı.`);
        // (2 Ağustos 2026 — revize planı madde 9) Kullanıcı geri bildirimi:
        // "çarpıya basıp hisseleri sildikten sonra o hisseler geri gelmiyor".
        // Aslında sembol Sembol Ara kutusuna yazılarak her zaman geri
        // eklenebiliyordu (renderWatchlistRows() zaten izleme listesindeki
        // semboller için ✓ rozeti gösteriyor) — ama bu hiç belli değildi,
        // kullanıcı hisseyi kalıcı olarak kaybettiğini düşünüyordu. Şimdi
        // silme işleminden hemen sonra birkaç saniyeliğine bir "Geri Al"
        // bildirimi çıkıyor; tıklanırsa sembol tek adımda geri ekleniyor.
        showWatchlistUndoToast(symbol);
    }

    let watchlistUndoTimer = null;
    function showWatchlistUndoToast(symbol) {
        const el = byId('watchlist-undo-toast');
        const textEl = byId('watchlist-undo-text');
        const btn = byId('btn-watchlist-undo');
        if (!el || !btn) return;
        if (textEl) textEl.textContent = `${symbol} kaldırıldı.`;
        el.style.display = '';
        clearTimeout(watchlistUndoTimer);
        // Butonu klonlayıp değiştiriyoruz ki art arda birden fazla kaldırma
        // işleminde eski dinleyiciler birikip yanlış sembolü geri eklemesin.
        const freshBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(freshBtn, btn);
        freshBtn.addEventListener('click', () => {
            addToWatchlist(symbol);
            renderWatchlistRows();
            el.style.display = 'none';
            clearTimeout(watchlistUndoTimer);
        });
        watchlistUndoTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
    }

    const state = {
        activeSymbol: null,
        side: 'BUY',          // BUY | SELL
        orderType: 'MARKET',  // MARKET | LIMIT
        watchlistFilter: '',
        heatmapGroupBy: 'sector', // 'sector' | 'flat' — Isı Haritası gruplama modu (17 Temmuz 2026, yedinci oturum)
        leverage: 1, // Kaldıraç — trading ticket'ta seçilen değer, yeni pozisyon açılırken kullanılır
        // (23 Temmuz 2026 düzeltmesi) 'NORMAL' | 'VIOP' — bkz. checkNormalModeShortBlock.
        // Normal seansta açığa satış/kaldıraç yok; VİOP eski (değişmeyen) davranışı kullanır.
        market: 'NORMAL'
    };
    const MARKET_MODE_STORAGE_KEY = 'optipulselab_market_mode_v1';

    // Bir pozisyon likide edilmeden önce izin verilen maksimum marj kaybı
    // oranı — gerçek borsalarda "maintenance margin" karşılığı. %80 kayıp =
    // marj çağrısı simülasyonu (bkz. checkMarginCalls()).
    const LIQUIDATION_MARGIN_LOSS_RATIO = 0.8;

    // (9 Ağustos 2026 — "Zerda"/"Mehmet Ali" VİOP büyüklük patlaması kök
    // neden düzeltmesi) İncelemede bulunan gerçek neden LIMIT emirlerdeki
    // eski hatadan FARKLIYDI: burada MARKET emirlerle, AÇIK-KAPAT'ı saniyeler
    // içinde art arda tekrarlayan (scalping) bir kullanıcı, HER işlemde
    // "%100 bakiye" ile yeniden pozisyon açtığında, iki yapısal eksiklik
    // yüzünden özkaynak saniyeler içinde katrilyonlarca TL'ye kadar
    // katlanabiliyordu:
    //   1) AL ve SAT TAMAMEN AYNI fiyattan (spread'siz) gerçekleşiyordu —
    //      gerçek bir borsada asla olmaz, her zaman alış (ask) satıştan
    //      (bid) biraz yüksektir. Spread'siz bir piyasada, fiyat rastgele
    //      yukarı/aşağı oynadıkça kullanıcı sadece YEŞİL anları bekleyip
    //      satarak neredeyse risksiz "bedava kâr" devşirebiliyordu —
    //      komisyon bunu caydırmaya yetmiyordu.
    //   2) Tek bir emrin büyüklüğüne (nominal değerine) HİÇBİR üst sınır
    //      yoktu — özkaynak her katlandığında bir sonraki emir otomatik
    //      olarak daha da büyüyor, birkaç dakika içinde milyar/trilyon TL'lik
    //      "var olmayan" emirlere ulaşabiliyordu (gerçek bir borsada bu
    //      büyüklükte bir emri karşılayacak likidite yok).
    // DÜZELTME: (a) her AL emri gerçek piyasa fiyatının biraz ÜSTÜNDEN (ask),
    // her SAT emri biraz ALTINDAN (bid) gerçekleşiyor — bkz. execFillPrice()
    // ve placeOrder()'daki uygulanışı; bu, saf gürültü/volatiliteyi
    // "bedava" kâra çevirmeyi yapısal olarak engelliyor (round-trip'in artık
    // her zaman küçük ama gerçek bir maliyeti var). (b) tek bir emrin nominal
    // değeri (fiyat × adet) MAX_ORDER_NOTIONAL_TL ile sınırlandı — bkz.
    // applyQtyPct() (otomatik miktar hiç bu sınırı önermiyor) ve placeOrder()
    // (elle yazılan miktarlar için son bir güvenlik duvarı). Kapatma
    // (closePosition) bu sınıra TABİ DEĞİL — zaten açık bir pozisyon her
    // zaman kapatılabilmeli, aksi halde kullanıcı pozisyonunda kilitli
    // kalırdı.
    const HALF_SPREAD_PCT = 0.04; // %0.04 (toplam ~%0.08 alış-satış farkı) — gerçekçi, ama abartılı olmayan bir kotasyon farkı
    const MAX_ORDER_NOTIONAL_TL = 20000000; // tek bir emrin (fiyat × adet) aşamayacağı nominal tavan — 20 milyon TL

    // AL emri her zaman ask'tan (mid'in biraz ÜSTÜnden), SAT emri her zaman
    // bid'ten (mid'in biraz ALTINDAN) gerçekleşir — gerçek bir borsa
    // kotasyonunun (bid/ask) basitleştirilmiş bir simülasyonu.
    function execFillPrice(side, midPrice) {
        return side === 'BUY' ? midPrice * (1 + HALF_SPREAD_PCT / 100) : midPrice * (1 - HALF_SPREAD_PCT / 100);
    }

    // (10 Ağustos 2026 — VİOP kaldıraç/tur gerçekçiliği düzeltmesi, ikinci
    // tur) 9 Ağustos'taki spread+nominal tavan düzeltmesi tek başına yeterli
    // olmadı: canlı veride "Edanur"/"Mehmet Ali" hesaplarının, TEK bir
    // sembolde, sabit 20x kaldıraçla, ortalama ~10 SANİYE tutup (en kısası
    // 1,7 saniye!) 25 kez üst üste aç-kapa yaparak, 25 işlemin 24'ünü kârlı
    // kapattığı (%96 kazanma oranı — saf rastgele bir piyasada istatistiksel
    // olarak neredeyse imkansız) tespit edildi. Demek ki spread+komisyonun
    // toplam ~%0,18'lik sürtünmesi, dev pozisyon büyüklüğü × 20x kaldıraç
    // ile kolayca aşılabiliyormuş. Gerçek platformlarda (Binance vb.) bunu
    // engelleyen İKİ ayrı yapısal fren var, ikisi de burada eksikti:
    //   1) Kademeli kaldıraç: pozisyonun nominal büyüklüğü arttıkça izin
    //      verilen maksimum kaldıraç OTOMATİK düşer — büyük pozisyonlar daha
    //      az kaldıraçla açılabilir (bkz. VIOP_LEVERAGE_TIERS/tieredMaxLeverage,
    //      placeOrder() içinde uygulanışı).
    //   2) Asgari pozisyon tutma süresi: gerçek piyasalarda spread+gerçek
    //      likidite saniyeler içinde aç-kapa yapmayı zaten anlamsız kılar —
    //      burada bunu taklit etmek için MANUEL kapamalara asgari bir süre
    //      zorunlu kılındı (bkz. MIN_POSITION_HOLD_MS, closePosition() içinde
    //      uygulanışı). Otomatik SL/Trailing/Marj çağrısı kapamaları BU
    //      SINIRA TABİ DEĞİL — risk yönetimi asla geciktirilmemeli.
    // (10 Ağustos 2026, üçüncü tur — "genel tarama") Asgari tutma süresi
    // başta sadece VİOP'a uygulanmıştı; ama aynı "kârdaysa hemen kapat"
    // deseni kaldıraç olmadan da (daha yavaş, çünkü kazanç gerçek fiyat
    // hareketiyle sınırlı, amplifikasyon yok) teorik olarak Normal seansta
    // da mümkün. Tutarlılık için MIN_POSITION_HOLD_MS artık HER İKİ deftere
    // de uygulanıyor — bkz. closePosition()/renderPositionsInto().
    const VIOP_LEVERAGE_TIERS = [
        { maxNotional: 250000, maxLeverage: 20 },
        { maxNotional: 1000000, maxLeverage: 10 },
        { maxNotional: 5000000, maxLeverage: 5 },
        { maxNotional: 20000000, maxLeverage: 3 },
        { maxNotional: Infinity, maxLeverage: 2 }
    ];
    function tieredMaxLeverage(notional) {
        const n = Math.max(0, Number(notional) || 0);
        for (let i = 0; i < VIOP_LEVERAGE_TIERS.length; i++) {
            if (n <= VIOP_LEVERAGE_TIERS[i].maxNotional) return VIOP_LEVERAGE_TIERS[i].maxLeverage;
        }
        return VIOP_LEVERAGE_TIERS[VIOP_LEVERAGE_TIERS.length - 1].maxLeverage;
    }
    const MIN_POSITION_HOLD_MS = 30000; // Bir pozisyon manuel (veya TP ile) kapatılmadan önce açık kalması gereken asgari süre (30 saniye) — hem Normal hem VİOP defteri için geçerli
    const MIN_TRAILING_PCT = 0.5; // Trailing Stop için izin verilen asgari yüzde — daha küçüğü fiyat gürültüsüyle anında tetiklenip asgari tutma süresini dolanmanın bir yolu olurdu

    // (10 Ağustos 2026) applyQtyPct/computeRiskBasedQty/updateEstimate/
    // estimateOrderMarginRequirement gibi ÖNİZLEME hesaplayıcılarının,
    // kademeli kaldıraç yüzünden placeOrder()'ın GERÇEKTE uygulayacağından
    // FARKLI bir kaldıraçla hesap yapıp kullanıcıyı "önizlemede yeterliydi,
    // gönderince yetersiz bakiye" sürprizine düşürmemesi için ortak yardımcı.
    // placeOrder() her zaman nihai/otoriter karardır — bu sadece önizlemeyi
    // ona yaklaştırır.
    function previewTieredLeverage(notional, requestedLeverage, market) {
        const req = Math.max(1, Number(requestedLeverage) || 1);
        if (market !== 'VIOP') return req;
        return Math.min(req, tieredMaxLeverage(notional));
    }

    /* ────────── DOM helpers ────────── */
    function byId(id) { return document.getElementById(id); }

    // All full-screen modal backdrop ids in the app — used so opening one
    // reliably closes any other that might already be open.
    // (2 Ağustos 2026 — revize planı madde 8) 'chart-note-modal-backdrop' eklendi.
    const ALL_MODAL_BACKDROP_IDS = ['indicator-modal-backdrop', 'alerts-modal-backdrop', 'sltp-modal-backdrop', 'heatmap-modal-backdrop', 'shortcuts-modal-backdrop', 'help-modal-backdrop', 'command-palette-backdrop', 'chart-note-modal-backdrop', 'order-confirm-modal-backdrop'];
    function closeOtherModals(exceptId) {
        ALL_MODAL_BACKDROP_IDS.forEach(id => {
            if (id === exceptId) return;
            const el = byId(id);
            if (el) el.classList.remove('open');
        });
    }
    window.__optipulseCloseOtherModals = closeOtherModals; // used by tradingChart.js's indicator modal

    // (22 Temmuz 2026, on ikinci oturum, ikinci tur — kullanıcı isteği üzerine
    // önceden not edilip bırakılan pürüz şimdi düzeltildi) Header'daki üç
    // "basit" (position:fixed, .open class'lı, tam ekran olmayan) açılır
    // menü — grafik tipi, hamburger (☰) ve profil — ALL_MODAL_BACKDROP_IDS'
    // teki tam ekran modallardan ayrı bir kategori, bu yüzden closeOtherModals()
    // bunları kapsamıyordu. Her birinin kendi tetikleyici butonu
    // e.stopPropagation() kullandığı için (dropdown'un kendi dışına
    // tıklamayı algılayabilmesi için gerekli), biri açıkken diğerine
    // tıklamak document'in "dışarı tıklama" dinleyicisine hiç ulaşmıyor ve
    // ilk açık kalıyordu. Artık her üçünün kendi open() fonksiyonu, açılışta
    // diğer ikisini de bu ortak fonksiyonla kapatıyor.
    const ALL_SIMPLE_DROPDOWN_IDS = ['chart-type-dropdown', 'header-menu-dropdown', 'profile-panel-dropdown'];
    function closeOtherSimpleDropdowns(exceptId) {
        ALL_SIMPLE_DROPDOWN_IDS.forEach(id => {
            if (id === exceptId) return;
            const el = byId(id);
            if (el) el.classList.remove('open');
        });
    }
    window.__optipulseCloseOtherSimpleDropdowns = closeOtherSimpleDropdowns; // used by tradingChart.js's chart-type/header menus

    function fmtTRY(v) {
        const sign = v < 0 ? '-' : '';
        return sign + '₺' + Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtPrice(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        // (18 Temmuz 2026, dördüncü tur, Madde 5f) Önceden toFixed() kullanılıyordu,
        // bu da ondalık ayıracı olarak her zaman '.' üretiyordu (ör. "125.40") —
        // oysa fmtTRY() ve uygulamanın geri kalanı Türkçe yerel biçimi (ondalık
        // virgül, binlik nokta, ör. "1.234,56") kullanıyor. Aynı ekranda iki
        // farklı sayı biçimi görünmesin diye burası da tr-TR yereline taşındı;
        // "1000 TL ve üzeri fiyatlarda ondalıksız göster" davranışı korunuyor.
        const decimals = v >= 1000 ? 0 : 2;
        return v.toLocaleString('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    function genId() { return 'ord_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    // (23 Temmuz 2026 düzeltmesi) Bir pozisyona farklı kaldıraçlarla birden
    // fazla kez eklenebildiği için (bkz. placeOrder) saklanan kaldıraç artık
    // adet-ağırlıklı bir ortalama olabilir (ör. 3.4x) — avgPrice zaten aynı
    // şekilde ağırlıklı ortalanıyordu, kaldıraç da tutarlılık için aynı
    // deseni izliyor. Bu yardımcı, tam sayıysa "5x", değilse en fazla 2
    // ondalıkla ("3.4x") gösterip gereksiz sondaki sıfırları temizliyor.
    function fmtLeverage(v) {
        const n = Number(v) || 1;
        const rounded = Math.round(n * 100) / 100;
        return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
    }

    /* ════════════════════════════════════════════════
       Portfolio persistence
       ════════════════════════════════════════════════ */

    function loadPortfolio() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.balance === 'number') {
                    // Eski (17 Temmuz 2026 yedinci oturumdan önce) kaydedilmiş
                    // portföylerde pendingOrders alanı yok — geriye dönük
                    // uyumluluk için varsayılan boş dizi ile tamamla.
                    if (!Array.isArray(parsed.pendingOrders)) parsed.pendingOrders = [];
                    // (29 Temmuz 2026 — Madde 11 "VİOP ayrı panel") Daha eski
                    // kaydedilmiş portföylerde VİOP'a ait ayrı defter alanları
                    // hiç yok — geriye dönük uyumluluk için boş varsayılanlarla
                    // tamamlanıyor. Böylece önceki oturumlardan gelen bir
                    // portföy (yalnızca spot pozisyonlar içeren) hatasız yüklenir.
                    if (!parsed.viopPositions || typeof parsed.viopPositions !== 'object' || Array.isArray(parsed.viopPositions)) parsed.viopPositions = {};
                    if (!Array.isArray(parsed.viopHistory)) parsed.viopHistory = [];
                    if (!Array.isArray(parsed.viopPendingOrders)) parsed.viopPendingOrders = [];
                    return parsed;
                }
            }
        } catch (e) { /* ignore corrupt storage */ }
        return { balance: DEFAULT_BALANCE, positions: {}, history: [], pendingOrders: [], viopPositions: {}, viopHistory: [], viopPendingOrders: [] };
    }

    function savePortfolio() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio)); } catch (e) { /* quota / private mode */ }
        // (9 Ağustos 2026 — "aynı hesabı 2-3 cihazdan art arda satabiliyorum,
        // her seferinde parasını alıyorum" kök neden düzeltmesi) ÖNCEDEN bu
        // fonksiyon SADECE localStorage'a yazıyordu — buluta (ve dolayısıyla
        // diğer cihazlara) sadece finteclubBridge.js'in periyodik 5 saniyelik
        // turunda gidiyordu. Bir işlemden hemen sonra buluta gidene kadar
        // geçen bu boşluk, tam olarak başka bir cihazın AYNI pozisyonu
        // "hâlâ açık" sanıp tekrar satabildiği ve her seferinde parasını
        // aldığı pencereydi. Artık her portföy değişikliğinde (satış/alım/
        // kapama/SL-TP/admin bakiye komutu — hepsi savePortfolio()'dan
        // geçiyor) finteclubBridge.js'e anında (kısa bir debounce ile)
        // senkronize olma talebi gönderiliyor; asıl çift-ödeme güvencesi
        // ise finteclubBridge.js'teki rev-korumalı Firestore TRANSACTION'ı
        // sağlıyor (bkz. o dosyadaki requestImmediateSync/
        // pushFullPortfolioToCloud yorumları) — bir cihazın bayat veriye
        // dayanan işlemi asla kalıcı olarak buluta yazılamaz. FinteClub
        // hiç yüklenmediyse (CDN engelli/offline) ya da giriş yapılmadıysa
        // bu çağrı güvenle no-op olur, hiçbir üretim davranışı buna bağımlı
        // değildir.
        if (window.FinteClubBridge && typeof window.FinteClubBridge.requestImmediateSync === 'function') {
            try { window.FinteClubBridge.requestImmediateSync(); } catch (e) { /* asla trade akışını bozmasın */ }
        }
    }

    function resetPortfolio() {
        portfolio = { balance: DEFAULT_BALANCE, positions: {}, history: [], pendingOrders: [], viopPositions: {}, viopHistory: [], viopPendingOrders: [] };
        savePortfolio();
        renderPositions();
        renderOrders();
        renderAccountSummary();
        renderPendingOcoOrders();
        equityHistory.length = 0;
        sampleEquity();
        renderPerformanceTab();
        showToast('Portföy sıfırlandı: ' + fmtTRY(DEFAULT_BALANCE));
    }

    // (8 Ağustos 2026 — admin panelinden ANLIK bakiye ayarlama) resetPortfolio()
    // ile AYNI güvenli desen: sadece portfolio.balance'ı (nakit) değiştirir,
    // pozisyonlara/geçmişe DOKUNMAZ, kaydeder ve ekranı hemen yeniden çizer.
    // finteclubBridge.js bunu doğrudan çağırır — böylece admin'in bakiye
    // komutu sayfa YENİDEN YÜKLENMEDEN, senkron olarak anında uygulanır
    // (önceki tasarımda localStorage'a yazıp sayfayı yenilemek gerekiyordu,
    // bu da her zaman görünür bir gecikme/"flash" yaratıyordu).
    function setBalance(amount) {
        const n = Number(amount);
        if (!isFinite(n) || n < 0) return false;
        portfolio.balance = n;
        savePortfolio();
        renderAccountSummary();
        renderPerformanceTab();
        sampleEquity();
        showToast('Bakiyeniz yönetici tarafından güncellendi: ' + fmtTRY(n));
        return true;
    }

    // (29 Temmuz 2026 — Madde 11 "VİOP ayrı panel") Hocanın geri bildirimi:
    // VİOP'un kendi kaldıraç/açığa satış davranışı zaten vardı (23 Temmuz
    // düzeltmesi, state.market toggle'ı) ama pozisyonlar/emirler/geçmiş TEK
    // bir ortak defterde (portfolio.positions/history/pendingOrders)
    // tutuluyordu — yani VİOP'ta açılan bir pozisyon, Normal Seans'ta aynı
    // sembolde açık bir spot pozisyonla YANLIŞLIKLA aynı kayda karışabilirdi
    // (ör. VİOP'ta 5x kaldıraçla eklenen bir AKBNK, spot'taki 1x AKBNK
    // pozisyonuna sessizce "eklenir" ve kaldıraç ağırlıklı ortalamaya
    // karışırdı — gerçek bir borsada spot hisse ile VİOP kontratı TAMAMEN
    // ayrı enstrümanlardır, birbirine asla karışmaz).
    //
    // Çözüm: portfolio nesnesine VİOP için tamamen ayrı bir pozisyon/geçmiş/
    // bekleyen-emir defteri eklendi (viopPositions/viopHistory/
    // viopPendingOrders). book(market) bu iki defterden doğru olanına bir
    // referans döndürür; placeOrder/closePosition/checkStopLossTakeProfit/
    // checkMarginCalls/checkPendingOcoOrders gibi TÜM pozisyon/emir mantığı
    // artık hangi defter üzerinde çalışacağını bu fonksiyondan alıyor. Demo
    // bakiye (portfolio.balance) kasıtlı olarak TEK ve ortak kalıyor — gerçek
    // hayatta da aynı yatırım hesabından hem spot hem VİOP işlemi yapılır,
    // yalnızca pozisyonlar ayrı tutulur.
    function book(market) {
        return market === 'VIOP'
            ? { positions: portfolio.viopPositions, history: portfolio.viopHistory, pending: portfolio.viopPendingOrders }
            : { positions: portfolio.positions, history: portfolio.history, pending: portfolio.pendingOrders };
    }

    /* ════════════════════════════════════════════════
       Price simulation
       ════════════════════════════════════════════════ */

    // Watchlist mini-sparkline'ları için tutulan kısa fiyat geçmişi — her
    // tick'te bir örnek eklenir, SPARK_HISTORY_LEN'i aşınca en eski örnek
    // atılır (TICK_MS=2000ms × 60 ≈ son 2 dakika).
    const SPARK_HISTORY_LEN = 60;

    // (10 Ağustos 2026 — "kuruş bazlı değil, 1-2 TL'lik sıçramalar" düzeltmesi)
    // DC.STOCK_PROFILES'taki `volatility` alanı (ör. ASELS için 0,017) bir
    // GÜNLÜK/SEANS oynaklığı parametresi — ama tickPrices() bunu doğrudan HER
    // 2 saniyelik tick'e uyguluyordu, sanki günlük oynaklıkmış gibi değil de
    // tek bir tick'in oynaklığıymış gibi. Bu da (356 TL × %1,7 × 0,5 ≈ 3 TL)
    // her 2 saniyede bir liralarla ölçülen sıçramalara yol açıyordu — gerçek
    // piyasada ise ardışık tickler arası fark genelde kuruşlarla ölçülür.
    // Doğru fiziksel model (rastgele yürüyüş / Brown hareketi ölçekleme
    // kuralı): bir seansı N bağımsız tick'e bölersek, tek bir tick'in
    // oynaklığı günlük oynaklığın 1/sqrt(N)'i kadar olmalı — toplam seans
    // boyunca birikince yine günlük oynaklığa ulaşılsın diye. BIST_SESSION_
    // MINUTES (480dk = 28800sn) / TICK_MS(2sn) ≈ 14400 tick/seans ->
    // sqrt(14400) = 120. Yani tick başına oynaklık, günlük oynaklığın
    // yaklaşık 1/120'si olmalı.
    const BIST_SESSION_SECONDS = 480 * 60;
    const TICKS_PER_SESSION = BIST_SESSION_SECONDS / (TICK_MS / 1000);
    const TICK_VOLATILITY_SCALE = 1 / Math.sqrt(TICKS_PER_SESSION);

    // (12 Ağustos 2026 — BIST resmi "Fiyat Adımı" (kademe) sistemi) Borsa
    // İstanbul'da her fiyat sürekli/serbest değişmez — Sermaye Piyasası
    // Kurulu'nun "Paylarda ve Yeni Pay Alma Hakkı Kuponlarında Uygulanan Baz
    // Fiyat Aralıkları ve Fiyat Adımları" tablosuna göre, hissenin O ANKİ
    // fiyat SEVİYESİNE bağlı olarak sabit bir "adım" büyüklüğünde zıplar
    // (ör. 250-500 TL aralığındaki bir hisse SADECE 0,25 TL'nin katları
    // kadar değişebilir — 361,92 gibi rastgele bir kuruş asla gerçekleşmez).
    // Kullanıcının "ASELS gerçekte 25 kuruşluk kademelerle hareket ediyor,
    // bizim sistemde rastgele TL'lik iniş-çıkışlar oluyor, tam gerçekçilik
    // istiyorum" talebi üzerine eklendi. Kullanıcının onayladığı "hibrit"
    // yaklaşım: iç rastgele-yürüyüş matematiği (ortalamaya dönüş + ölçekli
    // oynaklık, bkz. yukarısı) tamamen SÜREKLİ bir "gölge" değer (`p.rawPrice`)
    // üzerinde aynen çalışmaya devam ediyor — sadece dışarı açılan/işlem
    // gören `p.price` her tick'te bu gölge değerin en yakın geçerli kademeye
    // yuvarlanmış hali. Bu ayrım kasıtlı: eğer yuvarlanmış değeri bir sonraki
    // tick'in başlangıcı yapsaydık, binlerce tick üzerinde yuvarlama hatası
    // sistematik bir yöne birikebilirdi (özellikle düşük fiyatlı/düşük
    // oynaklıklı hisselerde) — gölge değer bunu önlüyor.
    const BIST_TICK_SIZE_TABLE = [
        { max: 20, step: 0.01 },
        { max: 50, step: 0.02 },
        { max: 100, step: 0.05 },
        { max: 250, step: 0.10 },
        { max: 500, step: 0.25 },
        { max: 1000, step: 0.50 },
        { max: 2500, step: 1.00 },
        { max: Infinity, step: 2.50 }
    ];
    function bistTickSize(price) {
        const p = Math.abs(Number(price) || 0);
        for (let i = 0; i < BIST_TICK_SIZE_TABLE.length; i++) {
            if (p < BIST_TICK_SIZE_TABLE[i].max) return BIST_TICK_SIZE_TABLE[i].step;
        }
        return BIST_TICK_SIZE_TABLE[BIST_TICK_SIZE_TABLE.length - 1].step;
    }
    function roundToBistTick(price) {
        if (!(price > 0)) return price;
        const step = bistTickSize(price);
        return +((Math.round(price / step) * step).toFixed(2));
    }

    // (12 Ağustos 2026 — kademe kalibrasyonu, doğrulama sırasında bulundu)
    // Kademeye yuvarlama eklendikten hemen sonra Node.js ile 1000 tick'lik
    // (~33 dakika) saf simülasyon (gerçek veri senkronu olmadan) test edildi
    // ve ÖNEMLİ bir sorun ortaya çıktı: p.tickVolatility (2. turdaki "kuruş
    // bazlı hareket" düzeltmesinden kalma), 0,06 katsayılı güçlü ortalamaya-
    // dönüşle birleşince, rawPrice'ın durağan-durum dalgalanma genişliğini
    // (~360 TL'lik bir hisse için ~0,04 TL) BIST kademesinden (0,25 TL) çok
    // küçük bırakıyordu — sonuç: fiyat 1000 tick boyunca TEK BİR KEZ bile
    // değişmiyordu (tamamen "donuk" görünüyordu, ki bu da tam olarak
    // kullanıcının şikayet ettiği "gerçekçi değil" durumunun BAŞKA bir
    // versiyonu olurdu). Kök neden: p.tickVolatility, ÖNCEKİ (sürekli/
    // yuvarlanmamış) fiyat modeli için kalibre edilmişti — kademeye
    // yuvarlama eklenince o küçük sürekli dalgalanmanın neredeyse tamamı
    // yuvarlamada kayboluyor. Çözüm: SADECE bu ham/gölge yürüyüşün şok
    // büyüklüğüne uygulanan ayrı bir çarpan eklendi — p.tickVolatility'nin
    // kendi (günlük ölçek bağlantılı) anlamına dokunmuyor, sadece kademe
    // sınırını rahatça aşabilecek kadar canlılık katıyor. Değer (6), Node.js
    // ile çeşitli fiyat seviyelerinde (8,5 TL'den 5.545 TL'ye) denenip
    // görsel olarak gerçekçi bir sonuca (33 dakikada tick'lerin ~%25-40'ında
    // görünür bir kademe değişimi, aşırı uçlarda değil) ulaşana kadar
    // ayarlandı.
    const BIST_KADEME_LIVELINESS_MULTIPLIER = 6;

    function buildPriceProfiles() {
        const profiles = {};
        DC.BIST100.forEach(({ symbol }) => {
            const known = DC.STOCK_PROFILES[symbol];
            if (known) {
                const seedPrice = roundToBistTick(known.basePrice);
                profiles[symbol] = { price: seedPrice, rawPrice: known.basePrice, dayOpen: known.basePrice, liveAnchor: known.basePrice, volatility: known.volatility, tickVolatility: known.volatility * TICK_VOLATILITY_SCALE, name: known.name, history: [seedPrice], hasRealAnchor: false, pendingSuspiciousPrice: null };
                return;
            }
            const hash = Array.from(symbol).reduce((s, c) => s * 31 + c.charCodeAt(0), 0);
            const base = +(15 + Math.abs(hash % 400) + (Math.abs(hash) % 100) / 100).toFixed(2);
            const dailyVol = 0.012 + (Math.abs(hash) % 8) / 1000;
            const seedBase = roundToBistTick(base);
            profiles[symbol] = { price: seedBase, rawPrice: base, dayOpen: base, liveAnchor: base, volatility: dailyVol, tickVolatility: dailyVol * TICK_VOLATILITY_SCALE, history: [seedBase], hasRealAnchor: false, pendingSuspiciousPrice: null };
        });
        return profiles;
    }

    function tickPrices() {
        // (9 Ağustos 2026) Emir bileti buton/uyarı durumu, aşağıdaki erken
        // çıkıştan ETKİLENMEMELİ — piyasa kapalıyken de (özellikle piyasa TAM
        // O AN kapandığında) buton anında pasif hale gelmeli.
        updateTradeAvailabilityUI();

        // BIST kapalıyken (hafta sonu veya 09:55-18:00 TRT seans dışında)
        // fiyatlar simüle edilmeyi durdurur — son kapanış fiyatında donuk kalır,
        // tıpkı gerçek bir borsa gibi. Aksi halde mumlar piyasa kapalıyken de
        // hareket etmeye devam ediyordu (kullanıcı tarafından bildirilen hata).
        if (DC.isMarketOpenNow && !DC.isMarketOpenNow()) return;

        Object.keys(priceProfiles).forEach(sym => {
            const p = priceProfiles[sym];
            // (10 Ağustos 2026 — "ASELS spekülatif sıçrama" düzeltmesi)
            // Reversion artık p.dayOpen'a DEĞİL, p.liveAnchor'a çekiyor.
            // dayOpen sadece günlük %değişim göstergesi için sabit kalması
            // gereken bir referans (gerçek gün açılışı); liveAnchor ise en
            // son alınan GERÇEK fiyat (WS tick / 40sn'lik toplu senkron /
            // sembol seçiminde OHLCV son kapanışı). Eskiden ikisi aynı
            // (dayOpen) olduğu için, dayOpen ancak %6'lık geniş banttan
            // taşıldığında güncelleniyordu — bu da günlük açılışa yakın
            // bir eski/durgun fiyatın (ör. bir önceki günün kapanışı)
            // saatlerce "yerçekimi" gibi fiyatı geri çekmesine, buna karşın
            // her 40sn'de bir gerçek fiyata sıçramasına, yani testere dişi
            // (sıçra-geri düş) görünümüne yol açıyordu — kullanıcının
            // bildirdiği "bir anda yükselip düşüyor, çok spekülatif" hatası.
            const anchor = (typeof p.liveAnchor === 'number') ? p.liveAnchor : p.dayOpen;
            // (12 Ağustos 2026 — BIST kademe/fiyat adımı sistemi) Rastgele
            // yürüyüş matematiği artık p.price ÜZERİNDE DEĞİL, sürekli/
            // yuvarlanmamış "gölge" değer p.rawPrice üzerinde çalışıyor —
            // bkz. buildPriceProfiles'taki geniş not. p.price (dışarı açılan,
            // işlem gören fiyat) bu fonksiyonun sonunda rawPrice'ın en yakın
            // geçerli BIST kademesine yuvarlanmış hali olarak ayrıca atanıyor.
            const rawBasis = (typeof p.rawPrice === 'number') ? p.rawPrice : p.price;
            const meanReversion = (anchor - rawBasis) * 0.06;
            // (10 Ağustos 2026) p.volatility DEĞİL p.tickVolatility kullanılıyor
            // — bkz. buildPriceProfiles'taki TICK_VOLATILITY_SCALE notu. p.volatility
            // hâlâ günlük ölçek referansı olarak duruyor (başka bir yerde kullanılmasa
            // da ileride ör. risk göstergelerinde lazım olabilir diye korunuyor).
            const tickVol = (typeof p.tickVolatility === 'number') ? p.tickVolatility : p.volatility;
            const shock = (Math.random() - 0.5) * tickVol * BIST_KADEME_LIVELINESS_MULTIPLIER * rawBasis;
            let nextRaw = rawBasis + shock + meanReversion;
            // Kısa vadeli (tik-tik arası) dalgalanma artık günlük %6 bandı
            // yerine, en son bilinen GERÇEK fiyatın çok daha dar bir bandı
            // (±%1,5) içinde tutuluyor — böylece iki gerçek-veri senkronu
            // arasında fiyat gerçekten uzaklaşıp "kelepçelenerek" sıçramıyor.
            // Günlük %6 sınırı (gerçek borsa marj/tavan-taban benzeri emniyet
            // kemeri) dış sınır olarak ayrıca korunuyor.
            const localBandPct = 0.015;
            const localCapUp = anchor * (1 + localBandPct), localCapDown = anchor * (1 - localBandPct);
            nextRaw = Math.max(localCapDown, Math.min(localCapUp, nextRaw));
            const capUp = p.dayOpen * 1.06, capDown = p.dayOpen * 0.94;
            nextRaw = Math.max(capDown, Math.min(capUp, nextRaw));
            p.rawPrice = nextRaw;
            p.price = roundToBistTick(nextRaw);

            if (!Array.isArray(p.history)) p.history = [p.price];
            p.history.push(p.price);
            if (p.history.length > SPARK_HISTORY_LEN) p.history.shift();
        });

        renderWatchlistPrices();
        updateActiveSymbolTicket();
        if (state.activeSymbol && window.TradingChart) {
            window.TradingChart.updateLastPrice(state.activeSymbol, priceProfiles[state.activeSymbol].price);
        }
        renderPositions();
        renderAccountSummary();

        checkStopLossTakeProfit();
        checkMarginCalls();
        checkPendingOcoOrders();
        checkAlerts();
        checkIndicatorAlerts();

        sampleEquity();
        if (byId('panel-tab-performance')?.classList.contains('active')) renderPerformanceTab();
        if (byId('panel-tab-summary')?.classList.contains('active')) renderSummaryDetailTab();
        if (byId('heatmap-modal-backdrop')?.classList.contains('open')) renderHeatmap();
        // (22 Temmuz 2026, on ikinci oturum — madde 7) Profil paneli açıkken
        // bakiye/özkaynak/K-Z rakamları da canlı tik ile birlikte tazelensin.
        if (byId('profile-panel-dropdown')?.classList.contains('open')) renderProfilePanel();
        // (12 Ağustos 2026 — onay penceresi "eski fiyat" düzeltmesi) Emir
        // onay penceresi açıkken de gösterdiği fiyat, arka planda değişmeye
        // devam eden gerçek piyasa fiyatıyla senkron kalsın.
        refreshOrderConfirmModalIfOpen();
    }

    function getPrice(symbol) {
        return priceProfiles[symbol] ? priceProfiles[symbol].price : null;
    }

    // (22 Temmuz 2026, on ikinci oturum — ızgara ekranı anlık fiyat) 2x2
    // ızgara görünümü (multiChartGrid.js) her hücrede anlık fiyat/değişim
    // göstermek için priceProfiles'a doğrudan erişemiyor (module-level
    // private state) — bu küçük dışa açık yardımcı, watchlist'teki günlük
    // değişim yüzdesi hesabıyla (bkz. renderWatchlistPrices, ~satır 1371)
    // birebir aynı formülü tekrar kullanıyor, tek gerçek kaynak (priceProfiles)
    // hâlâ burada.
    function getChangePercent(symbol) {
        const p = priceProfiles[symbol];
        if (!p || !p.dayOpen) return null;
        return ((p.price - p.dayOpen) / p.dayOpen) * 100;
    }

    // (22 Temmuz 2026, on ikinci oturum — ızgara canlı fiyat çapası) Herhangi
    // bir sembolün simüle canlı tick fiyatını bilinen GERÇEK/güncel son
    // kapanışa yeniden çapalıyor — selectSymbol() içindeki aynı re-anchor
    // mantığının (bkz. yukarısı, ~satır 1526) genel amaçlı, dışa açık hali.
    // multiChartGrid.js her hücre yüklendiğinde kendi (backend'den ya da
    // simüle yedekten) getirdiği mum serisinin son kapanışıyla bunu çağırır
    // — aksi halde ızgaranın kendi bağımsız mum verisi ile priceProfiles'ın
    // uzun süredir biriken ayrı simülasyonu arasında büyük, gerçekçi
    // olmayan bir sıçrama oluşabilir (iki ayrı rastgele yürüyüş aynı
    // sembol için farklı sonlara varır). Sembol o an aktif sembolse ilgili
    // panelleri de tazeler.
    // (10 Ağustos 2026, dördüncü tur — "204 TL'den aldım, kısa süre sonra
    // 14 TL'den satılmış, kâr yerine dev zarar" hatası — GERÇEK ve ciddi bir
    // sistem arızası, kullanıcı hayal görmüyordu) Buraya kadarki üç
    // düzeltme (liveAnchor, tickVolatility, backend tekli-sembol/önbellek)
    // fiyatın YANLIŞ hızda/hedefte hareket etmesiyle ilgiliydi. tickPrices()
    // simülasyonunun kendisi zaten sıkı bantlanmış (liveAnchor'ın ±%1,5'i,
    // dayOpen'ın ±%6'sı) — yani KENDİ BAŞINA 204'ten 14'e gibi bir sıçrama
    // ÜRETEMEZ. Ama WebSocket tick'i, toplu /api/v1/quotes senkronu ve
    // sembol seçimindeki OHLCV son-kapanış çapalaması, backend'den/yfinance'ten
    // gelen "gerçek" fiyatı HİÇBİR MANTIKLILIK KONTROLÜ OLMADAN doğrudan
    // p.price'a yazıyordu. Ücretsiz bir veri kaynağından (yfinance) TEK bir
    // bozuk/hatalı veri noktası (ağ hatası, geçici önbellek/kolon karışıklığı,
    // ya da bir kurumsal işlem sonrası ayarlanmış/ayarlanmamış kapanış
    // karışıklığı) geldiğinde fiyat ekranda VE checkMarginCalls()/oto-SL
    // değerlendirmesinde ANINDA gerçekçi olmayan bir seviyeye sıçrıyor,
    // kaldıraçlı bir VİOP pozisyonunu anlık olarak eziyor ya da kullanıcıyı
    // panikle yanlış fiyattan kapamaya itiyordu. Çözüm: gelen her "gerçek"
    // fiyatı applyRealPriceUpdate() üzerinden geçiriyoruz — mevcut bilinen
    // fiyattan %20'den fazla sapan tek seferlik bir değeri HEMEN uygulamak
    // yerine "şüpheli" olarak saklıyor, ancak BİR SONRAKİ gerçek veri turunda
    // da aynı (yakın) seviye tekrar gelirse (yani tek seferlik bir veri hatası
    // değil, kalıcı bir fiyat seviyesiyse) uyguluyoruz. Bir sembol için henüz
    // hiç gerçek veri görülmediyse (hasRealAnchor false) bu kontrol atlanır —
    // ilk açılış çapası her zaman doğrudan uygulanmalı.
    const SUSPICIOUS_PRICE_JUMP_PCT = 0.20;
    const SUSPICIOUS_CONFIRM_TOLERANCE_PCT = 0.03;
    function applyRealPriceUpdate(symbol, realPrice, applyFn) {
        const p = priceProfiles[symbol];
        if (!p || typeof realPrice !== 'number' || !(realPrice > 0)) return false;

        // (12 Ağustos 2026 — BIST kademe sistemi) Gerçek veri de (yfinance'ten
        // 2 ondalıklı bir float olarak geldiği için) her zaman tam olarak
        // geçerli bir BIST kademesinde olmayabilir — applyFn sonrası
        // p.rawPrice/p.price burada MERKEZİ olarak set edilip yuvarlanıyor,
        // böylece p.price'ın HER ZAMAN geçerli bir kademede olması garantisi
        // (simüle tick'lerdeki gibi) gerçek veri güncellemeleri için de geçerli.
        if (!p.hasRealAnchor || !(p.price > 0)) {
            p.hasRealAnchor = true;
            p.pendingSuspiciousPrice = null;
            applyFn(p, realPrice);
            p.rawPrice = realPrice;
            p.price = roundToBistTick(realPrice);
            return true;
        }

        const deviation = Math.abs(realPrice - p.price) / p.price;
        if (deviation <= SUSPICIOUS_PRICE_JUMP_PCT) {
            p.pendingSuspiciousPrice = null;
            applyFn(p, realPrice);
            p.rawPrice = realPrice;
            p.price = roundToBistTick(realPrice);
            return true;
        }

        const pending = p.pendingSuspiciousPrice;
        if (pending && Math.abs(realPrice - pending) / pending <= SUSPICIOUS_CONFIRM_TOLERANCE_PCT) {
            // Aynı şüpheli seviye art arda ikinci kez geldi — artık tek
            // seferlik bir veri hatası olma ihtimali çok düşük, kalıcı kabul
            // edip uyguluyoruz.
            p.pendingSuspiciousPrice = null;
            applyFn(p, realPrice);
            p.rawPrice = realPrice;
            p.price = roundToBistTick(realPrice);
            if (window.console && console.warn) console.warn(`[OptiPulse] ${symbol}: büyük fiyat sıçraması (%${(deviation * 100).toFixed(1)}) iki ayrı veri turunda doğrulandı, uygulandı.`);
            return true;
        }

        p.pendingSuspiciousPrice = realPrice;
        if (window.console && console.warn) console.warn(`[OptiPulse] ${symbol}: şüpheli fiyat sıçraması (₺${p.price} -> ₺${realPrice}, %${(deviation * 100).toFixed(1)}) — tek seferlik veri hatası olabilir, doğrulanana kadar UYGULANMADI.`);
        return false;
    }

    function syncPriceAnchor(symbol, lastClose) {
        const p = priceProfiles[symbol];
        if (!p || !lastClose) return;
        // (17 Ağustos 2026) ARTIK dayOpen burada set edilmiyor — "son kapanış"
        // (lastClose) günün canlı/en güncel fiyatıdır, GERÇEK önceki gün
        // kapanışı değildir; ikisini eşitlemek %değişimi anlık olarak (yanlış
        // biçimde) %0'a sıfırlıyordu. dayOpen artık YALNIZCA syncWatchlistPrices()
        // içindeki gerçek backend prevClose verisiyle güncelleniyor (bkz. o
        // fonksiyondaki 17 Ağustos notu) — bu da zaten 40sn içinde devreye girer.
        const applied = applyRealPriceUpdate(symbol, lastClose, (prof, val) => {
            prof.price = val;
            prof.liveAnchor = val;
        });
        if (!applied) return;
        renderWatchlistPrices();
        if (symbol === state.activeSymbol) {
            updateActiveSymbolTicket();
        }
    }

    /* ════════════════════════════════════════════════
       Canlı veri akışı (WebSocket) — sadece aktif sembol
       ════════════════════════════════════════════════ */
    // (17-18 Temmuz 2026, sekizinci oturum — "motor" geliştirmesi)
    // Backend'deki /ws/live/{ticker} ucu artık periyodik olarak GERÇEK
    // yfinance fiyatı push ediyor (bkz. main.py). Burada sadece o an
    // ekranda açık olan TEK sembol için bağlanıyoruz — 97 sembolün hepsi
    // için ayrı soket açmak hem tarayıcı hem backend kaynaklarını gereksiz
    // yere tüketirdi. Gelen her gerçek fiyat, mevcut 2 saniyelik client-
    // side rastgele-yürüyüş simülasyonuna bir "çıpa" olarak besleniyor
    // (fiyatı doğrudan o değere ayarlıyoruz) — böylece simülasyon periyodik
    // olarak gerçeğe demirleniyor ama aradaki saniyelerde akıcı görünmeye
    // devam ediyor. Bağlantı hiç kurulamazsa veya koparsa (ör. kullanıcı
    // backend'i kapatmışsa, ya da HTTPS/Vercel ortamında Local Network
    // Access izni yoksa) sessizce sadece mevcut simülasyona devam edilir —
    // hiçbir hata kullanıcıya sızmaz, işlevsellik bozulmaz.
    const LIVE_FEED_URL_BASE = (window.OPTIPULSE_CONFIG ? window.OPTIPULSE_CONFIG.BACKEND_WS : 'ws://127.0.0.1:8000') + '/ws/live/';
    // (18 Temmuz 2026, dokuzuncu oturum) Otomatik yeniden bağlanma: sabit
    // bir aralık yerine küçük bir üstel geri çekilme (backoff) kullanılıyor
    // (3sn → 6sn → 12sn → 24sn, 30sn'de tavan) — backend gerçekten kapalıysa
    // (kullanıcı sunucuyu hiç çalıştırmıyorsa) saniyede bir boşuna deneyip
    // konsolu/ağı yormamak için. Bir tick başarıyla alınınca sayaç sıfırlanır.
    const RECONNECT_BASE_DELAY_MS = 3000;
    const RECONNECT_MAX_DELAY_MS = 30000;
    let liveSocket = null;
    let liveFeedSymbol = null;
    let liveFeedActive = false;   // en az bir gerçek 'tick' mesajı alındı mı
    let liveFeedLastTickAt = null;
    let liveReconnectTimer = null;
    let liveReconnectAttempt = 0;

    function updateEngineFeedStatus() {
        if (typeof window.__optipulseSetLiveFeedStatus === 'function') {
            window.__optipulseSetLiveFeedStatus({
                active: liveFeedActive,
                symbol: liveFeedSymbol,
                lastTickAt: liveFeedLastTickAt
            });
        }
    }

    function cancelLiveReconnect() {
        if (liveReconnectTimer) {
            clearTimeout(liveReconnectTimer);
            liveReconnectTimer = null;
        }
        liveReconnectAttempt = 0;
    }

    function disconnectLiveFeed() {
        cancelLiveReconnect();
        if (liveSocket) {
            try { liveSocket.onclose = null; liveSocket.onmessage = null; liveSocket.onerror = null; liveSocket.close(); } catch (e) { /* ignore */ }
            liveSocket = null;
        }
        liveFeedSymbol = null;
        liveFeedActive = false;
        liveFeedLastTickAt = null;
        updateEngineFeedStatus();
    }

    function openLiveSocket(symbol) {
        if (!symbol || typeof WebSocket === 'undefined') return;
        let socket;
        try {
            socket = new WebSocket(LIVE_FEED_URL_BASE + symbol);
        } catch (e) {
            // Tarayıcı WebSocket kurulumunu reddetti (ör. mixed-content
            // güvenlik politikası) — sessizce mevcut simülasyona devam.
            return;
        }
        liveSocket = socket;

        socket.onmessage = (event) => {
            if (liveSocket !== socket) return; // sembol bu arada değişmiş, bu artık eski bir soket
            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            if (!msg || msg.type !== 'tick' || msg.source !== 'live' || typeof msg.price !== 'number' || !(msg.price > 0)) return;

            const p = priceProfiles[symbol];
            if (p) {
                // Gerçek fiyata demirle. Normalde dayOpen'a dokunmuyoruz
                // (gün içi ±%6 bandı gerçek gün açılışına göre hesaplanmaya
                // devam etsin) — ama gelen gerçek fiyat mevcut bandın çok
                // dışındaysa (ör. dayOpen tohumu bir şekilde bayatsa, ya da
                // gün içinde büyük bir hareket olduysa), bandı da gerçeğe
                // göre yeniden merkezliyoruz. Aksi halde bir sonraki 2
                // saniyelik simülasyon tick'i bu gerçek fiyatı hatalı
                // şekilde eski banda geri "kelepçeler" — tıpkı sembol ilk
                // seçildiğinde selectSymbol()'ün yaptığı ilk çıpalama gibi.
                // (10 Ağustos 2026, dördüncü tur) Artık bu doğrudan atama
                // yerine applyRealPriceUpdate() üzerinden geçiyor — tek
                // seferlik bozuk bir yfinance tick'inin fiyatı anında
                // gerçekçi olmayan bir seviyeye sıçratmasını engeller (bkz.
                // fonksiyonun tanımındaki not).
                const applied = applyRealPriceUpdate(symbol, msg.price, (prof, price) => {
                    const capUp = prof.dayOpen * 1.06, capDown = prof.dayOpen * 0.94;
                    if (price > capUp || price < capDown) {
                        prof.dayOpen = price;
                    }
                    prof.liveAnchor = price;
                    prof.price = +price.toFixed(2);
                });
                if (applied) {
                    renderWatchlistPrices();
                    updateActiveSymbolTicket();
                    if (window.TradingChart) window.TradingChart.updateLastPrice(symbol, p.price);
                    renderPositions();
                    renderAccountSummary();
                }
            }
            liveFeedActive = true;
            liveFeedLastTickAt = Date.now();
            liveReconnectAttempt = 0; // gerçek veri akıyor, geri çekilme sayacı sıfırlanır
            updateEngineFeedStatus();
        };
        socket.onerror = () => { /* sessizce yut — onclose zaten tetiklenecek */ };
        socket.onclose = () => {
            if (liveSocket !== socket) return; // zaten değiştirilmiş/kapatılmış eski bir soket
            liveSocket = null;
            liveFeedActive = false;
            updateEngineFeedStatus();
            // Sembol hâlâ aktifse (kullanıcı bilerek disconnectLiveFeed()
            // çağırmadıysa, ör. başka bir sembole geçmediyse) bağlantı
            // beklenmedik şekilde koptu demektir — otomatik tekrar dene.
            if (liveFeedSymbol === symbol) {
                const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, liveReconnectAttempt), RECONNECT_MAX_DELAY_MS);
                liveReconnectAttempt++;
                liveReconnectTimer = setTimeout(() => {
                    liveReconnectTimer = null;
                    if (liveFeedSymbol === symbol) openLiveSocket(symbol);
                }, delay);
            }
        };
    }

    function connectLiveFeed(symbol) {
        disconnectLiveFeed();
        if (!symbol || typeof WebSocket === 'undefined') return;
        liveFeedSymbol = symbol;
        openLiveSocket(symbol);
    }

    // (18 Temmuz 2026, dokuzuncu oturum — "tüm watchlist için periyodik
    // gerçek fiyat senkronizasyonu") Canlı WebSocket akışı yukarıda sadece
    // o an ekranda seçili TEK sembol için çalışıyor; watchlist'teki diğer
    // ~96 sembol her zaman client-side simülasyonda kal(ıyor)dı. Bu
    // fonksiyon periyodik olarak (her WATCHLIST_SYNC_INTERVAL_MS'de bir)
    // backend'in toplu /api/v1/quotes endpoint'inden TÜM watchlist için
    // gerçek son kapanış fiyatlarını çekip uyguluyor — WS akışının aksine
    // bu "anlık tick" değil, periyodik bir "gerçeğe demirleme" turu.
    // Backend'e ulaşılamazsa (kapalıysa, LNA izni yoksa, ağ hatası vb.)
    // sessizce hiçbir şey yapmadan bir sonraki turu bekliyor — mevcut
    // simülasyon kesintisiz devam ediyor, hiçbir hata kullanıcıya sızmıyor.
    // (26 Temmuz 2026, on üçüncü oturum devamı — "hızlandırma: izleme
    // listesi senkron aralığı") 90sn önceden fazla "donuk" hissettiriyordu;
    // 40sn'ye düşürüldü. Bu TEK bir toplu istek olduğu için (97 sembolü
    // ayrı ayrı değil, tek /api/v1/quotes çağrısıyla) backend yükü ~2.25
    // kat artıyor ama hâlâ ihmal edilebilir düzeyde — buna karşılık
    // izleme listesindeki fiyatlar gerçek zamana çok daha yakın kalıyor.
    const WATCHLIST_SYNC_INTERVAL_MS = 40000;
    const WATCHLIST_SYNC_URL = (window.OPTIPULSE_CONFIG ? window.OPTIPULSE_CONFIG.BACKEND_HTTP : 'http://127.0.0.1:8000') + '/api/v1/quotes';

    async function syncWatchlistPrices() {
        if (!DC || !Array.isArray(DC.BIST100) || !DC.BIST100.length) return;
        const tickers = DC.BIST100.map(s => s.symbol);
        let json;
        try {
            const res = await fetch(WATCHLIST_SYNC_URL, window.optipulseFetchOpts({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tickers }),
                signal: AbortSignal.timeout(15000)
            }));
            if (!res.ok) return;
            json = await res.json();
        } catch (e) {
            return; // backend'e ulaşılamadı — sessizce vazgeç, simülasyon kesintisiz sürüyor
        }
        if (!json || !json.quotes || typeof json.quotes !== 'object') return;

        let anyUpdated = false;
        Object.keys(json.quotes).forEach((symbol) => {
            const price = json.quotes[symbol];
            const p = priceProfiles[symbol];
            if (!p || typeof price !== 'number' || !(price > 0)) return;
            // (17 Ağustos 2026 — "TradingView'de düşüş varken bizde yükseliş"
            // kök neden düzeltmesi) ÖNCEDEN dayOpen sadece gerçek fiyat mevcut
            // %6'lık banttan TAŞARSA yeniden merkezleniyordu — bu bir tahminti,
            // gerçek "önceki gün kapanışı" değildi. Haftalar süren bu demo
            // boyunca dayOpen bu yüzden ya haftalar önceki bir dataController.js
            // tohum değerinde (STOCK_PROFILES.basePrice) ya da geçmişte bir kez
            // %6 bandı aştığı rastgele bir anda "yakalanmış" bir fiyatta asılı
            // kalıyordu — gerçek günlük referanstan giderek uzaklaşıyor, hatta
            // YÖNÜ bile ters çıkabiliyordu. Artık backend (main.py, 17 Ağustos
            // düzeltmesi) her turda GERÇEK önceki gün kapanışını da (`prevClose`)
            // döndürüyor — TradingView'ın kullandığı referansla birebir aynı —
            // bunu doğrudan ve HER senkron turunda (40sn'de bir) kullanıyoruz,
            // artık tahmine/6%-eşiğine gerek yok. Yeni bir işlem gününe
            // geçildiğinde de (backend'in kendi period="2d" penceresi otomatik
            // kaydığı için) ek bir "gün değişti" mantığına gerek kalmadan
            // kendiliğinden güncelleniyor. Backend bu sembol için (nadir bir
            // durumda) prevClose döndüremezse eski %6 bant tahminine düşülüyor.
            const applied = applyRealPriceUpdate(symbol, price, (prof, val) => {
                const realPrevClose = (json.prevClose && typeof json.prevClose[symbol] === 'number' && json.prevClose[symbol] > 0)
                    ? json.prevClose[symbol]
                    : null;
                if (realPrevClose !== null) {
                    prof.dayOpen = realPrevClose;
                } else {
                    const capUp = prof.dayOpen * 1.06, capDown = prof.dayOpen * 0.94;
                    if (val > capUp || val < capDown) {
                        prof.dayOpen = val;
                    }
                }
                prof.liveAnchor = val;
                prof.price = +val.toFixed(2);
            });
            if (applied) anyUpdated = true;
        });

        if (anyUpdated) {
            renderWatchlistPrices();
            updateActiveSymbolTicket();
            if (state.activeSymbol && priceProfiles[state.activeSymbol] && window.TradingChart) {
                window.TradingChart.updateLastPrice(state.activeSymbol, priceProfiles[state.activeSymbol].price);
            }
            renderPositions();
            renderAccountSummary();
        }
    }

    // (29 Temmuz 2026 — Madde 3 "Kayar menüden güncel €,$,altın,gümüş,BIST,
    // brent vs. eklensin") Header'ın altındaki tam genişlikte kayan şeridi
    // periyodik olarak yeni /api/v1/market-ticker uç noktasından (main.py —
    // USDTRY=X/EURTRY=X/GC=F/SI=F/BZ=F/XU100.IS için gerçek yfinance verisi)
    // besliyor. syncWatchlistPrices ile AYNI dostane-hata deseni: backend'e
    // ulaşılamazsa sessizce vazgeçilip bir sonraki turu bekliyor, hiçbir
    // hata kullanıcıya sızmıyor, şerit son bilinen veriyle kalıyor.
    const MARKET_TICKER_SYNC_INTERVAL_MS = 60000;
    const MARKET_TICKER_URL = (window.OPTIPULSE_CONFIG ? window.OPTIPULSE_CONFIG.BACKEND_HTTP : 'http://127.0.0.1:8000') + '/api/v1/market-ticker';

    function renderMarketTickerStrip(items) {
        const track = byId('market-ticker-track');
        if (!track || !Array.isArray(items) || !items.length) return;
        const itemHtml = items.map(it => {
            const hasChange = typeof it.changePct === 'number';
            const isUp = hasChange && it.changePct >= 0;
            const changeCls = hasChange ? (isUp ? 'profit-text' : 'loss-text') : '';
            const arrow = hasChange ? (isUp ? '▲' : '▼') : '';
            const changeText = hasChange ? (arrow + Math.abs(it.changePct).toFixed(2) + '%') : '--';
            const priceText = (typeof it.price === 'number')
                ? it.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                : '--';
            return '<span class="market-ticker-item"><span class="mt-label">' + it.label + '</span>' +
                '<span class="mt-price">' + priceText + '</span>' +
                '<span class="mt-change ' + changeCls + '">' + changeText + '</span></span>';
        }).join('');
        // Aynı liste iki kez art arda basılıyor — @keyframes market-ticker-scroll
        // %-50 kaydırdığında ikinci kopya ilkinin başladığı yerde olduğu için
        // dikişsiz (seamless) bir döngü oluşuyor (bkz. styles.css).
        track.innerHTML = itemHtml + itemHtml;
    }

    async function syncMarketTickerStrip() {
        let json;
        try {
            const res = await fetch(MARKET_TICKER_URL, window.optipulseFetchOpts({
                method: 'GET',
                signal: AbortSignal.timeout(15000)
            }));
            if (!res.ok) return;
            json = await res.json();
        } catch (e) {
            return; // backend'e ulaşılamadı — sessizce vazgeç, şerit son bilinen veriyle kalır
        }
        if (!json || !Array.isArray(json.items) || !json.items.length) return;
        renderMarketTickerStrip(json.items);
    }

    /* ════════════════════════════════════════════════
       Right panel sub-tabs (Alım-Satım / Performans / Özet Detay)
       ════════════════════════════════════════════════ */
    // (3 Ağustos 2026 — kullanıcı isteği: "emir ve son işlemler demo fake ise
    // onları kaldır") Emir Defteri (bid/ask depth) ve Son İşlemler (tape)
    // sekmeleri BURADAN kaldırıldı — ikisi de tamamen Math.random() tabanlı
    // simülasyondu, gerçek BIST verisi ücretsiz hiçbir kaynaktan alınamıyor
    // (bkz. proje dokümanı "Emir Defteri Teknik Açıklama"). fmtQty/
    // buildOrderBookSide/renderOrderBook/orderBookRowHtml/
    // maybePushRecentTrade/renderRecentTrades fonksiyonlarının hepsi bu
    // sekimlerle birlikte kaldırıldı.

    function setupPanelSubtabs() {
        const tabs = document.querySelectorAll('.panel-subtab');
        if (!tabs.length) return;
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.panel-subtab-content').forEach(c => c.classList.remove('active'));
                const target = byId('panel-tab-' + tab.dataset.panelTab);
                if (target) target.classList.add('active');
                // Populate on-demand the first time a tab is revealed, rather
                // than waiting for the next 2s price tick.
                if (tab.dataset.panelTab === 'performance') renderPerformanceTab();
                if (tab.dataset.panelTab === 'summary') renderSummaryDetailTab();
            });
        });
    }

    /* ════════════════════════════════════════════════
       Portfolio performance analytics
       ════════════════════════════════════════════════ */

    const equityHistory = [];
    const MAX_EQUITY_POINTS = 150;

    function currentEquity() {
        let longValue = 0, shortValue = 0;
        // (29 Temmuz 2026 — Madde 11) Özkaynak eğrisi artık Spot VE VİOP
        // pozisyonlarının ikisini de kapsıyor — aksi halde VİOP'ta açık bir
        // pozisyon varken Performans sekmesindeki özkaynak eğrisi/Maks.
        // Drawdown hesabı eksik/yanlış olurdu.
        ['NORMAL', 'VIOP'].forEach(market => {
            const positions = book(market).positions;
            Object.keys(positions).forEach(symbol => {
                const pos = positions[symbol];
                const current = getPrice(symbol) || pos.avgPrice;
                if (pos.side === 'LONG') longValue += pos.qty * current;
                else shortValue += pos.qty * current;
            });
        });
        return effectiveBalance() + longValue - shortValue;
    }

    function sampleEquity() {
        equityHistory.push({ ts: Date.now(), value: currentEquity() });
        if (equityHistory.length > MAX_EQUITY_POINTS) equityHistory.shift();
    }

    function computePerformanceStats() {
        // (29 Temmuz 2026 — Madde 11) Performans istatistikleri artık Spot
        // VE VİOP'ta kapanmış işlemlerin TAMAMINI birlikte değerlendiriyor —
        // ikisi de aynı demo hesabın gerçek gerçekleşmiş K/Z'sini oluşturuyor.
        const closed = portfolio.history.concat(portfolio.viopHistory || []).filter(h => h.type === 'CLOSE' && h.pnl !== null);
        const wins = closed.filter(h => h.pnl > 0);
        const losses = closed.filter(h => h.pnl < 0);
        const grossProfit = wins.reduce((s, h) => s + h.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, h) => s + h.pnl, 0));
        const totalPnl = closed.reduce((s, h) => s + h.pnl, 0);
        const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
        const best = closed.reduce((m, h) => (m === null || h.pnl > m.pnl) ? h : m, null);
        const worst = closed.reduce((m, h) => (m === null || h.pnl < m.pnl) ? h : m, null);

        const bySymbol = {};
        closed.forEach(h => { bySymbol[h.symbol] = (bySymbol[h.symbol] || 0) + h.pnl; });

        // (23 Temmuz 2026, on üçüncü oturum — "motoru güçlendirme": gerçek
        // Sharpe Oranı + Maks. Drawdown) Önceden bu panelde bu iki metrik
        // hiç yoktu; başka bir yerde (artık kaldırılmış eski Canvas
        // pipeline'ında) UYDURMA/sabit değerler olarak vardı. Burada GERÇEK
        // kapanmış işlem geçmişinden (portfolio.history, localStorage'da
        // kalıcı) hesaplanıyor — hiçbir sabit/varsayılan sayı yok.
        //
        // portfolio.history en yeni işlem başta olacak şekilde tutuluyor
        // (unshift ile ekleniyor) — burada ts'e göre kronolojik (eskiden
        // yeniye) sıraya çevirip, DEFAULT_BALANCE'tan başlayarak işlem
        // işlem gerçek bir özkaynak eğrisi kuruyoruz. Not: portfolio.history
        // en fazla son 50 kaydı (açılış+kapanış toplam) tuttuğu için bu,
        // "son işlemlere dayalı" bir pencere — tüm hesap ömrü değil.
        const chronological = closed.slice().sort((a, b) => a.ts - b.ts);
        let runningEquity = DEFAULT_BALANCE;
        let peakEquity = DEFAULT_BALANCE;
        let maxDrawdownPct = 0;
        const tradeReturns = [];
        chronological.forEach(h => {
            const before = runningEquity;
            runningEquity += h.pnl;
            if (before > 0) tradeReturns.push(h.pnl / before);
            if (runningEquity > peakEquity) peakEquity = runningEquity;
            const dd = peakEquity > 0 ? ((peakEquity - runningEquity) / peakEquity) * 100 : 0;
            if (dd > maxDrawdownPct) maxDrawdownPct = dd;
        });

        // İşlem-bazlı (calendar-time değil) basitleştirilmiş Sharpe Oranı:
        // ortalama işlem getirisi / işlem getirilerinin standart sapması,
        // örneklem büyüklüğüyle ölçeklenir (√N). Risksiz getiri oranı bu
        // basit haliyle 0 kabul edilir (demo/kağıt-üzerinde portföy için
        // ayrı bir risksiz oran varsayımı yapmak yanıltıcı olurdu).
        let sharpeRatio = 0;
        if (tradeReturns.length >= 2) {
            const meanRet = tradeReturns.reduce((s, r) => s + r, 0) / tradeReturns.length;
            const variance = tradeReturns.reduce((s, r) => s + Math.pow(r - meanRet, 2), 0) / tradeReturns.length;
            const stdRet = Math.sqrt(variance);
            sharpeRatio = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(tradeReturns.length) : 0;
        }

        return { closed, wins, losses, grossProfit, grossLoss, totalPnl, winRate, profitFactor, best, worst, bySymbol, sharpeRatio, maxDrawdownPct };
    }

    // (2 Ağustos 2026 — revize planı madde 12) "Örnek bir özet detay
    // konulabilir" — aktif sembolün Günlük/Aylık/Yıllık aralığı içindeki
    // konumunu basit çubuklarla gösterir. Ham hesaplama tradingChart.js'teki
    // getDailyRangeSummary() içinde (state.dailyCandles üzerinden) yapılıyor;
    // burada sadece render ediliyor.
    function renderSummaryDetailTab() {
        const body = byId('qt-summary-detail-body');
        if (!body) return;
        if (!state.activeSymbol || !window.TradingChart || !window.TradingChart.getDailyRangeSummary) {
            body.innerHTML = '<div class="qt-summary-empty">Sembol seçin.</div>';
            return;
        }
        const summary = window.TradingChart.getDailyRangeSummary();
        if (!summary) {
            body.innerHTML = '<div class="qt-summary-empty">Veri yükleniyor...</div>';
            return;
        }
        const rows = [
            { label: 'Günlük', range: summary.daily },
            { label: 'Aylık', range: summary.monthly },
            { label: 'Yıllık', range: summary.yearly }
        ];
        let html = `<div class="qt-summary-last">Son Fiyat: <b>₺${fmtPrice(summary.last)}</b></div>`;
        rows.forEach(r => {
            const { low, high } = r.range;
            const span = high - low;
            const pct = span > 0 ? Math.min(100, Math.max(0, ((summary.last - low) / span) * 100)) : 50;
            html += `
                <div class="qt-summary-row">
                    <div class="qt-summary-row-label">${r.label}</div>
                    <div class="qt-summary-slider-wrap">
                        <span class="qt-summary-edge">₺${fmtPrice(low)}</span>
                        <div class="qt-summary-slider">
                            <div class="qt-summary-slider-dot" style="left:${pct}%"></div>
                        </div>
                        <span class="qt-summary-edge">₺${fmtPrice(high)}</span>
                    </div>
                </div>`;
        });
        body.innerHTML = html;
    }

    function renderPerformanceTab() {
        const totalPnlEl = byId('perf-total-pnl');
        if (!totalPnlEl) return; // tab markup not present

        const stats = computePerformanceStats();
        const winRateEl = byId('perf-win-rate');
        const tradeCountEl = byId('perf-trade-count');
        const pfEl = byId('perf-profit-factor');
        const sharpeEl = byId('perf-sharpe-ratio');
        const maxDdEl = byId('perf-max-drawdown');
        const bestEl = byId('perf-best-trade');
        const worstEl = byId('perf-worst-trade');
        const listEl = byId('perf-symbol-list');

        totalPnlEl.textContent = (stats.totalPnl >= 0 ? '+' : '') + fmtTRY(stats.totalPnl);
        totalPnlEl.className = 'perf-stat-val ' + (stats.totalPnl >= 0 ? 'profit-text' : 'loss-text');

        if (winRateEl) winRateEl.textContent = stats.closed.length ? stats.winRate.toFixed(1) + '%' : '--';
        if (tradeCountEl) tradeCountEl.textContent = String(stats.closed.length);
        if (pfEl) pfEl.textContent = stats.closed.length ? (stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)) : '--';
        if (sharpeEl) sharpeEl.textContent = stats.closed.length >= 2 ? stats.sharpeRatio.toFixed(2) : '--';
        if (maxDdEl) {
            maxDdEl.textContent = stats.closed.length ? '-' + stats.maxDrawdownPct.toFixed(2) + '%' : '--';
            maxDdEl.className = 'perf-stat-val ' + (stats.maxDrawdownPct > 0 ? 'loss-text' : '');
        }
        if (bestEl) {
            bestEl.textContent = stats.best ? (stats.best.pnl >= 0 ? '+' : '') + fmtTRY(stats.best.pnl) + ' (' + stats.best.symbol + ')' : '--';
            bestEl.className = 'perf-stat-val ' + (stats.best && stats.best.pnl < 0 ? 'loss-text' : 'profit-text');
        }
        if (worstEl) {
            worstEl.textContent = stats.worst ? fmtTRY(stats.worst.pnl) + ' (' + stats.worst.symbol + ')' : '--';
            worstEl.className = 'perf-stat-val ' + (stats.worst && stats.worst.pnl >= 0 ? 'profit-text' : 'loss-text');
        }

        if (listEl) {
            const symbols = Object.keys(stats.bySymbol).sort((a, b) => stats.bySymbol[b] - stats.bySymbol[a]);
            if (!symbols.length) {
                listEl.innerHTML = '<div class="alerts-empty">Henüz kapatılmış işlem yok.</div>';
            } else {
                listEl.innerHTML = symbols.map(sym => {
                    const pnl = stats.bySymbol[sym];
                    return '<div class="perf-symbol-row"><span>' + sym + '</span><span class="' +
                        (pnl >= 0 ? 'profit-text' : 'loss-text') + '">' + (pnl >= 0 ? '+' : '') + fmtTRY(pnl) + '</span></div>';
                }).join('');
            }
        }

        drawEquityCurve();
    }

    function drawEquityCurve() {
        const canvas = byId('perf-equity-canvas');
        const currentEl = byId('perf-equity-current');
        if (!canvas) return;
        if (currentEl) currentEl.textContent = fmtTRY(currentEquity());

        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // hidden tab, skip draw

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        if (equityHistory.length < 2) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '11px Outfit, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Veri toplanıyor...', rect.width / 2, rect.height / 2);
            return;
        }

        const values = equityHistory.map(p => p.value);
        const min = Math.min(...values), max = Math.max(...values);
        const range = (max - min) || 1;
        const padY = rect.height * 0.12;
        const plotH = rect.height - padY * 2;

        const pts = equityHistory.map((p, i) => ({
            x: (i / (equityHistory.length - 1)) * rect.width,
            y: padY + plotH - ((p.value - min) / range) * plotH
        }));

        const up = values[values.length - 1] >= values[0];
        const lineColor = up ? '#4CAF50' : '#F44336';

        const grad = ctx.createLinearGradient(0, 0, 0, rect.height);
        grad.addColorStop(0, up ? 'rgba(76,175,80,0.22)' : 'rgba(244,67,54,0.22)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length - 1].x, rect.height);
        ctx.lineTo(pts[0].x, rect.height);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    /* ════════════════════════════════════════════════
       Price Alerts (fiyat alarmları)
       ════════════════════════════════════════════════ */

    const ALERTS_STORAGE_KEY = 'optipulselab_price_alerts_v1';
    let priceAlerts = [];

    function loadAlerts() {
        try {
            const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) { /* ignore corrupt storage */ }
        return [];
    }

    function saveAlerts() {
        try { localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(priceAlerts)); } catch (e) { /* quota / private mode */ }
    }

    function addAlert(symbol, condition, targetPrice) {
        if (!symbol || !targetPrice || targetPrice <= 0) return null;
        const alert = {
            id: 'alrt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            symbol,
            condition, // 'above' | 'below'
            targetPrice: +targetPrice,
            createdAt: Date.now(),
            triggered: false,
            triggeredAt: null,
            triggeredPrice: null
        };
        priceAlerts.push(alert);
        saveAlerts();
        renderAlertsList();
        updateAlertBadge();
        return alert;
    }

    function deleteAlert(id) {
        priceAlerts = priceAlerts.filter(a => a.id !== id);
        saveAlerts();
        renderAlertsList();
        updateAlertBadge();
    }

    function checkAlerts() {
        if (!priceAlerts.length) return;
        let firedAny = false;
        priceAlerts.forEach(a => {
            if (a.triggered) return;
            const price = getPrice(a.symbol);
            if (price === null) return;
            const hit = a.condition === 'above' ? price >= a.targetPrice : price <= a.targetPrice;
            if (!hit) return;

            a.triggered = true;
            a.triggeredAt = Date.now();
            a.triggeredPrice = price;
            firedAny = true;

            const dirLabel = a.condition === 'above' ? 'üzerine çıktı' : 'altına indi';
            showToast(`🔔 ${a.symbol} hedef fiyatı ₺${fmtPrice(a.targetPrice)} seviyesinin ${dirLabel} (şu an ₺${fmtPrice(price)})`);
            playAlertChime();
            flashAlertBadge();

            if (window.Notification && Notification.permission === 'granted') {
                try {
                    new Notification('OptiPulseLab — Fiyat Alarmı', {
                        body: `${a.symbol} ₺${fmtPrice(a.targetPrice)} seviyesinin ${dirLabel}. Güncel fiyat: ₺${fmtPrice(price)}`
                    });
                } catch (e) { /* notifications unsupported / blocked in this browser */ }
            }
        });
        if (firedAny) {
            saveAlerts();
            renderAlertsList();
            updateAlertBadge();
        }
    }

    function updateAlertBadge() {
        const badge = byId('alert-count-badge');
        if (!badge) return;
        // (29 Temmuz 2026 — Madde 20) Rozet, fiyat alarmları + gösterge
        // alarmlarının TOPLAM aktif sayısını gösteriyor — kullanıcı için
        // "bekleyen alarmım var mı" tek bir yerden anlaşılır kalsın diye.
        const activeCount = priceAlerts.filter(a => !a.triggered).length +
            indicatorAlerts.filter(a => !a.triggered).length;
        if (activeCount > 0) {
            badge.textContent = String(activeCount);
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    let alertFlashTimer = null;
    function flashAlertBadge() {
        const btn = byId('btn-open-alerts');
        if (!btn) return;
        btn.classList.remove('alert-flash');
        // force reflow so the animation restarts if it's already mid-flash
        void btn.offsetWidth;
        btn.classList.add('alert-flash');
        clearTimeout(alertFlashTimer);
        alertFlashTimer = setTimeout(() => btn.classList.remove('alert-flash'), 1700);
    }

    function alertRowHtml(a) {
        const dirLabel = a.condition === 'above' ? '≥' : '≤';
        const statusLabel = a.triggered ? 'Tetiklendi' : 'Aktif';
        return '<div class="alert-item ' + (a.triggered ? 'triggered' : '') + '">' +
            '<div class="alert-item-main">' +
                '<span class="alert-item-symbol">' + a.symbol + '</span>' +
                '<span class="alert-item-cond">' + dirLabel + ' ₺' + fmtPrice(a.targetPrice) + '</span>' +
                '<span class="alert-item-status">' + statusLabel + '</span>' +
            '</div>' +
            '<button type="button" class="alert-delete-btn" data-id="' + a.id + '" title="Sil">×</button>' +
        '</div>';
    }

    function renderAlertsList() {
        const activeEl = byId('active-alerts-list');
        const triggeredEl = byId('triggered-alerts-list');
        const triggeredSection = byId('triggered-alerts-section');
        const emptyMsg = byId('alerts-empty-msg');
        if (!activeEl) return;

        const active = priceAlerts.filter(a => !a.triggered).sort((a, b) => b.createdAt - a.createdAt);
        const triggered = priceAlerts.filter(a => a.triggered).sort((a, b) => b.triggeredAt - a.triggeredAt);

        activeEl.innerHTML = active.map(alertRowHtml).join('');
        if (emptyMsg) emptyMsg.style.display = active.length ? 'none' : 'block';

        if (triggeredSection) triggeredSection.style.display = triggered.length ? 'block' : 'none';
        if (triggeredEl) triggeredEl.innerHTML = triggered.map(alertRowHtml).join('');

        document.querySelectorAll('.alert-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteAlert(btn.dataset.id));
        });
    }

    function populateAlertSymbolSelect() {
        const sel = byId('alert-symbol-select');
        if (!sel || !DC) return;
        const prevValue = sel.value;
        sel.innerHTML = DC.BIST100.map(s => '<option value="' + s.symbol + '">' + s.symbol + ' — ' + s.name + '</option>').join('');
        sel.value = state.activeSymbol && DC.BIST100.some(s => s.symbol === state.activeSymbol)
            ? state.activeSymbol
            : (prevValue || sel.value);
    }

    /* ════════════════════════════════════════════════
       Gösterge Bazlı Koşullu Alarmlar (Madde 20)
       ════════════════════════════════════════════════
       Fiyat alarmlarından (yukarısı) KASITLI olarak ayrı bir sistem: kontrol
       mekanizması farklı ve daha kısıtlı. RSI/EMA hesaplaması geçmiş mum
       verisi gerektirir, bu veri yalnızca tradingChart.js'in o an ekranda
       AÇIK olan sembol için yüklediği state.candles/state.indicators'ta
       mevcut — watchlist'teki diğer ~96 sembol için (priceProfiles'taki
       basit simüle fiyatın aksine) RSI/EMA geçmişi hiç hesaplanmıyor. Bu
       yüzden: (a) alarm kurarken sembol serbest seçilemiyor, o an aktif
       grafik sembolüne bağlanıyor, (b) checkIndicatorAlerts() yalnızca o an
       aktif sembolün alarmlarını değerlendirebiliyor — başka bir sembol için
       kurulmuş bir alarm, kullanıcı o sembolü tekrar grafikte açana kadar
       "uykuda" kalır (bu, alarmın silinmesi/bozuk olması değil, mimari bir
       kısıt — arayüzde bilgi ikonuyla açıkça belirtiliyor). */

    const INDICATOR_ALERTS_STORAGE_KEY = 'optipulselab_indicator_alerts_v1';
    let indicatorAlerts = [];

    function loadIndicatorAlerts() {
        try {
            const raw = localStorage.getItem(INDICATOR_ALERTS_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) { /* ignore corrupt storage */ }
        return [];
    }

    function saveIndicatorAlerts() {
        try { localStorage.setItem(INDICATOR_ALERTS_STORAGE_KEY, JSON.stringify(indicatorAlerts)); } catch (e) { /* quota / private mode */ }
    }

    function indicatorAlertLabel(a) {
        if (a.indType === 'RSI_CROSS_BELOW') return 'RSI ' + a.threshold + "'un altına inince";
        if (a.indType === 'RSI_CROSS_ABOVE') return 'RSI ' + a.threshold + "'un üzerine çıkınca";
        if (a.indType === 'EMA20_TOUCH') return "Fiyat EMA(20)'ye dokununca";
        return a.indType;
    }

    function addIndicatorAlert(symbol, indType, threshold) {
        if (!symbol || !indType) return null;
        const alert = {
            id: 'ialrt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            symbol,
            indType, // 'RSI_CROSS_BELOW' | 'RSI_CROSS_ABOVE' | 'EMA20_TOUCH'
            threshold: (indType === 'EMA20_TOUCH') ? null : (+threshold || (indType === 'RSI_CROSS_ABOVE' ? 70 : 30)),
            createdAt: Date.now(),
            triggered: false,
            triggeredAt: null,
            triggeredValueText: null
        };
        indicatorAlerts.push(alert);
        saveIndicatorAlerts();
        renderIndicatorAlertsList();
        updateAlertBadge();
        return alert;
    }

    function deleteIndicatorAlert(id) {
        indicatorAlerts = indicatorAlerts.filter(a => a.id !== id);
        saveIndicatorAlerts();
        renderIndicatorAlertsList();
        updateAlertBadge();
    }

    // Her fiyat tick'inde (bkz. tickPrices() içindeki çağrı) çalışır. Sadece
    // o an tradingChart.js'te yüklü olan AKTİF sembol için bir "snapshot"
    // (son iki bar'lık RSI/EMA20/fiyat) alınabiliyor — kesişim/dokunma
    // tespiti önceki-şimdiki karşılaştırmasıyla yapılıyor (statik bir eşik
    // kontrolü DEĞİL, ör. RSI zaten 25 iken yeniden 25'te tetiklenmesin diye
    // yalnızca eşiği GERÇEKTEN KESTİĞİ an bir kez ateşleniyor).
    function checkIndicatorAlerts() {
        if (!indicatorAlerts.length) return;
        if (!window.TradingChart || !window.TradingChart.getIndicatorAlertSnapshot) return;
        const snap = window.TradingChart.getIndicatorAlertSnapshot();
        if (!snap) return;

        let firedAny = false;
        indicatorAlerts.forEach(a => {
            if (a.triggered) return;
            if (a.symbol !== snap.symbol) return; // bu sembol o an aktif değil — kontrol edilemez

            let hit = false, valueText = '';
            if (a.indType === 'RSI_CROSS_BELOW') {
                if (snap.rsiPrev != null && snap.rsiLast != null && snap.rsiPrev >= a.threshold && snap.rsiLast < a.threshold) {
                    hit = true; valueText = 'RSI ' + snap.rsiLast.toFixed(1);
                }
            } else if (a.indType === 'RSI_CROSS_ABOVE') {
                if (snap.rsiPrev != null && snap.rsiLast != null && snap.rsiPrev <= a.threshold && snap.rsiLast > a.threshold) {
                    hit = true; valueText = 'RSI ' + snap.rsiLast.toFixed(1);
                }
            } else if (a.indType === 'EMA20_TOUCH') {
                if (snap.ema20Prev != null && snap.ema20Last != null && snap.prevPrice != null) {
                    const prevDiff = snap.prevPrice - snap.ema20Prev;
                    const currDiff = snap.price - snap.ema20Last;
                    // İşaret değişimi (kesişim) YA DA fiyat EMA'nın binde 2'sinden
                    // daha yakınsa ("dokunma") — hem gerçek bir kesişimi hem de
                    // tam üzerine oturup kesmeyen bir "dokunuşu" yakalar.
                    const touchedWithoutCross = Math.abs(currDiff) <= snap.ema20Last * 0.002;
                    if (prevDiff * currDiff <= 0 || touchedWithoutCross) {
                        hit = true; valueText = 'Fiyat ₺' + fmtPrice(snap.price) + ', EMA(20) ₺' + fmtPrice(snap.ema20Last);
                    }
                }
            }
            if (!hit) return;

            a.triggered = true;
            a.triggeredAt = Date.now();
            a.triggeredValueText = valueText;
            firedAny = true;

            showToast(`🔔 ${a.symbol} — ${indicatorAlertLabel(a)} tetiklendi (${valueText})`);
            playAlertChime();
            flashAlertBadge();

            if (window.Notification && Notification.permission === 'granted') {
                try {
                    new Notification('OptiPulseLab — Gösterge Alarmı', {
                        body: `${a.symbol}: ${indicatorAlertLabel(a)} — ${valueText}`
                    });
                } catch (e) { /* notifications unsupported / blocked */ }
            }
        });
        if (firedAny) {
            saveIndicatorAlerts();
            renderIndicatorAlertsList();
            updateAlertBadge();
        }
    }

    function indicatorAlertRowHtml(a) {
        const statusLabel = a.triggered ? 'Tetiklendi' : 'Aktif';
        return '<div class="alert-item ' + (a.triggered ? 'triggered' : '') + '">' +
            '<div class="alert-item-main">' +
                '<span class="alert-item-symbol">' + a.symbol + '</span>' +
                '<span class="alert-item-cond">' + indicatorAlertLabel(a) + '</span>' +
                '<span class="alert-item-status">' + statusLabel + '</span>' +
            '</div>' +
            '<button type="button" class="indicator-alert-delete-btn" data-id="' + a.id + '" title="Sil">×</button>' +
        '</div>';
    }

    function renderIndicatorAlertsList() {
        const activeEl = byId('active-indicator-alerts-list');
        const emptyMsg = byId('indicator-alerts-empty-msg');
        if (!activeEl) return;
        const active = indicatorAlerts.slice().sort((a, b) => b.createdAt - a.createdAt);
        activeEl.innerHTML = active.map(indicatorAlertRowHtml).join('');
        if (emptyMsg) emptyMsg.style.display = active.length ? 'none' : 'block';
        document.querySelectorAll('.indicator-alert-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteIndicatorAlert(btn.dataset.id));
        });
    }

    function setupAlertsModal() {
        const backdrop = byId('alerts-modal-backdrop');
        const openBtn = byId('btn-open-alerts');
        const closeBtn = byId('btn-close-alerts');
        const addBtn = byId('btn-add-alert');
        const priceInput = byId('alert-target-price');
        const notifRow = byId('alert-notif-toggle-row');
        const notifChk = byId('alert-notif-checkbox');
        const indAddBtn = byId('btn-add-indicator-alert');
        const indActiveSymbolEl = byId('ind-alert-active-symbol');
        const indTypeSelect = byId('ind-alert-type-select');
        const indThresholdInput = byId('ind-alert-threshold');
        if (!backdrop || !openBtn) return;

        const updateIndicatorThresholdVisibility = () => {
            if (!indTypeSelect || !indThresholdInput) return;
            const isEma = indTypeSelect.value === 'EMA20_TOUCH';
            indThresholdInput.style.display = isEma ? 'none' : '';
            if (!isEma && indTypeSelect.value === 'RSI_CROSS_ABOVE' && indThresholdInput.value === '30') {
                indThresholdInput.value = '70';
            } else if (!isEma && indTypeSelect.value === 'RSI_CROSS_BELOW' && indThresholdInput.value === '70') {
                indThresholdInput.value = '30';
            }
        };
        if (indTypeSelect) indTypeSelect.addEventListener('change', updateIndicatorThresholdVisibility);

        const open = () => {
            closeOtherModals('alerts-modal-backdrop');

            populateAlertSymbolSelect();
            if (priceInput && state.activeSymbol) {
                const p = getPrice(state.activeSymbol);
                if (p) priceInput.placeholder = 'Örn: ' + fmtPrice(p);
            }
            if (notifRow && window.Notification) {
                notifRow.style.display = 'flex';
                if (notifChk) notifChk.checked = Notification.permission === 'granted';
            }
            // (Madde 20) Gösterge alarmı her zaman o an aktif olan grafik
            // sembolüne bağlanıyor — serbest sembol seçimi yok (bkz. yukarıdaki
            // mimari kısıt notu).
            if (indActiveSymbolEl) {
                indActiveSymbolEl.textContent = state.activeSymbol ? ('Aktif sembol: ' + state.activeSymbol) : 'Aktif sembol: (önce bir sembol açın)';
            }
            if (indAddBtn) indAddBtn.disabled = !state.activeSymbol;
            updateIndicatorThresholdVisibility();
            renderAlertsList();
            renderIndicatorAlertsList();
            backdrop.classList.add('open');
        };
        const close = () => backdrop.classList.remove('open');

        openBtn.addEventListener('click', open);
        if (closeBtn) closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
        });

        if (notifChk) {
            notifChk.addEventListener('change', () => {
                if (notifChk.checked && window.Notification && Notification.permission !== 'granted') {
                    Notification.requestPermission().then(perm => {
                        notifChk.checked = perm === 'granted';
                        if (perm !== 'granted') showToast('Tarayıcı bildirimlerine izin verilmedi.');
                    });
                }
            });
        }

        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const symbol = byId('alert-symbol-select')?.value;
                const condition = byId('alert-condition-select')?.value || 'above';
                const targetPrice = parseFloat(priceInput?.value);
                if (!symbol) { showToast('Bir sembol seçin.'); return; }
                if (!targetPrice || targetPrice <= 0) { showToast('Geçerli bir hedef fiyat girin.'); return; }
                addAlert(symbol, condition, targetPrice);
                if (priceInput) priceInput.value = '';
                showToast(`Alarm oluşturuldu: ${symbol} ${condition === 'above' ? '≥' : '≤'} ₺${fmtPrice(targetPrice)}`);
            });
        }

        if (indAddBtn) {
            indAddBtn.addEventListener('click', () => {
                if (!state.activeSymbol) { showToast('Önce grafikte bir sembol açın.'); return; }
                const indType = indTypeSelect?.value || 'RSI_CROSS_BELOW';
                const threshold = indThresholdInput ? parseFloat(indThresholdInput.value) : null;
                if (indType !== 'EMA20_TOUCH' && (!threshold || threshold <= 0 || threshold >= 100)) {
                    showToast('RSI eşiği için 1-99 arası bir değer girin.');
                    return;
                }
                const alert = addIndicatorAlert(state.activeSymbol, indType, threshold);
                if (alert) showToast(`Gösterge alarmı oluşturuldu: ${state.activeSymbol} — ${indicatorAlertLabel(alert)}`);
            });
        }
    }

    /* ════════════════════════════════════════════════
       BIST100 Heatmap
       ════════════════════════════════════════════════ */

    function computeHeatmapData() {
        return DC.BIST100.map(({ symbol }) => {
            const p = priceProfiles[symbol];
            if (!p) return null;
            const chgPct = ((p.price - p.dayOpen) / p.dayOpen) * 100;
            const profile = DC.STOCK_PROFILES && DC.STOCK_PROFILES[symbol];
            const sector = (profile && profile.sector) || 'Diğer';
            return { symbol, price: p.price, chgPct, sector };
        }).filter(Boolean);
    }

    function heatmapColor(chgPct) {
        const maxAbs = 5; // % magnitude at which the color reaches full saturation
        const t = Math.min(1, Math.abs(chgPct) / maxAbs);
        const base = [40, 42, 47];   // neutral dark tile (near 0% change)
        const pos = [46, 143, 78];   // green
        const neg = [176, 58, 58];   // red
        const target = chgPct >= 0 ? pos : neg;
        const rgb = base.map((c, i) => Math.round(c + (target[i] - c) * t));
        return 'rgb(' + rgb.join(',') + ')';
    }

    function heatmapTileHtml(d) {
        const sign = d.chgPct >= 0 ? '+' : '';
        return '<div class="heatmap-tile" style="background-color:' + heatmapColor(d.chgPct) + '" data-symbol="' + d.symbol + '" title="' + d.symbol + ' · ' + d.sector + ' · ' + sign + d.chgPct.toFixed(2) + '% · ₺' + fmtPrice(d.price) + '">' +
            '<span class="heatmap-tile-symbol">' + d.symbol + '</span>' +
            '<span class="heatmap-tile-chg">' + sign + d.chgPct.toFixed(2) + '%</span>' +
            '</div>';
    }

    // Sektöre göre gruplu ısı haritası (17 Temmuz 2026, yedinci oturum):
    // her sektör kendi başlığı (isim + hisse sayısı + sektör ortalama %
    // değişim) ile ayrı bir bölüm olarak render ediliyor, bölüm içindeki
    // hisseler kendi aralarında değişime göre sıralı. Kullanıcı "Değişime
    // Göre" moduna geçerse eski düz/tek-ızgara görünüme dönülüyor.
    function renderHeatmap() {
        const container = byId('heatmap-content');
        if (!container) return;
        const data = computeHeatmapData();

        if (state.heatmapGroupBy === 'flat') {
            const sorted = data.slice().sort((a, b) => b.chgPct - a.chgPct);
            container.innerHTML = '<div class="heatmap-grid">' + sorted.map(heatmapTileHtml).join('') + '</div>';
        } else {
            const bySector = new Map();
            data.forEach(d => {
                if (!bySector.has(d.sector)) bySector.set(d.sector, []);
                bySector.get(d.sector).push(d);
            });
            const sectors = Array.from(bySector.entries()).map(([sector, tiles]) => {
                tiles.sort((a, b) => b.chgPct - a.chgPct);
                const avgChg = tiles.reduce((sum, t) => sum + t.chgPct, 0) / tiles.length;
                return { sector, tiles, avgChg };
            }).sort((a, b) => b.avgChg - a.avgChg); // en güçlü sektör en üstte

            container.innerHTML = sectors.map(s => {
                const sign = s.avgChg >= 0 ? '+' : '';
                const avgClass = s.avgChg >= 0 ? 'profit-text' : 'loss-text';
                return '<div class="heatmap-sector-group">' +
                    '<div class="heatmap-sector-header">' +
                    '<span class="heatmap-sector-name">' + s.sector + '</span>' +
                    '<span class="heatmap-sector-count">' + s.tiles.length + ' hisse</span>' +
                    '<span class="heatmap-sector-avg ' + avgClass + '">Ort. ' + sign + s.avgChg.toFixed(2) + '%</span>' +
                    '</div>' +
                    '<div class="heatmap-grid">' + s.tiles.map(heatmapTileHtml).join('') + '</div>' +
                    '</div>';
            }).join('');
        }

        container.querySelectorAll('.heatmap-tile').forEach(tile => {
            tile.addEventListener('click', () => {
                const symbol = tile.dataset.symbol;
                byId('heatmap-modal-backdrop')?.classList.remove('open');
                selectSymbol(symbol);
            });
        });
    }

    function setupHeatmapGroupByToggle() {
        const buttons = document.querySelectorAll('.heatmap-groupby-btn');
        if (!buttons.length) return;
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                state.heatmapGroupBy = btn.dataset.groupby;
                buttons.forEach(b => b.classList.toggle('active', b === btn));
                renderHeatmap();
            });
        });
    }

    function setupHeatmapModal() {
        const backdrop = byId('heatmap-modal-backdrop');
        const openBtn = byId('btn-open-heatmap');
        const closeBtn = byId('btn-close-heatmap');
        if (!backdrop || !openBtn) return;
        setupHeatmapGroupByToggle();

        const open = () => {
            closeOtherModals('heatmap-modal-backdrop');
            renderHeatmap();
            backdrop.classList.add('open');
        };
        const close = () => backdrop.classList.remove('open');

        openBtn.addEventListener('click', open);
        if (closeBtn) closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
        });
    }

    /* ════════════════════════════════════════════════
       Keyboard shortcuts
       ════════════════════════════════════════════════ */

    function setupShortcutsModal() {
        const backdrop = byId('shortcuts-modal-backdrop');
        const openBtn = byId('btn-open-shortcuts');
        const closeBtn = byId('btn-close-shortcuts');
        if (!backdrop || !openBtn) return;

        const open = () => {
            closeOtherModals('shortcuts-modal-backdrop');
            backdrop.classList.add('open');
        };
        const close = () => backdrop.classList.remove('open');
        window.__optipulseToggleShortcuts = () => {
            if (backdrop.classList.contains('open')) close(); else open();
        };

        openBtn.addEventListener('click', open);
        if (closeBtn) closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
        });
    }

    // (18 Temmuz 2026, dokuzuncu oturum — "Yardım / Hakkında modalı")
    // Kısayollar modalıyla birebir aynı aç/kapat/backdrop/Escape deseni.
    function setupHelpModal() {
        const backdrop = byId('help-modal-backdrop');
        const openBtn = byId('btn-open-help');
        const closeBtn = byId('btn-close-help');
        if (!backdrop || !openBtn) return;

        const open = () => {
            closeOtherModals('help-modal-backdrop');
            backdrop.classList.add('open');
        };
        const close = () => backdrop.classList.remove('open');

        openBtn.addEventListener('click', open);
        if (closeBtn) closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
        });
    }

    // (18 Temmuz 2026, dördüncü tur — "Komut Paleti")
    // Ctrl+K / "/" ile açılır; sembol arama ve sık kullanılan işlemleri (tema,
    // ses, reset, tur, ısı haritası, kısayollar, yardım, göstergeler paneli)
    // tek bir arama kutusunda birleştirir. Hiçbir mevcut modalın/düğmenin
    // davranışını DEĞİŞTİRMEZ — sadece ilgili düğmeye programatik .click()
    // göndererek açar, böylece o modalların kendi aç/kapat/durum mantığı
    // (tourGuide.js'in .click() ile tetiklediği modallar dahil) aynen çalışır.
    const CMDP_ICON_ACTION = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

    function setupCommandPalette() {
        const backdrop = byId('command-palette-backdrop');
        const input = byId('command-palette-input');
        const resultsEl = byId('command-palette-results');
        const closeBtn = byId('btn-close-command-palette');
        if (!backdrop || !input || !resultsEl) return;

        const ACTIONS = [
            { label: 'Tema Değiştir (Koyu / Açık)', sub: 'Görünüm', hint: 'T', keywords: 'tema tema değiştir dark light aydınlık koyu görünüm', run: () => byId('btn-theme-toggle')?.click() },
            { label: 'Sesli Bildirimleri Aç/Kapat', sub: 'Görünüm', keywords: 'ses mute sessiz bildirim', run: () => byId('btn-mute-toggle')?.click() },
            { label: 'Kompakt Görünümü Aç/Kapat', sub: 'Görünüm', keywords: 'kompakt compact sıkı dar görünüm', run: () => byId('btn-toggle-compact')?.click() },
            { label: 'Göstergeler Panelini Aç', sub: 'Grafik', hint: 'G', keywords: 'gösterge indicator rsi macd ekle overlay osilatör supertrend', run: () => byId('btn-open-indicators')?.click() },
            { label: 'Fiyat Alarmları Panelini Aç', sub: 'Grafik', hint: 'A', keywords: 'alarm price alert fiyat uyarı', run: () => byId('btn-open-alerts')?.click() },
            { label: 'BIST100 Isı Haritasını Aç', sub: 'Piyasa', hint: 'H', keywords: 'ısı harita heatmap piyasa', run: () => byId('btn-open-heatmap')?.click() },
            { label: 'İşlem Panelini Aç/Kapat', sub: 'İşlem', keywords: 'işlem panel trade emir order al sat', run: () => byId('btn-toggle-tradepanel')?.click() },
            // (6 Ağustos 2026 — "portföy sıfırlama artık sadece admin
            // yapabilsin") "Parametreleri Sıfırla" komutu BİLEREK kaldırıldı —
            // hedef aldığı #btn-reset-params butonu da kaldırıldı.
            { label: 'Tanıtım Turunu Başlat', sub: 'Yardım', keywords: 'tur tanıtım tour rehber gezinti', run: () => byId('btn-open-tour')?.click() },
            { label: 'Klavye Kısayollarını Göster', sub: 'Yardım', hint: '?', keywords: 'kısayol shortcut klavye', run: () => byId('btn-open-shortcuts')?.click() },
            { label: 'Yardım / Hakkında', sub: 'Yardım', keywords: 'yardım hakkında help about bilgi', run: () => byId('btn-open-help')?.click() },
        ];

        let flatItems = []; // items currently rendered, in order — kept in sync with DOM for keyboard nav
        let activeIdx = -1;

        function matches(hay, term) { return hay.toLowerCase().includes(term); }

        function computeResults(term) {
            if (!term) {
                return { actions: ACTIONS.slice(0, 6), symbols: [] };
            }
            const actions = ACTIONS.filter(a => matches(a.label + ' ' + a.sub + ' ' + a.keywords, term));
            let symbols = [];
            if (DC && Array.isArray(DC.BIST100)) {
                symbols = DC.BIST100.filter(s => matches(s.symbol, term) || matches(s.name, term)).slice(0, 8);
            }
            return { actions: actions.slice(0, 6), symbols };
        }

        function render(term) {
            const { actions, symbols } = computeResults(term);
            flatItems = [];
            let html = '';

            if (symbols.length) {
                html += '<div class="cmdp-section-label">Semboller</div>';
                symbols.forEach(s => {
                    flatItems.push({ type: 'symbol', symbol: s.symbol });
                    html += '<button type="button" class="cmdp-item" data-cmdp-idx="' + (flatItems.length - 1) + '">' +
                        '<span class="cmdp-item-icon">' + s.symbol.slice(0, 2) + '</span>' +
                        '<span class="cmdp-item-main"><span class="cmdp-item-label">' + s.symbol + '</span><span class="cmdp-item-sub">' + s.name + '</span></span>' +
                        '</button>';
                });
            }
            if (actions.length) {
                html += '<div class="cmdp-section-label">Hızlı İşlemler</div>';
                actions.forEach(a => {
                    flatItems.push({ type: 'action', run: a.run });
                    html += '<button type="button" class="cmdp-item" data-cmdp-idx="' + (flatItems.length - 1) + '">' +
                        '<span class="cmdp-item-icon">' + CMDP_ICON_ACTION + '</span>' +
                        '<span class="cmdp-item-main"><span class="cmdp-item-label">' + a.label + '</span><span class="cmdp-item-sub">' + a.sub + '</span></span>' +
                        (a.hint ? '<span class="cmdp-item-hint">' + a.hint + '</span>' : '') +
                        '</button>';
                });
            }
            if (!flatItems.length) {
                html = '<div class="cmdp-empty">Sonuç bulunamadı</div>';
            }
            resultsEl.innerHTML = html;
            activeIdx = flatItems.length ? 0 : -1;
            updateActiveHighlight();
        }

        function updateActiveHighlight() {
            resultsEl.querySelectorAll('.cmdp-item').forEach((el, i) => {
                el.classList.toggle('active', i === activeIdx);
            });
        }

        function runItem(idx) {
            const item = flatItems[idx];
            if (!item) return;
            close();
            if (item.type === 'symbol') selectSymbol(item.symbol);
            else if (item.type === 'action') item.run();
        }

        const open = () => {
            closeOtherModals('command-palette-backdrop');
            backdrop.classList.add('open');
            input.value = '';
            render('');
            input.focus();
        };
        const close = () => backdrop.classList.remove('open');

        window.__optipulseOpenCommandPalette = open;

        input.addEventListener('input', () => render(input.value.trim().toLowerCase()));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (flatItems.length) { activeIdx = (activeIdx + 1) % flatItems.length; updateActiveHighlight(); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (flatItems.length) { activeIdx = (activeIdx - 1 + flatItems.length) % flatItems.length; updateActiveHighlight(); }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeIdx >= 0) runItem(activeIdx);
            } else if (e.key === 'Escape') {
                close();
            }
        });
        resultsEl.addEventListener('click', (e) => {
            const item = e.target.closest('.cmdp-item');
            if (!item) return;
            runItem(parseInt(item.dataset.cmdpIdx, 10));
        });
        if (closeBtn) closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
        });
    }

    function switchToTradeSubtab() {
        const tab = document.querySelector('.panel-subtab[data-panel-tab="trade"]');
        if (tab && !tab.classList.contains('active')) tab.click();
    }

    function setupGlobalShortcuts() {
        document.addEventListener('keydown', (e) => {
            const target = e.target;
            const isTyping = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable));

            // '?' toggles the shortcuts help modal.
            if (e.key === '?' && !isTyping) {
                e.preventDefault();
                window.__optipulseToggleShortcuts?.();
                return;
            }

            // Ctrl/Cmd+K or '/' opens the command palette (symbol search +
            // quick actions). Falls back to focusing the watchlist search
            // box if the palette isn't wired up for some reason.
            if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !isTyping)) {
                e.preventDefault();
                if (window.__optipulseOpenCommandPalette) window.__optipulseOpenCommandPalette();
                else byId('watchlist-search')?.focus();
                return;
            }

            if (isTyping) return; // everything below is a bare-key shortcut — don't hijack text input

            // Don't let bare-key shortcuts fire while a modal is open (except '?', handled above,
            // which needs to work to close the shortcuts modal itself).
            const anyModalOpen = ALL_MODAL_BACKDROP_IDS.some(id => byId(id)?.classList.contains('open'));
            if (anyModalOpen) return;

            // Digits 1-9: jump to that open chart tab.
            if (/^[1-9]$/.test(e.key)) {
                const idx = parseInt(e.key, 10) - 1;
                if (openTabs[idx] && openTabs[idx] !== state.activeSymbol) {
                    e.preventDefault();
                    selectSymbol(openTabs[idx]);
                }
                return;
            }

            // [ / ] : previous / next chart tab.
            if (e.key === '[' || e.key === ']') {
                if (openTabs.length < 2) return;
                e.preventDefault();
                const curIdx = openTabs.indexOf(state.activeSymbol);
                if (curIdx === -1) return;
                const delta = e.key === ']' ? 1 : -1;
                const nextIdx = (curIdx + delta + openTabs.length) % openTabs.length;
                selectSymbol(openTabs[nextIdx]);
                return;
            }

            if (e.ctrlKey || e.metaKey || e.altKey) {
                // Ctrl+Z: undo last drawing. (Ctrl+C/V/Delete for drawings are
                // already handled inside tradingChart.js's own listener.)
                if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    document.querySelector('#chart-toolbar [data-action="undo"]')?.click();
                }
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'b':
                    e.preventDefault();
                    setSide('BUY');
                    switchToTradeSubtab();
                    break;
                case 's':
                    e.preventDefault();
                    setSide('SELL');
                    switchToTradeSubtab();
                    break;
                case 'g':
                    e.preventDefault();
                    byId('btn-open-indicators')?.click();
                    break;
                case 'a':
                    e.preventDefault();
                    byId('btn-open-alerts')?.click();
                    break;
                case 'h':
                    e.preventDefault();
                    byId('btn-open-heatmap')?.click();
                    break;
                case 't':
                    e.preventDefault();
                    byId('btn-theme-toggle')?.click();
                    break;
            }
        });
    }

    /* ════════════════════════════════════════════════
       Watchlist
       ════════════════════════════════════════════════ */

    // (23 Temmuz 2026 düzeltmesi) İki modu var:
    //  - Arama kutusu BOŞ: yalnızca kullanıcının kendi izleme listesindeki
    //    semboller gösteriliyor (watchlistSymbols), her satırda bir "×"
    //    kaldırma düğmesiyle.
    //  - Arama kutusuna bir şey yazılınca: TÜM BIST100 arasında sembol/isim
    //    eşleşmesi aranıp sonuçlar gösteriliyor (izleme listesinde olsun ya
    //    da olmasın) — bir sonuca TIKLAMAK onu (henüz listede değilse)
    //    izleme listesine EKLİYOR ve grafik sembolü olarak seçiyor, sonra
    //    arama kutusu temizlenip normal (yalnızca-izleme-listesi) görünüme
    //    dönülüyor. Bu, kullanıcının istediği "ara → bul → tıkla → listeye
    //    eklensin" akışını karşılıyor.
    function renderWatchlistRows() {
        const body = byId('watchlist-body');
        if (!body) return;
        const label = document.querySelector('.watchlist-form-group > label');
        const term = (state.watchlistFilter || '').trim().toLowerCase();
        const searching = term.length > 0;

        const list = searching
            ? DC.BIST100.filter(({ symbol, name }) => symbol.toLowerCase().includes(term) || name.toLowerCase().includes(term))
            : DC.BIST100.filter(({ symbol }) => watchlistSymbols.has(symbol));

        if (label) label.textContent = searching ? `Arama Sonuçları (${list.length})` : 'İzleme Listesi';

        if (!list.length) {
            body.innerHTML = searching
                ? `<div class="watchlist-empty">Eşleşen sembol bulunamadı.</div>`
                : `<div class="watchlist-empty">İzleme listeniz boş. Yukarıdaki "Sembol Ara" kutusuyla hisse arayıp ekleyebilirsiniz.</div>`;
            return;
        }

        let html = '';
        list.forEach(({ symbol, name }) => {
            // (22 Temmuz 2026, on ikinci oturum, altıncı tur — "hisse logoları")
            // Sembol/isim yığınının soluna, DataController'ın tek ortak
            // üretici fonksiyonuyla (bkz. buildLogoHtml) gerçek şirket logosu
            // (bulunamazsa renkli baş harf rozeti) ekleniyor.
            const logoHtml = DC.buildLogoHtml ? DC.buildLogoHtml(symbol, 20) : '';
            const inList = watchlistSymbols.has(symbol);
            // Arama modunda TÜM sonuçlar tıklanınca ekler; normal modda
            // yalnızca kaldırma ikonu anlamlı (satır zaten listede).
            const actionBtn = searching
                ? (inList ? `<span class="wl-inlist-badge" title="Zaten izleme listenizde">✓</span>` : '')
                : `<button type="button" class="wl-remove-btn" data-remove-symbol="${symbol}" title="İzleme listesinden çıkar">×</button>`;
            html += `
                <div class="watchlist-row" data-symbol="${symbol}" data-name="${name.toLowerCase()}">
                    <div class="wl-left">
                        ${logoHtml}
                        <div class="wl-main">
                            <span class="wl-symbol">${symbol}</span>
                            <span class="wl-name">${name}</span>
                        </div>
                    </div>
                    <span class="wl-spark-wrap"><canvas class="wl-spark" id="wl-spark-${symbol}" width="46" height="18"></canvas></span>
                    <div class="wl-right">
                        <div class="wl-price-col">
                            <span class="wl-price" id="wl-price-${symbol}">--</span>
                            <span class="wl-change" id="wl-change-${symbol}">--</span>
                        </div>
                        ${actionBtn}
                    </div>
                </div>
            `;
        });
        body.innerHTML = html;

        body.querySelectorAll('.watchlist-row').forEach(row => {
            row.addEventListener('click', () => {
                const symbol = row.dataset.symbol;
                if (searching) {
                    addToWatchlist(symbol);
                    const input = byId('watchlist-search');
                    if (input) input.value = '';
                    state.watchlistFilter = '';
                }
                selectSymbol(symbol);
                renderWatchlistRows();
                renderWatchlistPrices();
                // Dar ekranda (980px altı) sidebar bir kayar panel — sembol
                // seçilince otomatik kapanıp grafiği göstersin.
                if (typeof window.__optipulseCloseMobileDrawers === 'function') {
                    window.__optipulseCloseMobileDrawers();
                }
            });
        });

        body.querySelectorAll('.wl-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const symbol = btn.dataset.removeSymbol;
                removeFromWatchlist(symbol);
                // (3 Ağustos 2026 — kullanıcı geri bildirimi: "burada bir
                // tanesini sildiğimizde tüm hisseleri yenilemesine gerek yok
                // sadece silinen hissenin altındakileri birer satır yukarı
                // taşıyacak") Eskiden burada TÜM liste renderWatchlistRows()
                // ile sıfırdan yeniden çiziliyordu — kalan onlarca satırın
                // DOM'u (ve sparkline canvas'ları) gereksiz yere yeniden
                // oluşturuluyordu. Artık SADECE silinen satır DOM'dan
                // kaldırılıyor; altındaki satırlar normal blok akışıyla
                // kendiliğinden bir satır yukarı kayıyor — diğer satırların
                // canvas/sparkline durumu hiç bozulmuyor.
                const row = btn.closest('.watchlist-row');
                if (row) {
                    if (sparkObserver) sparkObserver.unobserve(row);
                    visibleSparkSymbols.delete(symbol);
                    row.remove();
                }
                // Liste tamamen boşaldıysa boş-durum mesajını göstermek için
                // (nadir/ucuz bir durum) tam render'a düşülüyor.
                if (!body.querySelector('.watchlist-row')) {
                    renderWatchlistRows();
                }
            });
        });

        setupSparkVisibilityObserver(body);
    }

    // (18 Temmuz 2026, dokuzuncu oturum — "watchlist performans
    // optimizasyonu") 97 satırlık watchlist'te her 2 saniyelik tick'te 97
    // sparkline canvas'ının hepsini yeniden çizmek (ekranda sadece ~8-10
    // satır görünürken) gereksiz CPU harcıyordu. IntersectionObserver ile
    // sadece o an watchlist konteynerinin görünür alanında olan satırların
    // sembolleri izleniyor; renderWatchlistPrices() sparkline'ı SADECE bu
    // sette olan semboller için çiziyor. Fiyat/yüzde metni ve p.history
    // dizisi her zaman güncelleniyor (ucuz) — sadece pahalı canvas çizimi
    // atlanıyor. Bir satır tekrar görünüme girdiğinde en güncel geçmişle
    // hemen yeniden çiziliyor, "eski/donmuş" bir sparkline kalmıyor.
    let visibleSparkSymbols = new Set();
    let sparkObserver = null;

    function setupSparkVisibilityObserver(root) {
        if (sparkObserver) { sparkObserver.disconnect(); sparkObserver = null; }
        visibleSparkSymbols = new Set();
        if (!root || typeof IntersectionObserver === 'undefined') {
            // IntersectionObserver desteklenmiyorsa (çok eski tarayıcı):
            // güvenli taraf hepsini "görünür" saymak — optimizasyon devre
            // dışı kalır ama sparkline'lar yine de doğru çizilmeye devam eder.
            DC.BIST100.forEach(({ symbol }) => visibleSparkSymbols.add(symbol));
            return;
        }
        sparkObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const symbol = entry.target.dataset.symbol;
                if (!symbol) return;
                if (entry.isIntersecting) {
                    visibleSparkSymbols.add(symbol);
                    const p = priceProfiles[symbol];
                    const sparkEl = byId('wl-spark-' + symbol);
                    if (p && sparkEl) drawSparkline(sparkEl, p.history);
                } else {
                    visibleSparkSymbols.delete(symbol);
                }
            });
        }, { root, rootMargin: '100px 0px' });

        root.querySelectorAll('.watchlist-row').forEach(row => sparkObserver.observe(row));
    }

    // Watchlist satırındaki küçük sparkline'ı p.history dizisinden çizer —
    // son ~2 dakikanın fiyat YÖNÜNÜ gösteren kaba bir çizgi (eksen/etiket
    // yok, kasıtlı olarak minimal). Geçmişin ilk ve son noktası arasındaki
    // farka göre yeşil/kırmızı renklendirilir (günlük % değişimden bağımsız
    // — bu kısa vadeli, "az önce ne oldu" sinyali).
    function drawSparkline(canvas, history) {
        if (!canvas || !history || history.length < 2) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const min = Math.min(...history), max = Math.max(...history);
        const range = (max - min) || (max * 0.001) || 1;
        const stepX = w / (history.length - 1);
        const up = history[history.length - 1] >= history[0];

        ctx.beginPath();
        history.forEach((v, i) => {
            const x = i * stepX;
            const y = h - 2 - ((v - min) / range) * (h - 4);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = up ? '#4CAF50' : '#F44336';
        ctx.lineWidth = 1.25;
        ctx.lineJoin = 'round';
        ctx.stroke();
    }

    function renderWatchlistPrices() {
        DC.BIST100.forEach(({ symbol }) => {
            const p = priceProfiles[symbol];
            if (!p) return;
            const priceEl = byId('wl-price-' + symbol);
            const changeEl = byId('wl-change-' + symbol);
            if (!priceEl || !changeEl) return;
            const chgPct = ((p.price - p.dayOpen) / p.dayOpen) * 100;
            priceEl.textContent = '₺' + fmtPrice(p.price);
            changeEl.textContent = (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%';
            changeEl.className = 'wl-change ' + (chgPct >= 0 ? 'profit-text' : 'loss-text');

            if (visibleSparkSymbols.has(symbol)) {
                const sparkEl = byId('wl-spark-' + symbol);
                if (sparkEl) drawSparkline(sparkEl, p.history);
            }
        });
        renderMarketBreadth();
    }

    /* ════════════════════════════════════════════════
       Piyasa Nabzı / Market Breadth
       (29 Temmuz 2026 — "dual chart gibi başka ne özellikler ekleyebiliriz")
       BIST100 evreninin TAMAMINDA (97+ sembol) kaç tanesinin günlük açılışa
       göre yükselişte/düşüşte olduğunu özetler — computeHeatmapData()'nın
       (ısı haritası özelliği için zaten var olan) AYNI priceProfiles kaynağını
       yeniden kullanıyor, yeni bir backend isteği veya sentetik veri
       gerektirmiyor. renderWatchlistPrices() her tetiklendiğinde (fiyat
       tick'i, syncWatchlistPrices) otomatik güncellenir.
       ════════════════════════════════════════════════ */

    function renderMarketBreadth() {
        const el = byId('market-breadth-val');
        if (!el) return;
        const data = computeHeatmapData();
        if (!data.length) { el.textContent = '--'; return; }
        let up = 0, down = 0, flat = 0;
        data.forEach(d => {
            if (d.chgPct > 0.01) up++;
            else if (d.chgPct < -0.01) down++;
            else flat++;
        });
        el.innerHTML = '<span class="profit-text">' + up + '↑</span> / <span class="loss-text">' + down + '↓</span>' +
            (flat ? ' / <span style="color:var(--text-muted);">' + flat + '=</span>' : '');
    }

    // (23 Temmuz 2026 düzeltmesi) Önceden bu arama yalnızca mevcut 97
    // satırı gizleyip/gösteriyordu (gerçek bir ekleme yoktu). Artık
    // renderWatchlistRows() arama terimine göre TÜM BIST100'de arayıp
    // sonuçları tamamen yeniden çiziyor (satırlara tıklamak izleme
    // listesine ekliyor, bkz. renderWatchlistRows) — bu yüzden burada
    // sadece state.watchlistFilter'ı güncelleyip yeniden çizmek yeterli.
    function setupWatchlistSearch() {
        const input = byId('watchlist-search');
        if (!input) return;
        input.addEventListener('input', () => {
            state.watchlistFilter = input.value.trim().toLowerCase();
            renderWatchlistRows();
            renderWatchlistPrices();
        });
    }

    /* ════════════════════════════════════════════════
       Multi-chart tab bar (open several symbols as tabs
       above the chart, TradingView-style)
       ════════════════════════════════════════════════ */

    const openTabs = [];
    const MAX_CHART_TABS = 8;

    function openSymbolTab(symbol) {
        if (openTabs.indexOf(symbol) === -1) {
            openTabs.push(symbol);
            if (openTabs.length > MAX_CHART_TABS) {
                // Evict the oldest tab that isn't the one we're about to show.
                const evictIdx = openTabs[0] === symbol ? 1 : 0;
                openTabs.splice(evictIdx, 1);
            }
        }
    }

    function closeSymbolTab(symbol) {
        if (openTabs.length <= 1) return; // always keep at least one tab open
        const idx = openTabs.indexOf(symbol);
        if (idx === -1) return;
        openTabs.splice(idx, 1);
        if (symbol === state.activeSymbol) {
            const newIdx = Math.min(idx, openTabs.length - 1);
            selectSymbol(openTabs[newIdx]);
        } else {
            renderChartTabs();
        }
    }

    function renderChartTabs() {
        // (17-18 Temmuz 2026, sekizinci oturum) #tv-chart-tabs-bar'ın kendisi
        // yerine içindeki #tv-chart-tabs-list sarmalayıcısı hedefleniyor —
        // bar'ın artık kalıcı bir kardeş öğesi de var (ızgara görünümü
        // düğmesi), innerHTML ile tüm bar'ı değiştirmek onu her sembol
        // değişiminde yok ederdi.
        const bar = byId('tv-chart-tabs-list') || byId('tv-chart-tabs-bar');
        if (!bar) return;
        bar.innerHTML = openTabs.map(sym => {
            const isActive = sym === state.activeSymbol;
            return '<div class="tv-chart-tab ' + (isActive ? 'active' : '') + '" data-symbol="' + sym + '" role="tab" aria-selected="' + isActive + '">' +
                '<span>' + sym + '</span>' +
                (openTabs.length > 1 ? '<button type="button" class="tv-chart-tab-close" data-symbol="' + sym + '" title="Sekmeyi kapat">×</button>' : '') +
                '</div>';
        }).join('');

        bar.querySelectorAll('.tv-chart-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (e.target.classList.contains('tv-chart-tab-close')) return;
                if (tab.dataset.symbol !== state.activeSymbol) selectSymbol(tab.dataset.symbol);
            });
        });
        bar.querySelectorAll('.tv-chart-tab-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeSymbolTab(btn.dataset.symbol);
            });
        });
    }

    async function selectSymbol(symbol) {
        // Switching symbols must never leave a leftover quantity / SL-TP price
        // sitting in the order ticket — otherwise a value typed for one symbol
        // (e.g. "4769" while buying AEFES) can get silently submitted against
        // whichever symbol happens to be active later (e.g. after coming back
        // to a page that defaulted back to THYAO).
        if (state.activeSymbol !== symbol) {
            const qtyInput = byId('qt-qty');
            if (qtyInput) qtyInput.value = '';
            const limitInput = byId('qt-limit-price');
            if (limitInput) limitInput.value = '';
            const sltpToggle = byId('qt-sltp-toggle');
            if (sltpToggle && sltpToggle.checked) {
                sltpToggle.checked = false;
                const sltpRow = byId('qt-sltp-row');
                if (sltpRow) sltpRow.style.display = 'none';
            }
            const slInput = byId('qt-sl-price'), tpInput = byId('qt-tp-price');
            if (slInput) { slInput.value = ''; delete slInput.dataset.userEdited; }
            if (tpInput) { tpInput.value = ''; delete tpInput.dataset.userEdited; }
        }

        state.activeSymbol = symbol;
        try { localStorage.setItem(LAST_SYMBOL_STORAGE_KEY, symbol); } catch (e) { /* private mode / quota */ }
        openSymbolTab(symbol);
        renderChartTabs();

        document.querySelectorAll('.watchlist-row').forEach(row => {
            row.classList.toggle('active', row.dataset.symbol === symbol);
        });

        // Keep the (hidden) legacy <select> value in sync in case any other
        // code still reads it (e.g. the Reset button). The old backtest
        // pipeline it used to trigger via a 'change' event has been removed
        // along with the Analiz Paneli, so we intentionally no longer
        // dispatch that event here.
        const select = byId('stock-select');
        if (select) {
            select.value = symbol;
        }

        updateActiveSymbolTicket();
        renderPositions();
        // (3 Ağustos 2026 — "emir defteri/son işlemler kaldırma") Bu iki
        // fonksiyon (renderOrderBook/renderRecentTrades) tamamen simüle
        // (fake) veri ürettiği için hoca geri bildirimiyle kaldırıldı;
        // burada kalan çağrılar da o yüzden silindi.

        // (23 Temmuz 2026, on üçüncü oturum — "canlı veri akışı hızlandırma")
        // Önceden WebSocket bağlantısı, aşağıdaki tam OHLCV geçmişi
        // (loadSymbol, period=max) TAMAMEN bitene KADAR hiç açılmıyordu —
        // ikisi kasıtlı olarak SIRALI çalışıyordu (bkz. eski yorum: erken bir
        // tick'in aşağıdaki re-anchor tarafından ezilmesini önlemek için).
        // Bu, özellikle backend soğuk uyanıyorsa (Render'ın ücretsiz katmanı)
        // canlı veri noktasının yeşile dönmesini gereksiz yere geciktiriyordu.
        // Artık ikisi PARALEL başlıyor — WebSocket beklenmeden hemen açılıyor,
        // tam geçmiş fetch'i ayrıca sürüyor. Yarış durumu TERS yönde ele
        // alınıyor: re-anchor artık yalnızca bu sembol için HENÜZ gerçek bir
        // canlı tick gelmediyse uygulanıyor — tick zaten gelmişse (OHLCV'den
        // en az o kadar güncel, çoğu zaman daha güncel gerçek bir fiyat
        // olduğu için) OHLCV'nin (göreceli olarak durağan) son kapanışıyla
        // EZİLMİYOR.
        connectLiveFeed(symbol);

        if (window.TradingChart) {
            // (27 Ağustos 2026, üçüncü hız turu — "ilk yüklemede beklemeyi
            // sıfırla") priceProfiles[symbol] izleme listesi/quotes
            // senkronundan gelen GERÇEK, zaten bilinen bir fiyat/dayOpen
            // içerebilir (uydurma/sentetik değil). Bunu loadSymbol()'a
            // önbellek ipucu olarak geçiyoruz ki başlık, tam OHLCV geçmişi
            // (bazen Yahoo rate-limit'i yüzünden onlarca saniye sürebiliyor)
            // gelmeden ANINDA doğru görünsün — chartInfo hazır olduğunda
            // aşağıdaki mantık zaten en güncel/kesin değerle düzeltiyor.
            const cachedProfile = priceProfiles[symbol];
            const cachedHint = (cachedProfile && typeof cachedProfile.price === 'number' && typeof cachedProfile.dayOpen === 'number' && cachedProfile.dayOpen > 0)
                ? { price: cachedProfile.price, dayOpen: cachedProfile.dayOpen }
                : null;
            const chartInfo = await window.TradingChart.loadSymbol(symbol, cachedHint);
            // Re-anchor the simulated demo tick price to the real last close
            // that was just fetched, instead of the hardcoded STOCK_PROFILES
            // fallback seed. Without this, the live trading chart drifts
            // toward a fabricated price while the Price Action (backtest)
            // chart — which uses the real fetched data — keeps showing the
            // actual last close, so the two charts silently disagree on
            // "the current price" for the same symbol.
            const alreadyHasLiveTick = liveFeedActive && liveFeedSymbol === symbol;
            // (10 Ağustos 2026, dördüncü tur) Burada da applyRealPriceUpdate()
            // kullanılıyor — OHLCV geçmişindeki son kapanış da (ör. bir
            // kurumsal işlem sonrası ayarlanmış/ayarlanmamış kapanış
            // karışıklığı yüzünden) tek seferlik bozuk olabilir.
            // (17 Ağustos 2026) dayOpen ARTIK chartInfo.lastClose'a eşitlenmiyor
            // — lastClose günün en güncel/canlı fiyatıdır, gerçek önceki gün
            // kapanışı değil (bkz. syncWatchlistPrices'taki 17 Ağustos notu ve
            // syncPriceAnchor'daki aynı düzeltme) — dayOpen'ı buna eşitlemek
            // %değişimi sembol seçilir seçilmez yanlışlıkla %0'a sıfırlıyordu.
            //
            // (27 Ağustos 2026 — "izleme listesi/hızlı işlem paneli %0,
            // grafik başlığı %15,99" tutarsızlığı) BU SEFER FARKLI bir alan
            // kullanılıyor: chartInfo.dailyPrevClose (bkz. tradingChart.js'teki
            // loadSymbol() dönüşü) GERÇEKTEN bir önceki günün kapanışı —
            // yukarıdaki notun uyardığı "lastClose'u dayOpen'a yazma" hatasının
            // AYNISI değil. Kök neden: /api/v1/quotes'un periyodik (40sn'de
            // bir) senkronu şu anda Yahoo Finance rate-limit'ine takılıp ara
            // sıra 500 döndürüyor, bu yüzden pek çok sembolün dayOpen'ı hiç
            // güncellenmeden tohum değerinde (fiyatla aynı, %0) kalabiliyor.
            // Burada, grafiğin AYRICA ve BAŞARIYLA çekmiş olduğu aynı günlük
            // kapanış verisini kullanarak — Yahoo'ya EK bir istek atmadan —
            // dayOpen'ı düzeltiyoruz.
            //
            // (27 Ağustos 2026, İKİNCİ düzeltme — "yükleniyor'dan sonra hâlâ
            // yanlış yüzde geliyor") Yukarıdaki ilk deneme bu atamayı
            // `!alreadyHasLiveTick && ... && applyRealPriceUpdate(...)`
            // zincirinin İÇİNE koymuştu. Ama pratikte canlı tik (WebSocket),
            // TAM OHLCV geçmişinden (özellikle Yahoo rate-limit'e takılıp
            // yavaşladığında) çoğu zaman DAHA HIZLI geliyor — yani bu satıra
            // gelindiğinde `alreadyHasLiveTick` çoğunlukla ZATEN true oluyor
            // ve TÜM blok (fiyat güncellemesiyle birlikte dayOpen düzeltmesi
            // de) hiç çalışmadan atlanıyordu. Fiyat zaten canlı tikten doğru
            // geldiği için bu fark edilmiyordu, ama dayOpen hiçbir zaman
            // düzeltilmediği için %'ler yanlış kalmaya devam ediyordu.
            // Düzeltme: dayOpen ataması artık `alreadyHasLiveTick`'ten
            // TAMAMEN BAĞIMSIZ, koşulsuz çalışıyor — price/liveAnchor'ı hiç
            // etkilemez (o hâlâ aşağıda, suspicious-jump korumalı
            // applyRealPriceUpdate() içinde ayrı kalıyor), sadece %
            // referansını düzeltir. Sonuç: en azından o an AÇIK/seçili olan
            // sembol için izleme listesi + hızlı alım-satım paneli + grafik
            // başlığı üçü de aynı kaynaktan, tutarlı bir % gösterir — canlı
            // tik daha önce gelmiş olsa bile.
            if (priceProfiles[symbol] && chartInfo && typeof chartInfo.dailyPrevClose === 'number' && chartInfo.dailyPrevClose > 0) {
                priceProfiles[symbol].dayOpen = chartInfo.dailyPrevClose;
                renderWatchlistPrices();
                updateActiveSymbolTicket();
            }

            if (!alreadyHasLiveTick && chartInfo && chartInfo.lastClose && priceProfiles[symbol] && applyRealPriceUpdate(symbol, chartInfo.lastClose, (prof, val) => {
                prof.price = val;
                prof.liveAnchor = val;
            })) {
                renderWatchlistPrices();
                updateActiveSymbolTicket();
            }
        }
    }

    /* ════════════════════════════════════════════════
       Quick Trade Ticket
       ════════════════════════════════════════════════ */

    function setupTicket() {
        const buyTab = byId('qt-tab-buy');
        const sellTab = byId('qt-tab-sell');
        const marketTab = byId('qt-order-market');
        const limitTab = byId('qt-order-limit');
        const ocoTab = byId('qt-order-oco');
        const qtyInput = byId('qt-qty');
        const limitInput = byId('qt-limit-price');
        const ocoUpperInput = byId('qt-oco-upper');
        const ocoLowerInput = byId('qt-oco-lower');
        const submitBtn = byId('qt-submit');
        const sltpToggle = byId('qt-sltp-toggle');
        const sltpRow = byId('qt-sltp-row');
        const trailingToggle = byId('qt-trailing-toggle');
        const trailingRow = byId('qt-trailing-row');
        const riskToggle = byId('qt-risk-toggle');
        const riskRow = byId('qt-risk-row');
        const riskPctInput = byId('qt-risk-pct');
        const slPriceInput = byId('qt-sl-price');

        if (buyTab) buyTab.addEventListener('click', () => setSide('BUY'));
        if (sellTab) sellTab.addEventListener('click', () => setSide('SELL'));
        if (marketTab) marketTab.addEventListener('click', () => setOrderType('MARKET'));
        if (limitTab) limitTab.addEventListener('click', () => setOrderType('LIMIT'));
        if (ocoTab) ocoTab.addEventListener('click', () => setOrderType('OCO'));
        if (qtyInput) qtyInput.addEventListener('input', updateEstimate);
        // (29 Temmuz 2026 — Madde 19) Adet elle değiştirildiğinde de risk %
        // ön hesabı güncel kalsın (maybeRecomputeRiskQty DEĞİL — o, risk
        // hesaplayıcı açıkken adedi TERSİNE hesaplıyor; burada adet zaten
        // GİRDİ, döngüye girmeden sadece önizlemeyi tazeliyoruz).
        if (qtyInput) qtyInput.addEventListener('input', updateRiskPreview);
        if (limitInput) limitInput.addEventListener('input', () => { updateEstimate(); maybeRecomputeRiskQty(); });
        if (ocoUpperInput) ocoUpperInput.addEventListener('input', updateEstimate);
        if (ocoLowerInput) ocoLowerInput.addEventListener('input', updateEstimate);
        if (sltpToggle && sltpRow) {
            sltpToggle.addEventListener('change', () => {
                sltpRow.style.display = sltpToggle.checked ? 'flex' : 'none';
                // SL/TP kutusu kapanınca içindeki risk hesaplayıcı da anlamsız
                // hale gelir (Stop-Loss fiyatı artık gönderilmeyecek) — kapatılıp
                // adet alanı manuel girişe geri döndürülüyor.
                if (!sltpToggle.checked) {
                    setRiskCalcEnabled(false);
                } else {
                    // (29 Temmuz 2026 — Madde 10 düzeltmesi) Kutu ilk açıldığında
                    // alanlar boş kalıp sadece "0.00" placeholder'ı gösteriyordu
                    // — kullanıcının sıfırdan bir fiyat düşünüp yazması
                    // gerekiyordu. Artık kutu her açıldığında (alanlar henüz
                    // boşsa) mevcut fiyattan makul bir varsayılan SL/TP
                    // öneriliyor — kullanıcı dilerse direkt değiştirebilir.
                    applyDefaultSlTp();
                }
            });
        }
        if (trailingToggle && trailingRow) {
            trailingToggle.addEventListener('change', () => {
                trailingRow.style.display = trailingToggle.checked ? 'flex' : 'none';
                const slField = byId('qt-sl-price');
                if (slField) slField.disabled = trailingToggle.checked;
                // Trailing stop'un sabit bir Stop-Loss fiyatı yok — risk
                // hesaplayıcı sabit SL fiyatına dayandığı için trailing
                // seçilince otomatik kapatılır.
                if (trailingToggle.checked) setRiskCalcEnabled(false);
                // (29 Temmuz 2026 — Madde 19) Aynı sebeple risk ön izlemesi de
                // (sabit bir SL mesafesi gerektiriyor) trailing seçilince
                // gizlenmeli / kapatılınca varsa yeniden hesaplanmalı.
                updateRiskPreview();
            });
        }
        if (riskToggle && riskRow) {
            riskToggle.addEventListener('change', () => setRiskCalcEnabled(riskToggle.checked));
        }
        if (riskPctInput) riskPctInput.addEventListener('input', maybeRecomputeRiskQty);
        if (slPriceInput) slPriceInput.addEventListener('input', maybeRecomputeRiskQty);
        // (29 Temmuz 2026 — Madde 10) Kullanıcı SL/TP alanına GERÇEKTEN
        // dokunduysa bunu işaretle ki applyDefaultSlTp() bir daha üzerine
        // yazmasın (bkz. applyDefaultSlTp() yorumu).
        if (slPriceInput) slPriceInput.addEventListener('input', markSlTpUserEdited);
        const tpPriceInput = byId('qt-tp-price');
        if (tpPriceInput) tpPriceInput.addEventListener('input', markSlTpUserEdited);

        const atrSuggestBtn = byId('qt-atr-suggest-btn');
        if (atrSuggestBtn) atrSuggestBtn.addEventListener('click', suggestAtrStopLoss);

        document.querySelectorAll('.qty-pct-btn').forEach(btn => {
            btn.addEventListener('click', () => applyQtyPct(parseInt(btn.dataset.pct, 10)));
        });

        setupLeverageSelector();
        setupMarketModeSelector();

        if (submitBtn) submitBtn.addEventListener('click', submitOrder);
        // (6 Ağustos 2026 — "portföy sıfırlama artık sadece admin yapabilsin")
        // Yarışmacının kendi portföyünü sıfırlayabildiği "Portföyü Sıfırla"
        // butonu (ve buradaki wiring) BİLEREK kaldırıldı — buton index.html'den
        // de kaldırıldığı için resetBtn artık her zaman null, ama kod
        // netliği için wiring'i de kaldırıyoruz. resetPortfolio() fonksiyonu
        // KENDİSİ dokunulmadan kalıyor (finteclubBridge.js'in admin komut
        // kanalı hâlâ onu doğrudan çağırıyor).

        setSide('BUY');
        setOrderType('MARKET');
    }

    function setSide(side) {
        state.side = side;
        const buyTab = byId('qt-tab-buy');
        const sellTab = byId('qt-tab-sell');
        const submitBtn = byId('qt-submit');
        if (buyTab) buyTab.classList.toggle('active', side === 'BUY');
        if (sellTab) sellTab.classList.toggle('active', side === 'SELL');
        if (submitBtn) {
            submitBtn.textContent = side === 'BUY' ? 'AL (BUY)' : 'SAT (SELL)';
            submitBtn.className = 'btn-trade-submit ' + (side === 'BUY' ? 'btn-buy' : 'btn-sell');
        }
        updateEstimate();
        maybeRecomputeRiskQty();
        // (29 Temmuz 2026 — Madde 10) SL/TP kutusu zaten açıkken AL<->SAT
        // sekmesi değiştirilirse, yönle ters düşmüş eski varsayılan
        // değerlerin ekranda kalmaması için (kullanıcı henüz elle
        // düzenlemediyse) yeniden hesaplanır.
        const sltpToggleEl = byId('qt-sltp-toggle');
        if (sltpToggleEl && sltpToggleEl.checked) applyDefaultSlTp();
    }

    function setOrderType(type) {
        state.orderType = type;
        const marketTab = byId('qt-order-market');
        const limitTab = byId('qt-order-limit');
        const ocoTab = byId('qt-order-oco');
        const limitRow = byId('qt-limit-row');
        const ocoRow = byId('qt-oco-row');
        const sltpGroup = byId('qt-sltp-group');
        const sideTabs = document.querySelector('.trade-tabs');
        const submitBtn = byId('qt-submit');

        if (marketTab) marketTab.classList.toggle('active', type === 'MARKET');
        if (limitTab) limitTab.classList.toggle('active', type === 'LIMIT');
        if (ocoTab) ocoTab.classList.toggle('active', type === 'OCO');
        // BULUNAN GERÇEK HATA (18 Temmuz 2026, onuncu oturum, beşinci tur):
        // bu iki satır önceden 'flex' kullanıyordu — #qt-limit-row/#qt-oco-row
        // birer .form-group (varsayılan block/dikey düzen); 'flex' verilince
        // flex-direction varsayılanı 'row' olduğundan içindeki label+input
        // (limit) veya iki tetikleyici alanı + ipucu metni (OCO) yan yana
        // sıkışıp etiketler birkaç kelimeye bölünerek dar sütunlara
        // dönüşüyordu (kullanıcının bildirdiği "OCO Tetikleyicileri" ekranı
        // buydu). Doğru değer 'block' — .form-group'un zaten kendi normal
        // dikey akışı.
        if (limitRow) limitRow.style.display = type === 'LIMIT' ? 'block' : 'none';
        if (ocoRow) ocoRow.style.display = type === 'OCO' ? 'block' : 'none';

        // OCO bekleyen bir emir — hangi yönde gerçekleşeceği önceden
        // bilinmediğinden (tetikleyen fiyata bağlı), AL/SAT yön seçici ve
        // pozisyon SL/TP'si bu modda anlamsız; gizleniyor.
        if (sideTabs) sideTabs.style.display = type === 'OCO' ? 'none' : 'flex';
        if (sltpGroup) sltpGroup.style.display = type === 'OCO' ? 'none' : 'block';
        if (submitBtn) submitBtn.textContent = type === 'OCO' ? 'OCO EMRİ OLUŞTUR' : (state.side === 'BUY' ? 'AL (BUY)' : 'SAT (SELL)');

        // OCO'da SL/TP kutusu (ve içindeki risk hesaplayıcı) tamamen
        // gizleniyor — adet alanı OCO'nun kendi kullanımı için serbest
        // kalmalı, risk hesaplayıcının onu kilitli bırakmasına izin verilmez.
        if (type === 'OCO') setRiskCalcEnabled(false);

        updateEstimate();
        maybeRecomputeRiskQty();
    }

    const LEVERAGE_MIN = 1;
    const LEVERAGE_MAX = 20;

    function applyLeverage(value) {
        state.leverage = Math.min(LEVERAGE_MAX, Math.max(LEVERAGE_MIN, Math.round(Number(value) || 1)));
        const hint = byId('leverage-warning-hint');
        if (hint) hint.style.display = state.leverage >= 5 ? 'inline' : 'none';
        updateEstimate();
        maybeRecomputeRiskQty();
        return state.leverage;
    }

    function setupLeverageSelector() {
        const buttons = document.querySelectorAll('.leverage-btn');
        const customInput = byId('leverage-custom-input');
        const customApplyBtn = byId('btn-leverage-custom-apply');
        if (!buttons.length) return;

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                applyLeverage(parseInt(btn.dataset.leverage, 10) || 1);
                buttons.forEach(b => b.classList.toggle('active', b === btn));
                if (customInput) customInput.value = '';
                document.querySelectorAll('.leverage-quick-chip').forEach(c => c.classList.remove('active'));
            });
        });

        // (18 Temmuz 2026, onuncu oturum) Manuel kaldıraç: hazır 1/2/5/10x
        // butonlarının dışında, 1-20x arası herhangi bir tam sayı — aynı
        // state.leverage'a yazıp aynı marj/likidasyon mantığını kullanıyor.
        // Preset butonlarından biriyle birebir eşleşirse o buton "active"
        // görünür kalsın diye işaretleniyor; eşleşmezse hepsi pasife düşüyor
        // (kullanıcı gerçekten özel bir değer kullandığını görsün diye).
        if (customInput && customApplyBtn) {
            const applyCustom = (forcedValue) => {
                const raw = forcedValue !== undefined ? forcedValue : parseInt(customInput.value, 10);
                if (!raw || isNaN(raw)) {
                    showToast(`Geçerli bir kaldıraç girin (${LEVERAGE_MIN}-${LEVERAGE_MAX}x arası).`);
                    return;
                }
                const applied = applyLeverage(raw);
                customInput.value = applied;
                const matchingPreset = Array.from(buttons).find(b => parseInt(b.dataset.leverage, 10) === applied);
                buttons.forEach(b => b.classList.toggle('active', b === matchingPreset));
                const chips = document.querySelectorAll('.leverage-quick-chip');
                chips.forEach(c => c.classList.toggle('active', parseInt(c.dataset.leverageChip, 10) === applied));
                showToast(`Kaldıraç ${applied}x olarak ayarlandı.`);
            };
            customApplyBtn.addEventListener('click', () => applyCustom());
            customInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyCustom(); }
            });

            // (18 Temmuz 2026, onuncu oturum, ikinci tur) Manuel girişin
            // hemen yanında hızlı-seçim chip'leri (3x/7x/15x/20x) — hazır
            // 1/2/5/10x butonlarının kapsamadığı, ama sık kullanılan ara
            // değerlere tek tıkla ulaşmak için. Aynı applyLeverage() /
            // applyCustom() akışını kullanıyor, ayrı bir mantık değil.
            document.querySelectorAll('.leverage-quick-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const val = parseInt(chip.dataset.leverageChip, 10);
                    applyCustom(val);
                });
            });
        }
    }

    // (23 Temmuz 2026 düzeltmesi — Normal Seans / VİOP ayrımı) Trade
    // ticket'ının üstündeki iki butonlu bar: Normal Seans (varsayılan;
    // kaldıraç seçici tamamen gizleniyor ve state.leverage 1x'e zorlanıyor)
    // ile VİOP (kaldıraç seçici tekrar görünür, açığa satış serbest — eski
    // davranış). Seçim localStorage'a yazılıyor ki sayfa yenilense de kalsın.
    function setupMarketModeSelector() {
        const normalBtn = byId('qt-market-normal');
        const viopBtn = byId('qt-market-viop');
        const leverageGroup = byId('qt-leverage-group');
        // (29 Temmuz 2026 — Madde 11) Aşağıdaki açık pozisyon / bekleyen OCO /
        // son emirler listeleri artık BU aynı toggle ile birlikte değişiyor —
        // Normal Seans seçiliyken Spot defteri, VİOP seçiliyken VİOP defteri
        // görünür. Veriler her zaman ikisine de yazılıyor (bkz. book()),
        // burada yalnızca GÖRÜNÜRLÜK değişiyor.
        const spotScope = byId('qt-list-scope-spot');
        const viopScope = byId('qt-list-scope-viop');
        if (!normalBtn || !viopBtn) return;

        function apply(mode) {
            state.market = mode === 'VIOP' ? 'VIOP' : 'NORMAL';
            normalBtn.classList.toggle('active', state.market === 'NORMAL');
            viopBtn.classList.toggle('active', state.market === 'VIOP');
            if (leverageGroup) leverageGroup.style.display = state.market === 'VIOP' ? '' : 'none';
            if (spotScope) spotScope.style.display = state.market === 'NORMAL' ? '' : 'none';
            if (viopScope) viopScope.style.display = state.market === 'VIOP' ? '' : 'none';

            if (state.market === 'NORMAL') {
                // Normal seansta kaldıraç kavramı yok — 1x'e sabitle ve
                // seçici görünür kalsaydı yanıltıcı olurdu diye zaten gizli.
                applyLeverage(1);
                document.querySelectorAll('.leverage-btn').forEach(b => b.classList.toggle('active', b.dataset.leverage === '1'));
                document.querySelectorAll('.leverage-quick-chip').forEach(c => c.classList.remove('active'));
                const customInput = byId('leverage-custom-input');
                if (customInput) customInput.value = '';
            }

            try { localStorage.setItem(MARKET_MODE_STORAGE_KEY, state.market); } catch (e) { /* private mode */ }
            updateEstimate();
        }

        normalBtn.addEventListener('click', () => apply('NORMAL'));
        viopBtn.addEventListener('click', () => apply('VIOP'));

        let saved = null;
        try { saved = localStorage.getItem(MARKET_MODE_STORAGE_KEY); } catch (e) { /* private mode */ }
        apply(saved === 'VIOP' ? 'VIOP' : 'NORMAL');
    }

    // (26 Temmuz 2026, on üçüncü oturum devamı — "risk yönetimi: pozisyon
    // büyüklüğü hesaplayıcı") Kullanıcı "bakiyemin %X'ini riske atmak
    // istiyorum, Stop-Loss'um şu fiyatta olacak, bana kaç adet almam
    // gerektiğini hesapla" mantığını istedi — bu, çoğu gerçek trading
    // platformunda olan ama burada olmayan bir özellikti. Girdi:
    // Stop-Loss fiyatı (#qt-sl-price, zaten SL/TP kutusunda var) ve risk
    // yüzdesi (#qt-risk-pct, yeni). Formül: risk edilecek tutar = bakiye ×
    // risk% ; hisse başına risk = |giriş fiyatı − SL fiyatı| ; adet =
    // risk edilecek tutar / hisse başına risk. Sonuç ayrıca mevcut
    // kaldıraçla karşılanabilecek maksimum nominal pozisyonla (marj
    // sınırı) kırpılıyor — çok dar bir Stop-Loss çok büyük bir adede yol
    // açabilir, o zaman bakiye zaten yetmez. Yalnızca #qt-risk-toggle
    // işaretliyken çağrılır (bkz. maybeRecomputeRiskQty / setupTicket).
    function computeRiskBasedQty() {
        const hint = byId('qt-risk-hint');
        const qtyInput = byId('qt-qty');
        const slInput = byId('qt-sl-price');
        const riskPctInput = byId('qt-risk-pct');
        if (!qtyInput || !slInput || !riskPctInput) return;

        const price = effectivePrice();
        const slPrice = slInput.value ? Number(slInput.value) : null;
        const riskPct = riskPctInput.value ? Number(riskPctInput.value) : 0;

        const setHint = (text, ok) => {
            if (!hint) return;
            hint.textContent = text;
            hint.classList.toggle('qt-risk-hint-ok', !!ok);
        };

        if (!price || price <= 0) {
            setHint('Fiyat bilgisi alınamadı.', false);
            return;
        }
        if (!slPrice || slPrice <= 0 || !riskPct || riskPct <= 0) {
            setHint('Stop-Loss fiyatı girin — miktar otomatik hesaplanacak.', false);
            return;
        }

        const perShareRisk = Math.abs(price - slPrice);
        if (perShareRisk <= 0) {
            setHint('Stop-Loss fiyatı giriş fiyatından farklı olmalı.', false);
            return;
        }

        const riskAmount = effectiveBalance() * (riskPct / 100);
        let qty = Math.floor(riskAmount / perShareRisk);

        const leverage = Math.max(1, Number(state.leverage) || 1);
        const commissionPct = getCommissionPct();
        // (9 Ağustos 2026) BUY için gerçek gerçekleşme fiyatı (ask) mid'den
        // biraz yüksek — bkz. applyQtyPct'teki aynı not.
        const marginPrice = state.side === 'BUY' ? execFillPrice('BUY', price) : price;
        let maxQtyByMargin = Math.floor(effectiveBalance() / (marginPrice * ((1 / leverage) + (commissionPct / 100))));
        // (10 Ağustos 2026 — kademeli kaldıraç önizlemesi) bkz. applyQtyPct'teki
        // aynı not — teminat tavanı da gerçekte uygulanacak (düşürülmüş
        // olabilecek) kaldıraçla tutarlı olsun diye tek bir ek geçişle düzeltiliyor.
        if (state.market === 'VIOP') {
            const tierLev = previewTieredLeverage(marginPrice * maxQtyByMargin, leverage, state.market);
            if (tierLev < leverage) {
                maxQtyByMargin = Math.floor(effectiveBalance() / (marginPrice * ((1 / tierLev) + (commissionPct / 100))));
            }
        }
        // (9 Ağustos 2026 — kök neden düzeltmesi) Risk bazlı miktar da aynı
        // gerçekçi nominal tavana tabi — bkz. applyQtyPct/placeOrder.
        const maxQtyByNotional = Math.floor(MAX_ORDER_NOTIONAL_TL / price);
        const maxQty = Math.min(maxQtyByMargin, maxQtyByNotional);
        let clamped = false;
        if (qty > maxQty) {
            qty = Math.max(0, maxQty);
            clamped = true;
        }

        qtyInput.value = qty > 0 ? qty : '';
        updateEstimate();

        if (qty <= 0) {
            setHint('Bakiye bu risk / Stop-Loss kombinasyonu için yeterli değil.', false);
        } else if (clamped) {
            setHint(`${qty} adet — marj sınırı nedeniyle düşürüldü (Stop-Loss çok yakın olabilir).`, true);
        } else {
            setHint(`${qty} adet — risk: ${fmtTRY(riskAmount)} (bakiyenin %${riskPct})`, true);
        }
    }

    function maybeRecomputeRiskQty() {
        const toggle = byId('qt-risk-toggle');
        if (toggle && toggle.checked) computeRiskBasedQty();
        updateRiskPreview();
    }

    /* ════════════════════════════════════════════════
       SL/TP girilince otomatik risk % ön hesabı
       (29 Temmuz 2026 — Madde 19) computeRiskBasedQty()'den FARKLI: o, "%X
       riske et" mantığıyla ADET hesaplıyor ve ayrı bir onay kutusuyla açılan
       bir mod. Bu, tam tersine, elde ne kadar adet varsa (elle girilmiş ya da
       risk hesaplayıcıdan gelmiş, farketmez) ve Stop-Loss ne kadar
       uzaktaysa, bu kombinasyonun bakiyenin YÜZDE KAÇINA mal olacağını
       SL/TP kutusu açık olduğu sürece HER ZAMAN gösterir — kullanıcı ayrıca
       bir şey açmasına gerek kalmadan "bu işlemde bakiyemin %kaçını
       riske ediyorum" sorusuna anında yanıt.
       ════════════════════════════════════════════════ */
    const RISK_PREVIEW_WARN_THRESHOLD_PCT = 5;

    function updateRiskPreview() {
        const previewEl = byId('qt-risk-preview');
        if (!previewEl) return;
        const sltpToggle = byId('qt-sltp-toggle');
        if (!sltpToggle || !sltpToggle.checked) { previewEl.style.display = 'none'; return; }

        const trailingToggle = byId('qt-trailing-toggle');
        if (trailingToggle && trailingToggle.checked) {
            // Trailing stop'un sabit bir SL fiyatı yok — mesafe önceden
            // bilinmediği için bir risk ön hesabı yapılamaz.
            previewEl.style.display = 'none';
            return;
        }

        const qtyInput = byId('qt-qty');
        const slInput = byId('qt-sl-price');
        const qty = qtyInput ? Number(qtyInput.value) : 0;
        const slPrice = slInput && slInput.value ? Number(slInput.value) : null;
        const price = effectivePrice();

        if (!qty || qty <= 0 || !slPrice || slPrice <= 0 || !price || price <= 0 || !effectiveBalance()) {
            previewEl.style.display = 'none';
            return;
        }

        const perShareRisk = Math.abs(price - slPrice);
        const riskAmount = perShareRisk * qty;
        const riskPct = (riskAmount / effectiveBalance()) * 100;

        previewEl.style.display = '';
        previewEl.textContent = `Bu işlemde bakiyenizin yaklaşık %${riskPct.toFixed(2)}'sini (${fmtTRY(riskAmount)}) riske ediyorsunuz.`;
        previewEl.classList.toggle('qt-risk-preview-warn', riskPct >= RISK_PREVIEW_WARN_THRESHOLD_PCT);
    }

    // Risk hesaplayıcı açıkken adet alanı ve %25/50/75/100 hızlı butonları
    // manuel girişe kapatılır — aksi halde ikisi birbirinin üzerine yazıp
    // kullanıcının "risk bazlı" adedi neden değiştiğini anlamasını
    // zorlaştırırdı. Kapanınca adet alanı serbest kalır (son hesaplanan
    // değer olduğu gibi kalır, kullanıcı isterse elle değiştirebilir).
    function setRiskCalcEnabled(enabled) {
        const toggle = byId('qt-risk-toggle');
        const row = byId('qt-risk-row');
        const qtyInput = byId('qt-qty');
        if (toggle) toggle.checked = enabled;
        if (row) row.style.display = enabled ? 'block' : 'none';
        if (qtyInput) qtyInput.disabled = enabled;
        document.querySelectorAll('.qty-pct-btn').forEach(btn => { btn.disabled = enabled; });
        if (enabled) {
            computeRiskBasedQty();
        } else {
            const hint = byId('qt-risk-hint');
            if (hint) { hint.textContent = 'Stop-Loss fiyatı girin — miktar otomatik hesaplanacak.'; hint.classList.remove('qt-risk-hint-ok'); }
        }
    }

    /* ════════════════════════════════════════════════
       ATR bazlı akıllı Stop-Loss önerisi
       (29 Temmuz 2026 — "dual chart gibi başka ne özellikler ekleyebiliriz")
       Grafikte AKTİF sembol için zaten hesaplanmış ATR(14) — bkz.
       dataController.js computeATR() (Wilder düzeltmesi), tradingChart.js
       getLastATR() — kullanılarak "fiyattan ATR×çarpan kadar uzakta" bir SL
       öneriyor. Klasik bir volatilite bazlı stop mesafesi yaklaşımı (2 ATR
       yerine biraz daha sıkı 1.5 ATR seçildi — demo/eğitim amaçlı, kesin bir
       tavsiye değil). YÖN (uzun/kısa), o an seçili AL/SAT sekmesine
       (state.side) göre otomatik belirleniyor.
       ════════════════════════════════════════════════ */
    const ATR_SL_MULTIPLIER = 1.5;

    function suggestAtrStopLoss() {
        const symbol = state.activeSymbol;
        if (!symbol) { showToast('Önce bir sembol seçin.'); return; }
        const price = effectivePrice();
        if (!price) { showToast('Fiyat okunamadı.'); return; }
        const atr = (window.TradingChart && window.TradingChart.getLastATR) ? window.TradingChart.getLastATR() : null;
        if (!atr || atr <= 0) {
            showToast('ATR(14) henüz hesaplanamadı — grafikte bu sembol için yeterli geçmiş yok.');
            return;
        }
        const distance = atr * ATR_SL_MULTIPLIER;
        const isLong = state.side !== 'SELL'; // BUY ya da tanımsızsa uzun kabul edilir (varsayılan sekme)
        const suggestedSl = isLong ? (price - distance) : (price + distance);
        if (suggestedSl <= 0) {
            showToast('Önerilen Stop-Loss geçersiz (ATR mesafesi fiyattan büyük) — manuel girin.');
            return;
        }
        const slInput = byId('qt-sl-price');
        if (slInput) {
            slInput.value = suggestedSl.toFixed(2);
            slInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showToast(`ATR(14)×${ATR_SL_MULTIPLIER} ≈ ₺${fmtPrice(distance)} mesafeyle önerilen Stop-Loss: ₺${fmtPrice(suggestedSl)}`);
    }

    /* ════════════════════════════════════════════════
       SL/TP kutusu için makul varsayılan değerler
       (29 Temmuz 2026 — Madde 10 "Stop-loss 0,00 yerine makul bir
       varsayılanla açılsın") Kutu açıldığında alanlar boşsa (kullanıcı daha
       önce bir şey yazmadıysa) mevcut fiyattan basit, sabit yüzdelik bir
       mesafeyle (SL %2, TP %4 — yaklaşık 1:2 risk/ödül, eğitim amaçlı) bir
       başlangıç değeri öneriliyor. ATR bazlı öneri butonu (suggestAtrStopLoss)
       zaten var ve daha isabetli bir SL veriyor — bu, o butona hiç
       dokunmadan yazmayı gerektirmeyen basit bir ilk değer.
       "Boş mu" kontrolü YETERLİ DEĞİL: kutuyu kapatıp AL<->SAT sekmesini
       değiştirip tekrar açtığında alan hâlâ ÖNCEKİ varsayılanla dolu
       olduğundan (boş değil), yeni yöne göre yeniden hesaplanmıyordu — bu
       yüzden gerçek kullanıcı girişini bir dataset bayrağıyla (userEdited)
       ayrı takip ediyoruz: sadece kullanıcı GERÇEKTEN yazdıysa üzerine
       yazmıyoruz, aksi halde (boş VEYA bizim önceki varsayılanımız) güncel
       yöne göre yeniden dolduruyoruz.
       ════════════════════════════════════════════════ */
    const DEFAULT_SL_PCT = 2;
    const DEFAULT_TP_PCT = 4;

    function markSlTpUserEdited(e) {
        if (e && e.target) e.target.dataset.userEdited = '1';
    }

    function applyDefaultSlTp() {
        const slInput = byId('qt-sl-price');
        const tpInput = byId('qt-tp-price');
        const price = effectivePrice();
        if (!price) return;
        const isLong = state.side !== 'SELL';
        if (slInput && slInput.dataset.userEdited !== '1') {
            const sl = isLong ? price * (1 - DEFAULT_SL_PCT / 100) : price * (1 + DEFAULT_SL_PCT / 100);
            if (sl > 0) {
                slInput.value = sl.toFixed(2);
                maybeRecomputeRiskQty();
            }
        }
        if (tpInput && tpInput.dataset.userEdited !== '1') {
            const tp = isLong ? price * (1 + DEFAULT_TP_PCT / 100) : price * (1 - DEFAULT_TP_PCT / 100);
            if (tp > 0) tpInput.value = tp.toFixed(2);
        }
        // (29 Temmuz 2026 — Madde 19) SL zaten kullanıcı tarafından
        // düzenlenmişse yukarıdaki dal hiç çalışmıyor olabilir — kutu her
        // açıldığında risk ön izlemesinin YİNE DE tazelenmesi garanti
        // ediliyor.
        updateRiskPreview();
    }

    function applyQtyPct(pct) {
        if (!state.activeSymbol) return;
        const price = effectivePrice();
        if (!price) return;
        const commissionPct = getCommissionPct();
        const leverage = Math.max(1, Number(state.leverage) || 1);
        let qty;
        let isOpeningNewExposure = true; // (9 Ağustos 2026) mevcut pozisyonu KAPATAN dal nominal tavana tabi değil
        if (state.side === 'BUY') {
            // Bakiyenin %pct'i kadarını TEMİNAT olarak kullan — kaldıraç
            // sayesinde aynı teminatla `leverage` katı kadar nominal
            // pozisyon açılabiliyor.
            // (9 Ağustos 2026) Gerçekleşme fiyatı artık spread nedeniyle
            // gösterilen mid'den biraz YÜKSEK (ask) olacağı için, "%100
            // bakiye" gibi tam bütçeyi kullanan hesaplar burada da ask
            // fiyatına göre yapılıyor — aksi halde qty hesabı mid ile
            // yapılıp gerçek gerçekleşme anında birkaç TL'lik spread farkı
            // yüzünden "yetersiz bakiye" ile sessizce reddedilebilirdi.
            const execPrice = execFillPrice('BUY', price);
            const usableMargin = effectiveBalance() * (pct / 100);
            qty = Math.floor((usableMargin * leverage) / (execPrice * (1 + (commissionPct / 100) * leverage)));
            // (10 Ağustos 2026 — kademeli kaldıraç önizlemesi) İlk geçişte
            // hesaplanan miktarın nominal değeri, seçili kaldıracın izin
            // verildiği kademeyi aşıyorsa, miktar placeOrder()'ın gerçekte
            // uygulayacağı düşük kaldıraçla TEK bir ek geçişte yeniden
            // hesaplanıyor.
            if (state.market === 'VIOP') {
                const tierLev = previewTieredLeverage(execPrice * qty, leverage, state.market);
                if (tierLev < leverage) {
                    qty = Math.floor((usableMargin * tierLev) / (execPrice * (1 + (commissionPct / 100) * tierLev)));
                    showToast(`ℹ️ Kaldıracınız bu pozisyon büyüklüğü için ${fmtLeverage(tierLev)}x ile sınırlandırıldı (kademeli kaldıraç kuralı).`);
                }
            }
        } else {
            // (29 Temmuz 2026 — Madde 11) Ticket şu an hangi moddaysa (Normal
            // Seans/VİOP) o defterdeki pozisyona bakılıyor — aksi halde
            // örneğin VİOP moduna geçilmişken Spot'taki bir LONG pozisyon
            // yanlışlıkla "elimdeki miktar" olarak kullanılabilirdi.
            const pos = book(state.market).positions[state.activeSymbol];
            if (pos && pos.side === 'LONG') {
                qty = Math.floor(pos.qty * (pct / 100));
                isOpeningNewExposure = false; // var olan LONG'u kapatıyor, yeni pozisyon açmıyor
            } else {
                const usableMargin = effectiveBalance() * (pct / 100);
                qty = Math.floor((usableMargin * leverage) / price);
                if (state.market === 'VIOP') {
                    const tierLev = previewTieredLeverage(price * qty, leverage, state.market);
                    if (tierLev < leverage) {
                        qty = Math.floor((usableMargin * tierLev) / price);
                        showToast(`ℹ️ Kaldıracınız bu pozisyon büyüklüğü için ${fmtLeverage(tierLev)}x ile sınırlandırıldı (kademeli kaldıraç kuralı).`);
                    }
                }
            }
        }
        // (9 Ağustos 2026 — kök neden düzeltmesi) Otomatik miktar hesabı,
        // gerçekçi olmayan büyüklükte (milyar/trilyon TL'lik) bir emri HİÇ
        // önermesin — placeOrder()'daki asıl güvenlik duvarına gelmeden önce
        // burada da sınırlanıyor. Mevcut bir pozisyonu kapatan dal (yukarıda
        // isOpeningNewExposure=false) bu sınıra tabi değil.
        if (isOpeningNewExposure) {
            const maxQtyByNotional = Math.floor(MAX_ORDER_NOTIONAL_TL / price);
            if (qty > maxQtyByNotional) {
                qty = maxQtyByNotional;
                showToast(`Emir büyüklüğü gerçekçi bir üst sınırla (₺${fmtTRY(MAX_ORDER_NOTIONAL_TL).replace('₺', '')}) sınırlandırıldı.`);
            }
        }
        const qtyInput = byId('qt-qty');
        if (qtyInput) qtyInput.value = Math.max(0, qty);
        updateEstimate();
        updateRiskPreview();
    }

    function effectivePrice() {
        if (!state.activeSymbol) return null;
        if (state.orderType === 'LIMIT') {
            const limitInput = byId('qt-limit-price');
            const v = limitInput ? parseFloat(limitInput.value) : NaN;
            if (!isNaN(v) && v > 0) return v;
        }
        return getPrice(state.activeSymbol);
    }

    function getCommissionPct() {
        const el = byId('commission-rate');
        const v = el ? parseFloat(el.value) : NaN;
        return !isNaN(v) && v >= 0 ? v : 0.05;
    }

    function updateEstimate() {
        const estEl = byId('qt-est-cost');
        const notionalEl = byId('qt-est-notional');
        if (!estEl) return;
        const price = effectivePrice();
        const qtyInput = byId('qt-qty');
        const qty = qtyInput ? parseInt(qtyInput.value, 10) || 0 : 0;
        if (!price || !qty) {
            estEl.textContent = '--';
            if (notionalEl) notionalEl.textContent = '--';
            return;
        }
        const commissionPct = getCommissionPct();
        const notional = price * qty;
        // (10 Ağustos 2026 — kademeli kaldıraç önizlemesi) Gösterilen gereken
        // teminat, placeOrder()'ın bu pozisyon büyüklüğü için GERÇEKTE
        // uygulayacağı (kademe nedeniyle düşürülmüş olabilecek) kaldıraçla
        // hesaplanıyor — bkz. previewTieredLeverage.
        const leverage = previewTieredLeverage(notional, state.leverage, state.market);
        const commission = notional * (commissionPct / 100);
        const margin = notional / leverage;
        const requiredTotal = margin + commission;
        if (notionalEl) notionalEl.textContent = fmtTRY(notional);
        estEl.textContent = leverage > 1
            ? `${fmtTRY(requiredTotal)} (${leverage}x, kom. ${fmtTRY(commission)})`
            : `${fmtTRY(requiredTotal)} (kom. ${fmtTRY(commission)})`;
    }

    function updateActiveSymbolTicket() {
        const symEl = byId('qt-symbol');
        const priceEl = byId('qt-price');
        const chgEl = byId('qt-change');
        if (!state.activeSymbol) {
            if (symEl) symEl.textContent = 'Sembol seçin';
            if (priceEl) priceEl.textContent = '--';
            if (chgEl) chgEl.textContent = '';
            return;
        }
        const p = priceProfiles[state.activeSymbol];
        if (symEl) symEl.textContent = state.activeSymbol;
        if (p) {
            const chgPct = ((p.price - p.dayOpen) / p.dayOpen) * 100;
            if (priceEl) priceEl.textContent = '₺' + fmtPrice(p.price);
            if (chgEl) {
                chgEl.textContent = (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%';
                chgEl.className = 'qt-change ' + (chgPct >= 0 ? 'profit-text' : 'loss-text');
            }
        }
        updateEstimate();
    }

    /* ════════════════════════════════════════════════
       Order execution
       ════════════════════════════════════════════════ */

    // (6 Ağustos 2026 — "Mehmet Ali" hesap bozulması kök neden düzeltmesi +
    // Ali İhsan Hocam'ın istediği alım/satım onay popup'ı)
    //
    // KÖK NEDEN: Öğrencinin hesabında 230 katrilyon TL gibi anlamsız bir
    // özkaynak değeri oluşmuştu. İncelemede bulunan gerçek neden: LIMIT
    // emir tipi, kullanıcının GİRDİĞİ (limit) fiyatı — güncel piyasa
    // fiyatından ne kadar UZAK olursa olsun — HİÇBİR kontrol yapmadan
    // doğrudan gerçekleşme fiyatı olarak kullanıyordu (bkz. eski kod: aşağı
    // taşınan submitOrder()'ın eski hâlinde `price = effectivePrice()`
    // LIMIT'te doğrudan kullanıcının kutuya yazdığı sayıydı ve bu sayı hiç
    // sınırlanmadan hem qty hesaplamasında (bkz. applyQtyPct) hem de
    // placeOrder()'a verilen gerçekleşme fiyatında kullanılıyordu). Örnek:
    // bir öğrenci "Limit" sekmesinde ASELS için yanlışlıkla/bilmeyerek
    // 0,01 TL gibi gerçek dışı bir fiyat girip "%100 bakiye" ile miktar
    // hesaplattığında, qty = (bakiye × kaldıraç) / 0,01 formülü SAYISAL
    // OLARAK milyarlarca adet hisseye karşılık geliyordu (gereken teminat
    // da aynı oranda küçük olduğu için bakiye kontrolünü de sorunsuz
    // geçiyordu!). Emir o anda 0,01 TL'den "gerçekleşiyor", pozisyon
    // avgPrice=0,01 ile açılıyordu. Bir sonraki fiyat tick'inde gerçek
    // piyasa fiyatı (ör. 150 TL) ile hesaplanan gerçekleşmemiş K/Z =
    // (150 - 0,01) × (milyarlarca adet) = astronomik bir sayı oluyor,
    // equity = balance + usedMargin + openPnl bu sayıyı doğrudan yansıtıyordu.
    // 20x kaldıraç bu etkiyi büyütüyordu (aynı teminatla DAHA FAZLA adet
    // alınabildiği için) ama kaldıraç kendisi hatanın nedeni DEĞİL —
    // kaldıraç sadece hatayı büyüten bir çarpandı.
    //
    // DÜZELTME: LIMIT emirler artık GERÇEK bir limit emri gibi davranıyor:
    // - Girilen limit fiyatı koşulu ŞU AN zaten sağlıyorsa (AL için limit ≥
    //   güncel fiyat, SAT için limit ≤ güncel fiyat — yani gerçek bir
    //   borsada da emrin hemen gerçekleşeceği durum), emir HEMEN ama HER
    //   ZAMAN GÜNCEL (gerçek, sınırlı) PİYASA FİYATINDAN gerçekleşir —
    //   kullanıcının kutuya yazdığı sayıdan ASLA değil. Bu, tek başına
    //   yukarıdaki istismarı tamamen ortadan kaldırıyor: gerçekleşme fiyatı
    //   artık her zaman priceProfiles'ın kendi (tickPrices() içinde
    //   dayOpen'ın ±%6'sıyla sınırlanan) gerçek fiyatı.
    // - Koşul HENÜZ sağlanmıyorsa, emir gerçek bir borsadaki gibi BEKLEYEN
    //   bir limit emri olarak kuyruğa alınır (bkz. queuePendingLimitOrder)
    //   ve her fiyat tick'inde kontrol edilip (bkz. checkPendingOcoOrders'ın
    //   genişletilmiş hâli) koşul sağlandığı an yine GÜNCEL PİYASA
    //   FİYATINDAN gerçekleştirilir.
    //
    // AYRICA: Hocanın isteği üzerine artık AL/SAT (Spot ve VİOP'un ikisinde
    // de) hiçbir emir DOĞRUDAN gerçekleşmiyor — önce bir onay penceresi
    // açılıp emrin özeti (adet, sembol, fiyat, kaldıraç, gereken teminat)
    // gösteriliyor, kullanıcı "Onayla" demeden hiçbir pozisyon
    // değişmiyor/bakiye düşülmüyor. Bu, hem hocanın UX isteğini karşılıyor
    // hem de yukarıdaki gibi anlamsız/aşırı büyük emirlerin son bir görünür
    // kontrol noktasından geçmesini sağlıyor (öğrenci "1.000.000.000 adet
    // ASELS 0,01 TL'den almak istediğinize emin misiniz?" gibi bir özeti
    // görünce hatayı fark edebilir).
    function submitOrder() {
        // (9 Ağustos 2026 — admin durdurunca emir engelleme) Bu, tek gerçek
        // koruma DEĞİL — buton da updateTradeAvailabilityUI() ile pasif hale
        // getiriliyor — ama olası bir yarış durumuna (ör. buton disabled
        // olmadan hemen önce tıklanması) veya klavye/programatik tetiklemeye
        // karşı asıl, atlanamaz kontrol burası. Admin durdurması HER ZAMAN
        // tam blok (kuyruğa bile alınamaz).
        if (isTradingHaltedByAdmin()) {
            const m = tradingBlockedReason();
            showToast(m); showTicketAlert(m, 'error');
            return;
        }
        // (9 Ağustos 2026 — "piyasa kapalıyken kuyruğa emir alma" özelliği)
        // ÖNCEDEN piyasa kapalıyken TÜM emir türleri burada reddediliyordu.
        // Artık kullanıcı isteği üzerine SADECE OCO bu şekilde tam
        // reddediliyor — Piyasa ve Limit emirleri piyasa kapalıyken de
        // kabul ediliyor, aşağıda "kuyruğa alınacak" (willQueueAsPending)
        // olarak işaretlenip gerçek gerçekleştirme piyasa açılınca
        // checkPendingOcoOrders() üzerinden otomatik yapılıyor — tıpkı
        // gerçek borsa/aracı kurum uygulamalarındaki (Binance/Midas vb.)
        // "seans dışı emir" davranışı gibi: emir anında kuyruğa alınır,
        // gereken teminat ANINDA bakiyeden kilitlenir (bkz.
        // queuePendingLimitOrder/queuePendingMarketOrder), piyasa açılır
        // açılmaz o anki güncel/açılış fiyatından gerçekleştirilir.
        const marketClosedNow = !isMarketOpenForTrading();
        if (marketClosedNow && state.orderType === 'OCO') {
            const m = tradingBlockedReason();
            showToast(m); showTicketAlert(m, 'error');
            return;
        }
        if (!state.activeSymbol) { showToast('Önce bir sembol seçin.'); showTicketAlert('Önce bir sembol seçin.', 'error'); return; }
        const qtyInput = byId('qt-qty');
        const qty = qtyInput ? Math.floor(Number(qtyInput.value)) : 0;
        const enteredPrice = effectivePrice();
        const commissionPct = getCommissionPct();

        if (!qty || qty <= 0) { showToast('Geçerli bir miktar girin.'); showTicketAlert('Geçerli bir miktar girin.', 'error'); return; }
        if (!enteredPrice || enteredPrice <= 0) { showToast('Fiyat bilgisi alınamadı.'); showTicketAlert('Fiyat bilgisi alınamadı.', 'error'); return; }

        if (state.orderType === 'OCO') {
            // OCO zaten "anında gerçekleşmeyen, koşula bağlı" bir emir türü
            // (kurulduğunda hiçbir şey satın alınmıyor/satılmıyor) — hocanın
            // istediği "AL/SAT'a basınca onay" akışı buraya değil, ANINDA
            // gerçekleşen Piyasa/Limit emirlerine uygulanıyor. (Piyasa
            // kapalıyken zaten yukarıda reddedildiği için buraya SADECE
            // piyasa açıkken ulaşılır.)
            submitOcoOrder(qty, enteredPrice, commissionPct);
            return;
        }

        // (23 Temmuz 2026 düzeltmesi — Normal Seans / VİOP ayrımı) Bu kontrol
        // yalnızca ANINDA gerçekleşen Piyasa/Limit emirleri için geçerli —
        // OCO'nun kendi "alt tetik" (SAT yönü) kontrolü ayrıca
        // submitOcoOrder() içinde yapılıyor, çünkü OCO'da yön AL/SAT
        // sekmesinden değil hangi tetikleyicinin (üst/alt) önce
        // gerçekleştiğinden belirleniyor.
        const shortBlockMsg = checkNormalModeShortBlock(state.activeSymbol, state.side, qty);
        if (shortBlockMsg) {
            showToast(shortBlockMsg);
            showTicketAlert(shortBlockMsg, 'error');
            return;
        }

        // ---- LIMIT emir: gerçekleşme fiyatını belirle (bkz. yukarıdaki kök neden notu) ----
        let fillPrice = enteredPrice; // MARKET'te effectivePrice() zaten güncel piyasa fiyatı
        let willQueueAsPending = false;
        let limitPrice = null;
        if (state.orderType === 'LIMIT') {
            const marketPrice = getPrice(state.activeSymbol);
            if (!marketPrice) { const m = 'Fiyat bilgisi alınamadı.'; showToast(m); showTicketAlert(m, 'error'); return; }
            limitPrice = enteredPrice;
            if (marketClosedNow) {
                // Piyasa kapalıyken koşul o anki (donmuş) fiyata göre zaten
                // sağlanmış olsa bile HEMEN gerçekleştirilemez — piyasa
                // açılınca checkPendingOcoOrders() ilk tick'te normal LIMIT
                // tetik mantığıyla değerlendirir (genelde açılış anında da
                // hâlâ sağlanıyor olacağından pratikte "açılışta gerçekleşir"
                // anlamına gelir).
                willQueueAsPending = true;
            } else {
                const conditionAlreadyMet = state.side === 'BUY' ? (limitPrice >= marketPrice) : (limitPrice <= marketPrice);
                if (conditionAlreadyMet) {
                    fillPrice = marketPrice; // KÖK DÜZELTME: kullanıcının yazdığı fiyat DEĞİL, gerçek/sınırlı piyasa fiyatı
                } else {
                    willQueueAsPending = true;
                }
            }
        } else if (state.orderType === 'MARKET' && marketClosedNow) {
            // (9 Ağustos 2026 — "piyasa kapalıyken kuyruğa emir alma" özelliği)
            // Piyasa kapalıyken bir Piyasa (Market) emri artık reddedilmek
            // yerine kuyruğa alınıyor — bkz. queuePendingMarketOrder().
            // fillPrice zaten enteredPrice (donmuş son fiyat), sadece
            // TAHMİNİ teminat hesaplamak ve onay penceresinde göstermek için
            // kullanılıyor; gerçek gerçekleşme fiyatı piyasa açılınca o anki
            // güncel fiyattır.
            willQueueAsPending = true;
        }

        // Optional Stop-Loss / Take-Profit — bekleyen bir emir için henüz
        // kesin gerçekleşme fiyatı bilinmediğinden, doğrulama limitPrice
        // (Limit) ya da fillPrice (kapalıyken kuyruğa alınan Market) baz
        // alınarak yapılır.
        const sltpReference = willQueueAsPending ? (limitPrice !== null ? limitPrice : fillPrice) : fillPrice;
        const sltpToggle = byId('qt-sltp-toggle');
        let slPrice = null, tpPrice = null;
        if (sltpToggle && sltpToggle.checked) {
            const slInput = byId('qt-sl-price');
            const tpInput = byId('qt-tp-price');
            slPrice = slInput && slInput.value ? Number(slInput.value) : null;
            tpPrice = tpInput && tpInput.value ? Number(tpInput.value) : null;

            // Sanity: SL/TP must sit on the correct side of the intended new direction,
            // otherwise it would trigger immediately (or never make sense).
            const willBeLong = state.side === 'BUY';
            if (slPrice !== null && ((willBeLong && slPrice >= sltpReference) || (!willBeLong && slPrice <= sltpReference))) {
                const m = `Stop-Loss fiyatı ${willBeLong ? 'giriş fiyatının altında' : 'giriş fiyatının üzerinde'} olmalı.`;
                showToast(m); showTicketAlert(m, 'error');
                return;
            }
            if (tpPrice !== null && ((willBeLong && tpPrice <= sltpReference) || (!willBeLong && tpPrice >= sltpReference))) {
                const m = `Take-Profit fiyatı ${willBeLong ? 'giriş fiyatının üzerinde' : 'giriş fiyatının altında'} olmalı.`;
                showToast(m); showTicketAlert(m, 'error');
                return;
            }
        }

        const trailingToggle = byId('qt-trailing-toggle');
        const trailingPctInput = byId('qt-trailing-pct');
        const trailingRequested = !!(trailingToggle && trailingToggle.checked && trailingPctInput && Number(trailingPctInput.value) > 0);
        // (10 Ağustos 2026, ikinci tur) Aşırı küçük bir trailing yüzdesi
        // (ör. %0,01), fiyat gürültüsünün bile anında tetiklediği, fiilen
        // "kârdaysa hemen kapat" ile aynı işi gören bir "tetik" haline
        // gelirdi — asgari tutma süresi kuralını dolanmanın başka bir yolu.
        // Gerçek platformlarda da trailing stop için genelde bir asgari
        // yüzde/tık zorunludur; burada da MIN_TRAILING_PCT ile aynısı
        // uygulanıyor.
        if (trailingRequested && Number(trailingPctInput.value) < MIN_TRAILING_PCT) {
            const m = `Trailing Stop yüzdesi en az %${MIN_TRAILING_PCT} olmalı (çok küçük bir yüzde, gürültüyle anında tetiklenir).`;
            showToast(m); showTicketAlert(m, 'error');
            return;
        }
        const useTrailing = trailingRequested;

        openOrderConfirmModal({
            symbol: state.activeSymbol,
            side: state.side,
            qty,
            market: state.market,
            leverage: state.leverage,
            commissionPct,
            orderType: state.orderType,
            fillPrice,
            willQueueAsPending,
            limitPrice,
            slPrice,
            tpPrice,
            useTrailing,
            trailingPct: useTrailing ? Number(trailingPctInput.value) : null
        });
    }

    // Kullanıcı onay penceresinde "Onayla" dedikten SONRA gerçek işlemi
    // yapan fonksiyon — eskiden submitOrder()'ın gövdesiydi, artık ondan
    // ayrıldı ki onay adımı arada devreye girebilsin. `ctx`,
    // submitOrder()'ın hazırladığı emir bağlamı (bkz. yukarısı).
    function executeConfirmedOrder(ctx) {
        if (ctx.willQueueAsPending) {
            // (9 Ağustos 2026 — "piyasa kapalıyken kuyruğa emir alma" özelliği)
            // İki farklı kuyruklama nedeni var: Limit fiyat koşulu henüz
            // sağlanmadı (kind: 'LIMIT') YA DA piyasa kapalı olduğu için bir
            // Market emri hemen gerçekleştirilemedi (kind: 'MARKET_QUEUED').
            // ctx.limitPrice sadece gerçek bir LIMIT emrinde dolu olur.
            if (ctx.orderType === 'LIMIT') {
                queuePendingLimitOrder(ctx);
            } else {
                queuePendingMarketOrder(ctx);
            }
            resetTicketAfterOrder();
            return;
        }

        // (23 Temmuz 2026 düzeltmesi) Var olan bir pozisyon FARKLI bir
        // kaldıraçla açıksa, artık bilette seçili kaldıraç ekleme kısmına
        // GERÇEKTEN uygulanıyor (placeOrder'daki değişikliğe bkz.) — eskiden
        // olduğu gibi sessizce eski kaldıraca zorlanmıyor. Pozisyonun
        // saklanan kaldıracı, avgPrice ile aynı şekilde adet-ağırlıklı
        // ortalamaya güncelleniyor; kullanıcı bunu ticket'ta önceden görsün
        // diye bilgilendirici bir not gösteriliyor.
        // (29 Temmuz 2026 — Madde 11) Ticket'ın seçili modu (ctx.market)
        // hangi defterin kullanılacağını belirliyor — book() üzerinden.
        const existingBeforeOrder = book(ctx.market).positions[ctx.symbol];
        const intendedSide = ctx.side === 'BUY' ? 'LONG' : 'SHORT';
        if (existingBeforeOrder && existingBeforeOrder.side === intendedSide && existingBeforeOrder.leverage && existingBeforeOrder.leverage !== ctx.leverage) {
            const blendedPreview = (existingBeforeOrder.leverage * existingBeforeOrder.qty + ctx.leverage * ctx.qty) / (existingBeforeOrder.qty + ctx.qty);
            const leverageNote = `Not: ${ctx.symbol} şu an ${fmtLeverage(existingBeforeOrder.leverage)}x kaldıraçla açık — bu ekleme ${fmtLeverage(ctx.leverage)}x ile yapılacak, pozisyonun ortalama kaldıracı ${fmtLeverage(blendedPreview)}x olacak.`;
            showToast(leverageNote);
            showTicketAlert(leverageNote, 'info');
        }

        const result = placeOrder(ctx.symbol, ctx.side, ctx.qty, ctx.fillPrice, ctx.commissionPct, ctx.leverage, ctx.market);
        if (!result.ok) {
            showToast(result.msg);
            showTicketAlert(result.msg, 'error');
            return;
        }

        // Attach SL/TP (or a Trailing Stop instead of a fixed SL) only if this
        // order actually opened/added to a position in its own direction
        // (not just reducing/closing an opposite one).
        if (ctx.slPrice !== null || ctx.tpPrice !== null || ctx.useTrailing) {
            const pos = book(ctx.market).positions[ctx.symbol];
            const expectedSide = ctx.side === 'BUY' ? 'LONG' : 'SHORT';
            if (pos && pos.side === expectedSide) {
                if (ctx.useTrailing) {
                    pos.trailingPct = ctx.trailingPct;
                    pos.trailingExtreme = pos.avgPrice; // en iyi fiyat henüz giriş fiyatı
                    delete pos.sl;
                } else if (ctx.slPrice !== null) {
                    pos.sl = ctx.slPrice;
                    delete pos.trailingPct;
                    delete pos.trailingExtreme;
                }
                if (ctx.tpPrice !== null) pos.tp = ctx.tpPrice;
                savePortfolio();
            }
        }

        renderPositions();
        renderOrders();
        renderAccountSummary();
        // (9 Ağustos 2026) result.fillPrice, placeOrder() içinde spread
        // uygulandıktan SONRAKİ gerçek gerçekleşme fiyatı — ctx.fillPrice
        // (mid) yerine bu gösteriliyor ki kullanıcı gerçekte ne fiyattan
        // işlem yaptığını görsün.
        showToast(`[${ctx.market === 'VIOP' ? 'VİOP' : 'Spot'}] ${ctx.side === 'BUY' ? 'Alım' : 'Satım'} emri gerçekleşti: ${ctx.qty} adet ${ctx.symbol} @ ₺${fmtPrice(result.fillPrice)}`);
        // (10 Ağustos 2026 — kademeli kaldıraç) Seçilen kaldıraç, pozisyonun
        // büyüklüğü nedeniyle düşürüldüyse kullanıcı sessizce şaşırmasın diye
        // ayrıca bilgilendiriliyor — bkz. placeOrder()/tieredMaxLeverage.
        if (result.leverageClampedTo) {
            showToast(`ℹ️ Kaldıracınız bu pozisyon büyüklüğü için ${fmtLeverage(result.leverageClampedTo)}x ile sınırlandırıldı (kademeli kaldıraç kuralı).`);
        }
        // Emir başarıyla gerçekleşti. Bu turda bir kaldıraç notu gösterildiyse
        // (leverageNote) onu ekranda bırakıyoruz — kullanıcının hâlâ görmesi
        // faydalı bir bilgi. Gösterilmediyse, ÖNCEKİ bir başarısız denemeden
        // kalmış olabilecek bir hata kutusu varsa temizleniyor.
        if (!(existingBeforeOrder && existingBeforeOrder.side === intendedSide && existingBeforeOrder.leverage && existingBeforeOrder.leverage !== ctx.leverage)) {
            const alertEl = byId('qt-ticket-alert');
            if (alertEl && alertEl.classList.contains('qt-alert-error')) {
                alertEl.style.display = 'none';
                clearTimeout(ticketAlertTimer);
            }
        }
        resetTicketAfterOrder();
    }

    // Emir gerçekleştikten (ya da bekleyen limit emri kurulduktan) sonra
    // ticket'taki geçici alanları (adet, SL/TP, trailing) temizleyen ortak
    // yardımcı — eskiden submitOrder()'ın sonunda tek bir yerde tekrarsız
    // yazılıyordu, artık hem "anında gerçekleşti" hem "bekleyen limit emri
    // kuruldu" yollarının ikisinden de çağrılabilmesi için ayrı bir
    // fonksiyona çıkarıldı.
    function resetTicketAfterOrder() {
        const qtyInput = byId('qt-qty');
        if (qtyInput) qtyInput.value = '';
        const sltpToggle = byId('qt-sltp-toggle');
        if (sltpToggle) { sltpToggle.checked = false; }
        const sltpRow = byId('qt-sltp-row');
        if (sltpRow) sltpRow.style.display = 'none';
        const slInput = byId('qt-sl-price'), tpInput = byId('qt-tp-price');
        if (slInput) { slInput.value = ''; slInput.disabled = false; delete slInput.dataset.userEdited; }
        if (tpInput) { tpInput.value = ''; delete tpInput.dataset.userEdited; }
        const trailingToggle = byId('qt-trailing-toggle');
        const trailingPctInput = byId('qt-trailing-pct');
        if (trailingToggle) trailingToggle.checked = false;
        if (trailingPctInput) trailingPctInput.value = '';
        const trailingRow = byId('qt-trailing-row');
        if (trailingRow) trailingRow.style.display = 'none';
        // Risk hesaplayıcı da SL/TP ile birlikte sıfırlanır — bir sonraki
        // emir için adet alanı yeniden manuel girişe (ya da bir sonraki
        // risk hesaplamasına) hazır, kilitli kalmıyor.
        setRiskCalcEnabled(false);
        updateEstimate();
    }

    // (6 Ağustos 2026) Henüz koşulu sağlanmamış bir LIMIT emri, OCO'nun
    // bekleyen-emir defterine (aynı diziye — book(market).pending) `kind:
    // 'LIMIT'` etiketiyle ekleniyor. checkPendingOcoOrders() (aşağıda
    // genişletildi) her tick'te bunu da kontrol edip koşul sağlanınca GÜNCEL
    // PİYASA FİYATINDAN gerçekleştiriyor — asla kullanıcının yazdığı limit
    // fiyatından değil (bkz. submitOrder()'daki kök neden notu).
    function queuePendingLimitOrder(ctx) {
        // (9 Ağustos 2026 — Binance/Midas tarzı anlık teminat kilidi)
        // ÖNCEDEN bu sadece bir "ön kontrol"dü (estimatedRequired >
        // effectiveBalance() kontrolü geçilirse HİÇBİR ŞEY bakiyeden
        // düşülmüyordu) — kullanıcı aynı bakiyeyle art arda birden fazla
        // bekleyen emir kurup toplamda bakiyesinden fazla teminat taahhüt
        // edebiliyordu. Gerçek borsa/aracı kurum davranışı (kullanıcının
        // referans verdiği Binance/Midas gibi): emir GİRER GİRMEZ gereken
        // teminat anında kilitlenir/düşülür. Aşağıda estimatedRequired kadarı
        // (pozisyon azaltma/kapatma ağırlıklı emirlerde negatif çıkabilir —
        // o durumda hiçbir şey kilitlenmiyor) portfolio.balance'tan hemen
        // düşülüp emrin üzerinde `reservedAmount` olarak saklanıyor; emir
        // tetiklendiğinde (checkPendingOcoOrders) ya da iptal edildiğinde
        // (cancelOcoOrder) TAM olarak geri iade ediliyor.
        const estimatedMargin = estimateOrderMarginRequirement(ctx.symbol, ctx.side, ctx.qty, ctx.limitPrice, ctx.leverage, ctx.market);
        const estimatedCommission = ctx.limitPrice * ctx.qty * (ctx.commissionPct / 100);
        const estimatedRequired = estimatedMargin + estimatedCommission;
        if (estimatedRequired > effectiveBalance()) {
            const m = isFtcLoggedIn()
                ? 'Yetersiz demo bakiye (yaklaşık gereken teminat: ' + fmtTRY(estimatedRequired) + ').'
                : 'İşlem açmak için önce FinteLig girişi yapmalısın (profil panelinden).';
            showToast(m);
            showTicketAlert(m, 'error');
            return;
        }
        // (9 Ağustos 2026 — kök neden düzeltmesi) Bekleyen limit emri de
        // gerçekleşme anında AYNI nominal tavana tabi olacağı için (bkz.
        // placeOrder), burada da erken bir uyarı veriliyor — aksi halde
        // kullanıcı emri kurar, günlerce/dakikalarca bekler, sonunda
        // tetiklendiğinde sessizce reddedilirdi.
        const estimatedOpeningNotional = ctx.limitPrice * ctx.qty;
        if (estimatedOpeningNotional > MAX_ORDER_NOTIONAL_TL) {
            const m = 'Emrin büyüklüğü (' + fmtTRY(estimatedOpeningNotional) + ') gerçekçi olmayan bir seviyede — tek bir emir ' + fmtTRY(MAX_ORDER_NOTIONAL_TL) + '\'yi aşamaz.';
            showToast(m);
            showTicketAlert(m, 'error');
            return;
        }

        const reservedAmount = Math.max(0, estimatedRequired);
        if (reservedAmount > 0) portfolio.balance -= reservedAmount;

        const b = book(ctx.market);
        b.pending.push({
            id: genId(),
            kind: 'LIMIT',
            symbol: ctx.symbol,
            side: ctx.side,
            qty: ctx.qty,
            limitPrice: ctx.limitPrice,
            leverage: ctx.leverage,
            commissionPct: ctx.commissionPct,
            market: ctx.market,
            slPrice: ctx.slPrice,
            tpPrice: ctx.tpPrice,
            useTrailing: ctx.useTrailing,
            trailingPct: ctx.trailingPct,
            reservedAmount,
            createdAt: Date.now()
        });
        savePortfolio();
        renderPendingOcoOrders();
        renderAccountSummary(); // bakiye anında değişti, ekranı hemen tazele
        showToast(`[${ctx.market === 'VIOP' ? 'VİOP' : 'Spot'}] Limit emir kuruldu: ${ctx.qty} adet ${ctx.symbol} — fiyat ₺${fmtPrice(ctx.limitPrice)} olunca ${ctx.side === 'BUY' ? 'alınacak' : 'satılacak'}. Gereken teminat (₺${fmtTRY(reservedAmount).replace('₺', '')}) şimdiden kilitlendi.`);
    }

    // (9 Ağustos 2026 — "piyasa kapalıyken kuyruğa emir alma" özelliği)
    // Kullanıcı geri bildirimi: "market kapalıyken alım yapar, market
    // açılınca parayı çeker, kullanıcıya da 'işleminiz sıraya alındı, piyasa
    // açıldığında bakiyenizden düşecektir' der — Binance/Midas'ta nasılsa
    // öyle" (teminat anında kilitlenir). queuePendingLimitOrder() ile AYNI
    // desen — TEK FARK: kind 'MARKET_QUEUED', bir fiyat koşulu YOK, piyasa
    // açılıp checkPendingOcoOrders() ilk çalıştığı an (o anki güncel/açılış
    // fiyatından) KOŞULSUZ gerçekleştiriliyor.
    function queuePendingMarketOrder(ctx) {
        const estimatedMargin = estimateOrderMarginRequirement(ctx.symbol, ctx.side, ctx.qty, ctx.fillPrice, ctx.leverage, ctx.market);
        const estimatedCommission = ctx.fillPrice * ctx.qty * (ctx.commissionPct / 100);
        const estimatedRequired = estimatedMargin + estimatedCommission;
        if (estimatedRequired > effectiveBalance()) {
            const m = isFtcLoggedIn()
                ? 'Yetersiz demo bakiye (yaklaşık gereken teminat: ' + fmtTRY(estimatedRequired) + ').'
                : 'İşlem açmak için önce FinteLig girişi yapmalısın (profil panelinden).';
            showToast(m);
            showTicketAlert(m, 'error');
            return;
        }
        const estimatedOpeningNotional = ctx.fillPrice * ctx.qty;
        if (estimatedOpeningNotional > MAX_ORDER_NOTIONAL_TL) {
            const m = 'Emrin büyüklüğü (' + fmtTRY(estimatedOpeningNotional) + ') gerçekçi olmayan bir seviyede — tek bir emir ' + fmtTRY(MAX_ORDER_NOTIONAL_TL) + '\'yi aşamaz.';
            showToast(m);
            showTicketAlert(m, 'error');
            return;
        }

        const reservedAmount = Math.max(0, estimatedRequired);
        if (reservedAmount > 0) portfolio.balance -= reservedAmount;

        const b = book(ctx.market);
        b.pending.push({
            id: genId(),
            kind: 'MARKET_QUEUED',
            symbol: ctx.symbol,
            side: ctx.side,
            qty: ctx.qty,
            leverage: ctx.leverage,
            commissionPct: ctx.commissionPct,
            market: ctx.market,
            slPrice: ctx.slPrice,
            tpPrice: ctx.tpPrice,
            useTrailing: ctx.useTrailing,
            trailingPct: ctx.trailingPct,
            reservedAmount,
            createdAt: Date.now()
        });
        savePortfolio();
        renderPendingOcoOrders();
        renderAccountSummary();
        showToast(`[${ctx.market === 'VIOP' ? 'VİOP' : 'Spot'}] İşleminiz sıraya alındı — piyasa açıldığında ${ctx.qty} adet ${ctx.symbol} ${ctx.side === 'BUY' ? 'alım' : 'satım'} emriniz otomatik gerçekleştirilecek. Gereken teminat (₺${fmtTRY(reservedAmount).replace('₺', '')}) şimdiden bakiyenizden kilitlendi.`);
    }

    /* ════════════════════════════════════════════════
       Emir onay penceresi (6 Ağustos 2026 — Ali İhsan Hocam'ın isteği)
       ════════════════════════════════════════════════ */

    // submitOrder()'ın hazırladığı ctx, "Onayla" tıklanana kadar burada
    // tutulur — modal kapanınca (iptal ya da onay farketmez) temizlenir.
    let orderConfirmPendingCtx = null;

    // (12 Ağustos 2026 — onay penceresi "eski fiyat" düzeltmesi) Önceden
    // ctx.fillPrice submitOrder()'da BİR KEZ donduruluyordu ve pencere açık
    // kaldığı sürece (kullanıcı "Onayla"ya basana kadar) hiç güncellenmiyordu
    // — ama tickPrices() arka planda 2 saniyede bir fiyatı değiştirmeye devam
    // ediyordu. Sonuç: hem pencerede YANLIŞ/eski bir fiyat gösteriliyordu,
    // hem de DAHA CİDDİSİ, "Onayla" tıklanınca gerçek işlem de (placeOrder
    // üzerinden) bu eski fiyattan gerçekleşiyordu — kâr/zarar hesabı yanlış
    // çıkıyordu. Bu fonksiyon, kuyruğa alınmayacak (anında gerçekleşecek)
    // Piyasa/Limit emirleri için ctx.fillPrice'ı HER ZAMAN o anki güncel
    // piyasa fiyatına göre yeniden hesaplar. Kuyruğa alınacak emirlerde
    // (willQueueAsPending) dokunulmuyor — onlar zaten piyasa açılınca o anki
    // güncel fiyattan gerçekleşiyor, buradaki fillPrice sadece tahmini
    // teminat göstergesi.
    function refreshCtxFillPriceToLive(ctx) {
        if (!ctx || ctx.willQueueAsPending) return ctx;
        const liveMarketPrice = getPrice(ctx.symbol);
        if (!liveMarketPrice) return ctx;
        if (ctx.orderType === 'LIMIT' && ctx.limitPrice !== null) {
            // LIMIT emri: submitOrder()'daki KÖK DÜZELTME kuralıyla birebir
            // aynı — koşul (BUY: limit >= piyasa, SELL: limit <= piyasa) hâlâ
            // sağlanıyorsa gerçekleşme fiyatı güncel piyasa fiyatıdır.
            const conditionMet = ctx.side === 'BUY' ? (ctx.limitPrice >= liveMarketPrice) : (ctx.limitPrice <= liveMarketPrice);
            if (conditionMet) ctx.fillPrice = liveMarketPrice;
        } else {
            // MARKET emri: her zaman o anki güncel piyasa fiyatından gerçekleşir.
            ctx.fillPrice = liveMarketPrice;
        }
        return ctx;
    }

    function buildOrderConfirmSummaryHtml(ctx) {
        const sideLabel = ctx.side === 'BUY' ? 'AL' : 'SAT';
        const sideClass = ctx.side === 'BUY' ? 'order-confirm-buy' : 'order-confirm-sell';
        const marketLabel = ctx.market === 'VIOP' ? 'VİOP' : 'Spot';
        const rows = [];
        rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Yön</span><span class="order-confirm-row-value ${sideClass}">${sideLabel} · ${marketLabel}</span></div>`);
        rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Sembol</span><span class="order-confirm-row-value">${ctx.symbol}</span></div>`);
        rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Adet</span><span class="order-confirm-row-value">${ctx.qty}</span></div>`);

        // (9 Ağustos 2026) Anında gerçekleşecek emirlerde gösterilen fiyat,
        // placeOrder()'ın GERÇEKTEN uygulayacağı bid/ask (spread'li) fiyatla
        // birebir aynı — ctx.fillPrice submitOrder()'da donduğundan, bu
        // "tahmini" değil, kesin gerçekleşecek fiyat.
        const expectedExecPrice = ctx.willQueueAsPending ? null : execFillPrice(ctx.side, ctx.fillPrice);

        if (ctx.willQueueAsPending) {
            if (ctx.orderType === 'LIMIT') {
                rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Limit Fiyatı</span><span class="order-confirm-row-value">₺${fmtPrice(ctx.limitPrice)}</span></div>`);
            } else {
                // (9 Ağustos 2026) Piyasa kapalıyken kuyruğa alınan Market
                // emri — gösterilen fiyat SADECE tahmini teminat hesabı
                // içindir, gerçek gerçekleşme fiyatı piyasa açılınca o anki
                // güncel/açılış fiyatıdır.
                rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Yaklaşık Fiyat</span><span class="order-confirm-row-value">₺${fmtPrice(ctx.fillPrice)} (açılışta güncellenecek)</span></div>`);
            }
        } else {
            // (12 Ağustos 2026 — spread netleştirme) Kullanıcı, popup'taki
            // "Fiyat" ile ekrandaki canlı fiyat arasında (ör. ₺371,25 →
            // ₺371,40) küçük bir fark olduğunu, bunu bir hata sanarak
            // bildirdi. Bu fark bir hata DEĞİL — AL emri her zaman ask'tan
            // (mid'in %HALF_SPREAD_PCT kadar üstünden), SAT emri her zaman
            // bid'ten (mid'in altından) gerçekleşiyor (bkz. execFillPrice,
            // 9 Ağustos'ta VİOP hızlı-al-sat suistimaline karşı bilinçli
            // eklenmiş bir sürtünme katmanı). Kullanıcı bu spread'in
            // KALMASINI, sadece popup'ta İKİ fiyatın (canlı + gerçekleşme)
            // ayrı ayrı ve açıkça gösterilmesini istedi.
            const spreadNote = ctx.side === 'BUY' ? 'ask · alış farkı' : 'bid · satış farkı';
            const spreadPctStr = HALF_SPREAD_PCT.toFixed(2).replace('.', ',');
            rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Canlı Fiyat</span><span class="order-confirm-row-value">₺${fmtPrice(ctx.fillPrice)}</span></div>`);
            rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Gerçekleşme Fiyatı${ctx.orderType === 'LIMIT' ? ' (güncel piyasa)' : ''}</span><span class="order-confirm-row-value">₺${fmtPrice(expectedExecPrice)} (${spreadNote} %${spreadPctStr})</span></div>`);
        }

        if (ctx.leverage > 1) {
            rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Kaldıraç</span><span class="order-confirm-row-value">${fmtLeverage(ctx.leverage)}x</span></div>`);
        }

        const referencePrice = ctx.willQueueAsPending ? (ctx.orderType === 'LIMIT' ? ctx.limitPrice : ctx.fillPrice) : expectedExecPrice;
        const notional = referencePrice * ctx.qty;
        const commission = notional * (ctx.commissionPct / 100);
        const margin = notional / Math.max(1, Number(ctx.leverage) || 1);
        const required = margin + commission;
        rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">${ctx.willQueueAsPending ? 'Şimdi Kilitlenecek Teminat' : 'Gereken Teminat'}</span><span class="order-confirm-row-value">₺${fmtTRY(required).replace('₺', '')}</span></div>`);
        rows.push(`<div class="order-confirm-row"><span class="order-confirm-row-label">Nominal Değer</span><span class="order-confirm-row-value">₺${fmtTRY(notional).replace('₺', '')}</span></div>`);

        return rows.join('');
    }

    // (12 Ağustos 2026) openOrderConfirmModal() ve refreshOrderConfirmModalIfOpen()
    // arasında paylaşılan render mantığı — tek yerden değiştirilsin diye
    // ayrıldı (eskiden ikisi ayrı ayrı aynı metni üretiyordu, bu da
    // kopyalar arasında tutarsızlık riski taşıyordu).
    function renderOrderConfirmModalContent(ctx) {
        const questionEl = byId('order-confirm-question');
        const summaryEl = byId('order-confirm-summary');
        const submitBtn = byId('btn-order-confirm-submit');
        const actionWord = ctx.side === 'BUY' ? 'ALMAK' : 'SATMAK';
        const marketLabel = ctx.market === 'VIOP' ? 'VİOP' : 'Spot';
        if (questionEl) {
            if (ctx.willQueueAsPending && ctx.orderType === 'LIMIT') {
                questionEl.textContent = `${ctx.qty} adet ${ctx.symbol} için ${marketLabel} piyasasında ₺${fmtPrice(ctx.limitPrice)} limit fiyatından ${actionWord.toLowerCase()} istediğinize emin misiniz? (fiyat bu seviyeye ulaşınca gerçekleşecek)`;
            } else if (ctx.willQueueAsPending) {
                // (9 Ağustos 2026 — "piyasa kapalıyken kuyruğa emir alma")
                questionEl.textContent = `Piyasa şu anda kapalı — ${ctx.qty} adet ${ctx.symbol} için ${marketLabel} piyasasında ${actionWord.toLowerCase()} emriniz SIRAYA alınacak, gereken teminat şimdi kilitlenecek ve piyasa açılır açılmaz o anki güncel fiyattan otomatik gerçekleştirilecek. Onaylıyor musunuz?`;
            } else {
                questionEl.textContent = `${ctx.qty} adet ${ctx.symbol} hissesini ${marketLabel} piyasasında ₺${fmtPrice(execFillPrice(ctx.side, ctx.fillPrice))} fiyattan ${actionWord.toLowerCase()} istediğinize emin misiniz?`;
            }
        }
        if (summaryEl) summaryEl.innerHTML = buildOrderConfirmSummaryHtml(ctx);
        if (submitBtn) {
            submitBtn.textContent = ctx.willQueueAsPending
                ? (ctx.orderType === 'LIMIT' ? 'Limit Emri Kur' : 'Sıraya Al')
                : (ctx.side === 'BUY' ? 'Onayla · AL' : 'Onayla · SAT');
            submitBtn.classList.toggle('order-confirm-sell-btn', ctx.side === 'SELL' && !ctx.willQueueAsPending);
        }
    }

    function openOrderConfirmModal(ctx) {
        const backdrop = byId('order-confirm-modal-backdrop');
        if (!backdrop) {
            // Modal DOM'da yoksa (beklenmeyen durum) eski davranışa düş —
            // emir onaysız gerçekleşsin ki kullanıcı hiç mahsur kalmasın.
            executeConfirmedOrder(ctx);
            return;
        }

        orderConfirmPendingCtx = ctx;
        renderOrderConfirmModalContent(ctx);

        closeOtherModals('order-confirm-modal-backdrop');
        backdrop.classList.add('open');
    }

    // (12 Ağustos 2026) Onay penceresi AÇIKKEN her tickPrices() döngüsünde
    // çağrılır (bkz. aşağısı) — fiyatı ve gösterilen metni canlı tutar, ki
    // kullanıcı "Onayla"ya basmadan önce gördüğü fiyat gerçek/güncel fiyat
    // olsun.
    function refreshOrderConfirmModalIfOpen() {
        const backdrop = byId('order-confirm-modal-backdrop');
        if (!backdrop || !backdrop.classList.contains('open') || !orderConfirmPendingCtx) return;
        refreshCtxFillPriceToLive(orderConfirmPendingCtx);
        renderOrderConfirmModalContent(orderConfirmPendingCtx);
    }

    function closeOrderConfirmModal() {
        const backdrop = byId('order-confirm-modal-backdrop');
        if (backdrop) backdrop.classList.remove('open');
        orderConfirmPendingCtx = null;
    }

    function setupOrderConfirmModal() {
        const backdrop = byId('order-confirm-modal-backdrop');
        const closeBtn = byId('btn-close-order-confirm');
        const cancelBtn = byId('btn-order-confirm-cancel');
        const submitBtn = byId('btn-order-confirm-submit');
        if (!backdrop) return;

        const cancel = () => closeOrderConfirmModal();
        if (closeBtn) closeBtn.addEventListener('click', cancel);
        if (cancelBtn) cancelBtn.addEventListener('click', cancel);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cancel(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) cancel();
        });
        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                const ctx = orderConfirmPendingCtx;
                // (12 Ağustos 2026) "Onayla" tıklandığı an, bir sonraki
                // tickPrices() döngüsünü beklemeden SON KEZ güncel fiyata
                // senkronize et — ki gösterilen fiyat ile gerçekleşen fiyat
                // (placeOrder'a giden ctx.fillPrice) her zaman birebir aynı olsun.
                if (ctx) refreshCtxFillPriceToLive(ctx);
                closeOrderConfirmModal();
                if (ctx) executeConfirmedOrder(ctx);
            });
        }
    }

    // OCO (One-Cancels-Other) bekleyen emir oluşturur: fiyat üst tetiği
    // yukarı kırarsa AL, alt tetiği aşağı kırarsa açığa SAT gerçekleşir —
    // hangisi önce olursa checkPendingOcoOrders() diğerini otomatik iptal
    // eder (bkz. altta). Mevcut fiyata göre tetikleyicilerin doğru tarafta
    // olduğunu doğrular, aksi halde emir anında (yanlışlıkla) tetiklenirdi.
    function submitOcoOrder(qty, currentPrice, commissionPct) {
        const upperInput = byId('qt-oco-upper');
        const lowerInput = byId('qt-oco-lower');
        const upper = upperInput && upperInput.value ? Number(upperInput.value) : null;
        const lower = lowerInput && lowerInput.value ? Number(lowerInput.value) : null;

        if (!upper && !lower) { const m = 'En az bir tetikleyici (üst veya alt) girin.'; showToast(m); showTicketAlert(m, 'error'); return; }
        if (upper !== null && upper <= currentPrice) { const m = 'Üst tetik, güncel fiyatın üzerinde olmalı.'; showToast(m); showTicketAlert(m, 'error'); return; }
        if (lower !== null && lower >= currentPrice) { const m = 'Alt tetik, güncel fiyatın altında olmalı.'; showToast(m); showTicketAlert(m, 'error'); return; }

        // (23 Temmuz 2026 düzeltmesi — Normal Seans / VİOP ayrımı) OCO'da
        // "alt tetik" gerçekleştiğinde bir SAT emri çalışır (bkz.
        // checkPendingOcoOrders). Normal seansta bu, elde yeterli LONG
        // pozisyon olmadan bir açığa satış tetikleyicisi KURULMASINA izin
        // vermemeli — aksi halde günler sonra fiyat düşünce sessizce bir
        // short açılabilirdi.
        if (lower !== null) {
            const lowerBlockMsg = checkNormalModeShortBlock(state.activeSymbol, 'SELL', qty);
            if (lowerBlockMsg) { showToast(lowerBlockMsg); showTicketAlert(lowerBlockMsg, 'error'); return; }
        }

        // Bakiye ön-kontrolü (23 Temmuz 2026 düzeltmesi): OCO emri anında
        // gerçekleşmediği için bakiye o an DÜŞÜLMÜYOR, ama tetiklendiğinde
        // gereken teminatı karşılayamayacak bir emrin sessizce oluşturulup
        // kullanıcıyı yanıltması (emir "kuruldu" sanılıp günler sonra
        // tetiklendiğinde aslında hiç gerçekleşmemesi) engellenmeli. Gerçek
        // tetik fiyatı ileride değişebileceği için burada YAKLAŞIK bir tahmin
        // (güncel fiyat üzerinden) kullanılıyor; asıl kesin kontrol yine
        // tetiklenme anında placeOrder() içinde yapılıyor — bu sadece erken
        // bir uyarı katmanı.
        // (29 Temmuz 2026 — Madde 11) Marj tahmini de OCO'nun kurulacağı
        // modun (state.market) defterine bakmalı.
        const estimatedMargin = estimateOrderMarginRequirement(state.activeSymbol, state.side, qty, currentPrice, state.leverage, state.market);
        const estimatedCommission = currentPrice * qty * (commissionPct / 100);
        const estimatedRequired = estimatedMargin + estimatedCommission;
        if (estimatedRequired > effectiveBalance()) {
            const m = 'Yetersiz demo bakiye (yaklaşık gereken teminat: ' + fmtTRY(estimatedRequired) + ').';
            showToast(m);
            showTicketAlert(m, 'error');
            return;
        }
        // (9 Ağustos 2026 — kök neden düzeltmesi) OCO da tetiklendiğinde aynı
        // nominal tavana tabi (bkz. placeOrder) — erken uyarı.
        const estimatedOcoNotional = currentPrice * qty;
        if (estimatedOcoNotional > MAX_ORDER_NOTIONAL_TL) {
            const m = 'Emrin büyüklüğü (' + fmtTRY(estimatedOcoNotional) + ') gerçekçi olmayan bir seviyede — tek bir emir ' + fmtTRY(MAX_ORDER_NOTIONAL_TL) + '\'yi aşamaz.';
            showToast(m);
            showTicketAlert(m, 'error');
            return;
        }

        // (29 Temmuz 2026 — Madde 11) OCO emri, kurulduğu andaki moda
        // (state.market) ait bekleyen-emir defterine yazılıyor; emir nesnesi
        // ayrıca kendi "market" alanını taşıyor ki tetiklendiğinde
        // (checkPendingOcoOrders) doğru defterde gerçekleştirilebilsin.
        const ocoBook = book(state.market);
        ocoBook.pending.push({
            id: genId(),
            symbol: state.activeSymbol,
            qty,
            upper,
            lower,
            leverage: state.leverage,
            commissionPct,
            market: state.market,
            createdAt: Date.now()
        });
        savePortfolio();
        renderPendingOcoOrders();
        showToast(`[${state.market === 'VIOP' ? 'VİOP' : 'Spot'}] OCO emri oluşturuldu: ${state.activeSymbol} · ${upper ? 'üst ₺' + fmtPrice(upper) : ''}${upper && lower ? ' / ' : ''}${lower ? 'alt ₺' + fmtPrice(lower) : ''}`);

        const qtyInput = byId('qt-qty');
        if (qtyInput) qtyInput.value = '';
        if (upperInput) upperInput.value = '';
        if (lowerInput) lowerInput.value = '';
        updateEstimate();
    }

    // Her tick'te bekleyen OCO emirlerini güncel fiyata karşı kontrol eder;
    // biri tetiklenince o yönde piyasa emri gerçekleştirilip TÜM emir (iki
    // tetikleyicisiyle birlikte) listeden kaldırılır — "diğerinin otomatik
    // iptali" bu şekilde sağlanıyor (aynı nesnenin tek kullanımlık olması).
    // (29 Temmuz 2026 — Madde 11) Artık Spot VE VİOP'un kendi bekleyen OCO
    // defterleri ayrı ayrı taranıyor — biri tetiklenirken diğerinin
    // defterine hiç dokunmuyor.
    //
    // (6 Ağustos 2026) Aynı bekleyen-emir dizisi artık düz LIMIT emirlerini
    // de (kind: 'LIMIT', bkz. queuePendingLimitOrder) barındırıyor — OCO'dan
    // FARKLI bir tetik mantığıyla: AL limit emri fiyat DÜŞÜP limite EN
    // OLUNCA (price <= limitPrice), SAT limit emri fiyat YÜKSELİP limite
    // ULAŞINCA (price >= limitPrice) gerçekleşir (OCO'nun üst-kırılınca-AL /
    // alt-kırılınca-SAT mantığının TERSİ bir kullanım — limit emri "iyi
    // fiyat beklemek" içindir, breakout değil). ÖNEMLİ: tetiklendiğinde
    // gerçekleşme fiyatı HER ZAMAN o anki GERÇEK/sınırlı piyasa fiyatı
    // (`price`) — order.limitPrice DEĞİL — bkz. submitOrder()'daki kök
    // neden notu (bu, kullanıcının yazdığı keyfi bir fiyattan asla
    // gerçekleşmemesini garanti eder).
    function checkPendingOcoOrders() {
        ['NORMAL', 'VIOP'].forEach(market => {
            const b = book(market);
            if (!b.pending || !b.pending.length) return;
            const stillPending = [];
            let changed = false;
            b.pending.forEach(order => {
                const price = getPrice(order.symbol);
                if (!price) { stillPending.push(order); return; }

                if (order.kind === 'LIMIT') {
                    const triggered = order.side === 'BUY' ? (price <= order.limitPrice) : (price >= order.limitPrice);
                    if (!triggered) { stillPending.push(order); return; }
                    changed = true;
                    // (9 Ağustos 2026 — Binance/Midas tarzı teminat kilidi)
                    // Kuyruğa alırken (queuePendingLimitOrder) kilitlenen
                    // reservedAmount önce iade edilir, ardından placeOrder()
                    // GERÇEK gerçekleşme fiyatına göre kendi teminatını
                    // yeniden hesaplayıp düşer — reservedAmount sadece limit
                    // fiyatı üzerinden bir TAHMİNDİ, gerçek (spread'li) fiyat
                    // biraz farklı çıkabilir, fark burada otomatik dengelenir.
                    if (order.reservedAmount) portfolio.balance += order.reservedAmount;
                    const result = placeOrder(order.symbol, order.side, order.qty, price, order.commissionPct, order.leverage, market);
                    if (result.ok) {
                        showToast(`[${market === 'VIOP' ? 'VİOP' : 'Spot'}] Limit emir gerçekleşti: ${order.symbol} ${order.side === 'BUY' ? 'AL' : 'SAT'} @ ₺${fmtPrice(result.fillPrice)} (limit ₺${fmtPrice(order.limitPrice)}).`);
                        if (order.slPrice !== null || order.tpPrice !== null || order.useTrailing) {
                            const pos = book(market).positions[order.symbol];
                            const expectedSide = order.side === 'BUY' ? 'LONG' : 'SHORT';
                            if (pos && pos.side === expectedSide) {
                                if (order.useTrailing) {
                                    pos.trailingPct = order.trailingPct;
                                    pos.trailingExtreme = pos.avgPrice;
                                    delete pos.sl;
                                } else if (order.slPrice !== null) {
                                    pos.sl = order.slPrice;
                                    delete pos.trailingPct;
                                    delete pos.trailingExtreme;
                                }
                                if (order.tpPrice !== null) pos.tp = order.tpPrice;
                                savePortfolio();
                            }
                        }
                        renderPositions();
                        renderOrders();
                    } else {
                        showToast(`Limit emir tetiklendi ama gerçekleşemedi: ${result.msg}`);
                    }
                    return;
                }

                // (9 Ağustos 2026 — "piyasa kapalıyken kuyruğa emir alma"
                // özelliği) Bu fonksiyon SADECE piyasa açıkken çalışır (bkz.
                // tickPrices()'ın en baştaki DC.isMarketOpenNow() koruması) —
                // yani buraya bir 'MARKET_QUEUED' emri ulaştıysa, piyasa
                // (yeniden) açılmış demektir. Bir fiyat KOŞULU beklemiyor,
                // gördüğü anda o anki güncel/açılış fiyatından KOŞULSUZ
                // gerçekleştirilir.
                if (order.kind === 'MARKET_QUEUED') {
                    changed = true;
                    if (order.reservedAmount) portfolio.balance += order.reservedAmount;
                    const result = placeOrder(order.symbol, order.side, order.qty, price, order.commissionPct, order.leverage, market);
                    if (result.ok) {
                        showToast(`[${market === 'VIOP' ? 'VİOP' : 'Spot'}] Piyasa açıldı — sıradaki emriniz gerçekleşti: ${order.symbol} ${order.side === 'BUY' ? 'AL' : 'SAT'} @ ₺${fmtPrice(result.fillPrice)}.`);
                        if (order.slPrice !== null || order.tpPrice !== null || order.useTrailing) {
                            const pos = book(market).positions[order.symbol];
                            const expectedSide = order.side === 'BUY' ? 'LONG' : 'SHORT';
                            if (pos && pos.side === expectedSide) {
                                if (order.useTrailing) {
                                    pos.trailingPct = order.trailingPct;
                                    pos.trailingExtreme = pos.avgPrice;
                                    delete pos.sl;
                                } else if (order.slPrice !== null) {
                                    pos.sl = order.slPrice;
                                    delete pos.trailingPct;
                                    delete pos.trailingExtreme;
                                }
                                if (order.tpPrice !== null) pos.tp = order.tpPrice;
                                savePortfolio();
                            }
                        }
                        renderPositions();
                        renderOrders();
                    } else {
                        showToast(`Sıradaki piyasa emri gerçekleşemedi: ${result.msg}`);
                    }
                    return;
                }

                let triggeredSide = null;
                if (order.upper !== null && price >= order.upper) triggeredSide = 'BUY';
                else if (order.lower !== null && price <= order.lower) triggeredSide = 'SELL';

                if (triggeredSide) {
                    changed = true;
                    const result = placeOrder(order.symbol, triggeredSide, order.qty, price, order.commissionPct, order.leverage, market);
                    if (result.ok) {
                        showToast(`[${market === 'VIOP' ? 'VİOP' : 'Spot'}] OCO tetiklendi: ${order.symbol} ${triggeredSide === 'BUY' ? 'AL' : 'AÇIĞA SAT'} @ ₺${fmtPrice(result.fillPrice)} — diğer tetikleyici iptal edildi.`);
                        renderPositions();
                        renderOrders();
                    } else {
                        showToast(`OCO tetiklendi ama emir başarısız: ${result.msg}`);
                    }
                    // Triggered (successfully or not) — either way this pending
                    // order is consumed, matching real OCO semantics of a single
                    // fill attempt rather than retrying every tick.
                } else {
                    stillPending.push(order);
                }
            });
            if (changed) {
                if (market === 'VIOP') portfolio.viopPendingOrders = stillPending;
                else portfolio.pendingOrders = stillPending;
                savePortfolio();
                renderPendingOcoOrders();
                renderAccountSummary();
            }
        });
    }

    // (29 Temmuz 2026 — Madde 11) id'ler genId() ile üretiliyor (zaman damgası
    // + rastgele parça), pratikte çakışma ihtimali yok — bu yüzden iptal
    // ederken hangi deftere ait olduğunu ayrıca bilmeye gerek yok, ikisinde de
    // aranıp bulunduğu defterden çıkarılıyor.
    function cancelOcoOrder(orderId) {
        // (9 Ağustos 2026 — Binance/Midas tarzı teminat kilidi) LIMIT ve
        // MARKET_QUEUED emirleri kurulurken teminat ANINDA kilitleniyor
        // (bkz. queuePendingLimitOrder/queuePendingMarketOrder) — iptal
        // edildiğinde bu kilitli tutar TAM olarak bakiyeye geri iade
        // edilmeli, aksi halde kullanıcı iptal ettiği emrin parasını
        // kaybetmiş gibi görünür. OCO'nun kendisi hiçbir teminat kilitlemez
        // (reservedAmount hiç yok), o yüzden onun iptalinde ekstra bir şey
        // yapılmıyor.
        let order = null, orderMarket = null;
        if (portfolio.pendingOrders) {
            const found = portfolio.pendingOrders.find(o => o.id === orderId);
            if (found) { order = found; orderMarket = 'NORMAL'; }
        }
        if (!order && portfolio.viopPendingOrders) {
            const found = portfolio.viopPendingOrders.find(o => o.id === orderId);
            if (found) { order = found; orderMarket = 'VIOP'; }
        }
        if (!order) return;
        if (order.reservedAmount) portfolio.balance += order.reservedAmount;
        if (orderMarket === 'VIOP') {
            portfolio.viopPendingOrders = portfolio.viopPendingOrders.filter(o => o.id !== orderId);
        } else {
            portfolio.pendingOrders = portfolio.pendingOrders.filter(o => o.id !== orderId);
        }
        savePortfolio();
        renderPendingOcoOrders();
        renderAccountSummary();
        const kindLabel = order.kind === 'LIMIT' ? 'Limit emri' : order.kind === 'MARKET_QUEUED' ? 'Sıradaki piyasa emri' : 'OCO emri';
        showToast(kindLabel + ' iptal edildi' + (order.reservedAmount ? ` — kilitli teminat (₺${fmtTRY(order.reservedAmount).replace('₺', '')}) bakiyenize iade edildi.` : '.'));
    }
    window.__optipulseCancelOco = cancelOcoOrder; // used by inline onclick in rendered rows

    // (29 Temmuz 2026 — Madde 11) Spot ve VİOP'un kendi ayrı DOM
    // konteynerlerine render eden ortak yardımcı — iki liste birbirinden
    // tamamen bağımsız, aynı mantığın iki kez tekrarlanmasını önlüyor.
    //
    // (6 Ağustos 2026) Artık aynı liste iki farklı emir TÜRÜNÜ birlikte
    // gösterebiliyor: OCO (üst/alt tetikleyici çifti) ve düz LIMIT
    // (kind: 'LIMIT', tek limit fiyatı + yön). İkisi görsel olarak
    // ayrılıyor ki kullanıcı hangi emrin hangi mantıkla çalıştığını
    // karıştırmasın.
    function renderOcoListInto(containerId, orders) {
        const body = byId(containerId);
        if (!body) return;
        if (!orders.length) {
            body.innerHTML = `<div class="qt-empty-state">Bekleyen emir yok</div>`;
            return;
        }
        body.innerHTML = orders.map(o => {
            // (9 Ağustos 2026) LIMIT/MARKET_QUEUED emirleri artık kurulduğu
            // anda gerçek bir teminat kilitliyor (bkz. queuePendingLimitOrder/
            // queuePendingMarketOrder) — kullanıcının "param nereye gitti"
            // diye şaşırmaması için kilitli tutar kartta ayrıca gösteriliyor.
            const reservedRow = o.reservedAmount
                ? `<div class="oco-card-bottom font-mono" style="margin-top:4px;opacity:0.75;"><span>🔒 Kilitli teminat: ₺${fmtTRY(o.reservedAmount).replace('₺', '')}</span></div>`
                : '';
            if (o.kind === 'MARKET_QUEUED') {
                return `
                    <div class="oco-card">
                        <div class="oco-card-top">
                            <span class="font-bold">${o.symbol} · Piyasa (Sırada) ${o.side === 'BUY' ? 'AL' : 'SAT'}</span>
                            <button class="btn-cancel-oco" onclick="window.__optipulseCancelOco('${o.id}')">İptal</button>
                        </div>
                        <div class="oco-card-bottom font-mono">
                            <span>Piyasa açılınca gerçekleşir</span>
                            <span>${o.qty} adet</span>
                            <span>${o.leverage > 1 ? fmtLeverage(o.leverage) + 'x' : ''}</span>
                        </div>
                        ${reservedRow}
                    </div>
                `;
            }
            if (o.kind === 'LIMIT') {
                return `
                    <div class="oco-card">
                        <div class="oco-card-top">
                            <span class="font-bold">${o.symbol} · Limit ${o.side === 'BUY' ? 'AL' : 'SAT'}</span>
                            <button class="btn-cancel-oco" onclick="window.__optipulseCancelOco('${o.id}')">İptal</button>
                        </div>
                        <div class="oco-card-bottom font-mono">
                            <span>Limit ₺${fmtPrice(o.limitPrice)}</span>
                            <span>${o.qty} adet</span>
                            <span>${o.leverage > 1 ? fmtLeverage(o.leverage) + 'x' : ''}</span>
                        </div>
                        ${reservedRow}
                    </div>
                `;
            }
            return `
            <div class="oco-card">
                <div class="oco-card-top">
                    <span class="font-bold">${o.symbol} · OCO</span>
                    <button class="btn-cancel-oco" onclick="window.__optipulseCancelOco('${o.id}')">İptal</button>
                </div>
                <div class="oco-card-bottom font-mono">
                    <span>Üst ${o.upper !== null ? '₺' + fmtPrice(o.upper) : '--'}</span>
                    <span>Alt ${o.lower !== null ? '₺' + fmtPrice(o.lower) : '--'}</span>
                    <span>${o.qty} adet</span>
                </div>
            </div>
        `;
        }).join('');
    }

    function renderPendingOcoOrders() {
        renderOcoListInto('qt-pending-oco-body', portfolio.pendingOrders || []);
        renderOcoListInto('qt-pending-oco-body-viop', portfolio.viopPendingOrders || []);
    }

    // Kaldıraç/Marj modeli (17 Temmuz 2026, yedinci oturum): pozisyon açılırken
    // bakiyeden tam nominal tutar (price*qty) yerine sadece MARJ
    // (price*qty/leverage) düşülüyor, kapatılırken de o marj + gerçekleşen K/Z
    // geri ekleniyor. Bu, hem LONG hem SHORT için simetrik/birleşik bir
    // muhasebe modeli — leverage=1'de matematiksel olarak eskisiyle BİREBİR
    // aynı sonucu (aynı final bakiye) verir (LONG için triviyal, SHORT için:
    // eski model "ödünç hisse satıp bedelini hemen alma" kurgusuydu, yeni
    // model "teminat kilitleme" kurgusu — ikisi de round-trip'te aynı net
    // K/Z'ye ulaşıyor, ama yeni model kaldıraçla temiz şekilde genelleşiyor).
    // ÖNEMLİ: kaldıraç sadece GEREKEN TEMİNATI azaltıyor; gerçekleşen K/Z
    // büyüklüğü (fiyat farkı × adet) kaldıraçtan etkilenmiyor — gerçek marjin
    // ticaretinde de böyledir.
    // (23 Temmuz 2026 düzeltmesi) Kullanıcı geri bildirimi: "elimde TUPRS
    // yok ama sat kısmından direkt SAT deyince short işlem açıyor" — gerçek
    // BIST'te normal (nakit/Pay Piyasası) seansta açığa satış YAPILAMAZ;
    // açığa satış ve kaldıraç yalnızca ayrı bir piyasa olan VİOP'ta (Vadeli
    // İşlem ve Opsiyon Piyasası) mümkündür. Bu yüzden ticket'a bir "Normal
    // Seans / VİOP" anahtarı eklendi (state.market, bkz. üstteki tanım +
    // setupMarketModeSelector). NORMAL modda bir SAT emri yalnızca elde
    // tutulan bir LONG pozisyonu kapatabilir/azaltabilir — yeni bir SHORT
    // hiçbir şekilde açamaz. VİOP modunda ise DEĞİŞMEYEN eski davranış
    // geçerli: pozisyon yokken SAT direkt bir SHORT açar, kaldıraç seçilebilir.
    // null döner (izinli) ya da kullanıcıya gösterilecek hata mesajını döner.
    function checkNormalModeShortBlock(symbol, side, qty) {
        if (state.market !== 'NORMAL' || side !== 'SELL') return null;
        const pos = portfolio.positions[symbol];
        if (!pos || pos.side !== 'LONG') {
            return `Normal seansta açığa satış yapılamaz — ${symbol} için pozisyonunuz yok. Açığa satış/kaldıraç için yukarıdan VİOP'a geçin.`;
        }
        if (qty > pos.qty) {
            return `Normal seansta yalnızca elinizdeki kadar satabilirsiniz (mevcut: ${pos.qty} adet). Daha fazlası açığa satış sayılır — VİOP'a geçin.`;
        }
        return null;
    }

    // placeOrder()'daki marj hesaplama mantığının salt-okunur (hiçbir şeyi
    // değiştirmeyen) bir kopyası — OCO emri oluştururken erken bir bakiye
    // uyarısı verebilmek için kullanılıyor (bkz. submitOcoOrder). Ters yönde
    // açık bir pozisyon varsa önce onun kapanmasıyla serbest kalacak marjı da
    // hesaba katıyor, böylece "zaten açık bir SHORT'u kapatıp yeni bir LONG
    // açan" bir OCO emri de doğru şekilde değerlendiriliyor.
    function estimateOrderMarginRequirement(symbol, side, qty, price, leverage, market) {
        qty = Math.floor(Number(qty));
        price = Number(price);
        if (!symbol || !qty || qty <= 0 || !price || price <= 0) return 0;

        let remainingQty = qty;
        let releasedMargin = 0;
        // (29 Temmuz 2026 — Madde 11) Hangi defterin (Spot/VİOP) kontrol
        // edileceği çağıran tarafın belirttiği market'e göre seçiliyor.
        const pos = book(market).positions[symbol];
        if (pos && ((side === 'BUY' && pos.side === 'SHORT') || (side === 'SELL' && pos.side === 'LONG'))) {
            const closeQty = Math.min(remainingQty, pos.qty);
            const posLeverage = pos.leverage || 1;
            // (10 Ağustos 2026) placeOrder()'daki lockedMargin düzeltmesiyle
            // tutarlı olsun diye burada da GERÇEK kilitli marj (varsa)
            // kullanılıyor — bkz. placeOrder'daki tam açıklama.
            const totalLockedMargin = (typeof pos.lockedMargin === 'number')
                ? pos.lockedMargin
                : (pos.avgPrice * pos.qty) / posLeverage;
            releasedMargin = totalLockedMargin * (closeQty / pos.qty);
            remainingQty -= closeQty;
        }
        if (remainingQty <= 0) return -releasedMargin;

        // (23 Temmuz 2026 düzeltmesi) Bu tahmin de artık placeOrder() ile
        // birebir aynı mantığı izliyor: eklenen kısmın marjı, mevcut
        // pozisyonun ESKİ kaldıracıyla değil, bilet üzerinde SEÇİLİ olan
        // (bu fonksiyona parametre olarak gelen) kaldıraçla hesaplanıyor —
        // bkz. placeOrder()'daki ayrıntılı açıklama.
        // (10 Ağustos 2026 — kademeli kaldıraç önizlemesi) ...ve artık
        // kademeli kaldıraç tavanıyla da (bkz. previewTieredLeverage)
        // placeOrder()'ın GERÇEKTE uygulayacağıyla tutarlı.
        const effectiveLeverage = previewTieredLeverage(price * remainingQty, leverage, market);
        const margin = (price * remainingQty) / effectiveLeverage;
        return margin - releasedMargin;
    }

    // (29 Temmuz 2026 — Madde 18 "kullanıcının geçmişte yaptığı al-sat
    // noktalarını grafikte ok ile göster") tradingChart.js'in belirli bir
    // sembol için GERÇEK işlem geçmişini okuyup grafikte ok işareti
    // çizebilmesi için salt-okunur bir kopya döndürür.
    function getTradeHistoryForSymbol(symbol) {
        // (29 Temmuz 2026 — Madde 11) Grafikteki al/sat okları, o sembolde
        // Spot VE VİOP'ta yapılmış TÜM gerçek işlemleri kapsıyor — ikisi de
        // gerçek, kullanıcının bizzat yaptığı işlemler.
        const spot = portfolio.history.filter(h => h.symbol === symbol);
        const viop = (portfolio.viopHistory || []).filter(h => h.symbol === symbol);
        return spot.concat(viop).map(h => ({ ...h }));
    }

    function placeOrder(symbol, side, qty, midPrice, commissionPct, leverage, market) {
        qty = Math.floor(Number(qty));
        midPrice = Number(midPrice);
        if (!qty || qty <= 0 || !midPrice || midPrice <= 0) return { ok: false, msg: 'Geçersiz miktar/fiyat' };

        // (9 Ağustos 2026 — kök neden düzeltmesi) Gerçekleşme fiyatı artık
        // ARTIK ÇIPLAK piyasa fiyatı (mid) değil, yöne göre kotasyon
        // farkı (spread) uygulanmış bid/ask — bkz. execFillPrice() ve
        // yukarıdaki HALF_SPREAD_PCT notu. `price` değişkeni bundan sonra
        // fonksiyon içinde HEP bu gerçekleşme fiyatını temsil ediyor.
        const price = execFillPrice(side, midPrice);

        // (29 Temmuz 2026 — Madde 11 "VİOP ayrı panel") Emrin hangi deftere
        // (Spot/VİOP) yazılacağı burada belirleniyor — bkz. book(). Geriye
        // dönük uyumluluk için market belirtilmezse (eski çağrı kalıntısı
        // olursa) NORMAL/Spot varsayılıyor.
        market = market === 'VIOP' ? 'VIOP' : 'NORMAL';
        const b = book(market);

        const commissionTotal = price * qty * (commissionPct / 100);
        let remainingQty = qty;
        const pos = b.positions[symbol];
        let leverageClampedTo = null; // (10 Ağustos 2026) kademeli kaldıraç devreye girdiyse çağırana bildirmek için

        // 1. Close/reduce an opposite-direction position first.
        if (pos && ((side === 'BUY' && pos.side === 'SHORT') || (side === 'SELL' && pos.side === 'LONG'))) {
            const closeQty = Math.min(remainingQty, pos.qty);
            const closeCommission = commissionTotal * (closeQty / qty);
            const posLeverage = pos.leverage || 1;
            // (10 Ağustos 2026 — kök neden düzeltmesi: "kâr gösteriyor ama
            // bakiye artacağına azalıyor") ESKİ formül: releasedMargin =
            // avgPrice*closeQty/leverage — burada `leverage`, pozisyona
            // yapılan TÜM eklemelerin adet-ağırlıklı ORTALAMASI (bkz. aşağıdaki
            // "2. Open or add" dalı). Bu formül SADECE pozisyona yapılan TÜM
            // eklemeler AYNI kaldıraçla yapıldıysa gerçekten kilitlenen
            // toplam marjla eşleşir. Kademeli VİOP kaldıracı (tieredMaxLeverage)
            // yüzünden aynı sembole art arda YAPILAN eklemeler artık SIKLIKLA
            // farklı kaldıraçlarda oluyor (pozisyon büyüdükçe otomatik daha
            // düşük tier'a düşüyor) — bu durumda avgPrice*qty/ortalamaKaldıraç,
            // gerçekte kilitlenmiş toplam marjdan SİSTEMATİK olarak sapıyor
            // (örnek: 1000 adet @100 10x'te [marj 10.000] + 1000 adet @110
            // 5x'te [marj 22.000] = gerçek kilitli marj 32.000 TL, ama eski
            // formül 105*2000/7.5 = 28.000 TL hesaplıyordu — kapanışta 4.000
            // TL'lik marj SESSİZCE KAYBOLUYORDU, kâr doğru hesaplansa bile net
            // bakiye beklenenden düşük çıkıyordu). Düzeltme: pos.lockedMargin
            // artık her eklemede GERÇEKTEN kilitlenen tutarı birebir topluyor
            // (bkz. aşağıki "2." dal) ve burada oranla (closeQty/pos.qty)
            // GERİ VERİLİYOR — ortalama kaldıraçtan yeniden hesaplanmıyor.
            // pos.lockedMargin yoksa (bu düzeltmeden ÖNCE açılmış eski bir
            // pozisyon) eski formülle bir kerelik geriye dönük tahmin yapılır.
            const totalLockedMargin = (typeof pos.lockedMargin === 'number')
                ? pos.lockedMargin
                : (pos.avgPrice * pos.qty) / posLeverage;
            const releasedMargin = totalLockedMargin * (closeQty / pos.qty);
            let realizedPnl;

            if (pos.side === 'LONG') {
                realizedPnl = (price - pos.avgPrice) * closeQty - closeCommission;
            } else {
                realizedPnl = (pos.avgPrice - price) * closeQty - closeCommission;
            }
            portfolio.balance += releasedMargin + realizedPnl;

            pos.lockedMargin = totalLockedMargin - releasedMargin;
            pos.qty -= closeQty;
            remainingQty -= closeQty;
            if (pos.qty <= 0) delete b.positions[symbol];

            b.history.unshift({
                id: genId(), ts: Date.now(), symbol, side, qty: closeQty, price,
                type: 'CLOSE', commission: +closeCommission.toFixed(2), pnl: +realizedPnl.toFixed(2)
            });
        }

        // 2. Open or add to a position in the order's direction with any remaining qty.
        if (remainingQty > 0) {
            const newSide = side === 'BUY' ? 'LONG' : 'SHORT';
            const openCommission = commissionTotal * (remainingQty / qty);

            // (23 Temmuz 2026 düzeltmesi) ÖNCEKİ tasarım: var olan bir
            // pozisyona ekleniyorsa, bilette SEÇİLİ kaldıraç tamamen yok
            // sayılıp pozisyonun İLK açıldığı kaldıraç zorla yeniden
            // kullanılıyordu ("aynı pozisyon içinde farklı kaldıraç
            // seviyelerini karıştırmak marj hesaplamasını belirsizleştirir"
            // gerekçesiyle). Kullanıcı geri bildirimi ("bir hisseyi normal
            // aldıktan sonra kaldıraçlı almak istersem almıyor") bunun
            // pratikte gerçek bir engel yarattığını gösterdi: ör. normal
            // (1x) bir THYAO pozisyonu varken 5x ile ekleme yapmaya
            // çalışıldığında, gereken teminat SESSİZCE 5 kat daha FAZLA
            // (1x üzerinden) hesaplanıyor, bu da beklenmedik şekilde
            // "yetersiz bakiye" ile reddediliyordu — kaldıraç seçimi hiç
            // işe yaramıyordu.
            //
            // Yeni tasarım: eklenen kısmın marjı bilette SEÇİLİ kaldıraçla
            // hesaplanıyor (avgPrice'ın zaten yaptığı gibi), pozisyonun
            // saklanan kaldıracı da avgPrice ile AYNI adet-ağırlıklı
            // ortalama yöntemiyle güncelleniyor — böylece marj/likidasyon
            // formülleri (avgPrice*qty/leverage, bkz. checkMarginCalls ve
            // computeAccountSnapshot) hiç değişmeden doğru sonucu vermeye
            // devam ediyor, sadece "leverage" artık tek bir sabit değer
            // değil, gerçek ağırlıklı ortalama bir değer.
            const existingPos = b.positions[symbol];
            const requestedLeverage = Math.max(1, Number(leverage) || 1);

            // (9 Ağustos 2026 — kök neden düzeltmesi) Tek bir emrin AÇILAN
            // kısmının nominal değeri (fiyat × adet) gerçekçi bir tavanı
            // aşamaz — gerçek bir borsada bu büyüklükte bir emri karşılayacak
            // likidite yok. Kapatma (yukarıdaki 1. adım) bu sınıra TABİ
            // DEĞİL — açık bir pozisyon her zaman kapatılabilmeli.
            const openingNotional = price * remainingQty;
            if (openingNotional > MAX_ORDER_NOTIONAL_TL) {
                savePortfolio();
                return { ok: false, msg: 'Emrin büyüklüğü (' + fmtTRY(openingNotional) + ') gerçekçi olmayan bir seviyede — tek bir emir ' + fmtTRY(MAX_ORDER_NOTIONAL_TL) + '\'yi aşamaz.' };
            }

            // (10 Ağustos 2026 — kademeli kaldıraç) VİOP'ta izin verilen
            // maksimum kaldıraç, AÇILAN kısmın nominal büyüklüğüne göre
            // otomatik düşer (bkz. VIOP_LEVERAGE_TIERS/tieredMaxLeverage
            // yukarıda) — gerçek platformlardaki (Binance vb.) kademeli
            // kaldıraç/marj sistemine benzer. NORMAL seansta zaten 1x'e
            // sabitlendiği için bu her zaman no-op'tur.
            let effectiveRequestedLeverage = requestedLeverage;
            if (market === 'VIOP') {
                const tierMax = tieredMaxLeverage(openingNotional);
                if (effectiveRequestedLeverage > tierMax) {
                    leverageClampedTo = tierMax;
                    effectiveRequestedLeverage = tierMax;
                }
            }

            const margin = (price * remainingQty) / effectiveRequestedLeverage;
            const requiredBalance = margin + openCommission;
            if (effectiveBalance() < requiredBalance) {
                savePortfolio();
                const msg = isFtcLoggedIn()
                    ? 'Yetersiz demo bakiye (gereken teminat: ' + fmtTRY(requiredBalance) + ').'
                    : 'İşlem açmak için önce FinteLig girişi yapmalısın (profil panelinden).';
                return { ok: false, msg: msg };
            }
            portfolio.balance -= requiredBalance;

            let effectiveLeverage;
            if (!existingPos) {
                effectiveLeverage = effectiveRequestedLeverage;
                // (10 Ağustos 2026 — VİOP asgari tutma süresi) openedAt, bu
                // pozisyon MANUEL olarak ne zaman kapatılabileceğini belirlemek
                // için closePosition()'da kullanılıyor — bkz. MIN_POSITION_HOLD_MS.
                // Var olan bir pozisyona EKLEME yapılırken (aşağıdaki else dalı)
                // kasıtlı olarak DOKUNULMUYOR: pozisyonun "yaşı" ilk açıldığı
                // ana göre sayılmaya devam eder, her ekleme sayacı sıfırlamaz.
                // (10 Ağustos 2026 — kök neden düzeltmesi) lockedMargin,
                // pozisyonda GERÇEKTEN kilitli duran toplam marjı izliyor —
                // bkz. yukarıdaki "1. Close/reduce" dalındaki tam açıklama.
                // Taze açılışta bu basitçe az önce hesaplanan `margin`.
                b.positions[symbol] = { side: newSide, qty: remainingQty, avgPrice: price, leverage: effectiveLeverage, lockedMargin: margin, openedAt: Date.now() };
            } else {
                const p = existingPos;
                const totalQty = p.qty + remainingQty;
                const oldLeverage = p.leverage || 1;
                // (10 Ağustos 2026 — kök neden düzeltmesi) Eklemeden ÖNCEKİ
                // gerçek kilitli marj — pos.lockedMargin varsa onu kullan,
                // yoksa (bu düzeltmeden önce açılmış eski pozisyon) eski
                // formülle bir kerelik tahmin. Yeni eklenen kısmın marjı
                // (`margin`, yukarıda zaten kendi kaldıracıyla doğru
                // hesaplandı ve bakiyeden düşüldü) buna DOĞRUDAN eklenir —
                // ortalama kaldıraç üzerinden YENİDEN hesaplanmaz, bu yüzden
                // farklı kaldıraçlarla yapılan art arda eklemelerde bile
                // kilitli toplam marj hep doğru kalır.
                const existingLockedMargin = (typeof p.lockedMargin === 'number')
                    ? p.lockedMargin
                    : (p.avgPrice * p.qty) / oldLeverage;
                p.avgPrice = (p.avgPrice * p.qty + price * remainingQty) / totalQty;
                effectiveLeverage = (oldLeverage * p.qty + effectiveRequestedLeverage * remainingQty) / totalQty;
                p.lockedMargin = existingLockedMargin + margin;
                p.qty = totalQty;
                p.leverage = effectiveLeverage;
            }

            b.history.unshift({
                id: genId(), ts: Date.now(), symbol, side, qty: remainingQty, price,
                type: 'OPEN', commission: +openCommission.toFixed(2), pnl: null, leverage: effectiveLeverage
            });
        }

        // (29 Temmuz 2026 — Madde 11) Son 50 kayıtla sınırlama artık HANGİ
        // deftere yazıldıysa onun üzerinde yapılıyor (önceden her zaman
        // portfolio.history'yi kırpıyordu — bir VİOP emrinde bu hem yanlış
        // deftere dokunuyor hem de viopHistory'nin sınırsız büyümesine yol
        // açıyordu). `.length` ile yerinde kırpma, b.history'nin (portfolio
        // üzerindeki gerçek diziye) referansını bozmadan çalışır.
        if (b.history.length > 50) b.history.length = 50;
        savePortfolio();
        // (29 Temmuz 2026 — Madde 18) Grafikte o an bu sembol gösteriliyorsa
        // yeni işlemin ok işaretinin sembol değiştirmeden hemen görünmesi
        // için.
        if (window.TradingChart && window.TradingChart.refreshUserTradeMarkers) {
            window.TradingChart.refreshUserTradeMarkers(symbol);
        }
        // (9 Ağustos 2026) Gerçekleşme fiyatı artık mid'den spread kadar
        // farklı olabildiği için, çağıranların kendi (spread'siz) mid
        // değişkenleri yerine GERÇEKTEN gerçekleşen fiyatı gösterebilmesi
        // için burada da döndürülüyor.
        return { ok: true, fillPrice: price, leverageClampedTo: leverageClampedTo };
    }

    function closePosition(symbol, reason, market) {
        // (29 Temmuz 2026 — Madde 11) Hangi defterin (Spot/VİOP) kapatılacağı
        // artık açıkça belirtiliyor — otomatik SL/TP/marj çağrısı kontrolleri
        // pozisyonun bulunduğu deftere göre bunu geçiyor; manuel "Kapat"
        // butonu da kartın ait olduğu moda göre (bkz. renderPositionsInto).
        market = market === 'VIOP' ? 'VIOP' : 'NORMAL';
        const pos = book(market).positions[symbol];
        if (!pos) return;

        // (10 Ağustos 2026 — VİOP asgari tutma süresi) `reason` OTOMATİK
        // kapamalarda (SL/TP/TRAILING/LIQUIDATION) dolu gelir — manuel
        // "Kapat" butonu her zaman null geçer (bkz. __optipulseClosePosition
        // inline onclick). Bu sınır manuel kapamaya VE Take-Profit'e
        // uygulanıyor. (10 Ağustos 2026, ikinci tur) TP de dahil edildi,
        // çünkü aksi halde kullanıcı pozisyonu açar açmaz giriş fiyatının
        // hemen üstüne bir TP koyup asgari süreyi TAMAMEN dolanabilirdi —
        // TP, checkStopLossTakeProfit() tarafından her 2 saniyelik tick'te
        // yeniden kontrol edildiği için koşul sağlandığı an otomatik
        // tetiklenir, tıpkı manuel "kârdaysa hemen kapat" davranışı gibi.
        // Stop-Loss/Trailing Stop/Marj çağrısı KESİNLİKLE bu sınıra TABİ
        // DEĞİL — bunlar kayıptan koruma mekanizmaları, asla
        // geciktirilmemeli. pos.openedAt olmayan (bu düzeltmeden ÖNCE
        // açılmış) eski pozisyonlar bloklanmıyor.
        const holdGatedClose = !reason || reason === 'TP';
        if (holdGatedClose && pos.openedAt) {
            const heldMs = Date.now() - pos.openedAt;
            if (heldMs < MIN_POSITION_HOLD_MS) {
                if (!reason) {
                    const remainingSec = Math.ceil((MIN_POSITION_HOLD_MS - heldMs) / 1000);
                    showToast(`⏳ ${symbol} pozisyonu en az ${Math.round(MIN_POSITION_HOLD_MS / 1000)} saniye açık kalmalı — ${remainingSec} saniye daha bekleyin.`);
                }
                // TP tetiklemesi sessizce ertelenir — checkStopLossTakeProfit()
                // zaten her tick'te tekrar deneyecek, süre dolunca (fiyat hâlâ
                // TP koşulunu sağlıyorsa) otomatik gerçekleşir. Burada toast
                // basmıyoruz, aksi halde 2 saniyede bir spam olurdu.
                return;
            }
        }

        const price = getPrice(symbol);
        if (!price) return;
        const side = pos.side === 'LONG' ? 'SELL' : 'BUY';
        const result = placeOrder(symbol, side, pos.qty, price, getCommissionPct(), pos.leverage || 1, market);
        if (result.ok) {
            renderPositions();
            renderOrders();
            renderAccountSummary();
            // (9 Ağustos 2026) result.fillPrice — placeOrder()'ın spread
            // uyguladıktan sonraki GERÇEK kapanış fiyatı.
            const fp = result.fillPrice;
            const msg = reason === 'SL'
                ? `🛑 ${symbol} Stop-Loss tetiklendi — pozisyon ₺${fmtPrice(fp)} seviyesinden kapatıldı.`
                : reason === 'TP'
                    ? `🎯 ${symbol} Take-Profit tetiklendi — pozisyon ₺${fmtPrice(fp)} seviyesinden kapatıldı.`
                    : reason === 'TRAILING'
                        ? `📉 ${symbol} Trailing Stop tetiklendi — pozisyon ₺${fmtPrice(fp)} seviyesinden kapatıldı.`
                        : reason === 'LIQUIDATION'
                            ? `⚠️ ${symbol} marj çağrısı — kaldıraçlı pozisyon zarar sınırını aştığı için ₺${fmtPrice(fp)} seviyesinden otomatik likide edildi.`
                            : `${symbol} pozisyonu kapatıldı.`;
            showToast(msg);
            if (reason === 'LIQUIDATION') playLiquidationChime();
            else if (reason === 'SL' || reason === 'TP' || reason === 'TRAILING') playSltpChime();
        }
    }
    window.__optipulseClosePosition = closePosition; // used by inline onclick in rendered rows

    /* ════════════════════════════════════════════════
       Stop-Loss / Take-Profit auto-execution
       ════════════════════════════════════════════════ */

    // (29 Temmuz 2026 — Madde 11) Artık Spot VE VİOP defterlerinin ikisi de
    // taranıyor — bir VİOP pozisyonunun SL/TP/Trailing Stop'u önceden hiç
    // kontrol edilmiyordu (yalnızca portfolio.positions taranıyordu).
    function checkStopLossTakeProfit() {
        ['NORMAL', 'VIOP'].forEach(market => {
            const positions = book(market).positions;
            Object.keys(positions).forEach(symbol => {
                const pos = positions[symbol];
                if (!pos.sl && !pos.tp && !pos.trailingPct) return;
                const price = getPrice(symbol);
                if (!price) return;

                // Trailing Stop (17 Temmuz 2026, yedinci oturum): fiyat lehte
                // hareket ettikçe pos.trailingExtreme yeni bir en iyi seviyeye
                // "kilitleniyor" (geri çekilmede asla geri gitmiyor), stop
                // seviyesi her zaman o en iyi seviyeden trailingPct kadar geride
                // hesaplanıyor. Sabit SL'nin aksine, fiyat lehte ilerledikçe
                // kilitlenen kâr da artıyor.
                if (pos.trailingPct) {
                    if (pos.side === 'LONG') {
                        if (price > pos.trailingExtreme) pos.trailingExtreme = price;
                        const stopPrice = pos.trailingExtreme * (1 - pos.trailingPct / 100);
                        if (price <= stopPrice) { closePosition(symbol, 'TRAILING', market); return; }
                    } else {
                        if (price < pos.trailingExtreme) pos.trailingExtreme = price;
                        const stopPrice = pos.trailingExtreme * (1 + pos.trailingPct / 100);
                        if (price >= stopPrice) { closePosition(symbol, 'TRAILING', market); return; }
                    }
                }

                if (pos.side === 'LONG') {
                    if (pos.sl && price <= pos.sl) { closePosition(symbol, 'SL', market); return; }
                    if (pos.tp && price >= pos.tp) { closePosition(symbol, 'TP', market); return; }
                } else {
                    if (pos.sl && price >= pos.sl) { closePosition(symbol, 'SL', market); return; }
                    if (pos.tp && price <= pos.tp) { closePosition(symbol, 'TP', market); return; }
                }
            });
        });
    }

    // Marj çağrısı / likidasyon simülasyonu (17 Temmuz 2026, yedinci oturum):
    // kaldıraçlı bir pozisyonun gerçekleşmemiş zararı, o pozisyona kilitli
    // marjın LIQUIDATION_MARGIN_LOSS_RATIO'sunu (%80) aşarsa, gerçek bir
    // borsadaki marj çağrısı/zorunlu kapama gibi pozisyon otomatik kapatılır
    // — aksi halde kaldıraçlı bir pozisyon bakiyeyi negatife düşürebilirdi
    // (demo bakiye asla eksiye düşmemeli). Sadece leverage > 1 olan
    // pozisyonlar risk altında; leverage=1'de marj = tam nominal tutar
    // olduğundan zarar hiçbir zaman marjın %100'ünü geçemez (bir hissenin
    // fiyatı teorik olarak 0'a inebilir ama negatif olamaz).
    // (29 Temmuz 2026 — Madde 11) Marj çağrısı kontrolü de artık Spot VE
    // VİOP'un ikisini de tarıyor.
    function checkMarginCalls() {
        ['NORMAL', 'VIOP'].forEach(market => {
            const positions = book(market).positions;
            Object.keys(positions).forEach(symbol => {
                const pos = positions[symbol];
                const leverage = pos.leverage || 1;
                if (leverage <= 1) return;
                const price = getPrice(symbol);
                if (!price) return;
                // (10 Ağustos 2026) Likidasyon eşiği artık GERÇEK kilitli
                // marja (pos.lockedMargin, varsa) göre hesaplanıyor — bkz.
                // placeOrder'daki tam açıklama. Karışık kaldıraçlı
                // eklemelerde eski formül (avgPrice*qty/ortalamaKaldıraç)
                // yanlış bir marj tabanı verip likidasyonu erken/geç
                // tetikleyebiliyordu.
                const margin = (typeof pos.lockedMargin === 'number') ? pos.lockedMargin : (pos.avgPrice * pos.qty) / leverage;
                const unrealized = pos.side === 'LONG'
                    ? (price - pos.avgPrice) * pos.qty
                    : (pos.avgPrice - price) * pos.qty;
                if (unrealized <= -margin * LIQUIDATION_MARGIN_LOSS_RATIO) {
                    closePosition(symbol, 'LIQUIDATION', market);
                }
            });
        });
    }

    function setPositionSLTP(symbol, slPrice, tpPrice, market) {
        market = market === 'VIOP' ? 'VIOP' : 'NORMAL';
        const pos = book(market).positions[symbol];
        if (!pos) return false;
        pos.sl = slPrice || null;
        pos.tp = tpPrice || null;
        savePortfolio();
        renderPositions();
        // (26 Temmuz 2026 devamı) Portföy genel risk uyarısı artık pos.sl'e
        // bağlı (bkz. computeAccountSnapshot/renderPortfolioRiskWarning) —
        // bu modaldan bir Stop-Loss eklenip/kaldırıldığında banner'ın anında
        // güncellenmesi için renderAccountSummary() de çağrılmalı; önceden
        // yalnızca renderPositions() yeterliydi çünkü hesap özeti SL/TP'den
        // etkilenmiyordu.
        renderAccountSummary();
        return true;
    }

    function setupSltpModal() {
        const backdrop = byId('sltp-modal-backdrop');
        const closeBtn = byId('btn-close-sltp');
        const saveBtn = byId('btn-sltp-save');
        const clearBtn = byId('btn-sltp-clear');
        const symbolEl = byId('sltp-modal-symbol');
        const infoEl = byId('sltp-modal-info');
        const slInput = byId('sltp-modal-sl');
        const tpInput = byId('sltp-modal-tp');
        if (!backdrop) return;

        let editingSymbol = null;
        // (29 Temmuz 2026 — Madde 11) Hangi defterin (Spot/VİOP) pozisyonu
        // düzenlendiği ayrıca tutuluyor — aksi halde VİOP'ta açık bir
        // pozisyonun SL/TP'si yanlışlıkla Spot defterinde aranırdı.
        let editingMarket = 'NORMAL';

        const close = () => backdrop.classList.remove('open');

        window.__optipulseOpenSltp = (symbol, market) => {
            market = market === 'VIOP' ? 'VIOP' : 'NORMAL';
            const pos = book(market).positions[symbol];
            if (!pos) return;
            editingSymbol = symbol;
            editingMarket = market;
            const current = getPrice(symbol);
            if (symbolEl) symbolEl.textContent = symbol;
            if (infoEl) {
                infoEl.innerHTML = `Yön: <b>${pos.side}</b> · Adet: <b>${pos.qty}</b> · Ort. Fiyat: <b>₺${fmtPrice(pos.avgPrice)}</b> · Güncel: <b>₺${fmtPrice(current)}</b>`;
            }
            if (slInput) slInput.value = pos.sl ? pos.sl : '';
            if (tpInput) tpInput.value = pos.tp ? pos.tp : '';

            // Close other modals so only one is open at a time.
            closeOtherModals('sltp-modal-backdrop');

            backdrop.classList.add('open');
        };

        if (closeBtn) closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
        });

        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (!editingSymbol) return;
                const pos = book(editingMarket).positions[editingSymbol];
                if (!pos) { close(); return; }
                const current = getPrice(editingSymbol);
                const slVal = slInput && slInput.value ? Number(slInput.value) : null;
                const tpVal = tpInput && tpInput.value ? Number(tpInput.value) : null;

                if (slVal !== null && current) {
                    const invalid = pos.side === 'LONG' ? slVal >= current : slVal <= current;
                    if (invalid) { showToast(`Stop-Loss fiyatı ${pos.side === 'LONG' ? 'güncel fiyatın altında' : 'güncel fiyatın üzerinde'} olmalı.`); return; }
                }
                if (tpVal !== null && current) {
                    const invalid = pos.side === 'LONG' ? tpVal <= current : tpVal >= current;
                    if (invalid) { showToast(`Take-Profit fiyatı ${pos.side === 'LONG' ? 'güncel fiyatın üzerinde' : 'güncel fiyatın altında'} olmalı.`); return; }
                }

                setPositionSLTP(editingSymbol, slVal, tpVal, editingMarket);
                showToast(`${editingSymbol} için SL/TP güncellendi.`);
                close();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (!editingSymbol) return;
                setPositionSLTP(editingSymbol, null, null, editingMarket);
                if (slInput) slInput.value = '';
                if (tpInput) tpInput.value = '';
                showToast(`${editingSymbol} için SL/TP temizlendi.`);
                close();
            });
        }
    }

    /* ════════════════════════════════════════════════
       Rendering: positions / orders / account
       ════════════════════════════════════════════════ */

    // (29 Temmuz 2026 — Madde 11) Spot ve VİOP kartlarını aynı ortak
    // fonksiyonla, kendi ayrı DOM konteynerlerine render eder. `market`
    // parametresi yalnızca SL/TP ve Kapat butonlarının doğru deftere
    // yönlenmesi için satır içi onclick'lere gömülüyor.
    function renderPositionsInto(containerId, positions, market) {
        const body = byId(containerId);
        if (!body) return;
        const symbols = Object.keys(positions);
        if (symbols.length === 0) {
            body.innerHTML = `<div class="qt-empty-state">Açık pozisyon yok</div>`;
            return;
        }
        let html = '';
        symbols.forEach(symbol => {
            const pos = positions[symbol];
            const current = getPrice(symbol) || pos.avgPrice;
            const unrealized = pos.side === 'LONG'
                ? (current - pos.avgPrice) * pos.qty
                : (pos.avgPrice - current) * pos.qty;
            const pnlClass = unrealized >= 0 ? 'profit-text' : 'loss-text';
            const sideClass = pos.side === 'LONG' ? 'badge-long' : 'badge-short';
            const hasSltp = !!(pos.sl || pos.tp);
            const sltpParts = [];
            if (pos.sl) sltpParts.push('SL ₺' + fmtPrice(pos.sl));
            if (pos.tp) sltpParts.push('TP ₺' + fmtPrice(pos.tp));
            const sltpSub = hasSltp ? `<div class="pos-sltp-sub">${sltpParts.join(' · ')}</div>` : '';
            const leverage = pos.leverage || 1;
            const leverageBadge = leverage > 1 ? `<span class="pos-leverage-badge">${fmtLeverage(leverage)}x</span>` : '';
            // (10 Ağustos 2026 — asgari tutma süresi, hem Normal hem VİOP)
            // Buton, asgari süre dolmadan tıklansa da closePosition() zaten
            // engelliyor (bkz. yukarıda) — ama kullanıcı boşuna denemesin
            // diye burada da görsel olarak devre dışı bırakılıp kalan saniye
            // gösteriliyor. tickPrices() 2 saniyede bir renderPositions()
            // çağırdığı için bu geri sayım otomatik güncelleniyor, ayrı bir
            // zamanlayıcıya gerek yok.
            let closeBtnHtml;
            const heldMs = pos.openedAt ? (Date.now() - pos.openedAt) : null;
            if (heldMs !== null && heldMs < MIN_POSITION_HOLD_MS) {
                const remainingSec = Math.ceil((MIN_POSITION_HOLD_MS - heldMs) / 1000);
                closeBtnHtml = `<button class="btn-close-pos" disabled title="Asgari tutma süresi dolmadı">${remainingSec}sn</button>`;
            } else {
                closeBtnHtml = `<button class="btn-close-pos" onclick="window.__optipulseClosePosition('${symbol}', null, '${market}')">Kapat</button>`;
            }
            // (23 Temmuz 2026, on üçüncü oturum devamı) Kart düzeni: üst satırda
            // sembol+yön+kaldıraç solda, K/Z sağda (nowrap — artık "-" işareti
            // ayrı satıra düşmüyor); alt satırda adet/ort. fiyat solda, SL/TP ve
            // Kapat butonları sağda. Bkz. .pos-card kuralları (styles.css).
            html += `
                <div class="pos-card">
                    <div class="pos-card-top">
                        <div class="pos-card-id">
                            <span class="font-bold">${symbol}</span>
                            <span class="badge ${sideClass}">${pos.side}</span>${leverageBadge}
                        </div>
                        <div class="pos-card-pnl font-mono ${pnlClass}">${unrealized >= 0 ? '+' : ''}${fmtTRY(unrealized)}</div>
                    </div>
                    <div class="pos-card-bottom">
                        <div class="pos-card-meta font-mono">${pos.qty} adet<span class="pos-card-dot">·</span>Ort. ₺${fmtPrice(pos.avgPrice)}</div>
                        <div class="pos-actions-cell">
                            <button class="btn-sltp-edit ${hasSltp ? 'has-sltp' : ''}" onclick="window.__optipulseOpenSltp('${symbol}', '${market}')" title="Stop-Loss / Take-Profit">SL/TP</button>
                            ${closeBtnHtml}
                        </div>
                    </div>
                    ${sltpSub}
                </div>
            `;
        });
        body.innerHTML = html;
    }

    function renderPositions() {
        renderPositionsInto('qt-positions-body', portfolio.positions, 'NORMAL');
        renderPositionsInto('qt-positions-body-viop', portfolio.viopPositions, 'VIOP');
    }

    function renderOrdersInto(containerId, history) {
        const body = byId(containerId);
        if (!body) return;
        if (!history.length) {
            body.innerHTML = `<div class="qt-empty-state">Emir geçmişi yok</div>`;
            return;
        }
        let html = '';
        history.slice(0, 12).forEach(h => {
            const t = new Date(h.ts);
            const timeStr = t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const sideClass = h.side === 'BUY' ? 'badge-long' : 'badge-short';
            const pnlStr = h.pnl !== null ? `<span class="font-mono ${h.pnl >= 0 ? 'profit-text' : 'loss-text'}">${h.pnl >= 0 ? '+' : ''}${fmtTRY(h.pnl)}</span>` : '<span class="font-mono" style="color:var(--text-muted)">--</span>';
            html += `
                <div class="order-card">
                    <div class="order-card-top">
                        <span class="font-mono order-card-time">${timeStr}</span>
                        <span class="font-bold">${h.symbol}</span>
                        <span class="badge ${sideClass}">${h.side}</span>
                    </div>
                    <div class="order-card-bottom">
                        <span class="font-mono">${h.qty}@₺${fmtPrice(h.price)}</span>
                        ${pnlStr}
                    </div>
                </div>
            `;
        });
        body.innerHTML = html;
    }

    function renderOrders() {
        const csvBtn = byId('btn-export-history-csv');
        // (29 Temmuz 2026 — Madde 11) CSV butonu, Spot + VİOP'un ikisini de
        // dışa aktardığı için ikisinden herhangi biri boş değilse aktif.
        if (csvBtn) csvBtn.disabled = !(portfolio.history.length || (portfolio.viopHistory && portfolio.viopHistory.length));
        renderOrdersInto('qt-orders-body', portfolio.history);
        renderOrdersInto('qt-orders-body-viop', portfolio.viopHistory || []);
    }

    /* ════════════════════════════════════════════════
       Trade history CSV export
       ════════════════════════════════════════════════ */

    function csvEscape(val) {
        const s = String(val);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function exportTradeHistoryCSV() {
        // (29 Temmuz 2026 — Madde 11) Artık Spot VE VİOP'un TÜM işlem
        // geçmişini birlikte, hangi piyasada gerçekleştiğini belirten ayrı
        // bir "Piyasa" sütunuyla dışa aktarıyor — böylece indirilen kayıt
        // gerçekten TAM (eksiksiz) bir işlem geçmişi oluyor.
        const combined = portfolio.history.map(h => ({ ...h, market: 'NORMAL' }))
            .concat((portfolio.viopHistory || []).map(h => ({ ...h, market: 'VIOP' })));
        if (!combined.length) { showToast('Dışa aktarılacak işlem geçmişi yok.'); return; }

        const headers = ['Tarih', 'Saat', 'Piyasa', 'Sembol', 'Yön', 'Tip', 'Adet', 'Fiyat (₺)', 'Komisyon (₺)', 'K/Z (₺)'];
        const rows = combined.slice().sort((a, b) => a.ts - b.ts).map(h => { // chronological order, oldest first
            const d = new Date(h.ts);
            return [
                d.toLocaleDateString('tr-TR'),
                d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                h.market === 'VIOP' ? 'VİOP' : 'Spot',
                h.symbol,
                h.side === 'BUY' ? 'AL' : 'SAT',
                h.type === 'OPEN' ? 'AÇILIŞ' : 'KAPANIŞ',
                h.qty,
                h.price.toFixed(2),
                (h.commission || 0).toFixed(2),
                h.pnl !== null && h.pnl !== undefined ? h.pnl.toFixed(2) : ''
            ];
        });

        const csvBody = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
        const csvContent = '\uFEFF' + csvBody; // UTF-8 BOM so Excel renders Turkish characters correctly
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `optipulselab_islem_gecmisi_${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`İşlem geçmişi CSV olarak indirildi (${combined.length} kayıt).`);
    }

    /* ════════════════════════════════════════════════
       Trade history Excel (.xlsx) export — markalı, logo gömülü
       (18 Ağustos 2026, yeni oturum — "işlemleri indirince otomatik
       böyle bir csv dosyası insin" isteği üzerine: FinteLig/FinTeClub
       başlık banner'ı + OP Lab & FinTeClub logoları gömülü bir Excel
       dosyası. (Not: Önce iki elle çizilmiş OP Lab logo denemesi
       kullanıcıya sunuldu, ikisi de beğenilmedi/kaldırıldı — kullanıcı
       daha sonra kulübün gerçek e-posta imzasındaki resmi logoları
       (PDF) gönderdi, o resmi PNG'ler (şeffaf, gerçek OP Lab ve
       FinTeClub logoları) buraya gömülüyor.) Gerçek .csv format
       görsel/renk/logo TAŞIYAMADIĞI için
       (düz metindir) bu format .xlsx'e taşındı — veri sütunları
       (Tarih, Saat, Piyasa, Sembol, Yön, Tip, Adet, Fiyat, Komisyon,
       K/Z) eski CSV ile birebir aynı, sadece görsel bir üst başlık
       eklendi. ExcelJS kütüphanesi CDN'den YALNIZCA bu buton
       tıklandığında (lazy) yükleniyor — sayfa ilk açılışını
       yavaşlatmaması için. CDN erişilemezse (offline/engellenmiş)
       eski düz CSV'ye otomatik geri dönülüyor, kullanıcı asla elleri
       boş kalmıyor. ════════════════════════════════════════════════ */

    let _exceljsLoadPromise = null;
    function loadExcelJsLib() {
        if (window.ExcelJS) return Promise.resolve();
        if (_exceljsLoadPromise) return _exceljsLoadPromise;
        _exceljsLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('ExcelJS kütüphanesi yüklenemedi (CDN engelli/offline olabilir).'));
            document.head.appendChild(script);
        });
        return _exceljsLoadPromise;
    }

    function fetchImageAsDataUrl(url) {
        return fetch(url)
            .then(r => { if (!r.ok) throw new Error('Logo görseli yüklenemedi: ' + url); return r.blob(); })
            .then(blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result); // full "data:image/png;base64,...." string
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }));
    }

    async function exportTradeHistoryXLSX() {
        const combined = portfolio.history.map(h => ({ ...h, market: 'NORMAL' }))
            .concat((portfolio.viopHistory || []).map(h => ({ ...h, market: 'VIOP' })));
        if (!combined.length) { showToast('Dışa aktarılacak işlem geçmişi yok.'); return; }

        showToast('Excel hazırlanıyor...');

        try {
            await loadExcelJsLib();
            const [oplabDataUrl, ftcDataUrl] = await Promise.all([
                fetchImageAsDataUrl('oplab-logo.png'),
                fetchImageAsDataUrl('finteclub-logo.png')
            ]);

            const wb = new window.ExcelJS.Workbook();
            wb.creator = 'OptiPulseLab';
            const ws = wb.addWorksheet('İşlem Geçmişi');

            const headers = ['Tarih', 'Saat', 'Piyasa', 'Sembol', 'Yön', 'Tip', 'Adet', 'Fiyat (₺)', 'Komisyon (₺)', 'K/Z (₺)'];
            const dataColCount = headers.length; // 10 → sütun B..K
            const DARK_BG = 'FF0B1120';
            const GOLD_BG = 'FFFFB93C';

            ws.getColumn(1).width = 20; // A — logo sütunu
            for (let i = 0; i < dataColCount; i++) ws.getColumn(i + 2).width = 14; // B..K

            // Satır 1-3: "FİNTELİG" banner, B:K birleşik
            ws.mergeCells(1, 2, 3, 1 + dataColCount);
            const bannerCell = ws.getCell(1, 2);
            bannerCell.value = 'FİNTELİG';
            bannerCell.font = { name: 'Arial', size: 28, bold: true, color: { argb: 'FFFFFFFF' } };
            bannerCell.alignment = { vertical: 'middle', horizontal: 'center' };
            for (let r = 1; r <= 5; r++) {
                for (let c = 1; c <= 1 + dataColCount; c++) {
                    ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK_BG } };
                }
            }
            ws.getRow(1).height = 22;
            ws.getRow(2).height = 22;
            ws.getRow(3).height = 22;
            ws.getRow(4).height = 6;
            ws.getRow(5).height = 6;

            // Satır 6: sütun başlıkları
            const headerRowIdx = 6;
            headers.forEach((h, i) => {
                const cell = ws.getCell(headerRowIdx, i + 2);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FF1A1300' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_BG } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = { bottom: { style: 'thin', color: { argb: 'FF1A1300' } } };
            });
            ws.getRow(headerRowIdx).height = 20;
            ws.getCell(headerRowIdx, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK_BG } };

            // Veri satırları (kronolojik, en eski üstte — eski CSV ile aynı sıralama)
            const sorted = combined.slice().sort((a, b) => a.ts - b.ts);
            let rowIdx = headerRowIdx + 1;
            sorted.forEach(h => {
                const d = new Date(h.ts);
                const rowVals = [
                    d.toLocaleDateString('tr-TR'),
                    d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    h.market === 'VIOP' ? 'VİOP' : 'Spot',
                    h.symbol,
                    h.side === 'BUY' ? 'AL' : 'SAT',
                    h.type === 'OPEN' ? 'AÇILIŞ' : 'KAPANIŞ',
                    h.qty,
                    Number(h.price.toFixed(2)),
                    Number((h.commission || 0).toFixed(2)),
                    h.pnl !== null && h.pnl !== undefined ? Number(h.pnl.toFixed(2)) : ''
                ];
                rowVals.forEach((v, i) => {
                    const cell = ws.getCell(rowIdx, i + 2);
                    cell.value = v;
                    if (i === 7 || i === 8 || i === 9) cell.numFmt = '0.00'; // Fiyat, Komisyon, K/Z — hep 2 ondalık
                    cell.alignment = { horizontal: (i >= 6 ? 'right' : 'center') };
                });
                rowIdx++;
            });

            // Logo sütununun tamamını (banner + veri boyunca) koyu zeminle doldur
            for (let r = 1; r < rowIdx; r++) {
                ws.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK_BG } };
            }

            // İki resmi logoyu göm: üstte OP Lab, altında FinTeClub
            const oplabImgId = wb.addImage({ base64: oplabDataUrl, extension: 'png' });
            const ftcImgId = wb.addImage({ base64: ftcDataUrl, extension: 'png' });
            ws.addImage(oplabImgId, { tl: { col: 0.05, row: 0.15 }, ext: { width: 140, height: 140 } });
            ws.addImage(ftcImgId, { tl: { col: 0.05, row: 7.35 }, ext: { width: 140, height: 140 } });

            const buf = await wb.xlsx.writeBuffer();
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `optipulselab_islem_gecmisi_${stamp}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`İşlem geçmişi Excel olarak indirildi (${combined.length} kayıt).`);
        } catch (err) {
            console.error('[XLSX export] Excel oluşturulamadı, düz CSV\'ye geri dönülüyor:', err);
            showToast('Excel oluşturulamadı, CSV olarak indiriliyor...');
            exportTradeHistoryCSV();
        }
    }

    function setupCsvExport() {
        const btn = byId('btn-export-history-csv');
        if (btn) btn.addEventListener('click', exportTradeHistoryXLSX);
    }

    /* ════════════════════════════════════════════════
       Dark / Light theme
       ════════════════════════════════════════════════ */

    const THEME_STORAGE_KEY = 'optipulselab_theme';

    function getCurrentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    // (12 Ağustos 2026 — "Kurumsal Mavi'deyken beyaz temaya geçemiyorum"
    // düzeltmesi) getCurrentTheme() o an EKRANDA görünen temayı okuyor (ki bu
    // admin zorunluluğuyla 'fintech' olabilir) — kullanıcının kendi KAYITLI
    // tercihini (admin zorunluluğundan bağımsız, localStorage'daki gerçek
    // seçimi) okumak için ayrı bir yardımcı gerekiyor, aksi halde admin
    // Kurumsal Mavi'yi kapattığında kullanıcı yanlışlıkla koyu temaya
    // düşebilir (kendi tercihi açık/beyaz olsa bile).
    function getStoredThemePreference() {
        try {
            return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
        } catch (e) {
            return 'dark';
        }
    }

    function applyTheme(theme) {
        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* private mode / quota — theme just won't persist */ }

        const moonIcon = byId('theme-icon-moon');
        const sunIcon = byId('theme-icon-sun');
        if (moonIcon) moonIcon.style.display = theme === 'light' ? 'none' : 'block';
        if (sunIcon) sunIcon.style.display = theme === 'light' ? 'block' : 'none';

        if (window.TradingChart && window.TradingChart.setTheme) window.TradingChart.setTheme(theme);
    }

    // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü;
    // 12 Ağustos 2026'da kullanıcı isteğiyle GÜNCELLENDİ) Başlangıçta admin
    // Kurumsal Mavi'yi zorunlu kıldığında kullanıcının kendi tema butonu
    // TAMAMEN devre dışı bırakılıyordu (bkz. eski yorum, aşağıda korunuyor).
    // Kullanıcı bunun "sağ üstte beyaz moda geçme kısmı çalışmıyor" bir hata
    // olduğunu bildirip, Kurumsal Mavi'de VEYA orijinal koyu (sarı-siyah)
    // temada da her zaman beyaz temaya geçilebilmesini istedi. Artık buton
    // ASLA devre dışı bırakılmıyor — admin'in Kurumsal Mavi zorunluluğu
    // sadece kullanıcının "koyu" tercihinin GÖRÜNÜMÜNÜ belirliyor (koyu
    // tercih ediyorsa Kurumsal Mavi mi yoksa orijinal koyu mu göreceği),
    // kullanıcının "açık/beyaz" tercihini hiçbir zaman engellemiyor.
    let adminForcedFintechTheme = false;

    function toggleTheme() {
        // (12 Ağustos 2026 güncellemesi) data-theme'in O AN GERÇEKTEN ne
        // olduğuna bakıyoruz (getCurrentTheme() gibi sadece 'light'/'dark'
        // ikiliğine indirgemek yerine) — çünkü 'fintech' de geçerli bir
        // "koyu" durum ve beyazdan çıkarken doğru koyu varyanta (admin hâlâ
        // zorunlu kılıyorsa Kurumsal Mavi'ye, değilse orijinal koyuya) geri
        // dönmemiz gerekiyor.
        const current = document.documentElement.getAttribute('data-theme');
        if (current === 'light') {
            if (adminForcedFintechTheme) {
                document.documentElement.setAttribute('data-theme', 'fintech');
                try { localStorage.setItem(THEME_STORAGE_KEY, 'dark'); } catch (e) { /* private mode / quota */ }
                const moonIcon = byId('theme-icon-moon');
                const sunIcon = byId('theme-icon-sun');
                if (moonIcon) moonIcon.style.display = 'block';
                if (sunIcon) sunIcon.style.display = 'none';
                if (window.TradingChart && window.TradingChart.setTheme) window.TradingChart.setTheme('fintech');
            } else {
                applyTheme('dark');
            }
        } else {
            applyTheme('light');
        }
    }

    function setupThemeToggle() {
        const btn = byId('btn-theme-toggle');
        // Sync icons/chart to whatever the early <head> script already applied
        // (it runs before any other JS to avoid a dark/light flash on load).
        applyTheme(getCurrentTheme());
        if (btn) btn.addEventListener('click', toggleTheme);
    }

    // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü;
    // 12 Ağustos 2026'da kullanıcı isteğiyle GÜNCELLENDİ — bkz. toggleTheme
    // üzerindeki not) finteclubBridge.js'in shared_state dinleyicisinden
    // çağrılır. Artık buton HİÇBİR ZAMAN devre dışı bırakılmıyor. active
    // true olduğunda: kullanıcının KAYITLI tercihi 'light' değilse Kurumsal
    // Mavi'yi uygular (kullanıcının koyu tercihinin görünümünü belirler);
    // kullanıcı zaten beyazı seçmişse ona DOKUNMAZ — admin zorunluluğu asla
    // kullanıcının açık/beyaz tercihini ezmemeli. active false olduğunda
    // (admin kapattığında ya da Firebase'e hiç ulaşılamadığında), o an
    // GERÇEKTEN Kurumsal Mavi görünüyorsa (yani kullanıcı kendi beyaz
    // temasında değilse) kullanıcının kayıtlı Koyu/Açık tercihine döner;
    // kullanıcı beyazdaysa ona dokunmaz.
    function setAdminForcedTheme(active) {
        adminForcedFintechTheme = !!active;
        const btn = byId('btn-theme-toggle');
        if (btn) {
            btn.disabled = false;
            btn.title = 'Koyu / Açık Tema (T)';
        }
        const current = document.documentElement.getAttribute('data-theme');
        if (adminForcedFintechTheme) {
            if (getStoredThemePreference() !== 'light') {
                document.documentElement.setAttribute('data-theme', 'fintech');
                if (window.TradingChart && window.TradingChart.setTheme) window.TradingChart.setTheme('fintech');
                const moonIcon = byId('theme-icon-moon');
                const sunIcon = byId('theme-icon-sun');
                if (moonIcon) moonIcon.style.display = 'block';
                if (sunIcon) sunIcon.style.display = 'none';
            }
        } else if (current === 'fintech') {
            // Zorunlu tema kaldırıldığında, ve kullanıcı o an gerçekten
            // Kurumsal Mavi'deyse (kendi beyaz seçiminde değilse) kayıtlı
            // Koyu/Açık tercihine geri dön — applyTheme zaten ikon/grafik
            // senkronunu da hallediyor.
            applyTheme(getStoredThemePreference());
        }
    }

    /* ════════════════════════════════════════════════
       Kompakt Görünüm (18 Temmuz 2026, dördüncü tur, Madde 5e)
       Watchlist satırlarını ve durum çubuğunu sıkılaştıran, tercihi
       localStorage'da tutan basit bir görünüm anahtarı. Tema anahtarıyla
       birebir aynı desen (bkz. setupThemeToggle) — sadece <body>'ye bir
       class ekleyip CSS'in geri kalanını halletmesine izin veriyor.
       ════════════════════════════════════════════════ */
    const COMPACT_MODE_STORAGE_KEY = 'optipulselab_compact_mode';

    function applyCompactMode(enabled) {
        document.body.classList.toggle('compact-mode', enabled);
        try { localStorage.setItem(COMPACT_MODE_STORAGE_KEY, enabled ? '1' : '0'); } catch (e) { /* private mode / quota */ }
        const btn = byId('btn-toggle-compact');
        const label = byId('btn-toggle-compact-label');
        if (btn) btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        if (label) label.textContent = enabled ? 'Normal Görünüm' : 'Kompakt Görünüm';
    }

    function setupCompactMode() {
        const btn = byId('btn-toggle-compact');
        if (!btn) return;
        let stored = false;
        try { stored = localStorage.getItem(COMPACT_MODE_STORAGE_KEY) === '1'; } catch (e) { /* private mode */ }
        applyCompactMode(stored);
        btn.addEventListener('click', () => applyCompactMode(!document.body.classList.contains('compact-mode')));
    }

    /* ════════════════════════════════════════════════
       Sesli bildirimler (Alarm / SL-TP / Marj Çağrısı)
       ════════════════════════════════════════════════ */
    // (18 Temmuz 2026, dokuzuncu oturum) Fiyat alarmı, Stop-Loss/Take-
    // Profit/Trailing Stop tetiklenmesi ve marj çağrısı (liquidation) daha
    // önce sadece görsel bir toast bırakıyordu — kullanıcı o an ekrana
    // bakmıyorsa fark etmiyordu. Harici bir ses dosyasına bağımlı olmamak
    // için Web Audio API ile anlık, kısa bir "bip" üretiliyor (osilatör
    // tabanlı, hiçbir asset indirmeye gerek yok, offline da çalışır).
    // Tarayıcıların otomatik-sesi engelleme politikası bir kullanıcı
    // etkileşimi (tıklama vb.) gerektirir — bu olaylar zaten kullanıcının
    // sayfada aktif olduğu bir sırada (bir emir açmışken, bir modal
    // açıkken vb.) gerçekleştiği için pratikte sorun çıkarmıyor; yine de
    // AudioContext oluşturma/çalma her ihtimale karşı try/catch içinde.
    const SOUND_STORAGE_KEY = 'optipulselab_sound_enabled_v1';
    let soundEnabled = true;
    let sharedAudioCtx = null;

    function loadSoundPreference() {
        try {
            const raw = localStorage.getItem(SOUND_STORAGE_KEY);
            if (raw !== null) soundEnabled = raw !== 'false';
        } catch (e) { /* private mode */ }
    }

    function saveSoundPreference() {
        try { localStorage.setItem(SOUND_STORAGE_KEY, String(soundEnabled)); } catch (e) { /* private mode / quota */ }
    }

    // freq/duration'ı olay tipine göre hafifçe farklılaştırıyoruz — alarm
    // tek kısa bip, SL/TP iki kısa bip, marj çağrısı (en ciddi olay) üç bip
    // ve daha pes bir ton — kullanıcı sesi duyduğunda gözünü ekrana atmadan
    // bile kabaca "ne tür" bir olay olduğunu ayırt edebilsin diye.
    function playChime(pattern) {
        if (!soundEnabled) return;
        if (typeof window.AudioContext === 'undefined' && typeof window.webkitAudioContext === 'undefined') return;
        try {
            if (!sharedAudioCtx) {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                sharedAudioCtx = new Ctx();
            }
            if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
            const ctx = sharedAudioCtx;
            let t = ctx.currentTime;
            pattern.forEach(({ freq, dur }) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(t);
                osc.stop(t + dur + 0.02);
                t += dur + 0.06;
            });
        } catch (e) { /* ses çalınamadı — sessizce yut, işlevselliği bozma */ }
    }

    function playAlertChime() { playChime([{ freq: 880, dur: 0.14 }]); }
    function playSltpChime() { playChime([{ freq: 740, dur: 0.11 }, { freq: 740, dur: 0.11 }]); }
    function playLiquidationChime() { playChime([{ freq: 440, dur: 0.13 }, { freq: 440, dur: 0.13 }, { freq: 330, dur: 0.22 }]); }

    function updateMuteButtonIcon() {
        const onIcon = byId('mute-icon-on');
        const offIcon = byId('mute-icon-off');
        if (onIcon) onIcon.style.display = soundEnabled ? 'block' : 'none';
        if (offIcon) offIcon.style.display = soundEnabled ? 'none' : 'block';
        const btn = byId('btn-mute-toggle');
        if (btn) btn.title = soundEnabled ? 'Sesli Bildirimleri Kapat' : 'Sesli Bildirimleri Aç';
    }

    function setupMuteToggle() {
        loadSoundPreference();
        updateMuteButtonIcon();
        const btn = byId('btn-mute-toggle');
        if (btn) {
            btn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                saveSoundPreference();
                updateMuteButtonIcon();
                if (soundEnabled) playAlertChime(); // açılınca kısa bir onay bipi
            });
        }
    }

    // Kaldıraç/marj modeliyle (bkz. placeOrder) uyumlu özkaynak formülü:
    // `portfolio.balance` artık pozisyon açılırken kilitlenen marjı
    // İÇERMİYOR (o tutar bakiyeden düşülüp pozisyona kilitleniyor), bu
    // yüzden özkaynak = serbest bakiye + tüm açık pozisyonların kilitli
    // marjı + tüm açık pozisyonların gerçekleşmemiş K/Z'si. Bu formül
    // leverage=1'de eski "balance + longValue - shortValue" formülüyle
    // matematiksel olarak birebir aynı sonucu verir (bkz. placeOrder'daki
    // yorum) — sadece kaldıraç>1 için doğru şekilde genelleşiyor.
    // (22 Temmuz 2026, on ikinci oturum — madde 7 "profil paneli") Hesap
    // özetinin (bakiye/özkaynak/açık K-Z/kullanılan marj) hesaplama mantığı
    // burada TEK YERDE toplandı — hem renderAccountSummary() (header/ticket
    // panelleri) hem de dışa açık getAccountSnapshot() (profil paneli) aynı
    // hesabı kullanıyor, iki ayrı kopya birbirinden sapmasın diye.
    // (26 Temmuz 2026, on üçüncü oturum devamı — "risk yönetimi: portföy
    // genel risk uyarısı") totalRisk/positionsWithoutStopCount buraya
    // eklendi. Bir pozisyonun Stop-Loss'u (pos.sl) varsa gerçek maksimum
    // kaybı TAM olarak biliniyor: |avgPrice − sl| × qty. Yoksa (Stop-Loss
    // ayarlanmamışsa) teorik kayıp sınırsızdır — muhafazakâr/pratik bir
    // yaklaşımla o pozisyon için yatırılan teminat (margin) kadarının
    // riskte olduğu varsayılıyor, ayrıca kaç pozisyonun korumasız olduğu
    // ayrıca sayılıyor ki uyarı metni bunu açıkça belirtebilsin.
    // (29 Temmuz 2026 — Madde 11) Hesap özeti (özkaynak, kullanılan marj,
    // açık K/Z, portföy risk uyarısı) artık Spot VE VİOP'un ikisini birden
    // kapsıyor — ikisi de aynı demo bakiyeyi paylaşan GERÇEK açık
    // pozisyonlar. Önceden yalnızca portfolio.positions (Spot) taranıyordu;
    // bir VİOP pozisyonu açıkken header'daki Toplam Varlık/Kullanılan Marj
    // ve portföy risk uyarısı o pozisyonu hiç görmüyordu.
    function computeAccountSnapshot() {
        let usedMargin = 0, openPnl = 0, totalRisk = 0, positionsWithoutStopCount = 0, positionsCount = 0;
        ['NORMAL', 'VIOP'].forEach(market => {
            const positions = book(market).positions;
            Object.keys(positions).forEach(symbol => {
                const pos = positions[symbol];
                const current = getPrice(symbol) || pos.avgPrice;
                const leverage = pos.leverage || 1;
                // (10 Ağustos 2026) Özkaynak/kullanılan marj artık GERÇEK
                // kilitli marja (pos.lockedMargin, varsa) göre — bkz.
                // placeOrder'daki tam açıklama.
                const margin = (typeof pos.lockedMargin === 'number') ? pos.lockedMargin : (pos.avgPrice * pos.qty) / leverage;
                usedMargin += margin;
                if (pos.side === 'LONG') {
                    openPnl += (current - pos.avgPrice) * pos.qty;
                } else {
                    openPnl += (pos.avgPrice - current) * pos.qty;
                }
                if (pos.sl) {
                    totalRisk += Math.abs(pos.avgPrice - pos.sl) * pos.qty;
                } else {
                    totalRisk += margin;
                    positionsWithoutStopCount++;
                }
                positionsCount++;
            });
        });
        const equity = effectiveBalance() + usedMargin + openPnl;
        return {
            balance: effectiveBalance(),
            equity,
            openPnl,
            usedMargin,
            positionsCount,
            totalRisk,
            positionsWithoutStopCount
        };
    }

    function getAccountSnapshot() {
        return computeAccountSnapshot();
    }

    // (26 Temmuz 2026, on üçüncü oturum devamı) Toplam tanımlı risk
    // özkaynağın bu yüzdesini aşınca uyarı banner'ı görünür. %10, birçok
    // trading eğitiminde kullanılan "portföy genelinde tek seferde riske
    // atılabilecek makul üst sınır" kabul edilen bir eşik (ör. işlem
    // başına %2 × en fazla ~5 eşzamanlı pozisyon) — sabit ama makul bir
    // varsayılan; ileride ayarlanabilir hale getirilebilir.
    const PORTFOLIO_RISK_WARNING_THRESHOLD_PCT = 10;

    function renderPortfolioRiskWarning(equity, totalRisk, positionsWithoutStopCount, positionsCount) {
        const el = byId('qt-portfolio-risk-warning');
        if (!el) return;
        if (!positionsCount || equity <= 0 || totalRisk <= 0) {
            el.style.display = 'none';
            return;
        }
        const riskPct = (totalRisk / equity) * 100;
        if (riskPct < PORTFOLIO_RISK_WARNING_THRESHOLD_PCT) {
            el.style.display = 'none';
            return;
        }
        const stopNote = positionsWithoutStopCount > 0
            ? ` (${positionsWithoutStopCount} pozisyonda Stop-Loss yok — bunlar için yatırılan teminat riskte kabul edildi)`
            : '';
        el.textContent = `Toplam açık risk özkaynağın %${riskPct.toFixed(1)}'i (${fmtTRY(totalRisk)}) — önerilen sınır %${PORTFOLIO_RISK_WARNING_THRESHOLD_PCT}.${stopNote}`;
        el.style.display = 'block';
    }

    function renderAccountSummary() {
        const { usedMargin, openPnl, equity, totalRisk, positionsWithoutStopCount, positionsCount } = computeAccountSnapshot();
        renderPortfolioRiskWarning(equity, totalRisk, positionsWithoutStopCount, positionsCount);

        // Balance now lives in the header pill (top right) rather than the trade ticket itself
        const headerBalEl = byId('header-balance-value');
        const headerEqEl = byId('header-equity-value');
        const eqEl = byId('qt-equity');
        const pnlEl = byId('qt-openpnl');
        const usedMarginEl = byId('qt-used-margin');
        const marginLevelEl = byId('qt-margin-level');
        if (headerBalEl) headerBalEl.textContent = fmtTRY(effectiveBalance());
        // (5 Ağustos 2026) Giriş yapılmadan bakiye 0 görünüyor — sebepsiz
        // "neden 0" kafa karışıklığını önlemek için pill'e açıklayıcı bir
        // tooltip ekleniyor, sadece kapı aktifken ve giriş yapılmamışken.
        // (10 Ağustos 2026 — "cihaz değiştirince bakiyem sıfırlanıyor, her
        // şey gitti" kök neden düzeltmesi) Bu tooltip SADECE fare ile üzerine
        // gelince (hover) görünüyordu — dokunmatik cihazlarda (telefon/
        // tablet) hover diye bir şey YOK, yani asıl bu senaryoda (biri
        // telefondan tablete/bilgisayara GEÇTİĞİNDE, yeni cihazda henüz
        // giriş yapmadığı için bakiye gerçekten 0 GÖRÜNÜYOR — veri
        // KAYBOLMUYOR, sadece görünmüyor) kullanıcı bu açıklamayı HİÇBİR
        // ZAMAN göremiyordu, "her şeyim gitti" sanıyordu. Artık aynı bilgi
        // pill'in üzerine GÖRÜNÜR bir etiket olarak da yazılıyor (hem
        // dokunmatik hem masaüstünde görünür), tooltip da yedek olarak
        // duruyor.
        const balancePillEl = byId('header-balance-pill');
        const balanceLabelEl = byId('header-balance-label');
        const needsLogin = isFtcGateActive() && !isFtcLoggedIn();
        if (balancePillEl) {
            balancePillEl.title = needsLogin
                ? 'Bakiyen kaybolmadı — bu cihazda henüz FinteLig girişi yapmadın. Giriş yapınca gerçek demo bakiyen (diğer cihazlarınla senkronize) geri gelir.'
                : '';
            balancePillEl.classList.toggle('pill-login-needed', needsLogin);
        }
        if (balanceLabelEl) balanceLabelEl.textContent = needsLogin ? 'Giriş yap' : 'Bakiye';
        // (29 Temmuz 2026 — Madde 8) Header'daki Toplam Varlık, bu fonksiyon
        // her çağrıldığında (işlem sonrası, fiyat tick'inde, SL/TP
        // değişiminde vb. — bkz. yukarıdaki çağrı noktaları) otomatik
        // güncelleniyor; hoca sorusuna somut cevap: portföy GERÇEKTEN
        // otomatik güncelleniyor, bu rozet bunu görünür kılıyor.
        if (headerEqEl) headerEqEl.textContent = fmtTRY(equity);
        if (eqEl) eqEl.textContent = fmtTRY(equity);
        if (pnlEl) {
            pnlEl.textContent = (openPnl >= 0 ? '+' : '') + fmtTRY(openPnl);
            pnlEl.className = 'acct-value ' + (openPnl >= 0 ? 'profit-text' : 'loss-text');
        }
        if (usedMarginEl) usedMarginEl.textContent = usedMargin > 0 ? fmtTRY(usedMargin) : '--';
        if (marginLevelEl) {
            // Marj seviyesi = özkaynak / kullanılan marj — %100'ün altına
            // düşmesi risklidir, gerçek borsalarda burada marj çağrısı
            // gelir (bkz. checkMarginCalls, %20 seviyesinde likidasyon).
            if (usedMargin > 0) {
                const marginLevelPct = (equity / usedMargin) * 100;
                marginLevelEl.textContent = marginLevelPct.toFixed(0) + '%';
                marginLevelEl.className = 'acct-value ' + (marginLevelPct < 150 ? 'loss-text' : marginLevelPct < 300 ? '' : 'profit-text');
            } else {
                marginLevelEl.textContent = '--';
                marginLevelEl.className = 'acct-value';
            }
        }
    }

    /* ────────── Profil paneli (madde 7, 22 Temmuz 2026, on ikinci oturum) ──────────
       Header'ın en sağındaki profil simgesine tıklanınca açılan panel:
       bakiye/özkaynak/açık K-Z/pozisyon sayısı (computeAccountSnapshot ile TEK
       kaynaktan) ve kalıcı bir profil ismi ayarı. Açılma/kapanma deseni
       tradingChart.js'teki setupHeaderMenu()/setupChartTypeMenu() ile birebir
       aynı (position:fixed + getBoundingClientRect, dışarı tıklama/Escape ile
       kapanma). (22 Temmuz 2026, ikinci tur) Simge başlangıçta soldaydı (SOLA
       hizalı açılıyordu); kullanıcı isteğiyle header-actions'ın sonuna, en
       sağa taşındı — açılma artık header-menu-dropdown ile aynı şekilde SAĞA
       hizalı (aksi halde 240px'lik panel viewport dışına taşardı). */
    const PROFILE_NAME_STORAGE_KEY = 'optipulselab_profile_name_v1';
    const DEFAULT_PROFILE_NAME = 'Kullanıcı';

    function loadProfileName() {
        try {
            const raw = localStorage.getItem(PROFILE_NAME_STORAGE_KEY);
            if (raw && raw.trim()) return raw.trim();
        } catch (e) { /* private mode */ }
        return DEFAULT_PROFILE_NAME;
    }

    function saveProfileName(name) {
        try { localStorage.setItem(PROFILE_NAME_STORAGE_KEY, name); } catch (e) { /* ignore */ }
    }

    function applyProfileName(name) {
        const display = (name && name.trim()) ? name.trim() : DEFAULT_PROFILE_NAME;
        const nameEl = byId('profile-name-display');
        const avatarEl = byId('profile-avatar');
        if (nameEl) nameEl.textContent = display;
        if (avatarEl) avatarEl.textContent = display.charAt(0);
    }

    function renderProfilePanel() {
        const snap = computeAccountSnapshot();
        const balEl = byId('profile-balance-value');
        const eqEl = byId('profile-equity-value');
        const pnlEl = byId('profile-pnl-value');
        const posEl = byId('profile-positions-count');
        if (balEl) balEl.textContent = fmtTRY(snap.balance);
        if (eqEl) eqEl.textContent = fmtTRY(snap.equity);
        if (pnlEl) {
            pnlEl.textContent = (snap.openPnl >= 0 ? '+' : '') + fmtTRY(snap.openPnl);
            pnlEl.className = 'profile-stat-value ' + (snap.openPnl >= 0 ? 'profit-text' : 'loss-text');
        }
        if (posEl) posEl.textContent = String(snap.positionsCount);
    }

    function setupProfilePanel() {
        const btn = byId('btn-profile');
        const dropdown = byId('profile-panel-dropdown');
        const nameInput = byId('profile-name-input');
        if (!btn || !dropdown) return;

        const savedName = loadProfileName();
        applyProfileName(savedName);
        if (nameInput) nameInput.value = savedName === DEFAULT_PROFILE_NAME ? '' : savedName;

        const close = () => dropdown.classList.remove('open');
        const open = () => {
            if (window.__optipulseCloseOtherModals) window.__optipulseCloseOtherModals();
            if (window.__optipulseCloseAllFlyouts) window.__optipulseCloseAllFlyouts();
            closeOtherSimpleDropdowns('profile-panel-dropdown');
            const rect = btn.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 6) + 'px';
            // Sağa hizalı açılır — artık header'ın en sağındaki butondan
            // tetiklendiği için (bkz. tradingChart.js setupHeaderMenu() ile
            // aynı desen), sola taşarsa viewport dışına çıkar.
            dropdown.style.right = (window.innerWidth - rect.right) + 'px';
            dropdown.style.left = 'auto';
            dropdown.classList.add('open');
            renderProfilePanel();
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown.classList.contains('open')) close(); else open();
        });
        document.addEventListener('click', (e) => {
            if (dropdown.classList.contains('open') && !dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && dropdown.classList.contains('open')) close();
        });

        if (nameInput) {
            nameInput.addEventListener('input', () => {
                const name = nameInput.value;
                saveProfileName(name.trim() ? name : DEFAULT_PROFILE_NAME);
                applyProfileName(name);
            });
        }
    }

    /* ────────── Toast notice (reuses footer status if present) ────────── */
    let toastTimer = null;
    function showToast(msg) {
        const el = byId('footer-status-text');
        if (!el) return;
        el.innerText = `System status: ${msg}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.innerText = 'System status: Ready'; }, 3500);
    }

    // (23 Temmuz 2026 düzeltmesi) Kullanıcı geri bildirimi: "bakiyemle
    // alamıyorum ama uyarı görmüyorum" / "kaldıraçla eklemek istediğimde
    // olmuyor, neden anlamıyorum" — her iki şikayetin de kök nedeni AYNI:
    // bu tür kritik emir-reddi mesajları SADECE showToast()'un yazdığı,
    // sayfanın en altındaki küçük gri durum satırına gidiyordu — kullanıcının
    // dikkati o an tam olarak AL/SAT biletindeyken bu uzak/küçük yazı hiç
    // fark edilmiyordu. showTicketAlert(), AYNI mesajı biletin İÇİNDE,
    // gönder butonunun hemen üstünde, renkli/belirgin bir kutuda ayrıca
    // gösteriyor — showToast()'un yerini almıyor, ona ek bir ikinci kanal.
    let ticketAlertTimer = null;
    function showTicketAlert(msg, kind) {
        const el = byId('qt-ticket-alert');
        if (!el) return;
        el.textContent = msg;
        el.className = 'qt-ticket-alert ' + (kind === 'error' ? 'qt-alert-error' : 'qt-alert-info');
        el.style.display = '';
        clearTimeout(ticketAlertTimer);
        ticketAlertTimer = setTimeout(() => { el.style.display = 'none'; }, kind === 'error' ? 5500 : 4000);
    }

    /* (2 Ağustos 2026 — revize planı madde 10) "Hızlı hisse seçimi bulunmuyor" —
       Hızlı Alım Satım panelindeki sembol başlığının yanına, sol taraftaki
       İzleme Listesi aramasıyla AYNI BIST100 verisi üzerinde çalışan küçük bir
       açılır arama penceresi eklendi. Bir sonuca tıklamak doğrudan
       selectSymbol() çağırıp grafiği/bileti o sembole geçiriyor — izleme
       listesine gitmeye gerek kalmıyor. */
    function setupQuickTicketSymbolSearch() {
        const btn = byId('btn-qt-symbol-search');
        const popover = byId('qt-symbol-search-popover');
        const input = byId('qt-symbol-search-input');
        const results = byId('qt-symbol-search-results');
        if (!btn || !popover || !input || !results) return;

        const renderResults = () => {
            const term = input.value.trim().toLowerCase();
            const source = DC.BIST100 || [];
            const list = (term
                ? source.filter(({ symbol, name }) => symbol.toLowerCase().includes(term) || name.toLowerCase().includes(term))
                : source
            ).slice(0, 30);
            if (!list.length) {
                results.innerHTML = '<div class="qt-symbol-search-empty">Eşleşen sembol bulunamadı.</div>';
                return;
            }
            results.innerHTML = list.map(({ symbol, name }) => (
                '<div class="qt-symbol-search-row" data-symbol="' + symbol + '">' +
                    '<span><span class="wl-symbol">' + symbol + '</span><span class="wl-name">' + name + '</span></span>' +
                '</div>'
            )).join('');
        };

        const open = () => {
            popover.style.display = '';
            input.value = '';
            renderResults();
            setTimeout(() => input.focus(), 20);
        };
        const close = () => { popover.style.display = 'none'; };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (popover.style.display === 'none') open(); else close();
        });
        input.addEventListener('input', renderResults);
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
        results.addEventListener('click', (e) => {
            const row = e.target.closest('.qt-symbol-search-row');
            if (!row) return;
            close();
            selectSymbol(row.dataset.symbol);
        });
        document.addEventListener('click', (e) => {
            if (popover.style.display !== 'none' && !popover.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close();
        });
    }

    /* ────────── Exchange selector (BIST active, others "coming soon") ────────── */
    function setupExchangeSelector() {
        document.querySelectorAll('.exchange-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.exchange !== 'BIST') {
                    showToast(`${btn.dataset.exchange} borsası yakında eklenecek.`);
                    return;
                }
                document.querySelectorAll('.exchange-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    /* ════════════════════════════════════════════════
       Init
       ════════════════════════════════════════════════ */

    function init() {
        DC = window.DataController;
        if (!DC) {
            console.error('[TradingEngine] DataController not found.');
            return;
        }
        priceProfiles = buildPriceProfiles();
        portfolio = loadPortfolio();
        priceAlerts = loadAlerts();
        indicatorAlerts = loadIndicatorAlerts();
        watchlistSymbols = loadWatchlistSymbols();

        renderWatchlistRows();
        renderWatchlistPrices();
        setupWatchlistSearch();
        setupTicket();
        setupQuickTicketSymbolSearch();
        setupExchangeSelector();
        setupPanelSubtabs();
        setupAlertsModal();
        setupSltpModal();
        setupOrderConfirmModal();
        setupHeatmapModal();
        setupShortcutsModal();
        setupHelpModal();
        setupCommandPalette();
        setupGlobalShortcuts();
        setupCsvExport();
        setupThemeToggle();
        setupCompactMode();
        setupMuteToggle();
        setupProfilePanel();
        renderPositions();
        renderOrders();
        renderAccountSummary();
        renderPendingOcoOrders();
        updateAlertBadge();
        sampleEquity();

        // (5 Ağustos 2026 — FinTeClub giriş kapısı) finteclubBridge.js'in
        // giriş durumu ASENKRON belli oluyor (Firebase); giriş/çıkış
        // gerçekleştiğinde ya da sayfa yüklenirken oturum bilgisi az sonra
        // gelince bakiye/özkaynak gösterimi hemen buna göre güncellensin.
        window.addEventListener('ftc-auth-changed', () => {
            renderAccountSummary();
            updateRiskPreview();
        });

        // Sayfa yüklendiğinde ilk 2 saniyelik tickPrices() beklemeden emir
        // butonunun doğru (etkin/pasif) durumda başlaması için tek seferlik
        // erken çağrı — bkz. updateTradeAvailabilityUI() yorumu.
        updateTradeAvailabilityUI();
        setInterval(tickPrices, TICK_MS);
        setInterval(syncWatchlistPrices, WATCHLIST_SYNC_INTERVAL_MS);
        // İlk senkronizasyonu birkaç saniye geciktir ki ilk sembol seçimi ve
        // canlı akış (WS) bağlantısı önce kurulsun, ağ istekleri çakışmasın.
        setTimeout(syncWatchlistPrices, 8000);

        // (29 Temmuz 2026 — Madde 3) Kayan piyasa şeridi — bağımsız, döviz/
        // emtia/BIST100 endeksi verisi watchlist senkronizasyonundan ayrı
        // bir uç noktadan geliyor, o yüzden ayrı zamanlayıcı.
        setInterval(syncMarketTickerStrip, MARKET_TICKER_SYNC_INTERVAL_MS);
        setTimeout(syncMarketTickerStrip, 3000);

        // Resume on whatever symbol was last being viewed, so a reload/revisit
        // doesn't silently jump back to a default symbol while old ticket
        // values (or just user expectations) still refer to a different one.
        let lastSymbol = null;
        try { lastSymbol = localStorage.getItem(LAST_SYMBOL_STORAGE_KEY); } catch (e) { /* private mode */ }
        const restored = lastSymbol && DC.BIST100.find(s => s.symbol === lastSymbol);
        const first = restored || DC.BIST100.find(s => s.symbol === 'THYAO') || DC.BIST100[0];
        if (first) selectSymbol(first.symbol);

        // (27 Ağustos 2026 — yarışma günü hız hazırlığı: "popüler hisseleri
        // önceden ısıt") Sayfa ilk açıldığında sadece TEK sembol (yukarıdaki
        // `first`) yükleniyor — geri kalan ~96 BIST100 sembolünün grafik
        // verisi hiç çekilmemiş oluyor. Bir kullanıcı/jüri bilinen büyük
        // hisselerden birine (ör. ASELS, GARAN) tıkladığında bu veri İLK KEZ
        // çekiliyor olduğu için (özellikle şu anki Yahoo rate-limit altında)
        // yavaş kalabiliyor. Aşağıdaki liste, en olası tıklanacak birkaç
        // BIST30 hissesinin verisini kullanıcı hiçbir şeye tıklamadan, ARKA
        // PLANDA ve ARALIKLI (backend'i bir anda yormamak için tek seferde
        // değil, 1,5sn arayla) önceden ısıtır. TradingChart.prewarmSymbol()
        // SADECE veriyi kendi önbelleğine (symbolHistoryCache, 3dk TTL)
        // düşürür — ekranı/aktif grafiği/canlı akışı HİÇ etkilemez, gerçekten
        // o sembol seçildiğinde loadSymbol() ağdan beklemeden önbellekten
        // anında yanıt alır. İlk sembol seçimi ve canlı akış (WS) bağlantısı
        // önce kurulsun diye 6 saniye gecikmeyle başlar (syncWatchlistPrices
        // için kullanılan 8sn'lik gecikmeyle aynı ilkeyle tutarlı).
        const PREWARM_SYMBOLS = ['THYAO', 'GARAN', 'AKBNK', 'ASELS', 'SASA', 'KCHOL', 'EREGL', 'BIMAS'];
        if (window.TradingChart && window.TradingChart.prewarmSymbol) {
            const toWarm = PREWARM_SYMBOLS.filter(s => !first || s !== first.symbol);
            toWarm.forEach((sym, i) => {
                setTimeout(() => window.TradingChart.prewarmSymbol(sym), 6000 + i * 1500);
            });
        }
    }

    return Object.freeze({
        init,
        selectSymbol,
        getPrice,
        getChangePercent,
        syncPriceAnchor,
        closePosition,
        resetPortfolio,
        setBalance,
        // (18 Temmuz 2026, dördüncü tur, Madde 5f — sayı/para birimi formatı
        // denetimi) app.js'in kendi ayrı .toFixed(2) çağrılarıyla ₺ fiyatları
        // biçimlendirmesi yerine (ki bu, watchlist/pozisyon panellerindeki
        // Türkçe yerel biçimden — binlik nokta/ondalık virgül — farklı bir
        // görünüm üretiyordu), tek bir merkezi fiyat biçimlendiricisi burada
        // dışa açılıyor.
        fmtPrice,
        // (22 Temmuz 2026, on ikinci oturum, ikinci tur) tradingChart.js'teki
        // dual-chart karşılaştırma sembolü seçicisinin geçersiz sembol
        // girişinde kullanıcıya kısa bir geri bildirim verebilmesi için —
        // ayrı bir toast mekanizması yazmak yerine mevcut olanı dışa açıyoruz.
        showToast,
        // (29 Temmuz 2026 — Madde 18) tradingChart.js'in grafik üzerinde
        // kullanıcının gerçek al-sat noktalarını ok işaretiyle gösterebilmesi
        // için.
        getTradeHistoryForSymbol,
        // (29 Temmuz 2026 — Madde 20) tradingChart.js'teki debugGet*/debugIs*
        // ailesiyle AYNI amaç: salt-okunur/tetikleyici QA yardımcıları,
        // yalnızca Playwright testlerinde kullanılıyor, hiçbir üretim kodu
        // bunlara bağımlı değil. checkIndicatorAlerts() normalde her
        // TICK_MS'de (2sn) bir otomatik çalışıyor — testlerde rastgele fiyat
        // yürüyüşünü beklemek yerine deterministik olarak hemen tetiklemek
        // için burada dışa açılıyor.
        debugCheckIndicatorAlertsNow: () => checkIndicatorAlerts(),
        debugGetIndicatorAlerts: () => indicatorAlerts.map(a => ({ ...a })),
        // (6 Ağustos 2026 — emir onay penceresi + LIMIT emir kök neden
        // düzeltmesi QA yardımcıları) Yalnızca Playwright testlerinde
        // kullanılıyor, hiçbir üretim kodu bunlara bağımlı değil.
        debugGetPortfolio: () => JSON.parse(JSON.stringify(portfolio)),
        debugGetAccountSnapshot: () => computeAccountSnapshot(),
        debugIsOrderConfirmOpen: () => { const el = byId('order-confirm-modal-backdrop'); return !!(el && el.classList.contains('open')); },
        debugConfirmPendingOrder: () => { const btn = byId('btn-order-confirm-submit'); if (btn) btn.click(); },
        debugCancelPendingOrder: () => { const btn = byId('btn-order-confirm-cancel'); if (btn) btn.click(); },
        debugTickPricesNow: () => tickPrices(),
        // (9 Ağustos 2026) debugTickPricesNow, tickPrices()'ın TAMAMINI (piyasa
        // kapalıyken erken çıkan DC.isMarketOpenNow() koruması dahil) çalıştırır
        // — bu üretimde DOĞRU davranış (piyasa kapalıyken fiyat/emir motoru
        // donuk kalmalı) ama hafta sonu/mesai dışı çalışan otomatik testleri
        // belirsizleştiriyor. Bekleyen emir tetikleme mantığını piyasa
        // saatlerinden bağımsız test edebilmek için ayrı bir QA girişi.
        debugCheckPendingOrdersNow: () => checkPendingOcoOrders(),
        debugSetPrice: (symbol, price) => { if (priceProfiles[symbol]) { priceProfiles[symbol].price = price; priceProfiles[symbol].dayOpen = price; priceProfiles[symbol].liveAnchor = price; } },
        // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü)
        // finteclubBridge.js'in shared_state dinleyicisi tarafından çağrılır.
        setAdminForcedTheme
    });
})();

window.TradingEngine = TradingEngine;
