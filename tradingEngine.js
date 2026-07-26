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

    /* ────────── DOM helpers ────────── */
    function byId(id) { return document.getElementById(id); }

    // All full-screen modal backdrop ids in the app — used so opening one
    // reliably closes any other that might already be open.
    const ALL_MODAL_BACKDROP_IDS = ['indicator-modal-backdrop', 'alerts-modal-backdrop', 'sltp-modal-backdrop', 'heatmap-modal-backdrop', 'shortcuts-modal-backdrop', 'help-modal-backdrop', 'command-palette-backdrop'];
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
                    return parsed;
                }
            }
        } catch (e) { /* ignore corrupt storage */ }
        return { balance: DEFAULT_BALANCE, positions: {}, history: [], pendingOrders: [] };
    }

    function savePortfolio() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio)); } catch (e) { /* quota / private mode */ }
    }

    function resetPortfolio() {
        portfolio = { balance: DEFAULT_BALANCE, positions: {}, history: [], pendingOrders: [] };
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

    /* ════════════════════════════════════════════════
       Price simulation
       ════════════════════════════════════════════════ */

    // Watchlist mini-sparkline'ları için tutulan kısa fiyat geçmişi — her
    // tick'te bir örnek eklenir, SPARK_HISTORY_LEN'i aşınca en eski örnek
    // atılır (TICK_MS=2000ms × 60 ≈ son 2 dakika).
    const SPARK_HISTORY_LEN = 60;

    function buildPriceProfiles() {
        const profiles = {};
        DC.BIST100.forEach(({ symbol }) => {
            const known = DC.STOCK_PROFILES[symbol];
            if (known) {
                profiles[symbol] = { price: known.basePrice, dayOpen: known.basePrice, volatility: known.volatility, name: known.name, history: [known.basePrice] };
                return;
            }
            const hash = Array.from(symbol).reduce((s, c) => s * 31 + c.charCodeAt(0), 0);
            const base = +(15 + Math.abs(hash % 400) + (Math.abs(hash) % 100) / 100).toFixed(2);
            profiles[symbol] = { price: base, dayOpen: base, volatility: 0.012 + (Math.abs(hash) % 8) / 1000, history: [base] };
        });
        return profiles;
    }

    function tickPrices() {
        // BIST kapalıyken (hafta sonu veya 09:55-18:00 TRT seans dışında)
        // fiyatlar simüle edilmeyi durdurur — son kapanış fiyatında donuk kalır,
        // tıpkı gerçek bir borsa gibi. Aksi halde mumlar piyasa kapalıyken de
        // hareket etmeye devam ediyordu (kullanıcı tarafından bildirilen hata).
        if (DC.isMarketOpenNow && !DC.isMarketOpenNow()) return;

        Object.keys(priceProfiles).forEach(sym => {
            const p = priceProfiles[sym];
            const meanReversion = (p.dayOpen - p.price) * 0.02;
            const shock = (Math.random() - 0.5) * p.volatility * p.price;
            let next = p.price + shock + meanReversion;
            const capUp = p.dayOpen * 1.06, capDown = p.dayOpen * 0.94;
            next = Math.max(capDown, Math.min(capUp, next));
            p.price = +next.toFixed(2);

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

        if (state.activeSymbol) {
            renderOrderBook(state.activeSymbol);
            maybePushRecentTrade(state.activeSymbol);
        }

        checkStopLossTakeProfit();
        checkMarginCalls();
        checkPendingOcoOrders();
        checkAlerts();

        sampleEquity();
        if (byId('panel-tab-performance')?.classList.contains('active')) renderPerformanceTab();
        if (byId('heatmap-modal-backdrop')?.classList.contains('open')) renderHeatmap();
        // (22 Temmuz 2026, on ikinci oturum — madde 7) Profil paneli açıkken
        // bakiye/özkaynak/K-Z rakamları da canlı tik ile birlikte tazelensin.
        if (byId('profile-panel-dropdown')?.classList.contains('open')) renderProfilePanel();
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
    function syncPriceAnchor(symbol, lastClose) {
        const p = priceProfiles[symbol];
        if (!p || !lastClose) return;
        p.price = lastClose;
        p.dayOpen = lastClose;
        renderWatchlistPrices();
        if (symbol === state.activeSymbol) {
            updateActiveSymbolTicket();
            renderOrderBook(symbol);
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
                const capUp = p.dayOpen * 1.06, capDown = p.dayOpen * 0.94;
                if (msg.price > capUp || msg.price < capDown) {
                    p.dayOpen = msg.price;
                }
                p.price = +msg.price.toFixed(2);
                renderWatchlistPrices();
                updateActiveSymbolTicket();
                if (window.TradingChart) window.TradingChart.updateLastPrice(symbol, p.price);
                renderPositions();
                renderAccountSummary();
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
    const WATCHLIST_SYNC_INTERVAL_MS = 90000;
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
            // Aynı re-merkezleme mantığı burada da geçerli (bkz.
            // connectLiveFeed'in onmessage'ı): gerçek fiyat mevcut günlük
            // banttan çok uzaksa dayOpen'ı da yeniden merkezle, aksi halde
            // bir sonraki simüle tick bu gerçek fiyatı geri "kelepçeler".
            const capUp = p.dayOpen * 1.06, capDown = p.dayOpen * 0.94;
            if (price > capUp || price < capDown) {
                p.dayOpen = price;
            }
            p.price = +price.toFixed(2);
            anyUpdated = true;
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

    /* ════════════════════════════════════════════════
       Simulated Order Book (bid/ask depth, Binance-style)
       ════════════════════════════════════════════════ */

    function fmtQty(n) {
        return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(Math.round(n));
    }

    function buildOrderBookSide(midPrice, levels, isAsk) {
        const rows = [];
        let cumQty = 0;
        // Tick size scales with price magnitude (kuruş-level for cheap stocks,
        // whole-lira steps for expensive ones) so the ladder looks sensible.
        const tick = midPrice >= 500 ? 0.5 : midPrice >= 100 ? 0.1 : midPrice >= 20 ? 0.02 : 0.01;
        for (let i = 1; i <= levels; i++) {
            const price = isAsk ? midPrice + tick * i : midPrice - tick * i;
            if (price <= 0) break;
            // Depth tends to thin out further from the mid price, with noise.
            const qty = Math.max(10, Math.round((2200 / i) * (0.4 + Math.random() * 1.2)));
            cumQty += qty;
            rows.push({ price, qty, cumQty });
        }
        return rows;
    }

    function renderOrderBook(symbol) {
        const asksEl = byId('orderbook-asks');
        const bidsEl = byId('orderbook-bids');
        const midEl = byId('orderbook-mid-price');
        if (!asksEl || !bidsEl) return; // tab not in DOM / not built yet
        const price = getPrice(symbol);
        if (!price) return;

        const LEVELS = 9;
        const asks = buildOrderBookSide(price, LEVELS, true);
        const bids = buildOrderBookSide(price, LEVELS, false);
        const maxCum = Math.max(asks[asks.length - 1]?.cumQty || 1, bids[bids.length - 1]?.cumQty || 1);

        // Asks render top-to-bottom from farthest to nearest (best ask sits
        // just above the mid-price row), matching standard order book UX.
        asksEl.innerHTML = asks.slice().reverse().map(r => orderBookRowHtml(r, 'ask', maxCum)).join('');
        bidsEl.innerHTML = bids.map(r => orderBookRowHtml(r, 'bid', maxCum)).join('');
        if (midEl) midEl.textContent = '₺' + price.toFixed(price >= 500 ? 1 : 2);
    }

    function orderBookRowHtml(row, side, maxCum) {
        const widthPct = Math.min(100, (row.cumQty / maxCum) * 100);
        return '<div class="orderbook-row ' + side + '">' +
            '<span class="ob-depth-bar" style="width:' + widthPct.toFixed(0) + '%"></span>' +
            '<span class="ob-price">' + row.price.toFixed(row.price >= 500 ? 1 : 2) + '</span>' +
            '<span class="ob-qty">' + fmtQty(row.qty) + '</span>' +
            '</div>';
    }

    /* ════════════════════════════════════════════════
       Simulated Recent Trades tape
       ════════════════════════════════════════════════ */

    const recentTradesBySymbol = {};
    const MAX_RECENT_TRADES = 40;

    function maybePushRecentTrade(symbol) {
        const price = getPrice(symbol);
        if (!price) return;
        if (!recentTradesBySymbol[symbol]) recentTradesBySymbol[symbol] = [];
        const list = recentTradesBySymbol[symbol];
        const prevPrice = list.length ? list[0].price : price;
        // 1-3 prints per tick for a livelier tape, each with tiny price noise
        // around the current simulated price and a side biased by the recent
        // direction of travel (mimics real tape behavior on up/down moves).
        const printCount = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < printCount; i++) {
            const noise = (Math.random() - 0.5) * price * 0.0015;
            const printPrice = +(price + noise).toFixed(price >= 500 ? 1 : 2);
            const upBias = printPrice >= prevPrice ? 0.62 : 0.38;
            const side = Math.random() < upBias ? 'buy' : 'sell';
            const qty = Math.max(1, Math.round(5 + Math.random() * 250));
            list.unshift({ price: printPrice, qty, side, ts: Date.now() });
        }
        if (list.length > MAX_RECENT_TRADES) list.length = MAX_RECENT_TRADES;
        renderRecentTrades(symbol);
    }

    function renderRecentTrades(symbol) {
        const el = byId('recent-trades-list');
        if (!el) return;
        const list = recentTradesBySymbol[symbol] || [];
        el.innerHTML = list.map(t => {
            const time = new Date(t.ts);
            const hh = String(time.getHours()).padStart(2, '0');
            const mm = String(time.getMinutes()).padStart(2, '0');
            const ss = String(time.getSeconds()).padStart(2, '0');
            return '<div class="trade-tape-row ' + t.side + '">' +
                '<span class="tt-price">' + t.price.toFixed(t.price >= 500 ? 1 : 2) + '</span>' +
                '<span class="tt-qty">' + fmtQty(t.qty) + '</span>' +
                '<span class="tt-time">' + hh + ':' + mm + ':' + ss + '</span>' +
                '</div>';
        }).join('');
    }

    /* ════════════════════════════════════════════════
       Right panel sub-tabs (Alım-Satım / Emir Defteri / Son İşlemler)
       ════════════════════════════════════════════════ */

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
                if (tab.dataset.panelTab === 'orderbook' && state.activeSymbol) renderOrderBook(state.activeSymbol);
                if (tab.dataset.panelTab === 'trades' && state.activeSymbol) renderRecentTrades(state.activeSymbol);
                if (tab.dataset.panelTab === 'performance') renderPerformanceTab();
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
        Object.keys(portfolio.positions).forEach(symbol => {
            const pos = portfolio.positions[symbol];
            const current = getPrice(symbol) || pos.avgPrice;
            if (pos.side === 'LONG') longValue += pos.qty * current;
            else shortValue += pos.qty * current;
        });
        return portfolio.balance + longValue - shortValue;
    }

    function sampleEquity() {
        equityHistory.push({ ts: Date.now(), value: currentEquity() });
        if (equityHistory.length > MAX_EQUITY_POINTS) equityHistory.shift();
    }

    function computePerformanceStats() {
        const closed = portfolio.history.filter(h => h.type === 'CLOSE' && h.pnl !== null);
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
        const activeCount = priceAlerts.filter(a => !a.triggered).length;
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

    function setupAlertsModal() {
        const backdrop = byId('alerts-modal-backdrop');
        const openBtn = byId('btn-open-alerts');
        const closeBtn = byId('btn-close-alerts');
        const addBtn = byId('btn-add-alert');
        const priceInput = byId('alert-target-price');
        const notifRow = byId('alert-notif-toggle-row');
        const notifChk = byId('alert-notif-checkbox');
        if (!backdrop || !openBtn) return;

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
            renderAlertsList();
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
            { label: 'Parametreleri Sıfırla (Reset)', sub: 'Genel', keywords: 'reset sıfırla temizle varsayılan', run: () => byId('btn-reset-params')?.click() },
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
                removeFromWatchlist(btn.dataset.removeSymbol);
                renderWatchlistRows();
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
            if (slInput) slInput.value = '';
            if (tpInput) tpInput.value = '';
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
        renderOrderBook(symbol);
        renderRecentTrades(symbol);

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
            const chartInfo = await window.TradingChart.loadSymbol(symbol);
            // Re-anchor the simulated demo tick price to the real last close
            // that was just fetched, instead of the hardcoded STOCK_PROFILES
            // fallback seed. Without this, the live trading chart drifts
            // toward a fabricated price while the Price Action (backtest)
            // chart — which uses the real fetched data — keeps showing the
            // actual last close, so the two charts silently disagree on
            // "the current price" for the same symbol.
            const alreadyHasLiveTick = liveFeedActive && liveFeedSymbol === symbol;
            if (!alreadyHasLiveTick && chartInfo && chartInfo.lastClose && priceProfiles[symbol]) {
                priceProfiles[symbol].price = chartInfo.lastClose;
                priceProfiles[symbol].dayOpen = chartInfo.lastClose;
                renderWatchlistPrices();
                updateActiveSymbolTicket();
                renderOrderBook(symbol);
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
        const resetBtn = byId('qt-reset-portfolio');
        const sltpToggle = byId('qt-sltp-toggle');
        const sltpRow = byId('qt-sltp-row');
        const trailingToggle = byId('qt-trailing-toggle');
        const trailingRow = byId('qt-trailing-row');

        if (buyTab) buyTab.addEventListener('click', () => setSide('BUY'));
        if (sellTab) sellTab.addEventListener('click', () => setSide('SELL'));
        if (marketTab) marketTab.addEventListener('click', () => setOrderType('MARKET'));
        if (limitTab) limitTab.addEventListener('click', () => setOrderType('LIMIT'));
        if (ocoTab) ocoTab.addEventListener('click', () => setOrderType('OCO'));
        if (qtyInput) qtyInput.addEventListener('input', updateEstimate);
        if (limitInput) limitInput.addEventListener('input', updateEstimate);
        if (ocoUpperInput) ocoUpperInput.addEventListener('input', updateEstimate);
        if (ocoLowerInput) ocoLowerInput.addEventListener('input', updateEstimate);
        if (sltpToggle && sltpRow) {
            sltpToggle.addEventListener('change', () => {
                sltpRow.style.display = sltpToggle.checked ? 'flex' : 'none';
            });
        }
        if (trailingToggle && trailingRow) {
            trailingToggle.addEventListener('change', () => {
                trailingRow.style.display = trailingToggle.checked ? 'flex' : 'none';
                const slField = byId('qt-sl-price');
                if (slField) slField.disabled = trailingToggle.checked;
            });
        }

        document.querySelectorAll('.qty-pct-btn').forEach(btn => {
            btn.addEventListener('click', () => applyQtyPct(parseInt(btn.dataset.pct, 10)));
        });

        setupLeverageSelector();
        setupMarketModeSelector();

        if (submitBtn) submitBtn.addEventListener('click', submitOrder);
        if (resetBtn) resetBtn.addEventListener('click', () => {
            if (confirm('Demo portföyünüz sıfırlanacak (' + fmtTRY(DEFAULT_BALANCE) + '). Onaylıyor musunuz?')) {
                resetPortfolio();
            }
        });

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

        updateEstimate();
    }

    const LEVERAGE_MIN = 1;
    const LEVERAGE_MAX = 20;

    function applyLeverage(value) {
        state.leverage = Math.min(LEVERAGE_MAX, Math.max(LEVERAGE_MIN, Math.round(Number(value) || 1)));
        const hint = byId('leverage-warning-hint');
        if (hint) hint.style.display = state.leverage >= 5 ? 'inline' : 'none';
        updateEstimate();
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
        if (!normalBtn || !viopBtn) return;

        function apply(mode) {
            state.market = mode === 'VIOP' ? 'VIOP' : 'NORMAL';
            normalBtn.classList.toggle('active', state.market === 'NORMAL');
            viopBtn.classList.toggle('active', state.market === 'VIOP');
            if (leverageGroup) leverageGroup.style.display = state.market === 'VIOP' ? '' : 'none';

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

    function applyQtyPct(pct) {
        if (!state.activeSymbol) return;
        const price = effectivePrice();
        if (!price) return;
        const commissionPct = getCommissionPct();
        const leverage = Math.max(1, Number(state.leverage) || 1);
        let qty;
        if (state.side === 'BUY') {
            // Bakiyenin %pct'i kadarını TEMİNAT olarak kullan — kaldıraç
            // sayesinde aynı teminatla `leverage` katı kadar nominal
            // pozisyon açılabiliyor.
            const usableMargin = portfolio.balance * (pct / 100);
            qty = Math.floor((usableMargin * leverage) / (price * (1 + (commissionPct / 100) * leverage)));
        } else {
            const pos = portfolio.positions[state.activeSymbol];
            if (pos && pos.side === 'LONG') {
                qty = Math.floor(pos.qty * (pct / 100));
            } else {
                const usableMargin = portfolio.balance * (pct / 100);
                qty = Math.floor((usableMargin * leverage) / price);
            }
        }
        const qtyInput = byId('qt-qty');
        if (qtyInput) qtyInput.value = Math.max(0, qty);
        updateEstimate();
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
        const leverage = Math.max(1, Number(state.leverage) || 1);
        const notional = price * qty;
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

    function submitOrder() {
        if (!state.activeSymbol) { showToast('Önce bir sembol seçin.'); showTicketAlert('Önce bir sembol seçin.', 'error'); return; }
        const qtyInput = byId('qt-qty');
        const qty = qtyInput ? Math.floor(Number(qtyInput.value)) : 0;
        const price = effectivePrice();
        const commissionPct = getCommissionPct();

        if (!qty || qty <= 0) { showToast('Geçerli bir miktar girin.'); showTicketAlert('Geçerli bir miktar girin.', 'error'); return; }
        if (!price || price <= 0) { showToast('Fiyat bilgisi alınamadı.'); showTicketAlert('Fiyat bilgisi alınamadı.', 'error'); return; }

        if (state.orderType === 'OCO') {
            submitOcoOrder(qty, price, commissionPct);
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

        // Optional Stop-Loss / Take-Profit attached to the position this order opens/adds to.
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
            if (slPrice !== null && ((willBeLong && slPrice >= price) || (!willBeLong && slPrice <= price))) {
                const m = `Stop-Loss fiyatı ${willBeLong ? 'giriş fiyatının altında' : 'giriş fiyatının üzerinde'} olmalı.`;
                showToast(m); showTicketAlert(m, 'error');
                return;
            }
            if (tpPrice !== null && ((willBeLong && tpPrice <= price) || (!willBeLong && tpPrice >= price))) {
                const m = `Take-Profit fiyatı ${willBeLong ? 'giriş fiyatının üzerinde' : 'giriş fiyatının altında'} olmalı.`;
                showToast(m); showTicketAlert(m, 'error');
                return;
            }
        }

        if (state.orderType === 'LIMIT') {
            // Simplified: simulate immediate fill against current market for demo purposes,
            // since this is a sandbox with no real order book.
            showToast(`Limit emir ${fmtPrice(price)} seviyesinden gerçekleşti (demo).`);
        }

        // (23 Temmuz 2026 düzeltmesi) Var olan bir pozisyon FARKLI bir
        // kaldıraçla açıksa, artık bilette seçili kaldıraç ekleme kısmına
        // GERÇEKTEN uygulanıyor (placeOrder'daki değişikliğe bkz.) — eskiden
        // olduğu gibi sessizce eski kaldıraca zorlanmıyor. Pozisyonun
        // saklanan kaldıracı, avgPrice ile aynı şekilde adet-ağırlıklı
        // ortalamaya güncelleniyor; kullanıcı bunu ticket'ta önceden görsün
        // diye bilgilendirici bir not gösteriliyor.
        const existingBeforeOrder = portfolio.positions[state.activeSymbol];
        const intendedSide = state.side === 'BUY' ? 'LONG' : 'SHORT';
        if (existingBeforeOrder && existingBeforeOrder.side === intendedSide && existingBeforeOrder.leverage && existingBeforeOrder.leverage !== state.leverage) {
            const blendedPreview = (existingBeforeOrder.leverage * existingBeforeOrder.qty + state.leverage * qty) / (existingBeforeOrder.qty + qty);
            const leverageNote = `Not: ${state.activeSymbol} şu an ${fmtLeverage(existingBeforeOrder.leverage)}x kaldıraçla açık — bu ekleme ${fmtLeverage(state.leverage)}x ile yapılacak, pozisyonun ortalama kaldıracı ${fmtLeverage(blendedPreview)}x olacak.`;
            showToast(leverageNote);
            // (23 Temmuz 2026 düzeltmesi) Bu bilgilendirme mesajı önceden
            // yalnızca footer'a gidiyordu ve hemen ardından placeOrder()
            // sonucu (başarı ya da "yetersiz bakiye") onu ezip geçiyordu —
            // kullanıcı NEDEN kaldıraç seçiminin uygulanmadığını hiç
            // göremiyordu. Artık ticket içinde ayrıca gösteriliyor; emir
            // başarısız olursa hemen aşağıdaki showTicketAlert('error')
            // çağrısı bunun yerini alacak (aynı kutu, tek mesaj kalır).
            showTicketAlert(leverageNote, 'info');
        }

        const result = placeOrder(state.activeSymbol, state.side, qty, price, commissionPct, state.leverage);
        if (!result.ok) {
            showToast(result.msg);
            showTicketAlert(result.msg, 'error');
            return;
        }

        // Attach SL/TP (or a Trailing Stop instead of a fixed SL) only if this
        // order actually opened/added to a position in its own direction
        // (not just reducing/closing an opposite one).
        const trailingToggle = byId('qt-trailing-toggle');
        const trailingPctInput = byId('qt-trailing-pct');
        const useTrailing = !!(trailingToggle && trailingToggle.checked && trailingPctInput && Number(trailingPctInput.value) > 0);
        if (slPrice !== null || tpPrice !== null || useTrailing) {
            const pos = portfolio.positions[state.activeSymbol];
            const expectedSide = state.side === 'BUY' ? 'LONG' : 'SHORT';
            if (pos && pos.side === expectedSide) {
                if (useTrailing) {
                    pos.trailingPct = Number(trailingPctInput.value);
                    pos.trailingExtreme = pos.avgPrice; // en iyi fiyat henüz giriş fiyatı
                    delete pos.sl; // trailing, sabit SL'nin yerini alır
                } else if (slPrice !== null) {
                    pos.sl = slPrice;
                    delete pos.trailingPct;
                    delete pos.trailingExtreme;
                }
                if (tpPrice !== null) pos.tp = tpPrice;
                savePortfolio();
            }
        }

        renderPositions();
        renderOrders();
        renderAccountSummary();
        showToast(`${state.side === 'BUY' ? 'Alım' : 'Satım'} emri gerçekleşti: ${qty} adet ${state.activeSymbol} @ ₺${fmtPrice(price)}`);
        // Emir başarıyla gerçekleşti. Bu turda bir kaldıraç notu gösterildiyse
        // (leverageNote) onu ekranda bırakıyoruz — kullanıcının hâlâ görmesi
        // faydalı bir bilgi. Gösterilmediyse, ÖNCEKİ bir başarısız denemeden
        // kalmış olabilecek bir hata kutusu varsa temizleniyor.
        if (!(existingBeforeOrder && existingBeforeOrder.side === intendedSide && existingBeforeOrder.leverage && existingBeforeOrder.leverage !== state.leverage)) {
            const alertEl = byId('qt-ticket-alert');
            if (alertEl && alertEl.classList.contains('qt-alert-error')) {
                alertEl.style.display = 'none';
                clearTimeout(ticketAlertTimer);
            }
        }
        if (qtyInput) qtyInput.value = '';
        if (sltpToggle) { sltpToggle.checked = false; }
        const sltpRow = byId('qt-sltp-row');
        if (sltpRow) sltpRow.style.display = 'none';
        const slInput = byId('qt-sl-price'), tpInput = byId('qt-tp-price');
        if (slInput) { slInput.value = ''; slInput.disabled = false; }
        if (tpInput) tpInput.value = '';
        if (trailingToggle) trailingToggle.checked = false;
        if (trailingPctInput) trailingPctInput.value = '';
        const trailingRow = byId('qt-trailing-row');
        if (trailingRow) trailingRow.style.display = 'none';
        updateEstimate();
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
        const estimatedMargin = estimateOrderMarginRequirement(state.activeSymbol, state.side, qty, currentPrice, state.leverage);
        const estimatedCommission = currentPrice * qty * (commissionPct / 100);
        const estimatedRequired = estimatedMargin + estimatedCommission;
        if (estimatedRequired > portfolio.balance) {
            const m = 'Yetersiz demo bakiye (yaklaşık gereken teminat: ' + fmtTRY(estimatedRequired) + ').';
            showToast(m);
            showTicketAlert(m, 'error');
            return;
        }

        if (!portfolio.pendingOrders) portfolio.pendingOrders = [];
        portfolio.pendingOrders.push({
            id: genId(),
            symbol: state.activeSymbol,
            qty,
            upper,
            lower,
            leverage: state.leverage,
            commissionPct,
            createdAt: Date.now()
        });
        savePortfolio();
        renderPendingOcoOrders();
        showToast(`OCO emri oluşturuldu: ${state.activeSymbol} · ${upper ? 'üst ₺' + fmtPrice(upper) : ''}${upper && lower ? ' / ' : ''}${lower ? 'alt ₺' + fmtPrice(lower) : ''}`);

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
    function checkPendingOcoOrders() {
        if (!portfolio.pendingOrders || !portfolio.pendingOrders.length) return;
        const stillPending = [];
        let changed = false;
        portfolio.pendingOrders.forEach(order => {
            const price = getPrice(order.symbol);
            if (!price) { stillPending.push(order); return; }
            let triggeredSide = null;
            if (order.upper !== null && price >= order.upper) triggeredSide = 'BUY';
            else if (order.lower !== null && price <= order.lower) triggeredSide = 'SELL';

            if (triggeredSide) {
                changed = true;
                const result = placeOrder(order.symbol, triggeredSide, order.qty, price, order.commissionPct, order.leverage);
                if (result.ok) {
                    showToast(`OCO tetiklendi: ${order.symbol} ${triggeredSide === 'BUY' ? 'AL' : 'AÇIĞA SAT'} @ ₺${fmtPrice(price)} — diğer tetikleyici iptal edildi.`);
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
            portfolio.pendingOrders = stillPending;
            savePortfolio();
            renderPendingOcoOrders();
            renderAccountSummary();
        }
    }

    function cancelOcoOrder(orderId) {
        if (!portfolio.pendingOrders) return;
        portfolio.pendingOrders = portfolio.pendingOrders.filter(o => o.id !== orderId);
        savePortfolio();
        renderPendingOcoOrders();
        showToast('OCO emri iptal edildi.');
    }
    window.__optipulseCancelOco = cancelOcoOrder; // used by inline onclick in rendered rows

    function renderPendingOcoOrders() {
        const body = byId('qt-pending-oco-body');
        if (!body) return;
        const orders = portfolio.pendingOrders || [];
        if (!orders.length) {
            body.innerHTML = `<div class="qt-empty-state">Bekleyen OCO emri yok</div>`;
            return;
        }
        body.innerHTML = orders.map(o => `
            <div class="oco-card">
                <div class="oco-card-top">
                    <span class="font-bold">${o.symbol}</span>
                    <button class="btn-cancel-oco" onclick="window.__optipulseCancelOco('${o.id}')">İptal</button>
                </div>
                <div class="oco-card-bottom font-mono">
                    <span>Üst ${o.upper !== null ? '₺' + fmtPrice(o.upper) : '--'}</span>
                    <span>Alt ${o.lower !== null ? '₺' + fmtPrice(o.lower) : '--'}</span>
                    <span>${o.qty} adet</span>
                </div>
            </div>
        `).join('');
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
    function estimateOrderMarginRequirement(symbol, side, qty, price, leverage) {
        qty = Math.floor(Number(qty));
        price = Number(price);
        if (!symbol || !qty || qty <= 0 || !price || price <= 0) return 0;

        let remainingQty = qty;
        let releasedMargin = 0;
        const pos = portfolio.positions[symbol];
        if (pos && ((side === 'BUY' && pos.side === 'SHORT') || (side === 'SELL' && pos.side === 'LONG'))) {
            const closeQty = Math.min(remainingQty, pos.qty);
            const posLeverage = pos.leverage || 1;
            releasedMargin = (pos.avgPrice * closeQty) / posLeverage;
            remainingQty -= closeQty;
        }
        if (remainingQty <= 0) return -releasedMargin;

        // (23 Temmuz 2026 düzeltmesi) Bu tahmin de artık placeOrder() ile
        // birebir aynı mantığı izliyor: eklenen kısmın marjı, mevcut
        // pozisyonun ESKİ kaldıracıyla değil, bilet üzerinde SEÇİLİ olan
        // (bu fonksiyona parametre olarak gelen) kaldıraçla hesaplanıyor —
        // bkz. placeOrder()'daki ayrıntılı açıklama.
        const effectiveLeverage = Math.max(1, Number(leverage) || 1);
        const margin = (price * remainingQty) / effectiveLeverage;
        return margin - releasedMargin;
    }

    function placeOrder(symbol, side, qty, price, commissionPct, leverage) {
        qty = Math.floor(Number(qty));
        price = Number(price);
        if (!qty || qty <= 0 || !price || price <= 0) return { ok: false, msg: 'Geçersiz miktar/fiyat' };

        const commissionTotal = price * qty * (commissionPct / 100);
        let remainingQty = qty;
        const pos = portfolio.positions[symbol];

        // 1. Close/reduce an opposite-direction position first.
        if (pos && ((side === 'BUY' && pos.side === 'SHORT') || (side === 'SELL' && pos.side === 'LONG'))) {
            const closeQty = Math.min(remainingQty, pos.qty);
            const closeCommission = commissionTotal * (closeQty / qty);
            const posLeverage = pos.leverage || 1;
            const releasedMargin = (pos.avgPrice * closeQty) / posLeverage;
            let realizedPnl;

            if (pos.side === 'LONG') {
                realizedPnl = (price - pos.avgPrice) * closeQty - closeCommission;
            } else {
                realizedPnl = (pos.avgPrice - price) * closeQty - closeCommission;
            }
            portfolio.balance += releasedMargin + realizedPnl;

            pos.qty -= closeQty;
            remainingQty -= closeQty;
            if (pos.qty <= 0) delete portfolio.positions[symbol];

            portfolio.history.unshift({
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
            const existingPos = portfolio.positions[symbol];
            const requestedLeverage = Math.max(1, Number(leverage) || 1);

            const margin = (price * remainingQty) / requestedLeverage;
            const requiredBalance = margin + openCommission;
            if (portfolio.balance < requiredBalance) {
                savePortfolio();
                return { ok: false, msg: 'Yetersiz demo bakiye (gereken teminat: ' + fmtTRY(requiredBalance) + ').' };
            }
            portfolio.balance -= requiredBalance;

            let effectiveLeverage;
            if (!existingPos) {
                effectiveLeverage = requestedLeverage;
                portfolio.positions[symbol] = { side: newSide, qty: remainingQty, avgPrice: price, leverage: effectiveLeverage };
            } else {
                const p = existingPos;
                const totalQty = p.qty + remainingQty;
                const oldLeverage = p.leverage || 1;
                p.avgPrice = (p.avgPrice * p.qty + price * remainingQty) / totalQty;
                effectiveLeverage = (oldLeverage * p.qty + requestedLeverage * remainingQty) / totalQty;
                p.qty = totalQty;
                p.leverage = effectiveLeverage;
            }

            portfolio.history.unshift({
                id: genId(), ts: Date.now(), symbol, side, qty: remainingQty, price,
                type: 'OPEN', commission: +openCommission.toFixed(2), pnl: null, leverage: effectiveLeverage
            });
        }

        portfolio.history = portfolio.history.slice(0, 50);
        savePortfolio();
        return { ok: true };
    }

    function closePosition(symbol, reason) {
        const pos = portfolio.positions[symbol];
        if (!pos) return;
        const price = getPrice(symbol);
        if (!price) return;
        const side = pos.side === 'LONG' ? 'SELL' : 'BUY';
        const result = placeOrder(symbol, side, pos.qty, price, getCommissionPct());
        if (result.ok) {
            renderPositions();
            renderOrders();
            renderAccountSummary();
            const msg = reason === 'SL'
                ? `🛑 ${symbol} Stop-Loss tetiklendi — pozisyon ₺${fmtPrice(price)} seviyesinden kapatıldı.`
                : reason === 'TP'
                    ? `🎯 ${symbol} Take-Profit tetiklendi — pozisyon ₺${fmtPrice(price)} seviyesinden kapatıldı.`
                    : reason === 'TRAILING'
                        ? `📉 ${symbol} Trailing Stop tetiklendi — pozisyon ₺${fmtPrice(price)} seviyesinden kapatıldı.`
                        : reason === 'LIQUIDATION'
                            ? `⚠️ ${symbol} marj çağrısı — kaldıraçlı pozisyon zarar sınırını aştığı için ₺${fmtPrice(price)} seviyesinden otomatik likide edildi.`
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

    function checkStopLossTakeProfit() {
        Object.keys(portfolio.positions).forEach(symbol => {
            const pos = portfolio.positions[symbol];
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
                    if (price <= stopPrice) { closePosition(symbol, 'TRAILING'); return; }
                } else {
                    if (price < pos.trailingExtreme) pos.trailingExtreme = price;
                    const stopPrice = pos.trailingExtreme * (1 + pos.trailingPct / 100);
                    if (price >= stopPrice) { closePosition(symbol, 'TRAILING'); return; }
                }
            }

            if (pos.side === 'LONG') {
                if (pos.sl && price <= pos.sl) { closePosition(symbol, 'SL'); return; }
                if (pos.tp && price >= pos.tp) { closePosition(symbol, 'TP'); return; }
            } else {
                if (pos.sl && price >= pos.sl) { closePosition(symbol, 'SL'); return; }
                if (pos.tp && price <= pos.tp) { closePosition(symbol, 'TP'); return; }
            }
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
    function checkMarginCalls() {
        Object.keys(portfolio.positions).forEach(symbol => {
            const pos = portfolio.positions[symbol];
            const leverage = pos.leverage || 1;
            if (leverage <= 1) return;
            const price = getPrice(symbol);
            if (!price) return;
            const margin = (pos.avgPrice * pos.qty) / leverage;
            const unrealized = pos.side === 'LONG'
                ? (price - pos.avgPrice) * pos.qty
                : (pos.avgPrice - price) * pos.qty;
            if (unrealized <= -margin * LIQUIDATION_MARGIN_LOSS_RATIO) {
                closePosition(symbol, 'LIQUIDATION');
            }
        });
    }

    function setPositionSLTP(symbol, slPrice, tpPrice) {
        const pos = portfolio.positions[symbol];
        if (!pos) return false;
        pos.sl = slPrice || null;
        pos.tp = tpPrice || null;
        savePortfolio();
        renderPositions();
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

        const close = () => backdrop.classList.remove('open');

        window.__optipulseOpenSltp = (symbol) => {
            const pos = portfolio.positions[symbol];
            if (!pos) return;
            editingSymbol = symbol;
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
                const pos = portfolio.positions[editingSymbol];
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

                setPositionSLTP(editingSymbol, slVal, tpVal);
                showToast(`${editingSymbol} için SL/TP güncellendi.`);
                close();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (!editingSymbol) return;
                setPositionSLTP(editingSymbol, null, null);
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

    function renderPositions() {
        const body = byId('qt-positions-body');
        if (!body) return;
        const symbols = Object.keys(portfolio.positions);
        if (symbols.length === 0) {
            body.innerHTML = `<div class="qt-empty-state">Açık pozisyon yok</div>`;
            return;
        }
        let html = '';
        symbols.forEach(symbol => {
            const pos = portfolio.positions[symbol];
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
                            <button class="btn-sltp-edit ${hasSltp ? 'has-sltp' : ''}" onclick="window.__optipulseOpenSltp('${symbol}')" title="Stop-Loss / Take-Profit">SL/TP</button>
                            <button class="btn-close-pos" onclick="window.__optipulseClosePosition('${symbol}')">Kapat</button>
                        </div>
                    </div>
                    ${sltpSub}
                </div>
            `;
        });
        body.innerHTML = html;
    }

    function renderOrders() {
        const body = byId('qt-orders-body');
        const csvBtn = byId('btn-export-history-csv');
        if (csvBtn) csvBtn.disabled = !portfolio.history.length;
        if (!body) return;
        if (!portfolio.history.length) {
            body.innerHTML = `<div class="qt-empty-state">Emir geçmişi yok</div>`;
            return;
        }
        let html = '';
        portfolio.history.slice(0, 12).forEach(h => {
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

    /* ════════════════════════════════════════════════
       Trade history CSV export
       ════════════════════════════════════════════════ */

    function csvEscape(val) {
        const s = String(val);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function exportTradeHistoryCSV() {
        if (!portfolio.history.length) { showToast('Dışa aktarılacak işlem geçmişi yok.'); return; }

        const headers = ['Tarih', 'Saat', 'Sembol', 'Yön', 'Tip', 'Adet', 'Fiyat (₺)', 'Komisyon (₺)', 'K/Z (₺)'];
        const rows = portfolio.history.slice().reverse().map(h => { // chronological order, oldest first
            const d = new Date(h.ts);
            return [
                d.toLocaleDateString('tr-TR'),
                d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
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
        showToast(`İşlem geçmişi CSV olarak indirildi (${portfolio.history.length} kayıt).`);
    }

    function setupCsvExport() {
        const btn = byId('btn-export-history-csv');
        if (btn) btn.addEventListener('click', exportTradeHistoryCSV);
    }

    /* ════════════════════════════════════════════════
       Dark / Light theme
       ════════════════════════════════════════════════ */

    const THEME_STORAGE_KEY = 'optipulselab_theme';

    function getCurrentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
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

        // The chart canvas paints its own background/grid/text via JS options,
        // not CSS, so it needs to be told about the theme change explicitly.
        if (window.TradingChart && window.TradingChart.setTheme) window.TradingChart.setTheme(theme);
    }

    function toggleTheme() {
        applyTheme(getCurrentTheme() === 'light' ? 'dark' : 'light');
    }

    function setupThemeToggle() {
        const btn = byId('btn-theme-toggle');
        // Sync icons/chart to whatever the early <head> script already applied
        // (it runs before any other JS to avoid a dark/light flash on load).
        applyTheme(getCurrentTheme());
        if (btn) btn.addEventListener('click', toggleTheme);
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
    function computeAccountSnapshot() {
        let usedMargin = 0, openPnl = 0;
        Object.keys(portfolio.positions).forEach(symbol => {
            const pos = portfolio.positions[symbol];
            const current = getPrice(symbol) || pos.avgPrice;
            const leverage = pos.leverage || 1;
            usedMargin += (pos.avgPrice * pos.qty) / leverage;
            if (pos.side === 'LONG') {
                openPnl += (current - pos.avgPrice) * pos.qty;
            } else {
                openPnl += (pos.avgPrice - current) * pos.qty;
            }
        });
        const equity = portfolio.balance + usedMargin + openPnl;
        return {
            balance: portfolio.balance,
            equity,
            openPnl,
            usedMargin,
            positionsCount: Object.keys(portfolio.positions).length
        };
    }

    function getAccountSnapshot() {
        return computeAccountSnapshot();
    }

    function renderAccountSummary() {
        const { usedMargin, openPnl, equity } = computeAccountSnapshot();

        // Balance now lives in the header pill (top right) rather than the trade ticket itself
        const headerBalEl = byId('header-balance-value');
        const eqEl = byId('qt-equity');
        const pnlEl = byId('qt-openpnl');
        const usedMarginEl = byId('qt-used-margin');
        const marginLevelEl = byId('qt-margin-level');
        if (headerBalEl) headerBalEl.textContent = fmtTRY(portfolio.balance);
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
        watchlistSymbols = loadWatchlistSymbols();

        renderWatchlistRows();
        renderWatchlistPrices();
        setupWatchlistSearch();
        setupTicket();
        setupExchangeSelector();
        setupPanelSubtabs();
        setupAlertsModal();
        setupSltpModal();
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

        setInterval(tickPrices, TICK_MS);
        setInterval(syncWatchlistPrices, WATCHLIST_SYNC_INTERVAL_MS);
        // İlk senkronizasyonu birkaç saniye geciktir ki ilk sembol seçimi ve
        // canlı akış (WS) bağlantısı önce kurulsun, ağ istekleri çakışmasın.
        setTimeout(syncWatchlistPrices, 8000);

        // Resume on whatever symbol was last being viewed, so a reload/revisit
        // doesn't silently jump back to a default symbol while old ticket
        // values (or just user expectations) still refer to a different one.
        let lastSymbol = null;
        try { lastSymbol = localStorage.getItem(LAST_SYMBOL_STORAGE_KEY); } catch (e) { /* private mode */ }
        const restored = lastSymbol && DC.BIST100.find(s => s.symbol === lastSymbol);
        const first = restored || DC.BIST100.find(s => s.symbol === 'THYAO') || DC.BIST100[0];
        if (first) selectSymbol(first.symbol);
    }

    return Object.freeze({
        init,
        selectSymbol,
        getPrice,
        getChangePercent,
        syncPriceAnchor,
        closePosition,
        resetPortfolio,
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
        showToast
    });
})();

window.TradingEngine = TradingEngine;
