/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB TRADING CHART (TradingView Lightweight Charts)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Big centerpiece candlestick chart with:
 *   - Overlay indicators (SMA20/50/200, EMA9/21, Bollinger Bands, VWAP)
 *   - A synced oscillator sub-pane (RSI / MACD / Stochastic / ATR / ADX / OBV)
 *   - A custom canvas drawing layer (trendline, horizontal ray, rectangle,
 *     fibonacci retracement) since Lightweight Charts ships no drawing tools.
 *   - Simulated live tick updates on the most recent bar.
 *
 * Exposed as window.TradingChart.
 * Depends on: window.LightweightCharts, window.DataController
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const TradingChart = (() => {

    const COLORS = {
        up: '#D4AF37',
        down: '#555555',
        wickUp: '#D4AF37',
        wickDown: '#777777',
        grid: 'rgba(255,255,255,0.04)',
        text: '#888888',
        sma20: '#42A5F5',
        sma50: '#AB47BC',
        sma200: '#EF5350',
        ema9: '#26C6DA',
        ema21: '#FFA726',
        wma20: '#8D6E63',
        bbLine: 'rgba(66, 165, 245, 0.55)',
        bbFill: 'rgba(66, 165, 245, 0.06)',
        vwap: '#26A69A',
        draw: '#D4AF37',
        fibLine: 'rgba(212, 175, 55, 0.5)',
        volUp: 'rgba(212, 175, 55, 0.45)',
        volDown: 'rgba(120, 120, 120, 0.35)',
        baselineTop: '#D4AF37',
        baselineBottom: '#EF5350',
        ichimokuTenkan: '#EF5350',
        ichimokuKijun: '#42A5F5',
        ichimokuSenkouA: 'rgba(38, 198, 218, 0.9)',
        ichimokuSenkouB: 'rgba(171, 71, 188, 0.9)',
        ichimokuChikou: '#8D6E63',
        psar: 'rgba(255, 167, 38, 0.9)',
        pivot: 'rgba(212, 175, 55, 0.7)',
        pivotR: 'rgba(239, 83, 80, 0.55)',
        pivotS: 'rgba(38, 198, 218, 0.55)',
        supertrendUp: '#26A69A',
        supertrendDown: '#EF5350',
        keltnerLine: 'rgba(255, 167, 38, 0.55)',
        donchianLine: 'rgba(126, 87, 194, 0.55)',
        // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü)
        // RSI/MACD/Stochastic tek çizgili osilatörlerinin rengi — önceden bu
        // üç seri oluşturma noktasında (bkz. ensureOscillatorPane()) DOĞRUDAN
        // '#D4AF37' literal olarak yazılıydı, COLORS'tan hiç okumuyordu;
        // temaya duyarlı olabilmesi için buraya taşındı (bkz.
        // applyChartColorPaletteForTheme()).
        oscillatorAccent: '#D4AF37'
    };

    // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü)
    // COLORS SABİT bir değişken ama İÇERİĞİ (bir obje) değiştirilebilir — bu
    // yüzden yeni temayı eklemenin en düşük riskli yolu, COLORS'un altın'a
    // bağlı birkaç anahtarını ÇALIŞMA ZAMANINDA (tema değiştiğinde) yerinde
    // güncellemek, dosya genelinde COLORS.xxx okuyan onlarca yeri (mum/hacim/
    // gösterge serileri, çizim aracı, fibonacci/pivot çizgileri) TEK TEK
    // bulup değiştirmemek. Koyu/Açık (gold) temalar HİÇ dokunulmadan aynen
    // kalıyor — GOLD_DEFAULT_CHART_COLORS, herhangi bir mutasyondan ÖNCE
    // orijinal altın değerlerinin bir anlık görüntüsü, "fintech" temasından
    // geri dönüldüğünde tam olarak eski haline dönmeyi garanti ediyor.
    // Renkler FinTeClub admin panelinin KENDİ marka paletinden (--blue
    // #3d6fee, --green #22c55e, --red #ef4444) BİREBİR alındı.
    const FINTECH_CHART_OVERRIDES = {
        up: '#22c55e', down: '#ef4444', wickUp: '#22c55e', wickDown: '#ef4444',
        draw: '#3d6fee', fibLine: 'rgba(61, 111, 238, 0.5)',
        volUp: 'rgba(34, 197, 94, 0.45)', volDown: 'rgba(239, 68, 68, 0.35)',
        baselineTop: '#22c55e', pivot: 'rgba(61, 111, 238, 0.7)',
        oscillatorAccent: '#3d6fee'
    };
    const GOLD_DEFAULT_CHART_COLORS = {};
    Object.keys(FINTECH_CHART_OVERRIDES).forEach(k => { GOLD_DEFAULT_CHART_COLORS[k] = COLORS[k]; });
    function applyChartColorPaletteForTheme() {
        const source = currentTheme === 'fintech' ? FINTECH_CHART_OVERRIDES : GOLD_DEFAULT_CHART_COLORS;
        Object.keys(source).forEach(k => { COLORS[k] = source[k]; });
    }

    // Tier-1 chart type catalog (TradingView "Çubuklar" menu parity). Each
    // entry drives both the dropdown UI (label/icon) and applyChartType().
    const CHART_TYPES = [
        { id: 'candles',      label: 'Mumlar' },
        { id: 'hollow',       label: 'İçi Boş Mumlar' },
        { id: 'bars',         label: 'Sütunlar' },
        { id: 'line',         label: 'Çizgi' },
        { id: 'step_line',    label: 'Adım Çizgisi' },
        { id: 'area',         label: 'Alan' },
        { id: 'baseline',     label: 'Temel Çizgi' },
        { id: 'heikin_ashi',  label: 'Heikin Ashi' }
    ];

    // Resolution selector (functional, not decorative) — the underlying data
    // is always daily bars, so 'intraday' entries are synthesized client-side
    // via DataController.synthesizeIntradayCandles() and 'weekly' is an
    // OHLC roll-up via aggregateWeeklyCandles(). See dataController.js's
    // "Timeframe Resolution Engine" section for the full explanation.
    const RESOLUTIONS = [
        { id: '15m', kind: 'intraday', minutes: 15 },
        { id: '1h',  kind: 'intraday', minutes: 60 },
        { id: '4h',  kind: 'intraday', minutes: 240 },
        { id: '1d',  kind: 'daily' },
        { id: '1w',  kind: 'weekly' }
    ];

    // (19 Temmuz 2026, on ikinci oturum — "tam geçmiş erişimi") Backend
    // artık /api/v1/ohlcv için period="max" istiyor (bkz. main.py), yani
    // state.dailyCandles bazı semboller için binlerce güne kadar uzayabilir.
    // 1D/1W görünümleri bu TAM geçmişi kullanıyor (asıl istenen buydu), ama
    // dakikalık/saatlik sentetik mumları yıllarca geriye götürmenin hiçbir
    // anlamı yok — hem anlamsız (kimse 10 yıl önceki "15 dakikalık" mumla
    // ilgilenmez) hem de gereksiz yere ağır olurdu. İntraday senteleme bu
    // yüzden her zaman son N günlük bir dilimden türetiliyor.
    const INTRADAY_SOURCE_WINDOW_DAYS = 90;

    // (22 Temmuz 2026, on ikinci oturum — "grafik boşlukları/incelmiş mumlar"
    // incelemesi) fitContent() intraday çözünürlüklerde (15dk/1sa/4sa) TÜM
    // 90 günlük türetilmiş seriyi (4sa'da ~180, 1sa'da ~720, 15dk'da ~2880
    // bar) tek ekrana sığdırmaya çalışıyordu — bu, her mumu aşırı derecede
    // ince/sıkıştırılmış hale getirip (özellikle düşük oynaklıklı dönemlerde
    // neredeyse görünmez), kullanıcıya "boşluk varmış" gibi bir izlenim
    // verebiliyordu (aslında veri eksik değil, sadece piksel başına çok
    // fazla bar düşüyor). Şimdi intraday'e geçilince varsayılan görünüm son
    // birkaç günlük bir pencereye odaklanıyor — her mum rahat bir genişlik
    // kazanıyor; kullanıcı yine de dilerse manuel olarak dışarı zoom
    // yapabilir (fitContent() gibi TAM veriyi engellemiyor, sadece
    // BAŞLANGIÇ görünümünü makul bir varsayılana çekiyor).
    const DEFAULT_INTRADAY_VISIBLE_BARS = 60;

    // Lightweight Charts renders to <canvas> internally, so its background/
    // text/grid colors are set via JS options, not CSS — this mirrors the
    // page's [data-theme] attribute (read once at load; kept in sync by
    // setTheme() whenever the user toggles the theme).
    const THEME_CHART_COLORS = {
        dark: { bg: '#1E1E1E', text: '#888888', grid: 'rgba(255,255,255,0.04)', border: 'rgba(212,175,55,0.15)' },
        light: { bg: '#FFFFFF', text: '#5A5D63', grid: 'rgba(20,22,28,0.07)', border: 'rgba(184,134,11,0.22)' },
        // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü)
        // FinTeClub admin panelinin --bg-soft (#0a1020) zeminiyle, kenarlık
        // FinTeClub --blue'suyla eşleşiyor.
        fintech: { bg: '#0a1020', text: '#8b93ab', grid: 'rgba(255,255,255,0.04)', border: 'rgba(61,111,238,0.20)' }
    };
    function resolveThemeName(v) {
        return (v === 'light' || v === 'fintech') ? v : 'dark';
    }
    let currentTheme = resolveThemeName(document.documentElement.getAttribute('data-theme'));

    let chart = null;
    let candleSeries = null;      // always-present OHLC series; the price-scale anchor
                                   // for coordinate<->price conversions and drawing tools.
                                   // Hidden (visible:false) whenever an alternate chart
                                   // type (bars/line/area/baseline) is active.
    let typeSeries = null;        // the currently visible alt-type series, or null when
                                   // chartType is 'candles' | 'hollow' | 'heikin_ashi'
                                   // (those render directly on candleSeries).
    let volumeSeries = null;      // optional volume histogram, own price scale
    let overlaySeries = {};       // { sma20: LineSeries, ... }
    let pivotPriceLines = [];     // Pivot Points createPriceLine() handles — candleSeries
                                   // kalıcı olduğu için her renderOverlays() çağrısında
                                   // manuel temizlenmesi gerekir (removeSeries() geçerli değil).

    // ── Çoklu-osilatör paneli (18 Temmuz 2026, onuncu oturum) ──
    // Artık aynı anda birden fazla gösterge (RSI + MACD + ADX vb.) aktif
    // olabiliyor; her biri KENDİ hafif LightweightCharts örneğini alıyor
    // (tek bir paylaşılan subChart yerine), tıpkı Dual-Chart panelinde
    // olduğu gibi "singleton'ı çoğaltma" riskinden kaçınmak için ayrı,
    // sade örnekler kullanıyoruz. Anahtar = osilatör id'si (rsi/macd/...).
    // Değer = { el: <.tv-osc-pane DOM>, chart: LightweightCharts, series: {} }.
    let oscillatorPanes = {};

    const ACTIVE_OSC_STORAGE_KEY = 'optipulselab_active_oscillators_v1';
    const OSCILLATOR_META = {
        rsi:   { title: 'RSI (14)' },
        macd:  { title: 'MACD (12,26,9)' },
        stoch: { title: 'Stochastic (14,3)' },
        atr:   { title: 'ATR (14)' },
        adx:   { title: 'ADX (14)' },
        obv:   { title: 'OBV' },
        willr: { title: 'Williams %R (14)' },
        cci:   { title: 'CCI (20)' },
        mfi:   { title: 'MFI (14)' }
    };

    // (2 Ağustos 2026 — revize planı madde 7) Osilatör kimlikleri artık iki
    // biçimde olabilir: sade tip adı ("rsi" → varsayılan periyot 14) ya da
    // "tip:periyot" biçiminde özel periyotlu bir örnek ("rsi:20" gibi) — bu
    // sayede aynı osilatör tipinden birden fazla, farklı periyotlarda panel
    // aynı anda açık kalabiliyor (kullanıcı isteği: "iki farklı değerde rsi
    // değerlerini görebilmek"). parseOscType() bu iki biçimi ayrıştırır.
    function parseOscType(id) {
        const s = String(id || '');
        const idx = s.indexOf(':');
        if (idx === -1) return { base: s, period: null };
        const period = parseInt(s.slice(idx + 1), 10);
        return { base: s.slice(0, idx), period: Number.isFinite(period) ? period : null };
    }

    function loadActiveOscillators() {
        try {
            const raw = localStorage.getItem(ACTIVE_OSC_STORAGE_KEY);
            if (!raw) return ['rsi'];
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length) {
                const filtered = arr.filter(id => OSCILLATOR_META[parseOscType(id).base]);
                return filtered.length ? filtered : ['rsi'];
            }
            return ['rsi'];
        } catch (e) { return ['rsi']; }
    }

    function saveActiveOscillators() {
        try { localStorage.setItem(ACTIVE_OSC_STORAGE_KEY, JSON.stringify(state.activeOscillators)); } catch (e) {}
    }

    let drawCanvas = null;
    let drawCtx = null;
    let chartContainer = null;

    // ── Dual-Chart companion pane (18 Temmuz 2026, onuncu oturum) ──
    // Deliberately simple/read-only (no drawing tools, no overlay indicators)
    // for the same architectural-risk reason documented in multiChartGrid.js:
    // duplicating the full singleton chart/drawing engine for a second pane
    // is far riskier than it's worth. Varsayılan olarak AYNI sembolü ana
    // panelle bağımsız bir çözünürlükte gösterir ("ayna" modu).
    // (22 Temmuz 2026, on ikinci oturum, ikinci tur — kullanıcı isteği)
    // Artık dualSymbol set edilirse FARKLI bir sembol de seçilebiliyor —
    // gerçek anlamda "karşılaştırma". dualSymbol null iken davranış
    // ESKİSİYLE BİREBİR AYNI (ana grafiği takip eder); bu yüzden mevcut
    // hiçbir çağrı yeri bozulmadı, yalnızca yeni bir opsiyonel yol eklendi.
    let dualChart = null;
    let dualSeries = null;
    let dualActive = false;
    let dualResolution = '1w';
    let dualRefreshTimer = null;
    let dualOverlaySeries = {};
    // (29 Temmuz 2026 — "Dual-chart panelinde bağımsız gösterge desteği")
    // 2 sabit göstergeden (SMA20/EMA9) 6'ya genişletildi — hâlâ ana
    // grafiğin 14 checkbox'lı tam motorunu ÇOĞALTMIYOR, ama artık dual
    // panelin KENDİ bağımsız sembol/çözünürlük çiftinde anlamlı bir
    // gösterge seti sunuyor (bkz. refreshDualOverlays()).
    let dualOverlayActive = { sma20: false, sma50: false, ema9: false, ema21: false, bollinger: false, vwap: false };
    // Dual panelin kendi osilatör mini-panelleri (RSI/MACD/Stoch/ATR) —
    // ana grafiğin state.activeOscillators/oscillatorPanes'ının bire bir
    // paraleli, ama tamamen ayrı bir liste/konteyner (bkz.
    // ensureDualOscillatorPane()/renderDualOscillatorPanes()). Kasıtlı
    // olarak localStorage'a YAZILMIYOR (main.js'teki gibi kalıcı değil) —
    // dual-chart zaten varsayılan kapalı bir panel, her açılışta sade
    // başlaması daha öngörülebilir.
    let dualActiveOscillators = [];
    let dualOscillatorPanes = {};
    // dualSymbol/dualResolution çiftinin TAM calculateIndicators() çıktısı
    // — hem overlay hem osilatör render'ı bundan besleniyor, ikisi de aynı
    // hesaplamayı tekrar yapmasın diye refreshDualChart() içinde bir kez
    // hesaplanıp burada tutuluyor.
    let dualIndicators = null;
    let dualLastRenderedCandles = []; // { time, open, high, low, close } — dualOverlays/dualOscillators bu diziyi paylaşır
    let dualSymbol = null;          // null = "ayna modu" (ana sembolü takip eder); aksi halde karşılaştırma sembolü
    let dualDailyCandles = [];      // dualSymbol set edildiğinde onun BAĞIMSIZ günlük mum verisi
    let dualSymbolLoadToken = 0;    // hızlı ardışık sembol değişimlerinde eski bir fetch'in geç gelip yeniyi ezmesini önler
    // (29 Temmuz 2026 — "BIST100 Endeksi ile Göreceli Güç") XU100, backend'in
    // format_ticker()'ı tarafından otomatik olarak "XU100.IS"e çevriliyor —
    // bu GERÇEK Yahoo Finance BIST100 endeks sembolü (yfinance'te gerçekten
    // var), STOCK_PROFILES'taki 97 hisseden biri DEĞİL. setDualSymbol()
    // içinde bu yüzden ayrı bir istisna listesiyle tanınıyor.
    const SPECIAL_DUAL_SYMBOLS = { XU100: 'BIST100 Endeksi' };

    // ── Fullscreen chart mode (18 Temmuz 2026, onuncu oturum) ──
    let fullscreenActive = false;

    let state = {
        ticker: null,
        loadSeq: 0,             // (25 Ağustos 2026 — sembol geçişi yarış durumu
                                // düzeltmesi) her loadSymbol() çağrısında artırılan
                                // sayaç; bir yükleme başladıktan sonra daha yenisi
                                // başlarsa eskisi kendini "geçersiz" olarak tanır.
        dataReady: false,       // true olana kadar candles/dailyCandles GÜVENİLİR
                                // değildir — canlı tik güncellemeleri bu bayrak
                                // false iken diziye yazmayı reddeder (bkz.
                                // updateLastPrice).
        candles: [],           // the currently DISPLAYED resolution's candles (derived)
        dailyCandles: [],      // source-of-truth daily candles (fetched or generated)
        resolution: '1d',      // '15m' | '1h' | '4h' | '1d' | '1w'
        priceScaleMode: 'normal', // 'normal' | 'log'
        indicators: null,
        activeOscillators: loadActiveOscillators(),
        chartType: 'candles',
        showVolume: false,
        activeTool: 'cursor',
        magnetMode: false,
        drawingsLocked: false,
        drawingsHidden: false,
        drawings: [],          // committed shapes
        pendingShape: null,    // in-progress shape while dragging
        pendingPoints: null,   // accumulated points for multi-click tools (channel/triangle/position)
        // (29 Temmuz 2026 — Madde 14 "Cetvel düzeltilsin") Ölçüm aracının
        // SONUCU — eskiden diğer tüm araçlar gibi state.drawings'e KALICI
        // olarak ekleniyordu (bir trend çizgisi gibi grafikte kalıyor, elle
        // silinmesi gerekiyordu ve HER ölçümden sonra araç "İmleç"e dönüyordu,
        // art arda ölçüm yapmak için tekrar tekrar araç seçmek gerekiyordu —
        // gerçek bir cetvel/ölçüm aracının davranışı bu değil). Artık ayrı,
        // GEÇİCİ bir alanda tutuluyor: state.drawings'e hiç eklenmiyor (Tümünü
        // Sil/kopyala-yapıştır/geri al onu hiç görmüyor), araç seçili kaldığı
        // sürece ekranda kalıyor ve yeni bir ölçüme başlanınca ya da araç
        // değişince temizleniyor.
        measureShape: null,
        selectedDrawingIndex: -1,
        dayOpenPrice: null,
        resSeq: 0,              // (27 Ağustos 2026 — gerçek gün-içi veri yükseltmesi)
                                // her setResolution()/loadSymbol() çağrısında artırılır;
                                // asenkron gerçek-veri getirimi tamamlandığında hâlâ
                                // aynı sembol/çözünürlükte miyiz diye bunun ile
                                // karşılaştırılır — eskiyse sonuç sessizce atılır.

        // (22 Temmuz 2026, on ikinci oturum, üçüncü tur) Sinyal Anlatıcısı +
        // Strateji Tekrarı ("zaman makinesi") — bkz. bu dosyanın altındaki
        // ilgili bölümler. signalMarkers, state.candles her değiştiğinde
        // (applyResolution) TAM geçmişten yeniden hesaplanır; açık/kapalı
        // gösterimi setMarkers ile ayrıca uygulanır.
        signalExplainerOn: false,
        signalMarkers: [],
        replayActive: false,
        replayIndex: 0,
        replayPlaying: false,
        replaySpeed: 1,
        replayPrevExplainerOn: false
    };

    let copiedDrawing = null;

    // (19 Temmuz 2026, on ikinci oturum — çizim "taşıma" özelliği) Seçili bir
    // çizime cursor aracıyla basıp sürüklemek onu kopyalamadan/silmeden
    // olduğu yerde taşır. moveDrag, sürükleme başladığı andaki orijinal
    // şeklin (JSON klonu) + başlangıç mum-indeksi/fiyatını tutar; her
    // mousemove'da o ANDAKI imleç konumuyla başlangıç arasındaki fark
    // (indexDelta/priceDelta) orijinal şekle uygulanıp state.drawings'e
    // yazılır — böylece hata birikmeden (drift) her adımda orijinalden tutarlı
    // şekilde hesaplanır, art arda küçük yuvarlama hatalarının toplanması
    // önlenir.
    let moveDrag = null;

    // (23 Temmuz 2026, on üçüncü oturum devamı — eğim/uç nokta düzenleme)
    // Seçili bir çizimin köşe tutamaçlarından (zaten drawShape() içinde
    // isSelected iken çizilen 7x7'lik kareler) birine basıp sürüklemek,
    // moveDrag'in aksine TÜM şekli değil SADECE o tek uç noktayı taşır —
    // diğer uç nokta olduğu yerde sabit kalır. Bu, bir trend çizgisinin (ya
    // da herhangi iki-noktalı bir çizimin) EĞİMİNİ değiştirmeyi sağlar.
    // `original`, sürükleme başladığı andaki şeklin JSON klonudur; her
    // mousemove'da güncel imleç konumu SADECE `which` alanına yazılıp diğer
    // uç nokta `original`dan hiç değişmeden korunur (drift birikmesin diye
    // moveDrag'deki gibi hep orijinalden yeniden hesaplanır).
    let endpointDrag = null;

    // Per-symbol drawing persistence so switching between multi-chart tabs
    // doesn't discard a symbol's trend lines / fib levels / rectangles.
    const drawingsBySymbol = {};

    /* ────────── Utilities ────────── */

    function $(sel) { return document.querySelector(sel); }
    function byId(id) { return document.getElementById(id); }

    function fmtPrice(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        return v >= 1000 ? v.toFixed(0) : v.toFixed(2);
    }

    /* ────────── Init ────────── */

    function init() {
        if (!window.LightweightCharts) {
            console.error('[TradingChart] LightweightCharts library not loaded.');
            return;
        }

        // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü)
        // setTheme() finteclubBridge.js'in ilk snapshot'ında (async, sayfa
        // yüklendikten biraz sonra) ya da tradingEngine.js'in kendi
        // kurulumunda (setupThemeToggle) çağrılıyor olsa da, HANGİSİNİN önce
        // çalışacağı script yükleme sırasına bağlı — COLORS'un candleSeries
        // oluşturulmadan ÖNCE doğru temaya göre ayarlandığından emin olmak
        // için burada da (ayrıca, zararsızca) uygulanıyor.
        applyChartColorPaletteForTheme();

        chartContainer = byId('tv-main-chart');
        if (!chartContainer) {
            console.error('[TradingChart] Chart mount points not found in DOM.');
            return;
        }

        chart = LightweightCharts.createChart(chartContainer, baseChartOptions(chartContainer));
        candleSeries = chart.addCandlestickSeries({
            upColor: COLORS.up,
            downColor: COLORS.down,
            borderUpColor: COLORS.up,
            borderDownColor: COLORS.down,
            wickUpColor: COLORS.wickUp,
            wickDownColor: COLORS.wickDown
        });

        // Sync every active oscillator pane's time scale to the main chart.
        // Each pane also pushes its own range back onto the main chart (wired
        // per-pane in ensureOscillatorPane()), so scrolling/zooming any one
        // of them keeps all panes + the main chart lined up together.
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range) {
                Object.values(oscillatorPanes).forEach(p => {
                    if (p.chart) p.chart.timeScale().setVisibleLogicalRange(range);
                });
            }
            redrawDrawings();
            // (23 Temmuz 2026 düzeltmesi) Yakınlaştırma/kaydırma sırasında
            // görünür bar seti değişince fiyat ekseni de otomatik yeniden
            // ölçekleniyor (autoscale) — bu ölçeklemenin dahili olarak bu
            // callback'ten hemen sonraki karede tamamlanma ihtimaline karşı
            // (kütüphanenin kendi render/scale döngüsü senkron olmayabilir),
            // bir sonraki animasyon karesinde İKİNCİ bir redrawDrawings()
            // daha planlanıyor — çizim katmanının GÜNCEL fiyat eksenine göre
            // konumlanmasını garantiliyor, ucuz ve zararsız bir önlem.
            requestAnimationFrame(() => redrawDrawings());
        });

        // Crosshair -> OHLC legend
        chart.subscribeCrosshairMove(handleCrosshairMove);
        // (22 Temmuz 2026, on ikinci oturum, üçüncü tur) Sinyal Anlatıcısı:
        // bir AL/SAT ok işaretine tıklanınca açıklama balonunu açar.
        chart.subscribeClick(handleChartSignalClick);

        setupDrawCanvas();
        setupToolbar();
        setupChartTypeMenu();
        setupHeaderMenu();
        setupResolutionBar();
        setupPriceScaleToggle();
        setupOscillatorCheckboxes();
        setupOverlayCheckboxes();
        setupIndicatorModal();
        setupDrawingSelection();
        setupResize();
        setupDualChartControls();
        setupFullscreenControl();
        setupRailCollapse();
        setupSubpanesContainer();
        setupSignalExplainerToggle();
        setupSignalTooltipDismiss();
        setupReplayControls();
        setupChartNoteModal();

        window.addEventListener('resize', () => {
            resizeAll();
            redrawDrawings();
            requestAnimationFrame(() => redrawDrawings());
        });
    }

    function baseChartOptions(container, isSub) {
        const c = THEME_CHART_COLORS[currentTheme];
        // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü)
        // Çapraz imleç rengi önceden altın olarak sabitti; artık COLORS.draw'a
        // bağlı (aynı applyChartColorPaletteForTheme() mutasyonu bunu da
        // günceller).
        const crosshairColor = currentTheme === 'fintech' ? 'rgba(61,111,238,0.35)' : 'rgba(212,175,55,0.35)';
        const crosshairLabelBg = COLORS.draw;
        return {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: {
                background: { color: c.bg },
                textColor: c.text,
                fontFamily: "'Fira Code', monospace"
            },
            grid: {
                vertLines: { color: c.grid },
                horzLines: { color: c.grid }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: crosshairColor, width: 1, style: 3, labelBackgroundColor: crosshairLabelBg },
                horzLine: { color: crosshairColor, width: 1, style: 3, labelBackgroundColor: crosshairLabelBg }
            },
            rightPriceScale: {
                borderColor: c.border,
                scaleMargins: isSub ? { top: 0.15, bottom: 0.05 } : { top: 0.08, bottom: 0.02 }
            },
            timeScale: {
                borderColor: c.border,
                timeVisible: false,
                secondsVisible: false,
                visible: !isSub ? false : true, // main chart hides its own time axis; sub-chart shows the shared axis
                // (3 Ağustos 2026 — kullanıcı/hoca geri bildirimi: "çizgi sağa
                // gitmiyor") Önceden rightOffset hiç ayarlanmamıştı (varsayılan
                // 0) — bu da son mumun grafığın SAĞ KENARINA TAM OTURMASI,
                // ötesinde hiç boş alan olmaması anlamına geliyordu. Bir trend
                // çizgisini/hedef çizgisini son mumun ÖTESİNE (geleceğe doğru)
                // sürüklemek isteyen kullanıcı için görsel olarak sürükleyecek
                // hiç yer yoktu. 20 barlık boş alan bırakarak (TradingView'daki
                // standart davranışla tutarlı) çizimlerin geleceğe doğru
                // uzatılabileceği bir alan açılıyor — aşağıdaki
                // pixelToDataPoint()/dataPointToPixel()/indexForTime()/
                // translateShapePoints() değişiklikleriyle birlikte çalışır.
                rightOffset: 20
            },
            handleScroll: true,
            handleScale: true
        };
    }

    /* ────────── Symbol loading ────────── */

    // Fetches real OHLCV from the local backend, parses it, and returns
    // null on any failure so the caller can fall back to simulated data.
    //
    // Root-cause note (17 Temmuz 2026, altıncı oturum): the backend's own
    // yfinance call uses a 10s internal timeout (main.py `timeout=10`), but
    // this fetch previously aborted after only 6s — meaning a perfectly
    // healthy backend that just took 6-10s to answer (very common: yfinance
    // needs an extra few seconds on its very first request after the backend
    // starts, to fetch an auth "crumb" from Yahoo — and can be slow again
    // under Yahoo-side rate limiting) got treated as "failed" and the app
    // silently fell back to simulated prices, even though nothing was
    // actually broken. Fixed by (a) raising the client timeout to 12s so it
    // comfortably exceeds the backend's own 10s timeout, and (b) adding one
    // automatic retry after a short pause before giving up — a single slow
    // response no longer permanently reads as "backend down" for that
    // symbol selection.
    async function fetchOhlcvWithRetry(ticker) {
        const attempt = async (timeoutMs) => {
            const res = await fetch(`${window.OPTIPULSE_CONFIG.BACKEND_HTTP}/api/v1/ohlcv/${ticker}`, window.optipulseFetchOpts({ signal: AbortSignal.timeout(timeoutMs) }));
            if (!res.ok) return null;
            const json = await res.json();
            if (!json || !Array.isArray(json.data) || json.data.length <= 5) return null;
            return json.data.map(r => ({
                date: parseBackendDate(r.Date),
                open: Number(r.Open || 0),
                high: Number(r.High || 0),
                low: Number(r.Low || 0),
                close: Number(r.Close || 0),
                volume: Number(r.Volume || 0)
            })).filter(c => c.date !== null);
        };

        try {
            // (19 Temmuz 2026, on ikinci oturum) Backend'in kendi yfinance
            // zaman aşımı "3mo" -> "max" geçişiyle 10sn'den 15sn'ye çıkarıldı
          // (period="max" bazı semboller için çok daha fazla satır çekiyor,
            // biraz daha uzun sürebilir) — istemci zaman aşımı da altıncı
            // oturumdaki "istemci > backend" ilkesiyle tutarlı kalması için
            // 12sn'den 18sn'ye çıkarıldı.
            const first = await attempt(18000);
            if (first) return first;
        } catch (err) {
            console.warn('[TradingChart] Backend OHLCV fetch (1st attempt) failed:', err.message || err);
        }

        // One retry after a short pause — covers transient hiccups (Yahoo
        // rate-limiting, a slow first crumb fetch) without hammering a
        // genuinely offline backend.
        await new Promise(r => setTimeout(r, 700));
        try {
            const second = await attempt(18000);
            if (second) return second;
        } catch (err) {
            console.warn('[TradingChart] Backend OHLCV fetch (retry) failed, falling back to simulated data:', err.message || err);
        }
        return null;
    }

    // (26 Temmuz 2026, on üçüncü oturum devamı — "hızlandırma: sembol
    // geçmişi önbelleği") Önceden her sembol seçiminde (aynı sembole geri
    // dönülse bile) fetchOhlcvWithRetry() TAM geçmişi (period=max, bazı
    // semboller için binlerce satır) sıfırdan yeniden indiriyordu — bir
    // önceki oturumda "REST+WS paralelleştirme" seçilirken bu madde
    // (istemci-taraf önbelleği) kasıtlı olarak ERTELENMİŞTİ, kullanıcı bu
    // oturumda ayrıca istedi. Basit bir bellek-içi (yalnızca bu sekme
    // ömrü boyunca — localStorage'a YAZILMIYOR) TTL'li önbellek: aynı
    // sembole 3 dakika içinde tekrar dönülürse ağa hiç gidilmez, önceki
    // sonuç doğrudan kullanılır. TTL süresi dolunca normal şekilde tekrar
    // ağdan çekilir — böylece uzun süre sonra dönüldüğünde veri bayatlamaz.
    // Yalnızca GERÇEK bir backend yanıtı önbelleğe alınır (`fresh` null ya
    // da çok kısaysa hiç yazılmaz) — bu sayede backend geçici olarak
    // erişilemezken üretilen sentetik yedek veri asla "önbelleklenmiş
    // gerçek veri" gibi davranmaz, bir sonraki seçimde yine gerçek veri
    // denenir.
    const SYMBOL_HISTORY_CACHE_TTL_MS = 3 * 60 * 1000;
    const symbolHistoryCache = new Map(); // ticker -> { candles, ts }

    async function fetchOhlcvCached(ticker) {
        const cached = symbolHistoryCache.get(ticker);
        if (cached && (Date.now() - cached.ts) < SYMBOL_HISTORY_CACHE_TTL_MS) {
            return cached.candles;
        }
        const fresh = await fetchOhlcvWithRetry(ticker);
        if (fresh && fresh.length >= 5) {
            symbolHistoryCache.set(ticker, { candles: fresh, ts: Date.now() });
        }
        return fresh;
    }

    /* ────────── Gerçek gün-içi (intraday) veri (27 Ağustos 2026) ──────────
     * "TradingView'daki mum bendekiyle aynı değil" geri bildirimi üzerine:
     * 15dk/1sa/4sa görünümleri ÖNCEDEN her zaman TAMAMEN sentetikti (bkz.
     * dataController.js → synthesizeIntradayCandles, sadece günlük
     * açılış/kapanış/en yüksek/en düşük'e sadık kalan rastgele bir "Brownian
     * bridge"). Backend artık ?interval=15m/60m ile GERÇEK Yahoo Finance
     * gün-içi verisi de sunuyor (bkz. main.py) — ama Yahoo'nun izin verdiği
     * geriye dönük pencereyle sınırlı (15dk için ~60 gün, 60dk için ~730 gün).
     * Bu yüzden strateji şu: o pencerenin İÇİNDEKİ (yakın geçmiş) barlar için
     * GERÇEK veri, DIŞINDAKİ (daha eski) barlar için ESKİ sentetik yöntem
     * aynen kullanılmaya devam ediyor — ikisi tek bir dizide birleştiriliyor.
     * Gerçek veri çekimi her zaman ASENKRON ve BEST-EFFORT: başarısız olursa
     * (ağ hatası, Yahoo rate-limit, zaman aşımı) sessizce tamamen sentetik
     * eski davranışa dönülüyor — hiçbir durumda grafik boş kalmıyor ya da
     * hataya düşmüyor.
     */
    const INTRADAY_REAL_CACHE_TTL_MS = 5 * 60 * 1000; // backend'in kendi 300sn'lik önbelleğiyle uyumlu
    const intradayRealCache = new Map(); // `${ticker}:${backendInterval}` -> { candles, ts }

    // Backend/main.py intraday satırları artık her zaman UTC'ye çevrilip
    // "...+00:00" son ekiyle ISO 8601 olarak geliyor (bkz. main.py 27 Ağustos
    // notu) — bu format tarayıcının yerel saat dilimine bakılmaksızın
    // `Date.parse` ile HER ZAMAN doğru/tekil şekilde ayrıştırılır (parseBackendDate'in
    // günlük barlar için elle Date.UTC() kullanmasının nedeni olan "ofset
    // içermeyen string" belirsizliği burada yok, çünkü offset her zaman AÇIK).
    function parseBackendDateTime(rawDate) {
        const t = Date.parse(String(rawDate || ''));
        return isNaN(t) ? null : Math.floor(t / 1000);
    }

    async function fetchIntradayReal(ticker, backendInterval) {
        const cacheKey = `${ticker}:${backendInterval}`;
        const cached = intradayRealCache.get(cacheKey);
        if (cached && (Date.now() - cached.ts) < INTRADAY_REAL_CACHE_TTL_MS) {
            return cached.candles;
        }
        try {
            const res = await fetch(
                `${window.OPTIPULSE_CONFIG.BACKEND_HTTP}/api/v1/ohlcv/${ticker}?interval=${backendInterval}`,
                window.optipulseFetchOpts({ signal: AbortSignal.timeout(15000) })
            );
            if (!res.ok) return null;
            const json = await res.json();
            if (!json || !Array.isArray(json.data) || json.data.length < 3) return null;
            const rows = json.data.map(r => ({
                date: parseBackendDateTime(r.Date),
                open: Number(r.Open || 0),
                high: Number(r.High || 0),
                low: Number(r.Low || 0),
                close: Number(r.Close || 0),
                volume: Number(r.Volume || 0)
            })).filter(c => c.date !== null && c.close > 0);
            if (rows.length < 3) return null;
            intradayRealCache.set(cacheKey, { candles: rows, ts: Date.now() });
            return rows;
        } catch (e) {
            console.warn(`[TradingChart] Gerçek gün-içi veri (${backendInterval}) alınamadı, sentetik veriye devam ediliyor:`, e.message || e);
            return null;
        }
    }

    // Yahoo'da 4 saatlik (4h) doğrudan bir interval yok — gerçek 60dk
    // barlarını, BIST seansı içinde (10:00-18:00 TRT = 07:00-15:00 UTC) her
    // takvim gününde ardışık 4'erli gruplara ayırarak türetiyoruz. Bu,
    // synthesizeIntradayCandles'ın 4sa için ürettiği "günde 2 bar" şeklini
    // birebir yansıtır (BIST_SESSION_MINUTES/240 = 2).
    function aggregateHourlyTo4H(hourlyCandles) {
        if (!Array.isArray(hourlyCandles) || !hourlyCandles.length) return [];
        const DAY_SECONDS = 86400;
        const byDay = new Map(); // dayStart -> bars[] (o günün barları, zaman sırasıyla)
        hourlyCandles.forEach(c => {
            const dayStart = Math.floor(c.date / DAY_SECONDS) * DAY_SECONDS;
            if (!byDay.has(dayStart)) byDay.set(dayStart, []);
            byDay.get(dayStart).push(c);
        });
        const out = [];
        Array.from(byDay.keys()).sort((a, b) => a - b).forEach(dayStart => {
            const bars = byDay.get(dayStart).sort((a, b) => a.date - b.date);
            for (let i = 0; i < bars.length; i += 4) {
                const group = bars.slice(i, i + 4);
                out.push({
                    date: group[0].date,
                    open: group[0].open,
                    high: Math.max(...group.map(b => b.high)),
                    low: Math.min(...group.map(b => b.low)),
                    close: group[group.length - 1].close,
                    volume: group.reduce((s, b) => s + (b.volume || 0), 0)
                });
            }
        });
        return out;
    }

    // Verilen çözünürlük için GERÇEK gün-içi mumları getirir (varsa) — 15dk
    // ve 1sa doğrudan backend'den, 4sa ise 1sa barlarının agregasyonundan.
    // Başarısız olursa (Yahoo'nun penceresi dışı, ağ hatası vb.) null döner
    // — çağıran taraf bu durumda MEVCUT sentetik türetimi aynen kullanmaya
    // devam eder, hiçbir davranış bozulmaz.
    async function fetchRealCandlesForResolution(ticker, resId) {
        if (resId === '15m') {
            return await fetchIntradayReal(ticker, '15m');
        }
        if (resId === '1h') {
            return await fetchIntradayReal(ticker, '60m');
        }
        if (resId === '4h') {
            const hourly = await fetchIntradayReal(ticker, '60m');
            if (!hourly || hourly.length < 4) return null;
            const fourH = aggregateHourlyTo4H(hourly);
            return fourH.length >= 3 ? fourH : null;
        }
        return null;
    }

    // Gerçek gün-içi barlar (Yahoo'nun izin verdiği pencere kadar geriye
    // gider) ile eski sentetik barları (o pencereden ÖNCEKİ, daha eski
    // günler için) TEK bir zaman-sıralı diziye birleştirir. Sınırda çakışma
    // olursa (aynı takvim günü hem sentetik hem gerçek tarafta üretilmişse)
    // gerçek veri her zaman KAZANIR — sentetik tarafın o güne ait barları
    // elenir.
    function mergeRealWithSynthetic(realCandles, syntheticCandles) {
        if (!realCandles || !realCandles.length) return syntheticCandles;
        const firstRealDate = realCandles[0].date;
        const olderSynthetic = (syntheticCandles || []).filter(c => c.date < firstRealDate);
        return olderSynthetic.concat(realCandles);
    }

    // (18 Temmuz 2026, onuncu oturum, beşinci tur — "şirket temel verileri")
    // F/K, piyasa değeri, temettü verimi — backend'in yeni /api/v1/fundamentals
    // ucundan çekiliyor. Grafiğin kendisini HİÇ geciktirmiyor: loadSymbol()
    // içinde "await" edilmeden, ayrı bir kısa zaman aşımıyla çağrılıyor —
    // backend kapalıysa veya bu sembol için veri yoksa satır sessizce "--"
    // göstermeye devam eder, hiçbir hata kullanıcıya sızmaz (projedeki
    // "sessiz/gerçekçi yedek" ilkesiyle tutarlı, bkz. fetchOhlcvWithRetry).
    function formatMarketCap(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        return String(Math.round(v));
    }
    function formatPE(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        return Number(v).toFixed(1);
    }
    function formatDividendYield(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        // yfinance sürümüne göre dividendYield bazen kesir (0.032), bazen
        // zaten yüzde (3.2) olarak geliyor — backend'deki yorumda da
        // belirtildi. >1 olan değerleri "zaten yüzde" kabul ediyoruz.
        const pct = v > 1 ? v : v * 100;
        return pct.toFixed(2) + '%';
    }
    // (22 Temmuz 2026, on ikinci oturum, beşinci tur — hocanın isteği üzerine
    // eklendi) 52 haftalık aralık, ortalama hacim, beta, hisse başına kazanç.
    function formatPrice2(v) {
        if (v === null || v === undefined || isNaN(v)) return null;
        return '₺' + Number(v).toFixed(2);
    }
    function formatRange(low, high) {
        const lo = formatPrice2(low), hi = formatPrice2(high);
        if (!lo || !hi) return '--';
        return lo + ' - ' + hi;
    }
    function formatVolume(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
        return String(Math.round(v));
    }
    function formatBeta(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        return Number(v).toFixed(2);
    }
    function formatEps(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        return '₺' + Number(v).toFixed(2);
    }
    async function fetchFundamentals(ticker) {
        const peEl = document.getElementById('tv-fund-pe');
        const mcapEl = document.getElementById('tv-fund-mcap');
        const divEl = document.getElementById('tv-fund-div');
        const rangeEl = document.getElementById('tv-fund-range');
        const avgVolEl = document.getElementById('tv-fund-avgvol');
        const betaEl = document.getElementById('tv-fund-beta');
        const epsEl = document.getElementById('tv-fund-eps');
        if (!peEl || !mcapEl || !divEl) return;
        // Sembol değişir değişmez placeholder'a dön — önceki sembolün eski
        // verisi yeni fetch tamamlanana kadar ekranda asılı kalmasın.
        peEl.textContent = 'F/K: --';
        mcapEl.textContent = 'Piyasa Değeri: --';
        divEl.textContent = 'Temettü Verimi: --';
        if (rangeEl) rangeEl.textContent = '52 Hafta: --';
        if (avgVolEl) avgVolEl.textContent = 'Ort. Hacim: --';
        if (betaEl) betaEl.textContent = 'Beta: --';
        if (epsEl) epsEl.textContent = 'Hisse Başı Kazanç: --';
        try {
            const backendHttp = window.OPTIPULSE_CONFIG ? window.OPTIPULSE_CONFIG.BACKEND_HTTP : 'http://127.0.0.1:8000';
            const fetchOpts = window.optipulseFetchOpts
                ? window.optipulseFetchOpts({ signal: AbortSignal.timeout(8000) })
                : { signal: AbortSignal.timeout(8000) };
            const res = await fetch(`${backendHttp}/api/v1/fundamentals/${ticker}`, fetchOpts);
            if (!res.ok) return;
            const data = await res.json();
            if (state.ticker !== ticker) return; // kullanıcı bu sırada başka bir sembole geçtiyse eski veriyi yazma
            peEl.textContent = 'F/K: ' + formatPE(data.trailingPE);
            mcapEl.textContent = 'Piyasa Değeri: ₺' + formatMarketCap(data.marketCap);
            divEl.textContent = 'Temettü Verimi: ' + formatDividendYield(data.dividendYield);
            if (rangeEl) rangeEl.textContent = '52 Hafta: ' + formatRange(data.fiftyTwoWeekLow, data.fiftyTwoWeekHigh);
            if (avgVolEl) avgVolEl.textContent = 'Ort. Hacim: ' + formatVolume(data.averageVolume);
            if (betaEl) betaEl.textContent = 'Beta: ' + formatBeta(data.beta);
            if (epsEl) epsEl.textContent = 'Hisse Başı Kazanç: ' + formatEps(data.trailingEps);
        } catch (e) {
            // Sessizce yoksay — backend kapalıysa/erişilemezse satır "--"
            // göstermeye devam eder, bu bir hata değil beklenen bir durumdur.
        }
    }

    async function loadSymbol(ticker, cachedHint) {
        if (!chart || !candleSeries) {
            console.warn('[TradingChart] Chart not initialized (library failed to load?) — skipping loadSymbol.');
            return;
        }

        // Sembol değişirken tekrar modu anlamsız hale gelir (farklı bir
        // sembolün geçmişini gösteriyor olurduk) — sessizce iptal edilir,
        // birkaç satır sonra zaten bu sembol için tam yeniden çizim yapılacak.
        cancelReplayIfActive();

        // Persist the outgoing symbol's drawings so multi-tab switching
        // doesn't wipe a user's trend lines / fib levels on that symbol.
        if (state.ticker && state.ticker !== ticker) {
            drawingsBySymbol[state.ticker] = state.drawings;
        }

        state.ticker = ticker;
        // (25 Ağustos 2026 — sembol geçişi yarış durumu düzeltmesi) Bu
        // fonksiyon `await fetchOhlcvCached(ticker)` sırasında askıya alınıyor
        // (yüzlerce ms - birkaç saniye sürebilir). O sırada tradingEngine.js'in
        // periyodik/WS canlı tik güncellemeleri (updateLastPrice) hâlâ tetiklenmeye
        // devam ediyor ve `ticker === state.ticker` kontrolünden geçiyorlardı
        // (state.ticker az önce yukarıda güncellendi) — ama state.candles/
        // dailyCandles HÂLÂ ESKİ sembolün verisiydi. Sonuç: yeni sembolün fiyatı
        // eski sembolün mum dizisinin son barına yazılıyor, hem grafiği (aşırı
        // volatil/anlamsız görünen sentetik intraday barlar) hem de header'daki
        // %değişimi (iki farklı sembolün fiyatları karşılaştırıldığı için dev
        // yanlış bir yüzde) kısa süreliğine bozuyordu — gerçek veri gelince
        // "kendiliğinden düzeliyormuş" gibi görünüyordu. `mySeq` bunu önler:
        // updateLastPrice, kendi başladığı yüklemeden DAHA YENİ bir yükleme
        // varsa (state.loadSeq ilerlediyse) yazmayı reddeder.
        const mySeq = ++state.loadSeq;
        state.dataReady = false;
        // (27 Ağustos 2026, üçüncü hız turu — "ilk yüklemede beklemeyi
        // sıfırla") Önceden burada HER ZAMAN setSymbolHeader(ticker, null,
        // null) çağrılıp fiyat/yüzde alanı "Yükleniyor…" durumuna
        // düşürülüyordu — tam OHLCV geçmişi (Yahoo rate-limit'i yüzünden
        // bazen onlarca saniye) gelene kadar kullanıcı boş bir başlık
        // görüyordu. Oysa tradingEngine.js çağıran taraf, o sembol için
        // GERÇEK (izleme listesi/quotes senkronundan gelen — UYDURMA
        // DEĞİL) bir fiyat/dayOpen'ı zaten önbelleğe almış olabiliyor.
        // `cachedHint` verildiyse başlık ANINDA bu gerçek önbellek
        // değeriyle dolduruluyor — birkaç saniye bayat olabilir ama asla
        // sentetik/uydurma değil. Gerçek geçmiş gelip dataReady=true
        // olduktan sonra ilk canlı tik (updateLastPrice) zaten en güncel
        // değerle üzerine yazıyor, hiçbir ek temizlik gerekmiyor.
        if (cachedHint && typeof cachedHint.price === 'number' && typeof cachedHint.dayOpen === 'number' && cachedHint.dayOpen > 0) {
            setSymbolHeader(ticker, cachedHint.price, cachedHint.dayOpen);
        } else {
            setSymbolHeader(ticker, null, null);
        }
        fetchFundamentals(ticker); // fire-and-forget, chart yüklemesini beklemez

        let candles = await fetchOhlcvCached(ticker);

        // Bu arada daha yeni bir sembol seçimi başladıysa (kullanıcı hızlıca
        // başka bir sembole tıkladı), bu eski yüklemeyi burada sessizce iptal
        // et — state'e hiçbir şey yazma, en yeni yüklemenin işini bozma.
        if (mySeq !== state.loadSeq) return null;

        if (!candles || candles.length < 5) {
            // (19 Temmuz 2026, on ikinci oturum) Önceden burada sabit "90"
            // geçiliyordu — bu, dataController.js'in TRADING_DAYS varsayılanı
            // 750'ye çıkarılsa bile bu çağrı noktasını hiç etkilemiyordu
            // (asıl "tam geçmiş" isteğinin fallback yolda çalışmamasının kök
            // nedeni buydu). Artık `days` argümanı hiç verilmiyor, böylece
            // DataController.generateOHLCV kendi güncel TRADING_DAYS (750,
            // ~3 yıllık simüle geçmiş) varsayılanını kullanıyor.
            candles = window.DataController.generateOHLCV(ticker);
        }

        // Lightweight Charts requires strictly ascending unique time values
        const seen = new Set();
        const preDedupCount = candles.length;
        candles = candles.filter(c => {
            if (seen.has(c.date)) return false;
            seen.add(c.date);
            return true;
        }).sort((a, b) => a.date - b.date);

        // (22 Temmuz 2026, on ikinci oturum — "grafik boşlukları" incelemesi)
        // Bu dedup/sıralama koruması zaten vardı ama SESSİZCE çalışıyordu —
        // yinelenen/sırasız bir gün varsa hiçbir iz bırakmadan atılıyordu. Bu
        // durum, intraday (15dk/1sa/4sa) görünümde beklenmeyen bir günün
        // eksik kalmasına yol açabilir (synthesizeIntradayCandles yalnızca
        // state.dailyCandles'ta VAR OLAN günleri işler). Artık en azından
        // konsola uyarı düşüyor — bu, gerçek bir backend veri sorununu
        // (örn. yfinance'ın bazı BIST günleri için sağladığı yinelenen/
        // sırasız satırlar) sessizce gizlemek yerine görünür kılıyor.
        if (candles.length !== preDedupCount) {
            console.warn(`[TradingChart] ${ticker}: ${preDedupCount - candles.length} yinelenen/sırasız günlük mum atıldı (grafik "boşluk" görünümüne katkıda bulunabilir).`);
        }

        // Ardışık günler arasında normal hafta sonu/tatilin (≈2-4 gün) çok
        // ötesinde bir boşluk varsa, bu muhtemelen backend'in (yfinance)
        // bazı işlem günlerini hiç döndürmediği anlamına gelir — VERİ
        // UYDURULMUYOR (eksik günler doldurulmuyor), sadece tanı amaçlı
        // konsola not düşülüyor ki ileride "neden grafikte boşluk var"
        // sorusu tekrar sorulduğunda kanıt olsun.
        const GAP_WARN_DAYS = 5;
        for (let i = 1; i < candles.length; i++) {
            const gapDays = (candles[i].date - candles[i - 1].date) / 86400;
            if (gapDays > GAP_WARN_DAYS) {
                const d1 = new Date(candles[i - 1].date * 1000).toISOString().slice(0, 10);
                const d2 = new Date(candles[i].date * 1000).toISOString().slice(0, 10);
                console.warn(`[TradingChart] ${ticker}: ${d1} ile ${d2} arasında ${gapDays.toFixed(1)} günlük olağandışı bir veri boşluğu var (backend/yfinance kaynaklı olabilir).`);
            }
        }

        // `state.dailyCandles` is the permanent source of truth; `state.candles`
        // (set inside applyResolution()) is whatever the active resolution
        // derives from it — daily/weekly reuse it as-is, intraday explodes it.
        state.dailyCandles = candles;
        state.dayOpenPrice = candles.length ? candles[candles.length - 1].open : null;
        state.dataReady = true;

        applyResolution();

        // (27 Ağustos 2026) Sembol yüklenirken zaten gün-içi bir çözünürlükte
        // isek (ör. 4sa açıkken ASELS'ten AKBNK'a geçiliyor), yeni sembol için
        // de gerçek gün-içi veri yükseltmesini tetikle — aksi halde kullanıcı
        // çözünürlüğü elle değiştirmeden gerçek veriyi hiç görmezdi. (27
        // Ağustos 2026 — hız düzeltmesi) Artık DEBOUNCE'lı: kullanıcı hızlıca
        // başka bir sembole geçerse bu istek hiç ateşlenmeden iptal edilir.
        scheduleIntradayUpgrade(ticker, state.resolution);

        const last = candles[candles.length - 1];
        const prev = candles.length > 1 ? candles[candles.length - 2] : last;
        setSymbolHeader(ticker, last ? last.close : null, prev ? prev.close : null);

        state.drawings = drawingsBySymbol[ticker] ? drawingsBySymbol[ticker].slice() : [];
        state.selectedDrawingIndex = -1;
        // Bir önceki sembolün mum indekslerine göre hesaplanmış geçici ölçüm
        // yeni sembolde anlamsız kalır — sembol değişince temizleniyor.
        state.measureShape = null;
        redrawDrawings();

        // Hand the real last close back to the caller (TradingEngine) so its
        // simulated live-tick price walk can anchor to the actual fetched
        // price instead of a hardcoded fallback — otherwise the "Price
        // Action" backtest chart and this live chart would slowly disagree
        // on what the current price even is.
        //
        // (27 Ağustos 2026 — "izleme listesi/hızlı işlem paneli %0 gösteriyor,
        // grafik başlığı %15,99 gösteriyor" tutarsızlığı) `dayOpen` alanı
        // burada zaten vardı ama günün KENDİ `open`'ıydı — TradingView'ın
        // kullandığı "bir önceki gün kapanışı" referansı DEĞİL (setSymbolHeader
        // ve updateLastPrice'ın %değişim için kullandığı gerçek kaynak budur,
        // bkz. 25 Ağustos düzeltmesi). Ayrı bir `dailyPrevClose` alanı ekliyoruz
        // — AYNI hesap, tek bir yerde tekrar edilmiş: state.dailyCandles'ın
        // sondan bir önceki günü. tradingEngine.js'in selectSymbol() fonksiyonu
        // bunu artık priceProfiles[symbol].dayOpen'a yazıyor; böylece backend'in
        // /api/v1/quotes'u (Yahoo rate-limit yüzünden) başarısız olduğu anlarda
        // bile izleme listesi ve hızlı alım-satım paneli, grafiğin zaten
        // başarıyla çektiği AYNI günlük kapanış verisiyle tutarlı kalır.
        const dailyPrevCloseForInfo = state.dailyCandles.length > 1
            ? state.dailyCandles[state.dailyCandles.length - 2].close
            : (last ? last.open : null);
        return { ticker, lastClose: last ? last.close : null, dayOpen: last ? last.open : null, dailyPrevClose: dailyPrevCloseForInfo };
    }

    function getLastClose() {
        // Read from state.dailyCandles (not the resolution-derived
        // state.candles) so this stays correct no matter which resolution is
        // currently on screen — the last daily bar's close/open is always
        // the real "today" seed value the live-tick engine should anchor to.
        if (!state.dailyCandles.length) return null;
        const last = state.dailyCandles[state.dailyCandles.length - 1];
        return { ticker: state.ticker, lastClose: last.close, dayOpen: last.open };
    }

    // (29 Temmuz 2026 — "ATR bazlı akıllı Stop-Loss önerisi") Aktif sembol
    // için grafikte ZATEN hesaplanmış olan ATR(14)'ün en son (null olmayan)
    // değerini döndürür — bkz. dataController.js computeATR() (Wilder
    // düzeltmesi). tradingEngine.js risk hesaplayıcısı bunu SL mesafesi
    // önerisi için kullanıyor; yeni bir hesaplama/istek YAPMIYOR, mevcut
    // state.indicators'ı okuyor.
    function getLastATR() {
        if (!state.indicators || !Array.isArray(state.indicators.atr14)) return null;
        const arr = state.indicators.atr14;
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] !== null && arr[i] !== undefined) return arr[i];
        }
        return null;
    }

    // (29 Temmuz 2026 — Madde 20 "gösterge bazlı koşullu alarm") tradingEngine.js
    // içindeki checkIndicatorAlerts()'ın ihtiyaç duyduğu son iki bar'lık RSI/
    // EMA(20)/fiyat değerlerini döndürür — YENİ bir istek/hesaplama yapmıyor,
    // state.indicators'ta ZATEN hesaplanmış RSI(14)'ü (bkz. getLastATR ile aynı
    // desen) ve DataController.computeEMA() ile (calculateIndicators() ana
    // pipeline'ında yok, hocanın istediği tam "EMA 20" için burada özel olarak
    // hesaplanıyor) okuyor. Yalnızca AKTİF grafik sembolü için anlamlı —
    // RSI/EMA geçmiş mum verisi gerektiriyor ve bu yalnızca burada (o an
    // ekranda açık sembol) yüklü; tradingEngine.js bu kısıtı zaten biliyor
    // (bkz. ilgili yorum orada) ve alarmı yalnızca bu snapshot'ın symbol'üyle
    // eşleşen alarmlar için kontrol ediyor.
    function getIndicatorAlertSnapshot() {
        if (!state.ticker || !state.candles || state.candles.length < 2) return null;
        const closes = state.candles.map(c => c.close);
        // NOT: state.indicators.rsi14 yalnızca sembol/çözünürlük yüklenirken
        // hesaplanıyor (bkz. getLastATR ile aynı sınır) — her fiyat tick'inde
        // GÜNCELLENMİYOR (yalnızca son mumun close'u değişiyor, bkz.
        // updateLastPrice). Alarmın canlı fiyat hareketine tepki verebilmesi
        // için RSI ve EMA(20) burada HER ÇAĞRIDA closes[] üzerinden taze
        // hesaplanıyor (computeRSI/computeEMA zaten public API'de var,
        // maliyeti ihmal edilebilir) — state.indicators'ın statik kopyası
        // KULLANILMIYOR, bu yüzden tutarsız/gecikmeli tetiklenme olmuyor.
        const rsiArr = (window.DataController && window.DataController.computeRSI)
            ? window.DataController.computeRSI(closes, 14)
            : null;
        const ema20Arr = (window.DataController && window.DataController.computeEMA)
            ? window.DataController.computeEMA(closes, 20)
            : null;
        const lastOf = (arr) => (Array.isArray(arr) && arr.length) ? arr[arr.length - 1] : null;
        const prevOf = (arr) => (Array.isArray(arr) && arr.length > 1) ? arr[arr.length - 2] : null;
        return {
            symbol: state.ticker,
            price: closes[closes.length - 1],
            prevPrice: closes[closes.length - 2],
            rsiLast: lastOf(rsiArr),
            rsiPrev: prevOf(rsiArr),
            ema20Last: lastOf(ema20Arr),
            ema20Prev: prevOf(ema20Arr)
        };
    }

    /* ────────── Çoklu Zaman Dilimi Analiz Paneli (MTF Confluence) ──────────
     * (29 Temmuz 2026) Aktif sembolün 4 saatlik/günlük/haftalık zaman
     * dilimlerinde trend yönünü (fiyat > SMA20 > SMA50 ise yükseliş, ters
     * sıralamaysa düşüş, aksi halde nötr) özetler. 4 saatlik ve haftalık
     * mumlar, ana çözünürlük seçicinin de kullandığı AYNI deterministik
     * türetim fonksiyonlarından (synthesizeIntradayCandles/
     * aggregateWeeklyCandles) geliyor — gerçek günlük mumlardan (backend/
     * yfinance) türetiliyor, ayrıca uydurulmuş bir seri DEĞİL. */
    function trendLabelFor(candles) {
        if (!candles || candles.length < 55 || !window.DataController) return null;
        const closes = candles.map(c => c.close);
        const sma20 = window.DataController.computeSMA(closes, 20);
        const sma50 = window.DataController.computeSMA(closes, 50);
        const lastClose = closes[closes.length - 1];
        const lastSma20 = sma20[sma20.length - 1];
        const lastSma50 = sma50[sma50.length - 1];
        if (lastSma20 === null || lastSma50 === null || lastSma20 === undefined || lastSma50 === undefined) return null;
        if (lastClose > lastSma20 && lastSma20 > lastSma50) return 'up';
        if (lastClose < lastSma20 && lastSma20 < lastSma50) return 'down';
        return 'neutral';
    }

    function renderMTFPanel() {
        const bar = byId('tv-mtf-bar');
        if (!bar) return;
        if (!state.dailyCandles.length || !window.DataController) { bar.innerHTML = ''; return; }
        const daily = state.dailyCandles;
        // 4 saatlik türetim için son ~40 günlük kaynak yeterli (ana
        // çözünürlük motorunun INTRADAY_SOURCE_WINDOW_DAYS'iyle tutarlı
        // büyüklük mertebesi) — TÜM 750 günlük geçmişi patlatmaya gerek yok.
        const fourH = window.DataController.synthesizeIntradayCandles(daily.slice(-40), 240);
        const weekly = window.DataController.aggregateWeeklyCandles(daily);
        const frames = [
            { key: '4h', label: '4 Saatlik', candles: fourH },
            { key: '1d', label: 'Günlük', candles: daily },
            { key: '1w', label: 'Haftalık', candles: weekly }
        ];
        const results = frames.map(f => ({ key: f.key, label: f.label, trend: trendLabelFor(f.candles) }));
        const upCount = results.filter(r => r.trend === 'up').length;
        const downCount = results.filter(r => r.trend === 'down').length;
        const knownCount = results.filter(r => r.trend !== null).length;

        let overall = 'Yetersiz Veri';
        let overallClass = 'mtf-mixed';
        if (knownCount === results.length) {
            if (upCount === results.length) { overall = 'Güçlü Yükseliş Uyumu'; overallClass = 'mtf-up'; }
            else if (downCount === results.length) { overall = 'Güçlü Düşüş Uyumu'; overallClass = 'mtf-down'; }
            else if (upCount >= 2) { overall = 'Yükseliş Ağırlıklı'; overallClass = 'mtf-up-lean'; }
            else if (downCount >= 2) { overall = 'Düşüş Ağırlıklı'; overallClass = 'mtf-down-lean'; }
            else { overall = 'Karışık / Net Değil'; overallClass = 'mtf-mixed'; }
        }

        const trendText = (t) => t === 'up' ? 'YÜKSELİŞ' : t === 'down' ? 'DÜŞÜŞ' : t === 'neutral' ? 'NÖTR' : '--';
        const trendClass = (t) => t === 'up' ? 'mtf-chip-up' : t === 'down' ? 'mtf-chip-down' : t === 'neutral' ? 'mtf-chip-neutral' : 'mtf-chip-na';

        const chipsHtml = results.map(r =>
            '<span class="mtf-chip ' + trendClass(r.trend) + '" title="Fiyat/SMA20/SMA50 hizası">' + r.label + ': ' + trendText(r.trend) + '</span>'
        ).join('');

        bar.innerHTML = '<span class="mtf-label">Çoklu Zaman Dilimi:</span>' + chipsHtml +
            '<span class="mtf-overall ' + overallClass + '">' + overall + '</span>';
    }

    /* ────────── Resolution engine (functional 15m/1H/4H/1D/1W selector) ────────── */

    function parseBackendDate(rawDate) {
        // Backend /api/v1/ohlcv rows carry an ISO-ish date/datetime string
        // (e.g. "2026-06-26T00:00:00"). Parse just the date portion via
        // Date.UTC (not `new Date(string)`) so the resulting unix timestamp
        // is 100% independent of the browser's local timezone, matching the
        // UTC-as-TRT convention documented in dataController.js.
        const dateStr = String(rawDate || '').slice(0, 10);
        const parts = dateStr.split('-').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return null;
        return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 1000);
    }

    // Generalized version of the old deriveCandlesForResolution() — takes an
    // explicit resolution id instead of always reading state.resolution, so
    // the Dual-Chart companion pane (which has its OWN independent
    // resolution) can reuse the exact same daily->intraday/weekly derivation
    // logic without duplicating it.
    // (22 Temmuz 2026, on ikinci oturum, ikinci tur) Asıl senteze/agregasyona
    // parametreli bir kök fonksiyon çıkarıldı — dual-chart panelinin artık
    // FARKLI bir sembolün (dualDailyCandles) kendi günlük verisini de aynı
    // yolla işleyebilmesi için. deriveCandlesForRes() (ana grafik) davranışı
    // birebir aynı kalıyor, sadece bu ortak koda yönleniyor.
    function deriveCandlesFromDaily(dailyCandles, resId) {
        const res = RESOLUTIONS.find(r => r.id === resId) || RESOLUTIONS[3];
        if (res.kind === 'intraday') {
            const recentSlice = dailyCandles.slice(-INTRADAY_SOURCE_WINDOW_DAYS);
            return window.DataController.synthesizeIntradayCandles(recentSlice, res.minutes);
        } else if (res.kind === 'weekly') {
            return window.DataController.aggregateWeeklyCandles(dailyCandles);
        }
        return dailyCandles;
    }

    function deriveCandlesForRes(resId) {
        return deriveCandlesFromDaily(state.dailyCandles, resId);
    }

    function deriveCandlesForResolution() {
        return deriveCandlesForRes(state.resolution);
    }

    // (22 Temmuz 2026, on ikinci oturum, ikinci tur) resId parametresi eklendi
    // (opsiyonel, verilmezse eskisi gibi state.resolution kullanılır) — dual-
    // chart panelinin kendi bağımsız çözünürlüğü (dualResolution) için de
    // aynı kontrolü tekrar yazmadan kullanabilmek için.
    function isIntradayResolution(resId) {
        const res = RESOLUTIONS.find(r => r.id === (resId || state.resolution));
        return !!(res && res.kind === 'intraday');
    }

    // (27 Ağustos 2026 — gerçek gün-içi veri yükseltmesi) `candlesOverride`
    // opsiyonel: verilirse state.candles bunun için YENİDEN türetilmez,
    // doğrudan kullanılır — upgradeIntradayWithRealData()'nın, sentetik ilk
    // render'dan SONRA gerçek veriyle gelen ikinci (daha doğru) render için
    // kullandığı yol budur. Verilmezse davranış tamamen ESKİSİ GİBİ
    // (deriveCandlesForResolution() ile sentetik/günlük/haftalık türetim).
    function applyResolution(candlesOverride) {
        if (!state.dailyCandles.length) return;
        state.candles = candlesOverride || deriveCandlesForResolution();

        const intraday = isIntradayResolution();
        if (chart) chart.applyOptions({ timeScale: { timeVisible: intraday, secondsVisible: false } });
        Object.values(oscillatorPanes).forEach(p => {
            if (p.chart) p.chart.applyOptions({ timeScale: { timeVisible: intraday, secondsVisible: false } });
        });

        // (22 Temmuz 2026, on ikinci oturum, üçüncü tur) Sinyal Anlatıcısı:
        // TAM (kısaltılmamış) geçmişten yeniden hesaplanır — applyChartType()
        // çağrısı bunu setMarkers ile uygulayacağı için ondan ÖNCE taze olması
        // gerekiyor.
        state.signalMarkers = computeSignalMarkers(state.candles);
        applyChartType();

        // (2 Ağustos 2026 — revize planı madde 4) dailyCandles ayrıca iletiliyor;
        // computePivotPoints() bunu pivot referans günü olarak kullanacak (bkz.
        // dataController.js açıklaması) — diğer tüm göstergeler hâlâ o anki
        // çözünürlüğün (state.candles) barlarına göre hesaplanmaya devam ediyor.
        state.indicators = window.DataController.calculateIndicators(state.candles, state.dailyCandles);
        renderOverlays();
        renderAllOscillatorPanes();
        renderMTFPanel();

        if (chart) {
            if (intraday && state.candles.length > DEFAULT_INTRADAY_VISIBLE_BARS) {
                const total = state.candles.length;
                chart.timeScale().setVisibleLogicalRange({ from: total - DEFAULT_INTRADAY_VISIBLE_BARS, to: total - 1 });
            } else {
                chart.timeScale().fitContent();
            }
            // (2 Ağustos 2026 — revize planı madde 1) `fitContent()`/
            // `setVisibleLogicalRange()` yalnızca ZAMAN eksenini ayarlar —
            // Lightweight Charts'ın FİYAT ekseni autoScale'i, kullanıcı fiyat
            // eksenini eliyle bir kez sürükleyip ölçeklendirdiği an
            // kütüphane tarafından SESSİZCE kalıcı olarak kapatılıyor. Bu
            // yüzden ör. AKCNS (160-255 aralığı) görüntülendikten sonra
            // AKBNK'a (63 TL) geçilince, fiyat ekseni eski manuel aralıkta
            // kilitli kalıyor ve yeni mumlar ekran dışında (görünmez)
            // kalıyordu — hoca bunu "fiyat aralığı bir önceki hisseden
            // kalıyor" diye bildirdi. Düzeltme: her sembol/çözünürlük
            // değişiminde autoScale açıkça yeniden zorlanıyor, böylece fiyat
            // ekseni her zaman o an yüklenen sembolün gerçek verisine göre
            // otomatik ölçekleniyor — kullanıcı isterse yine elle
            // sürükleyip özelleştirebilir, bir sonraki sembol/çözünürlük
            // değişiminde bu yeniden sıfırlanır.
            chart.priceScale('right').applyOptions({ autoScale: true });
        }

        // Drawings anchored to a different resolution's time axis simply
        // won't line up with any bar in the new series — dataPointToPixel()
        // already no-ops (returns null coords) for an unmatched time, so
        // they just don't render rather than throwing. They reappear as soon
        // as the user switches back to the resolution they were drawn on.
        redrawDrawings();

        if (dualActive) refreshDualChart();
    }

    // (27 Ağustos 2026 — gerçek gün-içi veri yükseltmesi) applyResolution()
    // ANINDA (sentetik veriyle) render ettikten SONRA, arka planda gerçek
    // Yahoo Finance gün-içi verisini getirmeyi DENER — başarılı olursa
    // (hâlâ AYNI sembol/çözünürlükteysek) grafiği bu daha doğru veriyle
    // sessizce yeniden çizer. Kullanıcı bu sırada araya girip sembolü/
    // çözünürlüğü değiştirirse (mySeq artık state.resSeq'e eşit değildir)
    // sonuç sessizce atılır — hiçbir yarış durumu/eski veri sızıntısı
    // olmaz (bkz. loadSymbol()'deki AYNI desenin loadSeq/dataReady versiyonu).
    async function upgradeIntradayWithRealData(ticker, resId, mySeq) {
        if (!isIntradayResolution(resId)) return;
        const real = await fetchRealCandlesForResolution(ticker, resId);
        if (!real || !real.length) return;
        if (mySeq !== state.resSeq || ticker !== state.ticker || resId !== state.resolution) return;
        const synthetic = deriveCandlesFromDaily(state.dailyCandles, resId);
        const merged = mergeRealWithSynthetic(real, synthetic);
        if (merged.length < 5) return;
        applyResolution(merged);
    }

    // (27 Ağustos 2026 — "hisse seçtikten sonra çok yavaş" hız düzeltmesi)
    // ÖNCEDEN upgradeIntradayWithRealData() HER sembol/çözünürlük
    // değişiminde ANINDA (fire-and-forget) tetikleniyordu — hızlıca birkaç
    // sekme/sembol arasında geçilirse (ör. ASELS→AKBNK→AKCNS art arda),
    // her biri için ayrı bir Yahoo Finance isteği arka planda birikip zaten
    // rate-limit'e takılan tek-worker'lı backend'i daha da yoruyordu, bu da
    // AYNI backend'i paylaşan diğer isteklerin (günlük mum, temel veriler,
    // izleme listesi senkronu) de yavaşlamasına yol açıyordu. Artık bu
    // getirim DEBOUNCE'lı: kullanıcı bir sembol/çözünürlükte
    // INTRADAY_UPGRADE_DEBOUNCE_MS kadar KESİNTİSİZ kalırsa tetiklenir —
    // hızlı gezinmelerde (her tıklamada clearTimeout ile bir öncekinin
    // isteği hiç ateşlenmeden iptal edilir) gereksiz istek hiç gitmez,
    // sadece kullanıcının GERÇEKTEN baktığı sembol için gider.
    const INTRADAY_UPGRADE_DEBOUNCE_MS = 1500;
    let intradayUpgradeTimer = null;

    function scheduleIntradayUpgrade(ticker, resId) {
        if (intradayUpgradeTimer) {
            clearTimeout(intradayUpgradeTimer);
            intradayUpgradeTimer = null;
        }
        if (!isIntradayResolution(resId)) return;
        intradayUpgradeTimer = setTimeout(() => {
            intradayUpgradeTimer = null;
            const mySeq = ++state.resSeq;
            upgradeIntradayWithRealData(ticker, resId, mySeq);
        }, INTRADAY_UPGRADE_DEBOUNCE_MS);
    }

    function setResolution(id) {
        if (!RESOLUTIONS.some(r => r.id === id) || id === state.resolution) return;
        cancelReplayIfActive(); // farklı bir çözünürlüğe geçince tekrar modu iptal edilir
        state.resolution = id;
        applyResolution();
        // (27 Ağustos 2026 — hız düzeltmesi) Debounce'lı: 15dk/1sa/4sa
        // arasında hızlıca gidip gelmek her seferinde Yahoo'ya istek attırmaz.
        scheduleIntradayUpgrade(state.ticker, id);
    }

    function setupResolutionBar() {
        const bar = byId('tv-resolution-bar');
        if (!bar) return;
        bar.querySelectorAll('.tv-res-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                bar.querySelectorAll('.tv-res-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setResolution(btn.dataset.res);
            });
        });
    }

    /* ═══════════ Sinyal Anlatıcısı (22 Temmuz 2026, on ikinci oturum, üçüncü tur) ═══════════
       Kullanıcı hocasına bu paneli gösterdiğinde "TradingView'da bile yok"
       dediği dual-chart'tan sonra istenen iki yeni özellikten ilki. Üç ayrı
       strateji mantığının (Optipulse: SMA5/SMA20 kesişimi; Backtrader:
       RSI+MACD birleşimi; Bollinger Bantları: ortalamaya-dönüş — 23 Temmuz
       2026, on üçüncü oturum'da eklendi) AL/SAT kararlarını backend'e HİÇ
       dokunmadan, doğrudan ekrandaki mumlardan istemci tarafında türetir —
       amaç gerçek bir emir/backtest değil, "motor burada NEDEN böyle karar
       verirdi" sorusunu grafik üzerinde ok işaretleri + tıklanabilir açıklama
       balonuyla cevaplamak. state.signalMarkers her çözünürlük/sembol
       değişiminde TAM geçmişten yeniden hesaplanır (bkz. applyResolution);
       ekranda gösterilip gösterilmeyeceği ayrıca state.signalExplainerOn ile
       kontrol edilir. */

    function computeSignalMarkers(candles) {
        if (!candles || candles.length < 25 || !window.DataController) return [];
        const closes = candles.map(c => c.close);
        const sma5 = window.DataController.computeSMA(closes, 5);
        const sma20 = window.DataController.computeSMA(closes, 20);
        const rsi14 = window.DataController.computeRSI(closes, 14);
        const macd = window.DataController.computeMACD(closes, 12, 26, 9);
        // (23 Temmuz 2026, on üçüncü oturum — "motoru güçlendirme": 3. gerçek
        // strateji) Bollinger Bantları — ortalamaya-dönüş (mean-reversion)
        // mantığı, trend-takip (Optipulse) ve momentum/dönüş (Backtrader)
        // motorlarından KASITLI OLARAK farklı bir üçüncü bakış açısı sunar.
        const bb = window.DataController.computeBollingerBands
            ? window.DataController.computeBollingerBands(closes, 20, 2)
            : null;

        const markers = [];
        const addMarker = (i, side, reason) => {
            markers.push({
                time: candles[i].date,
                position: side === 'buy' ? 'belowBar' : 'aboveBar',
                color: side === 'buy' ? '#4CAF50' : '#F44336',
                shape: side === 'buy' ? 'arrowUp' : 'arrowDown',
                text: side === 'buy' ? 'AL' : 'SAT',
                _side: side,
                _reason: reason
            });
        };

        for (let i = 1; i < candles.length; i++) {
            // --- Optipulse motoru mantığı: SMA5 / SMA20 kesişimi ---
            if (sma5[i] != null && sma20[i] != null && sma5[i - 1] != null && sma20[i - 1] != null) {
                if (sma5[i - 1] <= sma20[i - 1] && sma5[i] > sma20[i]) {
                    addMarker(i, 'buy', `5 günlük ortalama (₺${sma5[i].toFixed(2)}) 20 günlük ortalamayı (₺${sma20[i].toFixed(2)}) yukarı kesti → AL sinyali (Optipulse motoru mantığı: SMA5/SMA20 kesişimi).`);
                } else if (sma5[i - 1] >= sma20[i - 1] && sma5[i] < sma20[i]) {
                    addMarker(i, 'sell', `5 günlük ortalama (₺${sma5[i].toFixed(2)}) 20 günlük ortalamayı (₺${sma20[i].toFixed(2)}) aşağı kesti → SAT sinyali (Optipulse motoru mantığı: SMA5/SMA20 kesişimi).`);
                }
            }

            // --- Backtrader motoru mantığı: RSI(14) + MACD(12,26,9) birleşimi ---
            const rsiNow = rsi14[i], rsiPrev = rsi14[i - 1];
            const histNow = macd.histogram[i], histPrev = macd.histogram[i - 1];
            if (rsiNow != null && rsiPrev != null && histNow != null && histPrev != null) {
                if (rsiPrev <= 30 && rsiNow > 30 && histPrev <= 0 && histNow > 0) {
                    addMarker(i, 'buy', `RSI, 30 seviyesinin altından yukarı çıktı (${rsiNow.toFixed(1)}) ve MACD histogramı pozitife döndü → AL sinyali (Backtrader motoru mantığı: RSI+MACD).`);
                } else if (rsiPrev >= 70 && rsiNow < 70 && histPrev >= 0 && histNow < 0) {
                    addMarker(i, 'sell', `RSI, 70 seviyesinin üstünden aşağı indi (${rsiNow.toFixed(1)}) ve MACD histogramı negatife döndü → SAT sinyali (Backtrader motoru mantığı: RSI+MACD).`);
                }
            }

            // --- Bollinger Bantları mantığı: ortalamaya-dönüş (mean-reversion) ---
            // Fiyat bandın DIŞINA çıkıp bir sonraki barda TEKRAR İÇERİ
            // döndüğünde sinyal üretilir (bandın dışındayken değil) — bu,
            // "aşırı hareketin tükendiği" anı yakalamayı amaçlayan klasik
            // Bollinger geri-dönüş yaklaşımıdır.
            if (bb) {
                const bbLowerNow = bb.lower[i], bbLowerPrev = bb.lower[i - 1];
                const bbUpperNow = bb.upper[i], bbUpperPrev = bb.upper[i - 1];
                if (bbLowerNow != null && bbLowerPrev != null && closes[i - 1] < bbLowerPrev && closes[i] >= bbLowerNow) {
                    addMarker(i, 'buy', `Fiyat alt Bollinger bandının (₺${bbLowerNow.toFixed(2)}) altına sarkıp tekrar üzerine çıktı → AL sinyali (Bollinger Bantları mantığı: ortalamaya-dönüş).`);
                } else if (bbUpperNow != null && bbUpperPrev != null && closes[i - 1] > bbUpperPrev && closes[i] <= bbUpperNow) {
                    addMarker(i, 'sell', `Fiyat üst Bollinger bandının (₺${bbUpperNow.toFixed(2)}) üzerine taşıp tekrar altına indi → SAT sinyali (Bollinger Bantları mantığı: ortalamaya-dönüş).`);
                }
            }
        }

        // Aynı barda iki motor da aynı yönde sinyal verirse (nadir ama
        // mümkün), iki ayrı ok yerine tek, birleşik açıklamalı bir işaretçi
        // gösterilir — setMarkers aynı `time` için birden fazla kaydı
        // öngörülemeyen şekilde üst üste bindirebiliyor.
        const merged = new Map();
        markers.forEach(m => {
            const key = m.time + '_' + m._side;
            if (merged.has(key)) {
                merged.get(key)._reason += ' Ayrıca: ' + m._reason;
            } else {
                merged.set(key, m);
            }
        });
        return Array.from(merged.values()).sort((a, b) => a.time - b.time);
    }

    // candleSeries HER ZAMAN mevcut (fiyat-ölçeği çapası, bkz. applyChartType
    // yorumu) ama mum-dışı bir grafik tipinde (line/area/bars/baseline) gizli
    // olur ve görünen seri typeSeries olur — işaretlerin görünür seride de
    // aynı anda uygulanması gerekiyor, aksi halde o tiplerde hiç görünmezler.
    // (29 Temmuz 2026 — Madde 18 "kullanıcının geçmişte yaptığı al-sat
    // noktalarını grafikte ok ile göster") tradingEngine.js'teki GERÇEK işlem
    // geçmişini (portfolio.history — AI sinyallerinden TAMAMEN farklı, bu
    // KULLANICININ kendi gerçekleştirdiği alım/satımlar) okuyup, aktif
    // sembole ait her işlemi en yakın muma eşleyip küçük bir ok işaretine
    // çeviriyor. Sinyal anlatıcısının renk/şekil şemasından KASITLI olarak
    // farklı bir renk kullanılıyor (mavi/turuncu) — ikisi karıştırılmasın.
    function computeUserTradeMarkers() {
        if (!window.TradingEngine || !window.TradingEngine.getTradeHistoryForSymbol) return [];
        if (!state.ticker || !state.candles.length) return [];
        const history = window.TradingEngine.getTradeHistoryForSymbol(state.ticker);
        if (!history || !history.length) return [];
        const dates = state.candles.map(c => c.date);
        return history.map(h => {
            const targetSec = Math.floor(h.ts / 1000);
            let nearestIdx = 0, nearestDiff = Infinity;
            for (let i = 0; i < dates.length; i++) {
                const diff = Math.abs(dates[i] - targetSec);
                if (diff < nearestDiff) { nearestDiff = diff; nearestIdx = i; }
            }
            const isBuy = h.side === 'BUY';
            return {
                time: dates[nearestIdx],
                position: isBuy ? 'belowBar' : 'aboveBar',
                color: isBuy ? '#42A5F5' : '#FF7043',
                shape: isBuy ? 'arrowUp' : 'arrowDown',
                // (29 Temmuz 2026 — sukru geri bildirimi) once "AL 353 @₺376.25"
                // gibi uzun metin gosteriliyordu; birden fazla islem ayni muma
                // denk gelince yazilar ust uste binip karmasik gorunuyordu. Metin
                // sadece adete indirilmisti (bkz. asagidaki 28 Agustos notu).
                //
                // (28 Ağustos 2026 — "genel görünüm" yenilemesi, kullanıcı
                // geri bildirimi) Adet sayıları bile birden fazla işlem aynı
                // muma denk geldiğinde ("1335, 1325, 282, 268" gibi) üst üste
                // dizilip grafiği kirletiyordu — kullanıcı bunları gereksiz
                // buldu. Yön zaten ok şekli (yukarı/aşağı) + renk (mavi/turuncu)
                // ile belli olduğu için metin tamamen kaldırıldı; tam fiyat/
                // taraf/adet detayı hâlâ "Son İşlemler" sekmesinde mevcut,
                // sadece grafiğin ÜZERİNDEKİ sayı etiketleri gitti. Ok
                // işaretlerinin KENDİSİ bilinçli olarak kalıyor — kullanıcının
                // geçmişte nerede işlem yaptığını görmesi hâlâ faydalı,
                // şikayet edilen şey sayılardı.
                text: '',
                _userTrade: true
            };
        }).sort((a, b) => a.time - b.time);
    }

    function applySignalMarkersForCurrentState() {
        if (!candleSeries) return;
        let markers = [];
        if (state.signalExplainerOn && state.candles.length && state.signalMarkers && state.signalMarkers.length) {
            const lastTime = state.candles[state.candles.length - 1].date;
            markers = state.signalMarkers.filter(m => m.time <= lastTime);
        }
        markers = markers.concat(computeUserTradeMarkers()).sort((a, b) => a.time - b.time);
        try { candleSeries.setMarkers(markers); } catch (e) { /* eski/stub kütüphane sürümü */ }
        if (typeSeries) { try { typeSeries.setMarkers(markers); } catch (e) {} }
    }

    // (29 Temmuz 2026 — Madde 18) tradingEngine.js her başarılı emirden sonra
    // bunu çağırır — o an grafikte gösterilen sembolle eşleşiyorsa işaretler
    // anında yenilenir (sembol değişimini beklemeye gerek kalmaz).
    function refreshUserTradeMarkers(symbol) {
        if (symbol && state.ticker && symbol !== state.ticker) return;
        applySignalMarkersForCurrentState();
    }

    function setupSignalExplainerToggle() {
        const btn = byId('btn-toggle-signal-explainer');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (state.replayActive) {
                if (window.TradingEngine && window.TradingEngine.showToast) {
                    window.TradingEngine.showToast('Tekrar modundayken sinyal anlatıcısı zaten açık.');
                }
                return;
            }
            state.signalExplainerOn = !state.signalExplainerOn;
            btn.classList.toggle('active', state.signalExplainerOn);
            if (!state.signalExplainerOn) hideSignalTooltip();
            applySignalMarkersForCurrentState();
        });
    }

    function handleChartSignalClick(param) {
        if (!state.signalExplainerOn || state.activeTool !== 'cursor') { hideSignalTooltip(); return; }
        if (!param || param.time === undefined || param.time === null) { hideSignalTooltip(); return; }
        const marker = (state.signalMarkers || []).find(m => m.time === param.time);
        if (!marker) { hideSignalTooltip(); return; }
        showSignalTooltip(marker, param.point);
    }

    function showSignalTooltip(marker, point) {
        const tip = byId('tv-signal-tooltip');
        const pane = byId('tv-chart-pane-1');
        if (!tip || !pane || !point) return;
        const badge = byId('tv-signal-tooltip-badge');
        const dateEl = byId('tv-signal-tooltip-date');
        const textEl = byId('tv-signal-tooltip-text');
        if (badge) {
            badge.textContent = marker._side === 'buy' ? 'AL' : 'SAT';
            badge.className = 'tv-signal-tooltip-badge ' + (marker._side === 'buy' ? 'tv-signal-badge-buy' : 'tv-signal-badge-sell');
        }
        if (dateEl) dateEl.textContent = formatCandleDate(marker.time);
        if (textEl) textEl.textContent = marker._reason;

        const paneW = pane.clientWidth, paneH = pane.clientHeight;
        const tipW = 260, tipH = 110; // CSS max-width/tipik yükseklikle yaklaşık uyumlu
        let left = point.x + 14;
        let top = point.y + 14;
        if (left + tipW > paneW) left = Math.max(6, point.x - tipW - 14);
        if (top + tipH > paneH) top = Math.max(6, paneH - tipH - 6);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        tip.style.display = 'block';
    }

    function hideSignalTooltip() {
        const tip = byId('tv-signal-tooltip');
        if (tip) tip.style.display = 'none';
    }

    function setupSignalTooltipDismiss() {
        const closeBtn = byId('tv-signal-tooltip-close');
        if (closeBtn) closeBtn.addEventListener('click', hideSignalTooltip);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSignalTooltip(); });
    }

    /* ═══════════ Strateji Tekrarı / "Zaman Makinesi" (22 Temmuz 2026, on ikinci oturum, üçüncü tur) ═══════════
       Kullanıcının istediği ikinci özellik. Mevcut grafiği (state.candles),
       baştan bir noktadan itibaren bar bar, kronolojik olarak "yeniden
       oynatır" — sanki piyasa o an canlıymış gibi. Yeni bir backtest/veri
       isteği YAPMAZ; zaten yüklü olan state.candles/state.indicators'ın
       kısaltılmış anlık görüntülerini var olan render fonksiyonlarına
       (applyChartType/renderOverlays/renderAllOscillatorPanes) besleyerek
       çalışır: state.candles/state.indicators her karede GEÇİCİ olarak
       kısaltılır, o fonksiyonlar hep aynı state okuduğu için hiçbir yeni
       "sliced render" kodu yazmaya gerek kalmaz; kare çizildikten hemen
       sonra tam haline geri döndürülür (dış dünya bunu hiç fark etmez). */

    let replayTimer = null;
    const REPLAY_START_BARS = 30; // SMA20/RSI14 gibi göstergelerin anlamlı olması için minimum başlangıç
    const REPLAY_SPEED_MS = { 1: 480, 2: 220, 5: 90 };

    function buildSlicedIndicators(ind, n) {
        if (!ind) return ind;
        const out = {};
        Object.keys(ind).forEach((k) => {
            const v = ind[k];
            if (Array.isArray(v)) {
                out[k] = v.slice(0, n);
            } else if (v && typeof v === 'object') {
                const nested = {};
                Object.keys(v).forEach((k2) => {
                    const v2 = v[k2];
                    nested[k2] = Array.isArray(v2) ? v2.slice(0, n) : v2;
                });
                out[k] = nested;
            } else {
                out[k] = v;
            }
        });
        return out;
    }

    function updateReplayPlayPauseIcon() {
        const playIcon = byId('replay-icon-play');
        const pauseIcon = byId('replay-icon-pause');
        if (playIcon) playIcon.style.display = state.replayPlaying ? 'none' : '';
        if (pauseIcon) pauseIcon.style.display = state.replayPlaying ? '' : 'none';
    }

    function updateReplayUi() {
        const slider = byId('tv-replay-slider');
        const dateLabel = byId('tv-replay-date-label');
        if (!state.candles.length) return;
        if (slider) {
            slider.max = String(state.candles.length - 1);
            slider.value = String(state.replayIndex);
        }
        if (dateLabel) dateLabel.textContent = formatCandleDate(state.candles[state.replayIndex].date);
    }

    function updateReplayFrame() {
        if (!state.candles.length || !candleSeries) return;
        const n = state.replayIndex + 1;
        const fullCandles = state.candles;
        const fullIndicators = state.indicators;
        const slicedCandles = fullCandles.slice(0, n);
        const slicedIndicators = buildSlicedIndicators(fullIndicators, n);

        state.candles = slicedCandles;
        state.indicators = slicedIndicators;
        try {
            applyChartType();
            renderOverlays();
            renderAllOscillatorPanes();
            redrawDrawings();
        } finally {
            state.candles = fullCandles;
            state.indicators = fullIndicators;
        }

        if (chart) chart.timeScale().fitContent();
        updateReplayUi();

        const lastTime = slicedCandles[slicedCandles.length - 1].date;
        const justAppeared = (state.signalMarkers || []).filter(m => m.time === lastTime);
        justAppeared.forEach(m => {
            if (window.TradingEngine && window.TradingEngine.showToast) {
                window.TradingEngine.showToast(`${formatCandleDate(m.time)} — ${m._side === 'buy' ? 'AL' : 'SAT'} sinyali: ${m._reason}`);
            }
        });
    }

    function stepReplay() {
        if (state.replayIndex >= state.candles.length - 1) {
            pauseReplay();
            if (window.TradingEngine && window.TradingEngine.showToast) {
                window.TradingEngine.showToast('Tekrar tamamlandı — güncel tarihe ulaşıldı.');
            }
            return;
        }
        state.replayIndex++;
        updateReplayFrame();
    }

    function stopReplayTimer() {
        if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
    }

    function playReplay() {
        if (!state.replayActive || state.replayPlaying) return;
        if (state.replayIndex >= state.candles.length - 1) {
            state.replayIndex = Math.min(REPLAY_START_BARS, state.candles.length - 1);
        }
        state.replayPlaying = true;
        updateReplayPlayPauseIcon();
        stopReplayTimer();
        replayTimer = setInterval(stepReplay, REPLAY_SPEED_MS[state.replaySpeed] || 480);
    }

    function pauseReplay() {
        state.replayPlaying = false;
        updateReplayPlayPauseIcon();
        stopReplayTimer();
    }

    function setReplaySpeed(speed) {
        state.replaySpeed = speed;
        const bar = byId('tv-replay-bar');
        if (bar) {
            bar.querySelectorAll('.tv-replay-speed-btn').forEach(b => {
                b.classList.toggle('active', Number(b.dataset.speed) === speed);
            });
        }
        if (state.replayPlaying) {
            stopReplayTimer();
            replayTimer = setInterval(stepReplay, REPLAY_SPEED_MS[speed] || 480);
        }
    }

    // Sembol/çözünürlük değişimi gibi durumlarda tekrar modunun SESSİZCE (tam
    // yeniden çizim yapmadan) iptal edilmesi için — birkaç satır sonra zaten
    // yeni sembol/çözünürlük için tam bir applyResolution() çalışacağı için
    // burada tekrar render etmek gereksiz iş olurdu.
    function cancelReplayIfActive() {
        if (!state.replayActive) return;
        pauseReplay();
        state.replayActive = false;
        state.signalExplainerOn = state.replayPrevExplainerOn;
        const explainerBtn = byId('btn-toggle-signal-explainer');
        if (explainerBtn) explainerBtn.classList.toggle('active', state.signalExplainerOn);
        const replayBtn = byId('btn-toggle-replay');
        if (replayBtn) replayBtn.classList.remove('active');
        const bar = byId('tv-replay-bar');
        if (bar) bar.style.display = 'none';
        hideSignalTooltip();
    }

    function enterReplayMode() {
        if (!state.candles.length || state.candles.length < REPLAY_START_BARS + 5) {
            if (window.TradingEngine && window.TradingEngine.showToast) {
                window.TradingEngine.showToast('Tekrar modu için yeterli geçmiş veri yok.');
            }
            return;
        }
        if (state.replayActive) return;
        hideSignalTooltip();
        state.replayActive = true;
        state.replayIndex = REPLAY_START_BARS;
        state.replayPlaying = false;
        state.replaySpeed = 1;
        state.replayPrevExplainerOn = state.signalExplainerOn;
        state.signalExplainerOn = true;

        const explainerBtn = byId('btn-toggle-signal-explainer');
        if (explainerBtn) explainerBtn.classList.add('active');
        const replayBtn = byId('btn-toggle-replay');
        if (replayBtn) replayBtn.classList.add('active');
        const bar = byId('tv-replay-bar');
        if (bar) {
            bar.style.display = 'flex';
            bar.querySelectorAll('.tv-replay-speed-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === 1));
        }
        updateReplayPlayPauseIcon();
        updateReplayFrame();
    }

    function exitReplayMode() {
        if (!state.replayActive) return;
        cancelReplayIfActive();

        // Tam veriyi geri yükle (mevcut çözünürlük için) — cancelReplayIfActive
        // sadece bayrakları/UI'ı sıfırlar, gerçek yeniden çizimi burada yapıyoruz
        // (sembol/çözünürlük değişiminde bu adım gereksizdir, bkz. yukarısı).
        applyChartType();
        renderOverlays();
        renderAllOscillatorPanes();
        redrawDrawings();
        applySignalMarkersForCurrentState();
        if (chart) {
            const intraday = isIntradayResolution();
            if (intraday && state.candles.length > DEFAULT_INTRADAY_VISIBLE_BARS) {
                const total = state.candles.length;
                chart.timeScale().setVisibleLogicalRange({ from: total - DEFAULT_INTRADAY_VISIBLE_BARS, to: total - 1 });
            } else {
                chart.timeScale().fitContent();
            }
        }
    }

    function setupReplayControls() {
        const openBtn = byId('btn-toggle-replay');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                if (state.replayActive) exitReplayMode(); else enterReplayMode();
            });
        }
        const playPauseBtn = byId('btn-replay-playpause');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => {
                if (state.replayPlaying) pauseReplay(); else playReplay();
            });
        }
        const exitBtn = byId('btn-replay-exit');
        if (exitBtn) exitBtn.addEventListener('click', exitReplayMode);

        const bar = byId('tv-replay-bar');
        if (bar) {
            bar.querySelectorAll('.tv-replay-speed-btn').forEach(b => {
                b.addEventListener('click', () => setReplaySpeed(Number(b.dataset.speed)));
            });
        }
        const slider = byId('tv-replay-slider');
        if (slider) {
            slider.addEventListener('input', () => {
                if (state.replayPlaying) pauseReplay();
                state.replayIndex = Math.max(REPLAY_START_BARS, Math.min(Number(slider.value), state.candles.length - 1));
                updateReplayFrame();
            });
        }
    }

    /* ────────── Dual-Chart companion pane (onuncu oturum) ────────── */

    function createDualChart() {
        const container = byId('tv-main-chart-2');
        if (!container || !window.LightweightCharts) return;
        dualChart = LightweightCharts.createChart(container, baseChartOptions(container, true));
        dualSeries = dualChart.addCandlestickSeries({
            upColor: COLORS.up,
            downColor: COLORS.down,
            borderUpColor: COLORS.up,
            borderDownColor: COLORS.down,
            wickUpColor: COLORS.wickUp,
            wickDownColor: COLORS.wickDown
        });
        dualOverlaySeries = {};
    }

    function destroyDualChart() {
        if (dualRefreshTimer) {
            clearInterval(dualRefreshTimer);
            dualRefreshTimer = null;
        }
        // (29 Temmuz 2026) Osilatör mini-panelleri de dual grafikle birlikte
        // temizleniyor — dualActiveOscillators seçimi (localStorage'a
        // yazılmadığı için zaten kalıcı değil) korunuyor ki panel tekrar
        // açıldığında aynı seçim otomatik geri gelsin.
        Object.keys(dualOscillatorPanes).forEach(id => destroyDualOscillatorPane(id));
        if (dualChart) {
            try { dualChart.remove(); } catch (e) { /* already gone */ }
            dualChart = null;
            dualSeries = null;
            dualOverlaySeries = {};
        }
        dualIndicators = null;
        dualLastRenderedCandles = [];
    }

    // (29 Temmuz 2026 — genişletildi) Dual-Chart panelinin kendi overlay
    // göstergeleri — artık dualIndicators (dual panelin BAĞIMSIZ sembol/
    // çözünürlük çifti için hesaplanmış TAM calculateIndicators() çıktısı)
    // üzerinden besleniyor, ayrı ayrı computeSMA/computeEMA çağrıları yerine.
    // Hâlâ ana grafiğin renderOverlays()'ini/14 checkbox'ını ÇOĞALTMIYORUZ —
    // sadece 6 seçilebilir çizgi, kendi küçük toggle satırıyla.
    function refreshDualOverlays(candles) {
        if (!dualChart || !window.DataController || !dualIndicators) return;
        Object.values(dualOverlaySeries).forEach(s => { try { dualChart.removeSeries(s); } catch (e) {} });
        dualOverlaySeries = {};

        const dates = candles.map(c => c.time);
        const ind = dualIndicators;
        const addDLine = (key, values, color, opts = {}) => {
            const series = dualChart.addLineSeries({
                color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false,
                crosshairMarkerVisible: false, ...opts
            });
            series.setData(seriesFromValues(dates, values));
            dualOverlaySeries[key] = series;
        };

        if (dualOverlayActive.sma20) addDLine('sma20', ind.sma20, COLORS.sma20);
        if (dualOverlayActive.sma50) addDLine('sma50', ind.sma50, COLORS.sma50);
        if (dualOverlayActive.ema9)  addDLine('ema9', ind.ema9, COLORS.ema9, { lineStyle: LightweightCharts.LineStyle.Dashed });
        if (dualOverlayActive.ema21) addDLine('ema21', ind.ema21, COLORS.ema21, { lineStyle: LightweightCharts.LineStyle.Dashed });
        if (dualOverlayActive.vwap)  addDLine('vwap', ind.vwap, COLORS.vwap, { lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 2 });
        if (dualOverlayActive.bollinger) {
            addDLine('bbUpper', ind.bollingerUpper, COLORS.bbLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
            addDLine('bbLower', ind.bollingerLower, COLORS.bbLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
        }
    }

    function toggleDualOverlay(key) {
        dualOverlayActive[key] = !dualOverlayActive[key];
        document.querySelectorAll('#tv-dual-overlay-row [data-doverlay]').forEach(b => {
            b.classList.toggle('active', dualOverlayActive[b.dataset.doverlay]);
        });
        refreshDualOverlays(dualLastRenderedCandles);
    }

    /* ────────── Dual-Chart'ın kendi osilatör mini-panelleri ──────────
     * (29 Temmuz 2026 — "Dual-chart panelinde bağımsız gösterge desteği")
     * Ana grafiğin ensureOscillatorPane()/buildOscillatorSeries()/
     * renderAllOscillatorPanes() üçlüsünün dual panel için ayrı konteynere
     * (#tv-dual-subpanes-container) ve ayrı chart kümesine (dualChart)
     * yönlendirilmiş paraleli. buildOscillatorSeries() zaten hedef chart
     * örneğini parametre olarak aldığı için (bkz. yukarıdaki tanım) burada
     * SIFIRDAN yazılmadı, doğrudan yeniden kullanıldı — tek yeni kod,
     * pane DOM/chart YAŞAM DÖNGÜSÜ yönetimi. */
    function ensureDualOscillatorPane(id) {
        if (dualOscillatorPanes[id]) return dualOscillatorPanes[id];
        const container = byId('tv-dual-subpanes-container');
        if (!container || !window.LightweightCharts) return null;

        const paneEl = document.createElement('div');
        paneEl.className = 'tv-osc-pane';
        paneEl.dataset.dosc = id;
        paneEl.innerHTML =
            '<div class="tv-osc-pane-header">' +
                '<span class="tv-osc-title"></span>' +
                '<span class="tv-osc-close-btn" data-dosc="' + id + '" title="Paneli kapat">×</span>' +
            '</div>' +
            '<div class="tv-osc-chart-mount"></div>';
        container.appendChild(paneEl);

        const mount = paneEl.querySelector('.tv-osc-chart-mount');
        const paneChart = LightweightCharts.createChart(mount, baseChartOptions(mount, true));
        paneChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range && dualChart) dualChart.timeScale().setVisibleLogicalRange(range);
        });

        const closeBtn = paneEl.querySelector('.tv-osc-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                dualActiveOscillators = dualActiveOscillators.filter(o => o !== id);
                document.querySelectorAll('#tv-dual-osc-row [data-dosc]').forEach(b => {
                    b.classList.toggle('active', dualActiveOscillators.includes(b.dataset.dosc));
                });
                renderDualOscillatorPanes();
            });
        }

        const entry = { el: paneEl, chart: paneChart, series: {} };
        dualOscillatorPanes[id] = entry;
        return entry;
    }

    function destroyDualOscillatorPane(id) {
        const entry = dualOscillatorPanes[id];
        if (!entry) return;
        try { entry.chart.remove(); } catch (e) {}
        if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        delete dualOscillatorPanes[id];
    }

    function renderDualOscillatorPanes() {
        Object.keys(dualOscillatorPanes).forEach(id => {
            if (!dualActiveOscillators.includes(id)) destroyDualOscillatorPane(id);
        });
        if (!dualChart || !dualIndicators || !dualLastRenderedCandles.length) return;
        const dates = dualLastRenderedCandles.map(c => c.time);
        dualActiveOscillators.forEach(id => {
            const entry = ensureDualOscillatorPane(id);
            if (!entry) return;
            Object.values(entry.series).forEach(s => { try { entry.chart.removeSeries(s); } catch (e) {} });
            entry.series = {};
            const built = buildOscillatorSeries(entry.chart, id, dualIndicators, dates);
            entry.series = built.series;
            const titleEl = entry.el.querySelector('.tv-osc-title');
            if (titleEl) titleEl.textContent = built.title;
        });
        const range = dualChart.timeScale().getVisibleLogicalRange();
        if (range) {
            Object.values(dualOscillatorPanes).forEach(p => p.chart.timeScale().setVisibleLogicalRange(range));
        }
        resizeDualOscillatorPanes();
    }

    function resizeDualOscillatorPanes() {
        Object.values(dualOscillatorPanes).forEach(p => {
            const mount = p.el.querySelector('.tv-osc-chart-mount');
            if (mount) p.chart.applyOptions({ width: mount.clientWidth, height: mount.clientHeight });
        });
    }

    function toggleDualOscillator(id) {
        if (dualActiveOscillators.includes(id)) {
            dualActiveOscillators = dualActiveOscillators.filter(o => o !== id);
        } else {
            dualActiveOscillators.push(id);
        }
        document.querySelectorAll('#tv-dual-osc-row [data-dosc]').forEach(b => {
            b.classList.toggle('active', dualActiveOscillators.includes(b.dataset.dosc));
        });
        renderDualOscillatorPanes();
    }

    /* ────────── BIST100 Endeksi ile Göreceli Güç ──────────
     * (29 Temmuz 2026) Ana sembol ile karşılaştırma sembolünün (veya
     * BIST100 Endeksi'nin) PAYLAŞILAN son N günlük penceredeki kümülatif
     * getiri farkı. "Göreceli güç" burada TradingView'daki klasik "relative
     * strength" göstergesi gibi ayrı bir çizgi değil, daha basit ve
     * anlaşılır bir ÖZET rakam (bkz. sunulan öneri metni) — iki serinin
     * paylaştığı GERÇEK gün sayısı kadar geriye gidip son kapanışları
     * karşılaştırıyor, uydurma bir normalize edilmiş seri üretmiyor. */
    const REL_STRENGTH_WINDOW_DAYS = 60;

    function computeRelativeStrength() {
        if (!dualSymbol || !state.dailyCandles.length || !dualDailyCandles.length) return null;
        const n = Math.min(state.dailyCandles.length, dualDailyCandles.length, REL_STRENGTH_WINDOW_DAYS);
        if (n < 2) return null;
        const mainSlice = state.dailyCandles.slice(-n);
        const dualSlice = dualDailyCandles.slice(-n);
        const mainRet = (mainSlice[mainSlice.length - 1].close / mainSlice[0].close - 1) * 100;
        const dualRet = (dualSlice[dualSlice.length - 1].close / dualSlice[0].close - 1) * 100;
        return { mainRet, dualRet, spread: mainRet - dualRet, days: n };
    }

    function renderRelativeStrength() {
        const el = byId('tv-dual-relstrength');
        if (!el) return;
        const rs = computeRelativeStrength();
        if (!rs) { el.style.display = 'none'; el.innerHTML = ''; return; }
        const dualLabel = SPECIAL_DUAL_SYMBOLS[dualSymbol] || dualSymbol;
        const spreadCls = rs.spread >= 0 ? 'relstr-positive' : 'relstr-negative';
        const spreadSign = rs.spread >= 0 ? '+' : '';
        el.style.display = '';
        el.innerHTML = 'Göreceli Güç (son ' + rs.days + ' gün): ' +
            '<b>' + (state.ticker || '') + '</b> ' + (rs.mainRet >= 0 ? '+' : '') + rs.mainRet.toFixed(2) + '% · ' +
            '<b>' + dualLabel + '</b> ' + (rs.dualRet >= 0 ? '+' : '') + rs.dualRet.toFixed(2) + '% · ' +
            'Fark: <span class="' + spreadCls + '">' + spreadSign + rs.spread.toFixed(2) + '%</span>';
    }

    // (22 Temmuz 2026, on ikinci oturum, ikinci tur) dualSymbol set edilmişse
    // (kullanıcı farklı bir sembol seçtiyse) BAĞIMSIZ dualDailyCandles
    // kaynağı kullanılır; dualSymbol null iken ("ayna" modu, varsayılan/eski
    // davranış) ana grafiğin state.dailyCandles'ı kullanılmaya devam eder.
    function refreshDualChart() {
        if (!dualActive || !dualSeries) return;
        const sourceDaily = dualSymbol ? dualDailyCandles : state.dailyCandles;
        if (!sourceDaily.length) return;
        // (29 Temmuz 2026) `derivedRaw` volume alanını KORUYOR (VWAP/OBV/MFI
        // gibi göstergeler için gerekli) — candlestick serisine verilen
        // `candles` bunun sadece OHLC'ye indirgenmiş bir izdüşümü.
        const derivedRaw = deriveCandlesFromDaily(sourceDaily, dualResolution);
        const candles = derivedRaw.map(c => ({
            time: c.date, open: c.open, high: c.high, low: c.low, close: c.close
        }));
        dualLastRenderedCandles = candles;
        dualSeries.setData(candles);
        dualIndicators = (window.DataController && derivedRaw.length) ? window.DataController.calculateIndicators(derivedRaw, sourceDaily) : null;
        refreshDualOverlays(candles);
        renderDualOscillatorPanes();
        // (22 Temmuz 2026, on ikinci oturum, ikinci tur) Kullanıcı ekran
        // görüntüsünde bu panelin (kendi bağımsız çözünürlüğü intraday —
        // 1H/4H — iken) TÜM geçmişi fitContent() ile aşırı sıkıştırıp
        // "çirkin" gösterdiğini fark etti. Ana grafikteki aynı sorunu daha
        // önce bu oturumda düzeltmiştik (bkz. applyResolution()) ama bu
        // ikinci panele hiç uygulanmamıştı — aynı "son N bar" varsayılan
        // penceresi burada da uygulanıyor.
        if (isIntradayResolution(dualResolution) && candles.length > DEFAULT_INTRADAY_VISIBLE_BARS) {
            const total = candles.length;
            dualChart.timeScale().setVisibleLogicalRange({ from: total - DEFAULT_INTRADAY_VISIBLE_BARS, to: total - 1 });
        } else {
            dualChart.timeScale().fitContent();
        }
        updateDualSymbolLabel();
        renderRelativeStrength();
    }

    function updateDualSymbolLabel() {
        const label = byId('tv-dual-pane-label');
        if (!label) return;
        if (dualSymbol) {
            const displayName = SPECIAL_DUAL_SYMBOLS[dualSymbol] || dualSymbol;
            label.textContent = displayName + ' vs ' + (state.ticker || '');
        } else if (state.ticker) {
            label.textContent = state.ticker + ' — Karşılaştırma';
        }
    }

    // (22 Temmuz 2026, on ikinci oturum, ikinci tur) loadSymbol()'daki asıl
    // veri-edinme yolunun sadeleştirilmiş bir kopyası — dual-chart'ın
    // bağımsız karşılaştırma sembolü için. Yinelenen/boşluk uyarılarını
    // KASITLI OLARAK tekrarlamıyor (ana sembol için zaten bir kez
    // gösteriliyor, aynı gürültüyü ikinci bir sembol için de basmak
    // faydadan çok karmaşa katardı) — ama aynı dedup/sıralama korumasını
    // (Lightweight Charts'ın kesin artan/tekil zaman gereksinimi) uyguluyor.
    async function fetchDailyCandlesForCompare(ticker) {
        let candles = await fetchOhlcvCached(ticker);
        if (!candles || candles.length < 5) {
            candles = window.DataController.generateOHLCV(ticker);
        }
        const seen = new Set();
        return candles.filter(c => {
            if (seen.has(c.date)) return false;
            seen.add(c.date);
            return true;
        }).sort((a, b) => a.date - b.date);
    }

    // (22 Temmuz 2026, on ikinci oturum, ikinci tur — kullanıcı isteği:
    // "farklı bir sembolle karşılaştırma ekle") ticker boş bırakılırsa ya da
    // ana sembolün kendisiyle aynıysa "ayna" moduna döner (dualSymbol=null,
    // eski davranış). Geçersiz/bilinmeyen bir sembol girilirse (STOCK_
    // PROFILES'ta yoksa) sessizce reddedilir ve kullanıcıya kısa bir toast
    // ile bildirilir — mevcut sembol değişmeden kalır.
    async function setDualSymbol(rawTicker) {
        let normalized = (rawTicker || '').trim().toUpperCase();
        if (!normalized || normalized === state.ticker) {
            dualSymbol = null;
            dualDailyCandles = [];
            updateDualSymbolLabel();
            refreshDualChart();
            return;
        }
        // (29 Temmuz 2026 — "BIST100 Endeksi ile Göreceli Güç") "BIST100" /
        // "XU100" kullanıcı için eşanlamlı — ikisi de gerçek BIST100 endeks
        // sembolüne (backend'in format_ticker()'ı "XU100.IS"e çevirir, bu
        // yfinance'te GERÇEKTEN var olan bir endeks sembolü) yönleniyor.
        // STOCK_PROFILES doğrulamasından bilerek MUAF — orada zaten yok,
        // 97 hisse listesi bir endeks sembolü içermiyor.
        if (normalized === 'BIST100' || normalized === 'BIST 100' || normalized === 'XU100.IS') {
            normalized = 'XU100';
        }
        if (!SPECIAL_DUAL_SYMBOLS[normalized]) {
            const profiles = window.DataController && window.DataController.STOCK_PROFILES;
            if (!profiles || !profiles[normalized]) {
                if (window.TradingEngine && window.TradingEngine.showToast) {
                    window.TradingEngine.showToast(`"${normalized}" tanınan bir sembol değil.`);
                }
                return;
            }
        }
        const myToken = ++dualSymbolLoadToken;
        const candles = await fetchDailyCandlesForCompare(normalized);
        if (myToken !== dualSymbolLoadToken) return; // daha yeni bir seçim bu isteği geçersiz kıldı
        dualSymbol = normalized;
        dualDailyCandles = candles;
        updateDualSymbolLabel();
        refreshDualChart();
    }

    // (22 Temmuz 2026, on ikinci oturum, ikinci tur) 5 saniyelik otomatik
    // yenileme artık multiChartGrid.js'teki tickGrid() ile aynı desende —
    // piyasa kapalıyken (hafta sonu/mesai dışı) veri zaten değişmeyeceği için
    // gereksiz yeniden çizim/redraw yapılmıyor. Kullanıcının kendi tetiklediği
    // çağrılar (panel açma, çözünürlük değiştirme) refreshDualChart()'ı
    // doğrudan çağırmaya devam ediyor — piyasa durumundan bağımsız.
    function dualChartTick() {
        if (window.DataController && window.DataController.isMarketOpenNow && !window.DataController.isMarketOpenNow()) return;
        refreshDualChart();
    }

    function setDualResolution(resId) {
        dualResolution = resId;
        document.querySelectorAll('#tv-dual-res-row [data-dres]').forEach(b => {
            b.classList.toggle('active', b.dataset.dres === resId);
        });
        refreshDualChart();
    }

    function toggleDualChart() {
        dualActive = !dualActive;
        const area = byId('tv-chart-area-single');
        const btn = byId('btn-toggle-dual-chart');
        if (area) area.classList.toggle('tv-dual-active', dualActive);
        if (btn) btn.classList.toggle('active', dualActive);

        if (dualActive) {
            if (!dualChart) createDualChart();
            // Layout only settles after the pane's display flips to flex —
            // defer sizing/data a tick, same pattern used by
            // multiChartGrid.js's openGridView().
            setTimeout(() => {
                resizeAll();
                refreshDualChart();
            }, 30);
            if (!dualRefreshTimer) dualRefreshTimer = setInterval(dualChartTick, 5000);
        } else {
            destroyDualChart();
        }
    }

    function setupDualChartControls() {
        const toggleBtn = byId('btn-toggle-dual-chart');
        if (toggleBtn) toggleBtn.addEventListener('click', toggleDualChart);

        const resRow = byId('tv-dual-res-row');
        if (resRow) {
            resRow.querySelectorAll('[data-dres]').forEach(btn => {
                btn.addEventListener('click', () => setDualResolution(btn.dataset.dres));
            });
        }

        const overlayRow = byId('tv-dual-overlay-row');
        if (overlayRow) {
            overlayRow.querySelectorAll('[data-doverlay]').forEach(btn => {
                btn.addEventListener('click', () => toggleDualOverlay(btn.dataset.doverlay));
            });
        }

        // (29 Temmuz 2026 — "Dual-chart panelinde bağımsız gösterge desteği")
        const oscRow = byId('tv-dual-osc-row');
        if (oscRow) {
            oscRow.querySelectorAll('[data-dosc]').forEach(btn => {
                btn.addEventListener('click', () => toggleDualOscillator(btn.dataset.dosc));
            });
        }

        // (29 Temmuz 2026 — "BIST100 Endeksi ile Göreceli Güç") Tek tıkla
        // karşılaştırma sembolünü gerçek BIST100 endeksine çevirir.
        const bist100Btn = byId('btn-dual-bist100');
        if (bist100Btn) {
            bist100Btn.addEventListener('click', () => setDualSymbol('XU100'));
        }

        setupDualSymbolPicker();
    }

    // (22 Temmuz 2026, on ikinci oturum, ikinci tur — kullanıcı isteği:
    // "farklı bir sembolle karşılaştırma ekle") Etikete tıklamak onu gizleyip
    // yerine bir <input> gösterir (Enter/blur ile onaylanır, Escape ile
    // vazgeçilir) — panel varsayılan halinde (dokunulmamışken) görsel olarak
    // eskisiyle birebir aynı kalması için "her zaman görünür input" yerine
    // bu "tıkla-düzenle" deseni seçildi.
    function setupDualSymbolPicker() {
        const labelEl = byId('tv-dual-pane-label');
        const input = byId('tv-dual-symbol-input');
        const datalist = byId('tv-dual-symbol-datalist');
        if (!labelEl || !input || !datalist) return;

        const populateDatalist = () => {
            const profiles = window.DataController && window.DataController.STOCK_PROFILES;
            if (!profiles || datalist.children.length) return;
            datalist.innerHTML = '<option value="XU100">BIST100 Endeksi</option>' +
                Object.keys(profiles).sort()
                .map(t => '<option value="' + t + '"></option>')
                .join('');
        };

        const enterEditMode = () => {
            populateDatalist();
            input.value = dualSymbol || '';
            labelEl.style.display = 'none';
            input.style.display = '';
            input.focus();
            input.select();
        };
        const exitEditMode = () => {
            input.style.display = 'none';
            labelEl.style.display = '';
        };

        labelEl.addEventListener('click', enterEditMode);
        labelEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterEditMode(); }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur(); // blur handler'ı commit ediyor
            } else if (e.key === 'Escape') {
                exitEditMode();
            }
        });
        input.addEventListener('blur', () => {
            const val = input.value;
            exitEditMode();
            setDualSymbol(val);
        });
    }

    /* ────────── Tam Ekran Grafik Modu (onuncu oturum) ────────── */

    function setFullscreenIcon(active) {
        const enterIcon = byId('fullscreen-icon-enter');
        const exitIcon = byId('fullscreen-icon-exit');
        if (enterIcon) enterIcon.style.display = active ? 'none' : '';
        if (exitIcon) exitIcon.style.display = active ? '' : 'none';
        const btn = byId('btn-toggle-fullscreen');
        if (btn) {
            btn.classList.toggle('active', active);
            btn.title = active ? 'Tam Ekrandan Çık (Esc)' : 'Tam Ekran Grafik (Esc ile çık)';
        }
    }

    function toggleFullscreen(forceState) {
        fullscreenActive = typeof forceState === 'boolean' ? forceState : !fullscreenActive;
        const container = document.querySelector('.dashboard-container');
        if (container) container.classList.toggle('tv-fullscreen-mode', fullscreenActive);
        setFullscreenIcon(fullscreenActive);
        // Header/sidebar/trade-panel visibility flips instantly via CSS; the
        // chart containers' actual pixel size only settles after that reflow,
        // so resize on the next tick (ResizeObserver also catches this, but
        // an explicit call avoids a one-frame flash of stale chart width).
        setTimeout(() => {
            resizeAll();
            redrawDrawings();
            requestAnimationFrame(() => redrawDrawings());
        }, 30);
    }

    // (18 Temmuz 2026, onuncu oturum, ikinci tur) Sol dikey araç rayını
    // daraltma/genişletme — kullanıcı tercihini localStorage'da saklıyoruz,
    // tıpkı diğer küçük UI tercihleri gibi (bkz. optipulselab_sound_enabled_v1).
    const RAIL_COLLAPSED_KEY = 'optipulselab_rail_collapsed_v1';

    function setRailCollapsed(collapsed) {
        const container = document.querySelector('.dashboard-container');
        if (container) container.classList.toggle('tv-rail-collapsed', collapsed);
        const arrow = byId('rail-toggle-arrow');
        if (arrow) arrow.setAttribute('points', collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6');
        const btn = byId('btn-toggle-rail');
        if (btn) btn.title = collapsed ? 'Araç rayını genişlet' : 'Araç rayını daralt';
        try { localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) {}
        // (23 Temmuz 2026 düzeltmesi) Araç rayı daraltılıp/genişletilince
        // grafiğin GENİŞLİĞİ değişiyor — bu da görünür bar sayısını ve
        // dolayısıyla otomatik fiyat eksenini (autoscale) etkileyebiliyor.
        // resizeAll() burada çağrılıyordu ama ardından redrawDrawings()
        // HİÇ çağrılmıyordu — yani çizim katmanı (trend çizgileri, fib vb.)
        // yeni ölçeğe göre yeniden hesaplanmıyor, eski (artık YANLIŞ) piksel
        // konumunda kalıyordu; bu da kullanıcıya çizginin "fiyatının
        // değiştiği" gibi görünüyordu (aslında sabit fiyatta kalıyor, sadece
        // ekranda YANLIŞ yerde çiziliyordu). fullscreen/pencere-yeniden-boyut
        // yollarındaki mevcut desenle (resizeAll() + redrawDrawings() ikilisi)
        // tutarlı hale getirildi.
        setTimeout(() => {
            resizeAll();
            redrawDrawings();
        }, 200);
    }

    function setupRailCollapse() {
        const btn = byId('btn-toggle-rail');
        if (!btn) return;
        let collapsed = false;
        try { collapsed = localStorage.getItem(RAIL_COLLAPSED_KEY) === '1'; } catch (e) {}
        setRailCollapsed(collapsed);
        btn.addEventListener('click', () => {
            const container = document.querySelector('.dashboard-container');
            const isCollapsed = container ? container.classList.contains('tv-rail-collapsed') : false;
            setRailCollapsed(!isCollapsed);
        });
    }

    function setupFullscreenControl() {
        const btn = byId('btn-toggle-fullscreen');
        if (btn) btn.addEventListener('click', () => toggleFullscreen());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && fullscreenActive) { toggleFullscreen(false); return; }
            // (18 Temmuz 2026, onuncu oturum, ikinci tur) "F" kısayolu tam
            // ekranı aç/kapat — herhangi bir input/textarea'ya yazarken veya
            // bir modal açıkken (arama kutusu vb. metin girişini bozmamak
            // için) devre dışı, ayrıca Ctrl/Cmd/Alt ile kombinasyonları yok say.
            if (e.key === 'f' || e.key === 'F') {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                const tag = (e.target && e.target.tagName) || '';
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
                // Tüm modaller (gösterge/uyarı/SLTP/ısı haritası/kısayollar/
                // yardım) aynı paylaşılan .indicator-modal-backdrop sınıfını
                // kullanıyor — herhangi biri açıksa F kısayolunu tetikleme.
                const anyModalOpen = document.querySelector('.indicator-modal-backdrop.open');
                if (anyModalOpen) return;
                toggleFullscreen();
            }
        });
    }

    /* ────────── Osilatör panelini sürükleyerek yeniden boyutlandırma ────────── */

    // (18 Temmuz 2026, onuncu oturum) Çoklu-osilatör paneli: her aktif
    // gösterge kendi .tv-osc-pane'ini alıyor (bkz. ensureOscillatorPane()
    // aşağıda), bu yüzden hem yükseklik-sürükleme hem sıralama-sürükleme
    // artık DELEGASYON ile (#tv-subpanes-container üzerinde tek bir dinleyici,
    // panel sayısı runtime'da değişse de yeniden bağlanmaya gerek yok) tek
    // fonksiyonda birleştirildi — eski tekil setupSubpaneResize()'ın yerini alıyor.
    function setupSubpanesContainer() {
        const container = byId('tv-subpanes-container');
        if (!container) return;

        const MIN_H = 90;
        const MAX_H = 420;
        const RESIZE_STEP = 40; // Madde 16 — tek tıkla büyüt/küçült adımı
        let resizingPane = null;
        let startY = 0;
        let startH = 0;
        let draggingPane = null;

        function onResizeMove(e) {
            if (!resizingPane) return;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const delta = startY - clientY; // dragging UP increases pane height
            const newH = Math.min(MAX_H, Math.max(MIN_H, startH + delta));
            resizingPane.style.flexBasis = newH + 'px';
            // (2 Ağustos 2026 — revize planı madde 6) Eskiden burada SADECE
            // DOM kutusunun (flexBasis) yüksekliği güncelleniyordu; panelin
            // içindeki gerçek Lightweight Charts canvas'ı ise ancak fare
            // bırakıldığında (onResizeUp → resizeOscillatorPanes()) yeniden
            // boyutlandırılıyordu. Bu da sürükleme SIRASINDA panelin DOM
            // kutusu ile içindeki grafik/çizgilerin (RSI 70/30 referans
            // çizgileri, MACD sıfır çizgisi vb.) birbirinden kopmasına,
            // kutunun yeni sınırına göre değil ESKİ boyuta göre çizilmeye
            // devam etmesine yol açıyordu — kullanıcı bunu "boyutlandırma
            // diğer sınır çizgilerinden de ayar getiriyor" olarak
            // algılıyordu. Düzeltme: sürükleme sırasında da canvas'ı anlık
            // olarak yeniden boyutlandır (sadece resizingPane'i, gereksiz
            // yere tüm panelleri değil — performans için).
            const mount = resizingPane.querySelector('.tv-osc-chart-mount');
            const entry = Object.values(oscillatorPanes).find(p => p.el === resizingPane);
            if (mount && entry) {
                entry.chart.applyOptions({ width: mount.clientWidth, height: mount.clientHeight });
            }
        }

        function onResizeUp() {
            if (!resizingPane) return;
            resizingPane = null;
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeUp);
            document.removeEventListener('touchmove', onResizeMove);
            document.removeEventListener('touchend', onResizeUp);
            resizeOscillatorPanes();
        }

        function onReorderMove(e) {
            if (!draggingPane) return;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const siblings = Array.from(container.querySelectorAll('.tv-osc-pane:not(.dragging)'));
            let after = null;
            for (const sib of siblings) {
                const box = sib.getBoundingClientRect();
                if (clientY < box.top + box.height / 2) { after = sib; break; }
            }
            if (after) container.insertBefore(draggingPane, after);
            else container.appendChild(draggingPane);
        }

        function onReorderUp() {
            if (!draggingPane) return;
            draggingPane.classList.remove('dragging');
            draggingPane = null;
            document.removeEventListener('mousemove', onReorderMove);
            document.removeEventListener('mouseup', onReorderUp);
            document.removeEventListener('touchmove', onReorderMove);
            document.removeEventListener('touchend', onReorderUp);
            state.activeOscillators = Array.from(container.children).map(el => el.dataset.osc);
            saveActiveOscillators();
        }

        container.addEventListener('mousedown', (e) => {
            const resizeHandle = e.target.closest('.tv-subpane-resize-handle');
            if (resizeHandle) {
                resizingPane = resizeHandle.closest('.tv-osc-pane');
                if (!resizingPane) return;
                startY = e.clientY;
                startH = resizingPane.getBoundingClientRect().height;
                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeUp);
                e.preventDefault();
                return;
            }
            const dragHandle = e.target.closest('.tv-osc-drag-handle');
            if (dragHandle) {
                draggingPane = dragHandle.closest('.tv-osc-pane');
                if (!draggingPane) return;
                draggingPane.classList.add('dragging');
                document.addEventListener('mousemove', onReorderMove);
                document.addEventListener('mouseup', onReorderUp);
                e.preventDefault();
                return;
            }
            const resizeBtn = e.target.closest('.tv-osc-resize-btn');
            if (resizeBtn) {
                const pane = resizeBtn.closest('.tv-osc-pane');
                if (!pane) return;
                const currentH = pane.getBoundingClientRect().height;
                const dir = resizeBtn.dataset.oscResize === 'grow' ? 1 : -1;
                const newH = Math.min(MAX_H, Math.max(MIN_H, currentH + dir * RESIZE_STEP));
                pane.style.flexBasis = newH + 'px';
                resizeOscillatorPanes();
                return;
            }
            const closeBtn = e.target.closest('.tv-osc-close-btn');
            if (closeBtn) {
                const id = closeBtn.dataset.osc;
                state.activeOscillators = state.activeOscillators.filter(o => o !== id);
                saveActiveOscillators();
                const chk = document.querySelector('.osc-checkbox[data-osc="' + id + '"]');
                if (chk) chk.checked = false;
                renderAllOscillatorPanes();
            }
        });

        container.addEventListener('touchstart', (e) => {
            const resizeHandle = e.target.closest('.tv-subpane-resize-handle');
            if (resizeHandle) {
                resizingPane = resizeHandle.closest('.tv-osc-pane');
                if (!resizingPane) return;
                startY = e.touches[0].clientY;
                startH = resizingPane.getBoundingClientRect().height;
                document.addEventListener('touchmove', onResizeMove, { passive: true });
                document.addEventListener('touchend', onResizeUp);
                return;
            }
            const dragHandle = e.target.closest('.tv-osc-drag-handle');
            if (dragHandle) {
                draggingPane = dragHandle.closest('.tv-osc-pane');
                if (!draggingPane) return;
                draggingPane.classList.add('dragging');
                document.addEventListener('touchmove', onReorderMove, { passive: true });
                document.addEventListener('touchend', onReorderUp);
            }
        }, { passive: true });
    }

    function formatCandleDate(ts) {
        if (ts === null || ts === undefined || isNaN(ts)) return '--';
        const d = new Date(ts * 1000);
        const dateStr = d.toLocaleDateString('tr-TR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
        if (isIntradayResolution()) {
            const timeStr = d.toLocaleTimeString('tr-TR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
            return dateStr + ' ' + timeStr;
        }
        return dateStr;
    }

    /* ────────── Price scale mode (Linear / Logarithmic) ────────── */

    function setPriceScaleMode(mode) {
        if (!chart) return;
        state.priceScaleMode = mode === 'log' ? 'log' : 'normal';
        const isLog = state.priceScaleMode === 'log';
        chart.priceScale('right').applyOptions({
            mode: isLog ? LightweightCharts.PriceScaleMode.Logarithmic : LightweightCharts.PriceScaleMode.Normal
        });
        const label = byId('price-scale-mode-label');
        if (label) label.textContent = isLog ? 'Log' : 'Lin';
        const btn = byId('btn-price-scale-toggle');
        if (btn) btn.classList.toggle('active', isLog);
    }

    function setupPriceScaleToggle() {
        const btn = byId('btn-price-scale-toggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            setPriceScaleMode(state.priceScaleMode === 'log' ? 'normal' : 'log');
        });
    }

    /* ────────── Chart type engine (Tier 1: Candles/Hollow/Bars/Line/StepLine/Area/Baseline/HeikinAshi) ────────── */

    function computeHeikinAshi(candles) {
        const out = [];
        let prevHA = null;
        candles.forEach(c => {
            const haClose = (c.open + c.high + c.low + c.close) / 4;
            const haOpen = prevHA ? (prevHA.open + prevHA.close) / 2 : (c.open + c.close) / 2;
            const haHigh = Math.max(c.high, haOpen, haClose);
            const haLow = Math.min(c.low, haOpen, haClose);
            const ha = { date: c.date, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: c.volume };
            out.push(ha);
            prevHA = ha;
        });
        return out;
    }

    function applyChartType() {
        if (!chart || !candleSeries || !state.candles.length) return;

        if (typeSeries) {
            try { chart.removeSeries(typeSeries); } catch (e) { /* already gone */ }
            typeSeries = null;
        }

        const type = state.chartType;
        const isHeikin = type === 'heikin_ashi';
        const sourceCandles = isHeikin ? computeHeikinAshi(state.candles) : state.candles;
        const candleData = sourceCandles.map(c => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close }));

        if (type === 'candles' || type === 'hollow' || type === 'heikin_ashi') {
            candleSeries.applyOptions({
                visible: true,
                upColor: type === 'hollow' ? 'rgba(0,0,0,0)' : COLORS.up,
                downColor: type === 'hollow' ? 'rgba(0,0,0,0)' : COLORS.down,
                borderUpColor: COLORS.up,
                borderDownColor: COLORS.down,
                wickUpColor: COLORS.wickUp,
                wickDownColor: COLORS.wickDown,
                borderVisible: true
            });
            candleSeries.setData(candleData);
        } else {
            candleSeries.applyOptions({ visible: false });
            // Keep candleSeries data current even while hidden — it remains
            // the price-scale anchor for coordinate<->price conversion and
            // for drawing-tool hit testing.
            candleSeries.setData(candleData);

            if (type === 'bars') {
                typeSeries = chart.addBarSeries({
                    upColor: COLORS.up, downColor: COLORS.down, thinBars: false
                });
                typeSeries.setData(candleData);
            } else if (type === 'line' || type === 'step_line') {
                // (29 Temmuz 2026 — hocanın geri bildirimi, madde 5) "Adım
                // Çizgisi" (step_line) tipi, basamaklı (dik köşeli) çizim
                // biçimi yüzünden aynı kalınlıkta bile normal Çizgi tipinden
                // daha ince/zayıf görünüyordu — kalınlığı 2'den 3'e çıkarıldı.
                // Normal Çizgi (line) tipi bu şikayette anılmadı, 2'de bırakıldı.
                typeSeries = chart.addLineSeries({
                    color: COLORS.up, lineWidth: type === 'step_line' ? 3 : 2, priceLineVisible: true, lastValueVisible: true,
                    lineType: type === 'step_line' ? LightweightCharts.LineType.WithSteps : LightweightCharts.LineType.Simple
                });
                typeSeries.setData(sourceCandles.map(c => ({ time: c.date, value: c.close })));
            } else if (type === 'area') {
                typeSeries = chart.addAreaSeries({
                    lineColor: COLORS.up, topColor: 'rgba(212,175,55,0.35)', bottomColor: 'rgba(212,175,55,0.02)',
                    lineWidth: 2, priceLineVisible: true, lastValueVisible: true
                });
                typeSeries.setData(sourceCandles.map(c => ({ time: c.date, value: c.close })));
            } else if (type === 'baseline') {
                const avg = sourceCandles.reduce((s, c) => s + c.close, 0) / sourceCandles.length;
                typeSeries = chart.addBaselineSeries({
                    baseValue: { type: 'price', price: avg },
                    topLineColor: COLORS.baselineTop, topFillColor1: 'rgba(212,175,55,0.28)', topFillColor2: 'rgba(212,175,55,0.02)',
                    bottomLineColor: COLORS.baselineBottom, bottomFillColor1: 'rgba(239,83,80,0.28)', bottomFillColor2: 'rgba(239,83,80,0.02)',
                    lineWidth: 2, priceLineVisible: true, lastValueVisible: true
                });
                typeSeries.setData(sourceCandles.map(c => ({ time: c.date, value: c.close })));
            }
        }

        applyVolumeVisibility();
        redrawDrawings();
        applySignalMarkersForCurrentState();
    }

    function applyVolumeVisibility() {
        if (!chart || !state.candles.length) return;
        if (state.showVolume) {
            if (!volumeSeries) {
                volumeSeries = chart.addHistogramSeries({
                    priceFormat: { type: 'volume' },
                    priceScaleId: 'optipulse-vol',
                    color: COLORS.volUp
                });
                chart.priceScale('optipulse-vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
            }
            const volData = state.candles.map(c => ({
                time: c.date,
                value: c.volume || 0,
                color: c.close >= c.open ? COLORS.volUp : COLORS.volDown
            }));
            volumeSeries.setData(volData);
            volumeSeries.applyOptions({ visible: true });
        } else if (volumeSeries) {
            volumeSeries.applyOptions({ visible: false });
        }
    }

    function setChartType(type) {
        if (!CHART_TYPES.some(t => t.id === type)) return;
        state.chartType = type;
        applyChartType();
    }

    function setVolumeVisible(on) {
        state.showVolume = !!on;
        applyVolumeVisibility();
    }

    function setSymbolHeader(ticker, price, prevClose) {
        const logoEl = byId('tv-symbol-logo');
        const nameEl = byId('tv-symbol-name');
        const priceEl = byId('tv-last-price');
        const chgEl = byId('tv-price-change');
        if (logoEl) {
            logoEl.innerHTML = (ticker && window.DataController)
                ? window.DataController.buildLogoHtml(ticker, 22)
                : '';
        }
        // (29 Temmuz 2026 — hocanın geri bildirimi, madde 2) Önceden burada
        // sembol adı bilerek "${ticker}.IS" (ör. "AKSEN.IS") olarak
        // gösteriliyordu — muhtemelen backend/yfinance formatını yansıtmak
        // içindi ama kullanıcı için anlamsız/kafa karıştırıcı görünüyordu.
        // Backend'e giden gerçek istek zaten kendi ".IS" ekleme mantığını
        // (format_ticker()) ayrıca uyguluyor, bu ekranda göstermeye gerek yok.
        if (nameEl) nameEl.textContent = ticker || '---';
        // (27 Ağustos 2026 — "hisse seçtikten sonra çok yavaş" algısal hız
        // düzeltmesi) price === null artık SADECE "---" göstermek yerine,
        // hafifçe nabız atan bir "Yükleniyor…" durumu gösteriyor — ayrıca
        // grafik konteynerini de hafifçe soluklaştırıyor (tv-chart-refreshing)
        // ki kullanıcı sembol değişiminin GERÇEKTEN sürdüğünü, uygulamanın
        // donmadığını hemen anlasın. Gerçek veri gelince (bu fonksiyon
        // gerçek bir price ile tekrar çağrılınca) ikisi de otomatik geri
        // alınır — hiçbir yeni state/temizlik mantığı gerekmiyor.
        if (priceEl) {
            if (price !== null) {
                priceEl.textContent = '₺' + fmtPrice(price);
                priceEl.classList.remove('tv-loading-text');
            } else {
                priceEl.textContent = 'Yükleniyor…';
                priceEl.classList.add('tv-loading-text');
            }
        }
        if (chgEl) {
            if (price !== null && prevClose) {
                const chg = ((price - prevClose) / prevClose) * 100;
                chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
                chgEl.className = 'tv-price-change ' + (chg >= 0 ? 'profit-text' : 'loss-text');
            } else {
                chgEl.textContent = '';
            }
        }
        if (chartContainer) {
            chartContainer.classList.toggle('tv-chart-refreshing', price === null);
        }
    }

    /* ────────── Live tick update (updates last bar only) ────────── */

    function updateLastPrice(ticker, price) {
        if (!chart || !candleSeries) return;
        // (25 Ağustos 2026 — sembol geçişi yarış durumu düzeltmesi) `ticker ===
        // state.ticker` tek başına yeterli değil: state.ticker, loadSymbol()
        // içinde ASENKRON veri isteği başlamadan HEMEN ÖNCE güncelleniyor —
        // yani "hedef sembol bu" demek, "bu sembolün gerçek verisi zaten
        // yüklendi" demek değil. `dataReady` bayrağı olmadan, sembol
        // değiştirilirken gelen bir canlı tik, HÂLÂ eski sembole ait olan
        // state.candles/dailyCandles dizisinin son barına yeni sembolün
        // fiyatını yazabiliyor ve grafiği kısa süreliğine bozuyordu.
        if (ticker !== state.ticker || !state.dataReady || !state.candles.length) return;

        // Keep the underlying daily source-of-truth candle in sync too, so a
        // mid-session resolution switch (e.g. 1D -> 1H) re-derives from the
        // latest live price instead of snapping back to the pre-tick close.
        if (state.dailyCandles.length) {
            const lastDaily = state.dailyCandles[state.dailyCandles.length - 1];
            lastDaily.close = price;
            if (price > lastDaily.high) lastDaily.high = price;
            if (price < lastDaily.low) lastDaily.low = price;
        }

        const last = state.candles[state.candles.length - 1];
        last.close = price;
        if (price > last.high) last.high = price;
        if (price < last.low) last.low = price;

        if (state.chartType === 'heikin_ashi') {
            // Heikin Ashi bars are derived from the whole series (each bar
            // depends on the previous HA bar), so a single-bar `.update()`
            // isn't correct here — recompute is cheap at this dataset size.
            applyChartType();
        } else {
            candleSeries.update({ time: last.date, open: last.open, high: last.high, low: last.low, close: last.close });
            if (typeSeries) {
                if (state.chartType === 'bars') {
                    typeSeries.update({ time: last.date, open: last.open, high: last.high, low: last.low, close: last.close });
                } else {
                    typeSeries.update({ time: last.date, value: last.close });
                }
            }
            if (volumeSeries && state.showVolume) {
                volumeSeries.update({
                    time: last.date, value: last.volume || 0,
                    color: last.close >= last.open ? COLORS.volUp : COLORS.volDown
                });
            }
        }

        // (25 Ağustos 2026 — % değişim tutarlılık düzeltmesi) Burada önceden
        // state.candles (aktif çözünürlüğe göre türetilmiş dizi — 15dk/1sa/4sa
        // görünümünde GÜNLÜK değil o zaman dilimine ait mumlar) kullanılıyordu.
        // Bu, 1D dışındaki bir zaman diliminde her canlı tikte header'daki
        // %değişimin "günün değişimi" yerine "son mumla bir önceki mum
        // arasındaki fark" olarak hesaplanmasına yol açıyordu — izleme
        // listesindeki (backend'in gerçek prevClose'undan hesaplanan) yüzdeyle
        // uyuşmuyordu. İlk render (loadSymbol içindeki setSymbolHeader çağrısı)
        // zaten doğru şekilde state.dailyCandles kullanıyordu; burası da aynı
        // kaynağa taşındı ki iki yer arasında asla drift olmasın.
        const dailyPrev = state.dailyCandles.length > 1
            ? state.dailyCandles[state.dailyCandles.length - 2].close
            : last.open;
        setSymbolHeader(ticker, price, dailyPrev);
    }

    /* ────────── Overlay indicators on main chart ────────── */

    function renderOverlays() {
        if (!chart || !candleSeries) return;
        // Clear existing overlay series
        Object.values(overlaySeries).forEach(s => { try { chart.removeSeries(s); } catch (e) {} });
        overlaySeries = {};
        // Pivot Points çizgileri ayrı candleSeries.removePriceLine() ile temizlenir
        // (bkz. pivotPriceLines tanımı) — chart.removeSeries() burada geçerli değil.
        pivotPriceLines.forEach(line => { try { candleSeries.removePriceLine(line); } catch (e) {} });
        pivotPriceLines = [];

        if (!state.indicators || !state.candles.length) return;
        const dates = state.candles.map(c => c.date);
        const ind = state.indicators;

        const vis = {
            sma20: checked('chk-sma20'),
            sma50: checked('chk-sma50'),
            sma200: checked('chk-sma200'),
            ema9: checked('chk-ema9'),
            ema21: checked('chk-ema21'),
            wma20: checked('chk-wma20'),
            bollinger: checked('chk-bollinger'),
            vwap: checked('chk-vwap'),
            ichimoku: checked('chk-ichimoku'),
            psar: checked('chk-psar'),
            pivot: checked('chk-pivot'),
            supertrend: checked('chk-supertrend'),
            keltner: checked('chk-keltner'),
            donchian: checked('chk-donchian')
        };

        const addLine = (key, values, color, opts = {}) => {
            const series = chart.addLineSeries({
                color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false,
                crosshairMarkerVisible: false, ...opts
            });
            series.setData(seriesFromValues(dates, values));
            overlaySeries[key] = series;
        };

        if (vis.sma20)  addLine('sma20', ind.sma20, COLORS.sma20);
        if (vis.sma50)  addLine('sma50', ind.sma50, COLORS.sma50);
        if (vis.sma200) addLine('sma200', ind.sma200, COLORS.sma200);
        if (vis.ema9)   addLine('ema9', ind.ema9, COLORS.ema9, { lineStyle: LightweightCharts.LineStyle.Dashed });
        if (vis.ema21)  addLine('ema21', ind.ema21, COLORS.ema21, { lineStyle: LightweightCharts.LineStyle.Dashed });
        if (vis.wma20)  addLine('wma20', ind.wma20, COLORS.wma20);
        if (vis.vwap)   addLine('vwap', ind.vwap, COLORS.vwap, { lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 2 });

        if (vis.bollinger) {
            addLine('bbUpper', ind.bollingerUpper, COLORS.bbLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
            addLine('bbLower', ind.bollingerLower, COLORS.bbLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
        }

        // Ichimoku Cloud: 5 çizgi (Senkou A/B, gerçek verilerden hesaplanan
        // ama sahte gelecek bar EKLENMEDEN çizilen bulut dahil — bkz.
        // dataController.js computeIchimoku() yorum bloğu).
        if (vis.ichimoku && ind.ichimoku) {
            addLine('ichiTenkan', ind.ichimoku.tenkan, COLORS.ichimokuTenkan, { lineWidth: 1 });
            addLine('ichiKijun', ind.ichimoku.kijun, COLORS.ichimokuKijun, { lineWidth: 1 });
            addLine('ichiSenkouA', ind.ichimoku.senkouA, COLORS.ichimokuSenkouA, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
            addLine('ichiSenkouB', ind.ichimoku.senkouB, COLORS.ichimokuSenkouB, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
            addLine('ichiChikou', ind.ichimoku.chikou, COLORS.ichimokuChikou, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
        }

        // Parabolic SAR: klasik izole-nokta gösterimi yerine ince noktalı
        // çizgi olarak çiziliyor (dürüst basitleştirme — bkz. dataController.js).
        if (vis.psar && ind.psar) {
            addLine('psar', ind.psar, COLORS.psar, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, crosshairMarkerVisible: false });
        }

        // Pivot Points: zaman serisi değil, son tamamlanmış bardan hesaplanan
        // yatay destek/direnç seviyeleri — RSI'nin 70/30 çizgileriyle aynı
        // createPriceLine() deseni.
        if (vis.pivot && ind.pivotPoints && candleSeries) {
            const pp = ind.pivotPoints;
            const addPivotLine = (price, title, color) => {
                if (price === null || price === undefined) return;
                const line = candleSeries.createPriceLine({
                    price, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed,
                    axisLabelVisible: true, title
                });
                pivotPriceLines.push(line);
            };
            addPivotLine(pp.p, 'P', COLORS.pivot);
            addPivotLine(pp.r1, 'R1', COLORS.pivotR);
            addPivotLine(pp.r2, 'R2', COLORS.pivotR);
            addPivotLine(pp.r3, 'R3', COLORS.pivotR);
            addPivotLine(pp.s1, 'S1', COLORS.pivotS);
            addPivotLine(pp.s2, 'S2', COLORS.pivotS);
            addPivotLine(pp.s3, 'S3', COLORS.pivotS);
        }

        // SuperTrend: iki ayrı seri (yükseliş/düşüş segmenti) — bkz.
        // dataController.js computeSuperTrend() yorum bloğu (dürüst
        // basitleştirme: nokta-bazlı renk API'si yerine null-boşluklu
        // iki çizgi kullanılıyor).
        if (vis.supertrend && ind.supertrend) {
            addLine('supertrendUp', ind.supertrend.up, COLORS.supertrendUp, { lineWidth: 2 });
            addLine('supertrendDown', ind.supertrend.down, COLORS.supertrendDown, { lineWidth: 2 });
        }

        if (vis.keltner && ind.keltner) {
            addLine('keltnerUpper', ind.keltner.upper, COLORS.keltnerLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
            addLine('keltnerMiddle', ind.keltner.middle, COLORS.keltnerLine, { lineWidth: 1 });
            addLine('keltnerLower', ind.keltner.lower, COLORS.keltnerLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
        }

        if (vis.donchian && ind.donchian) {
            addLine('donchianUpper', ind.donchian.upper, COLORS.donchianLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
            addLine('donchianLower', ind.donchian.lower, COLORS.donchianLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
        }

        updateLegend(vis);
    }

    function seriesFromValues(dates, values) {
        const out = [];
        for (let i = 0; i < dates.length; i++) {
            if (values[i] === null || values[i] === undefined) continue;
            out.push({ time: dates[i], value: values[i] });
        }
        return out;
    }

    function checked(id) {
        const el = byId(id);
        return el ? el.checked : false;
    }

    // TradingView-style removable chips: label -> {color, checkboxId}
    const LEGEND_CHIP_DEFS = [
        { key: 'sma20',     label: 'SMA20',      colorKey: 'sma20',  chk: 'chk-sma20' },
        { key: 'sma50',     label: 'SMA50',      colorKey: 'sma50',  chk: 'chk-sma50' },
        { key: 'sma200',    label: 'SMA200',     colorKey: 'sma200', chk: 'chk-sma200' },
        { key: 'ema9',      label: 'EMA9',       colorKey: 'ema9',   chk: 'chk-ema9' },
        { key: 'ema21',     label: 'EMA21',      colorKey: 'ema21',  chk: 'chk-ema21' },
        { key: 'wma20',     label: 'WMA20',      colorKey: 'wma20',  chk: 'chk-wma20' },
        { key: 'bollinger', label: 'BB(20,2)',   colorKey: 'bbLine', chk: 'chk-bollinger' },
        { key: 'vwap',      label: 'VWAP',       colorKey: 'vwap',   chk: 'chk-vwap' },
        { key: 'ichimoku',  label: 'Ichimoku',   colorKey: 'ichimokuKijun', chk: 'chk-ichimoku' },
        { key: 'psar',      label: 'Parabolic SAR', colorKey: 'psar', chk: 'chk-psar' },
        { key: 'pivot',     label: 'Pivot Points', colorKey: 'pivot', chk: 'chk-pivot' },
        { key: 'supertrend', label: 'SuperTrend', colorKey: 'supertrendUp', chk: 'chk-supertrend' },
        { key: 'keltner',   label: 'Keltner',     colorKey: 'keltnerLine', chk: 'chk-keltner' },
        { key: 'donchian',  label: 'Donchian',    colorKey: 'donchianLine', chk: 'chk-donchian' }
    ];

    function updateLegend(vis) {
        const legend = byId('tv-overlay-legend');
        if (!legend) return;
        legend.innerHTML = '';
        LEGEND_CHIP_DEFS.forEach(def => {
            if (!vis[def.key]) return;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'tv-indicator-chip';
            chip.dataset.chk = def.chk;
            chip.title = 'Kaldırmak için tıkla';
            chip.innerHTML = '<span class="tv-chip-dot" style="background:' + COLORS[def.colorKey] + '"></span>' +
                '<span>' + def.label + '</span>' +
                '<span class="tv-chip-remove">×</span>';
            chip.addEventListener('click', () => {
                const el = byId(def.chk);
                if (el) { el.checked = false; el.dispatchEvent(new Event('change')); }
            });
            legend.appendChild(chip);
        });
    }

    function setupOverlayCheckboxes() {
        ['chk-sma20', 'chk-sma50', 'chk-sma200', 'chk-ema9', 'chk-ema21', 'chk-wma20', 'chk-bollinger', 'chk-vwap', 'chk-ichimoku', 'chk-psar', 'chk-pivot', 'chk-supertrend', 'chk-keltner', 'chk-donchian'].forEach(id => {
            const el = byId(id);
            if (el) el.addEventListener('change', renderOverlays);
        });
    }

    /* ────────── Çoklu-osilatör paneli ────────── */

    // Her .osc-checkbox aynı anda birden fazla işaretlenebilir; işaretli
    // olanların tam kümesi state.activeOscillators'ta tutulur ve her
    // değişiklikte localStorage'a yazılır (setupSubpanesContainer()'daki
    // sürükle-sırala da aynı diziyi günceller — bkz. onReorderUp()).
    function setupOscillatorCheckboxes() {
        const checkboxes = document.querySelectorAll('.osc-checkbox');
        if (!checkboxes.length) return;
        checkboxes.forEach(cb => {
            cb.checked = state.activeOscillators.includes(cb.dataset.osc);
            cb.addEventListener('change', () => {
                const id = cb.dataset.osc;
                if (cb.checked) {
                    if (!state.activeOscillators.includes(id)) state.activeOscillators.push(id);
                } else {
                    state.activeOscillators = state.activeOscillators.filter(o => o !== id);
                }
                saveActiveOscillators();
                renderAllOscillatorPanes();
            });
        });

        setupCustomRsiInstance();
    }

    // (2 Ağustos 2026 — revize planı madde 7) "Farklı periyotlu RSI ekle"
    // düğmesi — girilen periyotla 'rsi:<periyot>' kimlikli YENİ bir osilatör
    // paneli açar (mevcut varsayılan 'rsi' (14) panelinin YANINDA, onu
    // DEĞİŞTİRMEDEN). Panel, diğer tüm osilatör panelleri gibi kendi
    // başlığındaki × düğmesiyle kapatılabilir — ek bir "kaldır" arayüzüne
    // gerek yok, mevcut mekanizma zaten id'ye bakmaksızın genel çalışıyor.
    function setupCustomRsiInstance() {
        const btn = byId('btn-add-custom-rsi');
        const input = byId('rsi-custom-period-input');
        if (!btn || !input || btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => {
            let period = parseInt(input.value, 10);
            if (!Number.isFinite(period) || period < 2) period = 20;
            if (period > 200) period = 200;
            input.value = period;
            const id = 'rsi:' + period;
            if (state.activeOscillators.includes(id)) return; // zaten ekli
            state.activeOscillators.push(id);
            saveActiveOscillators();
            renderAllOscillatorPanes();
        });
    }

    // Belirli bir osilatör id'si için pane DOM'unu + kendi hafif chart
    // örneğini oluşturur (zaten varsa mevcut olanı döndürür). Ayrı örnek
    // kullanmamızın nedeni: ana grafiğin çizim/gösterge motorunu her panelde
    // ÇOĞALTMAK yerine, Dual-Chart'ta olduğu gibi sade, salt-okunur bir
    // fiyat/seri görünümü yeterli — mimari risk açısından çok daha güvenli.
    function ensureOscillatorPane(id) {
        if (oscillatorPanes[id]) return oscillatorPanes[id];
        const container = byId('tv-subpanes-container');
        if (!container || !window.LightweightCharts) return null;

        const paneEl = document.createElement('div');
        paneEl.className = 'tv-osc-pane';
        paneEl.dataset.osc = id;
        paneEl.style.flexBasis = '150px';
        paneEl.innerHTML =
            '<div class="tv-osc-pane-header">' +
                '<span class="tv-osc-drag-handle" title="Sürükleyerek sırala">⋮⋮</span>' +
                '<span class="tv-osc-title"></span>' +
                // (29 Temmuz 2026 — Madde 16) Sürükleme tutamacına ek olarak,
                // tek tıkla sabit adımlarla büyüt/küçült butonları.
                '<span class="tv-osc-resize-btn" data-osc-resize="shrink" data-osc="' + id + '" title="Küçült">−</span>' +
                '<span class="tv-osc-resize-btn" data-osc-resize="grow" data-osc="' + id + '" title="Büyüt">+</span>' +
                '<span class="tv-osc-close-btn" data-osc="' + id + '" title="Paneli kapat">×</span>' +
            '</div>' +
            '<div class="tv-osc-chart-mount"></div>' +
            '<div class="tv-subpane-resize-handle"><span></span></div>';
        container.appendChild(paneEl);

        const mount = paneEl.querySelector('.tv-osc-chart-mount');
        const paneChart = LightweightCharts.createChart(mount, baseChartOptions(mount, true));
        // Bu panelde kaydırma/yakınlaştırma yapılırsa ana grafiğe (ve
        // oradan da diğer tüm panellere, init()'teki abonelik zinciriyle)
        // yansısın.
        paneChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range && chart) chart.timeScale().setVisibleLogicalRange(range);
        });

        const entry = { el: paneEl, chart: paneChart, series: {} };
        oscillatorPanes[id] = entry;
        return entry;
    }

    function destroyOscillatorPane(id) {
        const entry = oscillatorPanes[id];
        if (!entry) return;
        try { entry.chart.remove(); } catch (e) {}
        if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        delete oscillatorPanes[id];
    }

    // Belirli bir osilatör tipi için seri(ler)i verilen pane-chart üzerine
    // kurar. Eski tekil renderOscillatorPane()'in tip-bazlı gövdesinin
    // aynısı — sadece artık "hangi chart'a çizileceği" parametre olarak
    // geliyor, ayrıca yeni 'willr' (Williams %R) dalı eklendi.
    function buildOscillatorSeries(paneChart, type, ind, dates) {
        const series = {};
        // (2 Ağustos 2026 — revize planı madde 7) 'rsi:20' gibi özel periyotlu
        // kimlikler için taban tipe (parsed.base) göre meta/seri seçimi
        // yapılıyor; başlık de periyotu yansıtacak şekilde dinamik kuruluyor.
        const parsed = parseOscType(type);
        const title = parsed.period
            ? (OSCILLATOR_META[parsed.base] ? OSCILLATOR_META[parsed.base].title.replace(/\(\d+.*?\)/, '(' + parsed.period + ')') : type)
            : ((OSCILLATOR_META[type] && OSCILLATOR_META[type].title) || type);

        if (parsed.base === 'rsi') {
            // Varsayılan (periyotsuz) 'rsi' kimliği hâlâ önceden hesaplanmış
            // ind.rsi14'ü kullanıyor (performans — tekrar hesaplamaya gerek
            // yok); özel periyotlu bir örnekse (ör. 'rsi:20') o periyotla
            // DataController.computeRSI() DOĞRUDAN çağrılıyor.
            const rsiValues = parsed.period
                ? (window.DataController.computeRSI(state.candles.map(c => c.close), parsed.period))
                : ind.rsi14;
            series.rsi = paneChart.addLineSeries({ color: COLORS.oscillatorAccent, lineWidth: 1.5, priceLineVisible: false });
            series.rsi.setData(seriesFromValues(dates, rsiValues));
            series.rsi.createPriceLine({ price: 70, color: 'rgba(244,67,54,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '70' });
            series.rsi.createPriceLine({ price: 30, color: 'rgba(76,175,80,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '30' });
        } else if (type === 'macd') {
            series.hist = paneChart.addHistogramSeries({ priceLineVisible: false, color: '#42A5F5' });
            series.hist.setData(seriesFromValues(dates, ind.macd.histogram).map(p => ({
                time: p.time, value: p.value, color: p.value >= 0 ? 'rgba(76,175,80,0.55)' : 'rgba(244,67,54,0.55)'
            })));
            series.macd = paneChart.addLineSeries({ color: COLORS.oscillatorAccent, lineWidth: 1.5, priceLineVisible: false });
            series.macd.setData(seriesFromValues(dates, ind.macd.macdLine));
            series.signal = paneChart.addLineSeries({ color: '#42A5F5', lineWidth: 1.5, priceLineVisible: false });
            series.signal.setData(seriesFromValues(dates, ind.macd.signalLine));
        } else if (type === 'stoch') {
            series.k = paneChart.addLineSeries({ color: COLORS.oscillatorAccent, lineWidth: 1.5, priceLineVisible: false });
            series.k.setData(seriesFromValues(dates, ind.stochastic.k));
            series.d = paneChart.addLineSeries({ color: '#42A5F5', lineWidth: 1.5, priceLineVisible: false });
            series.d.setData(seriesFromValues(dates, ind.stochastic.d));
        } else if (type === 'atr') {
            series.atr = paneChart.addLineSeries({ color: '#EF6C00', lineWidth: 1.5, priceLineVisible: false });
            series.atr.setData(seriesFromValues(dates, ind.atr14));
        } else if (type === 'adx') {
            series.adx = paneChart.addLineSeries({ color: '#AB47BC', lineWidth: 1.5, priceLineVisible: false });
            series.adx.setData(seriesFromValues(dates, ind.adx14));
        } else if (type === 'obv') {
            series.obv = paneChart.addLineSeries({ color: '#26A69A', lineWidth: 1.5, priceLineVisible: false });
            series.obv.setData(seriesFromValues(dates, ind.obv));
        } else if (type === 'willr') {
            series.willr = paneChart.addLineSeries({ color: '#EC407A', lineWidth: 1.5, priceLineVisible: false });
            series.willr.setData(seriesFromValues(dates, ind.willr14));
            series.willr.createPriceLine({ price: -20, color: 'rgba(244,67,54,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '-20' });
            series.willr.createPriceLine({ price: -80, color: 'rgba(76,175,80,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '-80' });
        } else if (type === 'cci') {
            series.cci = paneChart.addLineSeries({ color: '#7E57C2', lineWidth: 1.5, priceLineVisible: false });
            series.cci.setData(seriesFromValues(dates, ind.cci20));
            series.cci.createPriceLine({ price: 100, color: 'rgba(244,67,54,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '100' });
            series.cci.createPriceLine({ price: -100, color: 'rgba(76,175,80,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '-100' });
        } else if (type === 'mfi') {
            series.mfi = paneChart.addLineSeries({ color: '#FF7043', lineWidth: 1.5, priceLineVisible: false });
            series.mfi.setData(seriesFromValues(dates, ind.mfi14));
            series.mfi.createPriceLine({ price: 80, color: 'rgba(244,67,54,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '80' });
            series.mfi.createPriceLine({ price: 20, color: 'rgba(76,175,80,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '20' });
        }

        return { series, title };
    }

    // state.activeOscillators ile DOM'daki panelleri senkronize eder:
    // artık aktif olmayanları yok eder, hâlâ/yeni aktif olanları
    // oluşturur ya da yeniden çizer. resolution/sembol değişince (bkz.
    // applyResolution()) ve checkbox tıklanınca bu fonksiyon çağrılır.
    function renderAllOscillatorPanes() {
        if (!chart || !candleSeries) return;
        const active = state.activeOscillators || [];

        Object.keys(oscillatorPanes).forEach(id => {
            if (!active.includes(id)) destroyOscillatorPane(id);
        });

        if (!state.indicators || !state.candles.length) return;
        const dates = state.candles.map(c => c.date);
        const ind = state.indicators;

        active.forEach(id => {
            const entry = ensureOscillatorPane(id);
            if (!entry) return;
            Object.values(entry.series).forEach(s => { try { entry.chart.removeSeries(s); } catch (e) {} });
            entry.series = {};
            const built = buildOscillatorSeries(entry.chart, id, ind, dates);
            entry.series = built.series;
            const titleEl = entry.el.querySelector('.tv-osc-title');
            if (titleEl) titleEl.textContent = built.title;
        });

        // Panellerin zaman eksenini ana grafikle hizala.
        const range = chart.timeScale().getVisibleLogicalRange();
        if (range) {
            Object.values(oscillatorPanes).forEach(p => p.chart.timeScale().setVisibleLogicalRange(range));
        }

        resizeOscillatorPanes();
    }

    function resizeOscillatorPanes() {
        Object.values(oscillatorPanes).forEach(p => {
            const mount = p.el.querySelector('.tv-osc-chart-mount');
            if (mount) p.chart.applyOptions({ width: mount.clientWidth, height: mount.clientHeight });
        });
    }

    /* ────────── Indicator picker modal (open/close + search) ────────── */

    function setupIndicatorModal() {
        const openBtn = byId('btn-open-indicators');
        const closeBtn = byId('btn-close-indicators');
        const backdrop = byId('indicator-modal-backdrop');
        const searchInput = byId('indicator-search-input');
        if (!openBtn || !backdrop) return;

        const open = () => {
            // Only one modal at a time — close any other modal that's open.
            if (window.__optipulseCloseOtherModals) {
                window.__optipulseCloseOtherModals('indicator-modal-backdrop');
            }

            backdrop.classList.add('open');
            if (searchInput) { searchInput.value = ''; filterIndicatorList(''); searchInput.focus(); }
        };
        const close = () => backdrop.classList.remove('open');

        openBtn.addEventListener('click', open);
        if (closeBtn) closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
        });

        if (searchInput) {
            searchInput.addEventListener('input', () => filterIndicatorList(searchInput.value));
        }

        setupIndicatorCopyPaste();
    }

    function filterIndicatorList(query) {
        const q = query.trim().toLowerCase();
        const items = document.querySelectorAll('.indicator-search-item');
        let anyVisible = false;
        items.forEach(item => {
            const haystack = (item.dataset.search || '') + ' ' + item.textContent.toLowerCase();
            const match = !q || haystack.toLowerCase().includes(q);
            item.style.display = match ? '' : 'none';
            if (match) anyVisible = true;
        });
        // Hide whole category blocks if every item inside is filtered out.
        // ÖNEMLİ (18 Temmuz 2026, onuncu oturum, beşinci tur — bulunan gerçek
        // bir hata): bu sorgu önceden TÜM DOKÜMAN genelinde ".indicator-modal-category"
        // arıyordu, ama bu sınıf Yardım/Hakkında ve Klavye Kısayolları modallarında
        // da (data-category-label ile) kullanılıyor — o modallarda hiç
        // ".indicator-search-item" elemanı olmadığından, Göstergeler modalı bir kez
        // açılıp bu fonksiyon çalıştığında (arama kutusu her açılışta sıfırlanırken
        // otomatik tetikleniyor), Yardım/Kısayollar modallarının TÜM bölümleri
        // kalıcı olarak "display:none" oluyordu — bu modallar daha sonra açıldığında
        // (ör. tanıtım turunda) tamamen boş görünüyordu. Artık sorgu SADECE
        // Göstergeler modalının kendi içindeki kategorilerle sınırlı.
        document.querySelectorAll('#indicator-modal-backdrop .indicator-modal-category').forEach(cat => {
            const visibleChildren = cat.querySelectorAll('.indicator-search-item:not([style*="display: none"])');
            cat.style.display = visibleChildren.length ? '' : 'none';
        });
        const empty = byId('indicator-modal-empty');
        if (empty) empty.style.display = anyVisible ? 'none' : 'block';
    }

    /* ────────── Copy/paste indicator settings between symbols ────────── */

    let copiedIndicatorSettings = null;

    function setupIndicatorCopyPaste() {
        const copyBtn = byId('btn-copy-indicators');
        const pasteBtn = byId('btn-paste-indicators');
        if (!copyBtn || !pasteBtn) return;

        copyBtn.addEventListener('click', () => {
            copiedIndicatorSettings = {
                overlays: {},
                activeOscillators: state.activeOscillators.slice()
            };
            ['chk-sma20', 'chk-sma50', 'chk-sma200', 'chk-ema9', 'chk-ema21', 'chk-wma20', 'chk-bollinger', 'chk-vwap'].forEach(id => {
                const el = byId(id);
                copiedIndicatorSettings.overlays[id] = el ? el.checked : false;
            });
            pasteBtn.disabled = false;
            pasteBtn.title = 'Kopyalanan ayarları yapıştır (' + state.ticker + ' sembolünden)';
            copyBtn.textContent = 'Kopyalandı ✓';
            setTimeout(() => { copyBtn.textContent = 'Ayarları Kopyala'; }, 1400);
        });

        pasteBtn.addEventListener('click', () => {
            if (!copiedIndicatorSettings) return;
            Object.keys(copiedIndicatorSettings.overlays).forEach(id => {
                const el = byId(id);
                if (el) el.checked = copiedIndicatorSettings.overlays[id];
            });
            renderOverlays();
            state.activeOscillators = copiedIndicatorSettings.activeOscillators.slice();
            saveActiveOscillators();
            document.querySelectorAll('.osc-checkbox').forEach(cb => {
                cb.checked = state.activeOscillators.includes(cb.dataset.osc);
            });
            renderAllOscillatorPanes();
            pasteBtn.textContent = 'Yapıştırıldı ✓';
            setTimeout(() => { pasteBtn.textContent = 'Yapıştır'; }, 1400);
        });
    }

    /* ────────── Crosshair -> OHLC legend ────────── */

    function handleCrosshairMove(param) {
        const legend = byId('tv-ohlc-legend');
        if (!legend) return;
        if (!param || !param.time || !state.candles.length) {
            legend.style.display = 'none';
            return;
        }
        const candle = state.candles.find(c => c.date === param.time);
        if (!candle) { legend.style.display = 'none'; return; }

        const isUp = candle.close >= candle.open;
        legend.style.display = 'flex';
        legend.innerHTML = `
            <span class="ohlc-date">${formatCandleDate(candle.date)}</span>
            <span>O <b class="${isUp ? 'profit-text' : 'loss-text'}">${fmtPrice(candle.open)}</b></span>
            <span>H <b class="${isUp ? 'profit-text' : 'loss-text'}">${fmtPrice(candle.high)}</b></span>
            <span>L <b class="${isUp ? 'profit-text' : 'loss-text'}">${fmtPrice(candle.low)}</b></span>
            <span>C <b class="${isUp ? 'profit-text' : 'loss-text'}">${fmtPrice(candle.close)}</b></span>
        `;
    }

    /* ════════════════════════════════════════════════
       DRAWING TOOLS (custom canvas overlay)
       ════════════════════════════════════════════════ */

    function setupDrawCanvas() {
        drawCanvas = byId('tv-draw-overlay');
        if (!drawCanvas) return;
        drawCtx = drawCanvas.getContext('2d');
        resizeDrawCanvas();

        drawCanvas.addEventListener('mousedown', onDrawStart);
        window.addEventListener('mousemove', onDrawMove);
        window.addEventListener('mouseup', onDrawEnd);
    }

    function resizeDrawCanvas() {
        if (!drawCanvas || !chartContainer) return;
        const dpr = window.devicePixelRatio || 1;
        const plot = getPlotRect();
        // Overlay, Lightweight Charts'ın sağ fiyat skalasının (ve varsa alt
        // zaman ekseninin) ÜSTÜNE binmesin diye yalnızca plot alanına
        // oturtulur. Koordinat sistemi hâlâ soldan 0'dan başladığı için
        // logicalToCoordinate / priceToCoordinate değerleri birebir uyumlu.
        drawCanvas.style.left = plot.x + 'px';
        drawCanvas.style.top = plot.y + 'px';
        drawCanvas.style.width = plot.width + 'px';
        drawCanvas.style.height = plot.height + 'px';
        drawCanvas.width = Math.max(1, plot.width * dpr);
        drawCanvas.height = Math.max(1, plot.height * dpr);
        if (drawCtx) drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Mumların çizildiği alan (sağ fiyat etiketi şeridi HARİÇ). Trend
    // çizgisi / ışın / yatay çizgi gibi overlay şekilleri bu dikdörtgenin
    // dışına taşmamalı — aksi halde çizgi "70.00" gibi fiyat skalasının
    // üzerine biner (kullanıcı geri bildirimi, 29 Ağustos 2026).
    function getPlotRect() {
        const fallback = { x: 0, y: 0, width: 0, height: 0 };
        if (!chartContainer) return fallback;
        const rect = chartContainer.getBoundingClientRect();
        let width = rect.width;
        let height = rect.height;
        try {
            if (chart && typeof chart.timeScale === 'function') {
                const tw = chart.timeScale().width();
                if (typeof tw === 'number' && isFinite(tw) && tw > 8) width = tw;
            }
        } catch (e) { /* chart henüz hazır değilse container genişliği kullanılır */ }
        if (width >= rect.width - 1) {
            try {
                const pw = chart && typeof chart.priceScale === 'function'
                    ? chart.priceScale('right').width()
                    : 0;
                if (typeof pw === 'number' && isFinite(pw) && pw > 0) {
                    width = Math.max(0, rect.width - pw);
                }
            } catch (e) { /* yok say */ }
        }
        return {
            x: 0,
            y: 0,
            width: Math.max(0, width),
            height: Math.max(0, height)
        };
    }

    function isInPlotArea(x, y) {
        const plot = getPlotRect();
        return x >= 0 && y >= 0 && x <= plot.width && y <= plot.height;
    }

    /* ────────── Chart type dropdown ("Çubuklar" menu) ────────── */

    function chartTypeIcon(id) {
        const S = 'width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
        const ICONS = {
            candles: '<rect x="4" y="9" width="3" height="9"></rect><line x1="5.5" y1="5" x2="5.5" y2="9"></line><line x1="5.5" y1="18" x2="5.5" y2="20"></line>' +
                     '<rect x="10.5" y="4" width="3" height="16" fill="currentColor"></rect><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line>' +
                     '<rect x="17" y="12" width="3" height="6"></rect><line x1="18.5" y1="9" x2="18.5" y2="12"></line><line x1="18.5" y1="18" x2="18.5" y2="20"></line>',
            hollow: '<rect x="4" y="9" width="3" height="9"></rect><rect x="10.5" y="4" width="3" height="16"></rect><rect x="17" y="12" width="3" height="6"></rect>',
            bars: '<line x1="5.5" y1="6" x2="5.5" y2="18"></line><line x1="5.5" y1="6" x2="8" y2="6"></line><line x1="5.5" y1="14" x2="3" y2="14"></line>' +
                  '<line x1="12" y1="3" x2="12" y2="21"></line><line x1="12" y1="3" x2="14.5" y2="3"></line><line x1="12" y1="12" x2="9.5" y2="12"></line>' +
                  '<line x1="18.5" y1="9" x2="18.5" y2="19"></line><line x1="18.5" y1="9" x2="21" y2="9"></line><line x1="18.5" y1="15" x2="16" y2="15"></line>',
            line: '<polyline points="3 17 9 10 14 14 21 5"></polyline>',
            step_line: '<polyline points="3 17 9 17 9 11 15 11 15 6 21 6"></polyline>',
            area: '<polyline points="3 15 9 9 14 13 21 5"></polyline><path d="M3 20h18v0L21 5 14 13 9 9 3 15z" opacity="0.25" stroke="none" fill="currentColor"></path>',
            baseline: '<line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="2 2"></line><polyline points="3 12 8 6 13 15 21 9"></polyline>',
            heikin_ashi: '<rect x="4" y="7" width="3" height="11" fill="currentColor"></rect><rect x="10.5" y="10" width="3" height="8" fill="currentColor"></rect><rect x="17" y="4" width="3" height="13" fill="currentColor"></rect>'
        };
        return '<svg ' + S + '>' + (ICONS[id] || ICONS.candles) + '</svg>';
    }

    function setupChartTypeMenu() {
        const btn = byId('btn-chart-type');
        const dropdown = byId('chart-type-dropdown');
        const list = byId('chart-type-list');
        const label = byId('chart-type-label');
        const volChk = byId('chk-show-volume');
        if (!btn || !dropdown || !list) return;

        list.innerHTML = CHART_TYPES.map(t =>
            '<button type="button" class="tv-charttype-item' + (t.id === state.chartType ? ' active' : '') + '" data-type="' + t.id + '">' +
                '<span class="tv-charttype-icon" aria-hidden="true">' + chartTypeIcon(t.id) + '</span>' +
                '<span>' + t.label + '</span>' +
            '</button>'
        ).join('');

        const close = () => dropdown.classList.remove('open');
        const open = () => {
            if (window.__optipulseCloseOtherModals) window.__optipulseCloseOtherModals();
            if (window.__optipulseCloseOtherSimpleDropdowns) window.__optipulseCloseOtherSimpleDropdowns('chart-type-dropdown');
            closeAllFlyouts();
            const rect = btn.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 6) + 'px';
            dropdown.style.left = rect.left + 'px';
            dropdown.classList.add('open');
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

        list.querySelectorAll('[data-type]').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.type;
                setChartType(type);
                list.querySelectorAll('.tv-charttype-item').forEach(b => b.classList.remove('active'));
                item.classList.add('active');
                const def = CHART_TYPES.find(t => t.id === type);
                if (label && def) label.textContent = def.label;
                close();
            });
        });

        if (volChk) {
            volChk.addEventListener('change', () => setVolumeVisible(volChk.checked));
        }
    }

    /* ────────── Header "diğer işlemler" hamburger menüsü ──────────
       (18 Temmuz 2026, onuncu oturum, dördüncü tur) Header sıkışıklığını
       gidermek için (bkz. arayuz-iyilestirme-onerileri.md, Madde 2) daha az
       sık kullanılan header butonları (Tur/Isı Haritası/Kısayollar/Yardım/
       Reset) buraya taşındı. Açılma deseni yukarıdaki setupChartTypeMenu()
       ile BİREBİR AYNI — yeni bir dropdown mimarisi icat edilmedi, var olan
       desen yeniden kullanıldı. */
    function setupHeaderMenu() {
        const btn = byId('btn-header-menu');
        const dropdown = byId('header-menu-dropdown');
        if (!btn || !dropdown) return;

        const close = () => dropdown.classList.remove('open');
        const open = () => {
            if (window.__optipulseCloseOtherModals) window.__optipulseCloseOtherModals();
            if (window.__optipulseCloseOtherSimpleDropdowns) window.__optipulseCloseOtherSimpleDropdowns('header-menu-dropdown');
            closeAllFlyouts();
            const rect = btn.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 6) + 'px';
            // Sağa hizalı açılır — header'ın en sağındaki butondan tetiklendiği
            // için sola değil sağa taşarsa viewport dışına çıkar.
            dropdown.style.right = (window.innerWidth - rect.right) + 'px';
            dropdown.style.left = 'auto';
            dropdown.classList.add('open');
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
        // Menüdeki herhangi bir butona tıklanınca (Tur/Isı Haritası/vb.) menü
        // kendiliğinden kapansın — o butonların kendi click handler'ları
        // (tradingEngine.js/app.js/tourGuide.js'de) hiç değişmeden ayrıca çalışır.
        dropdown.addEventListener('click', (e) => {
            if (e.target.closest('button')) close();
        });
    }

    /* ────────── Drawing tools toolbar (grouped flyout menus, Tier 1) ────────── */

    // Tier-1 drawing tool catalog, grouped TradingView-style. `standalone`
    // groups render as a single flat button; the rest render as a button
    // (showing the last-picked tool in that group) plus a caret that opens
    // a flyout listing every tool in the group.
    const TOOL_GROUPS = [
        { id: 'cursor', standalone: true, tools: [{ id: 'cursor', label: 'İmleç' }] },
        // (18 Temmuz 2026, onuncu oturum, dördüncü tur) "Göstergeler" grubu —
        // diğer rail gruplarından FARKLI: bir çizim aracı SEÇMİYOR, tıklanınca
        // açılan flyout'ta doğrudan gösterge checkbox'ları listeleniyor (bkz.
        // arayuz-iyilestirme-onerileri.md Madde 3). Bu yüzden `checklist: true`
        // ile işaretlendi — renderToolbar()/setupToolbar() bu bayrağı görünce
        // farklı bir HTML/click-davranışı üretiyor. Flyout'taki her checkbox,
        // Göstergeler modalındaki #chk-*/.osc-checkbox elemanlarının BİREBİR
        // AYNISINI tetikliyor (ayrı bir state icat edilmedi — bkz.
        // renderIndicatorFlyoutContent()/wireIndicatorFlyoutClicks()).
        { id: 'indicators', label: 'Göstergeler', checklist: true, tools: [] },
        { id: 'lines', label: 'Çizgiler', tools: [
            { id: 'trend', label: 'Trend Çizgisi' },
            { id: 'ray', label: 'Işın' },
            { id: 'extended', label: 'Genişletilmiş Çizgi' },
            { id: 'horizontal', label: 'Yatay Çizgi' },
            { id: 'hray', label: 'Yatay Işın' },
            { id: 'vline', label: 'Dikey Çizgi' },
            { id: 'cross', label: 'Çapraz Çizgi' },
            { id: 'channel', label: 'Paralel Kanal' }
        ] },
        { id: 'fibgroup', label: 'Fibonacci', tools: [
            { id: 'fib', label: 'Fibonacci Geri Çekilme' },
            { id: 'fib_ext', label: 'Fibonacci Uzantı' },
            { id: 'fib_fan', label: 'Fibonacci Yelpazesi' },
            { id: 'fib_time', label: 'Fibonacci Zaman Bölgesi' }
        ] },
        // (17 Temmuz 2026, yedinci oturum) Tier 2 çizim araçları: Gann Fan
        // (pivot + 1x1 açı noktasından türetilen klasik Gann açı seti) ve
        // manuel Elliott Dalgası (kullanıcının 0-1-2-3-4-5 dalga noktalarını
        // tek tek tıklayarak işaretlediği, otomatik dalga SAYIMI yapmayan —
        // yalnızca görsel etiketleme sağlayan — bir sayım aracı).
        { id: 'advanced', label: 'Gelişmiş Araçlar', tools: [
            { id: 'gann_fan', label: 'Gann Yelpazesi' },
            { id: 'elliott', label: 'Elliott Dalgası (Manuel)' }
        ] },
        // (18 Temmuz 2026, onuncu oturum, ikinci tur) Kullanıcı isteği:
        // "çizgiler - fibonacci - grafik desenleri - tahmin kısımları ayrı
        // ayrı sol tarafta olsun". Çizgiler ve Fibonacci zaten ayrı rail
        // ikonlarıydı (yukarıda); burada aynı desende iki YENİ kategori
        // ekliyoruz. Elliott Dalgası'ndaki gibi dürüstlük ilkesi geçerli:
        // ABCD deseni kullanıcının 4 noktayı elle işaretlediği görsel bir
        // araç — otomatik desen TANIMA yapmıyor. Tahmin/Projeksiyon aracı
        // da düz bir doğrusal ekstrapolasyon — YATIRIM TAVSİYESİ DEĞİLDİR,
        // sadece mevcut eğimin görsel devamı.
        { id: 'patterns', label: 'Desenler', tools: [
            { id: 'abcd', label: 'ABCD Deseni (Manuel)' }
        ] },
        { id: 'forecast', label: 'Tahmin', tools: [
            { id: 'trend_projection', label: 'Trend Projeksiyonu (Doğrusal — yatırım tavsiyesi değildir)' }
        ] },
        { id: 'shapes', label: 'Şekiller', tools: [
            { id: 'rect', label: 'Dikdörtgen' },
            { id: 'ellipse', label: 'Elips' },
            { id: 'triangle', label: 'Üçgen' }
        ] },
        { id: 'annotate', label: 'Not & Ok', tools: [
            { id: 'arrow', label: 'Ok' },
            { id: 'text', label: 'Metin' },
            { id: 'brush', label: 'Fırça' }
        ] },
        { id: 'measure', standalone: true, tools: [{ id: 'measure', label: 'Ölçüm Aracı' }] },
        { id: 'position', label: 'Pozisyon', tools: [
            { id: 'pos_long', label: 'Uzun Pozisyon' },
            { id: 'pos_short', label: 'Kısa Pozisyon' }
        ] }
    ];

    const groupLastTool = {};

    function toolIcon(id) {
        const S = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
        const ICONS = {
            cursor: '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>',
            trend: '<line x1="4" y1="20" x2="20" y2="4"></line><circle cx="4" cy="20" r="1.8" fill="currentColor"></circle><circle cx="20" cy="4" r="1.8" fill="currentColor"></circle>',
            ray: '<line x1="4" y1="20" x2="22" y2="2"></line><circle cx="4" cy="20" r="1.8" fill="currentColor"></circle>',
            extended: '<line x1="1" y1="23" x2="23" y2="1"></line>',
            horizontal: '<line x1="3" y1="12" x2="21" y2="12"></line>',
            hray: '<line x1="6" y1="12" x2="21" y2="12"></line><circle cx="6" cy="12" r="1.8" fill="currentColor"></circle>',
            vline: '<line x1="12" y1="3" x2="12" y2="21"></line>',
            cross: '<line x1="3" y1="12" x2="21" y2="12"></line><line x1="12" y1="3" x2="12" y2="21"></line>',
            channel: '<line x1="3" y1="18" x2="18" y2="4"></line><line x1="8" y1="21" x2="23" y2="7"></line>',
            fib: '<line x1="3" y1="5" x2="21" y2="5"></line><line x1="3" y1="10" x2="21" y2="10"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="3" y1="20" x2="21" y2="20"></line>',
            fib_ext: '<line x1="3" y1="4" x2="21" y2="4"></line><line x1="3" y1="10" x2="21" y2="10"></line><line x1="3" y1="16" x2="21" y2="16"></line><line x1="3" y1="21" x2="12" y2="21"></line>',
            fib_fan: '<line x1="3" y1="21" x2="21" y2="21"></line><line x1="3" y1="21" x2="21" y2="3"></line><line x1="3" y1="21" x2="21" y2="11"></line><line x1="3" y1="21" x2="21" y2="17"></line>',
            fib_time: '<line x1="4" y1="3" x2="4" y2="21"></line><line x1="10" y1="3" x2="10" y2="21"></line><line x1="16" y1="3" x2="16" y2="21"></line><line x1="21" y1="3" x2="21" y2="21"></line>',
            gann_fan: '<line x1="3" y1="21" x2="21" y2="21"></line><line x1="3" y1="21" x2="21" y2="3"></line><line x1="3" y1="21" x2="12" y2="3"></line><line x1="3" y1="21" x2="21" y2="12"></line><line x1="3" y1="21" x2="21" y2="17"></line><circle cx="3" cy="21" r="1.6" fill="currentColor"></circle>',
            elliott: '<polyline points="2,18 7,6 11,14 16,3 20,11"></polyline><circle cx="2" cy="18" r="1.4" fill="currentColor"></circle><circle cx="20" cy="11" r="1.4" fill="currentColor"></circle>',
            abcd: '<polyline points="3,19 9,6 14,15 21,3"></polyline><circle cx="3" cy="19" r="1.6" fill="currentColor"></circle><circle cx="9" cy="6" r="1.6" fill="currentColor"></circle><circle cx="14" cy="15" r="1.6" fill="currentColor"></circle><circle cx="21" cy="3" r="1.6" fill="currentColor"></circle>',
            trend_projection: '<line x1="3" y1="19" x2="12" y2="9"></line><line x1="12" y1="9" x2="21" y2="2" stroke-dasharray="2.5 2.5"></line><circle cx="3" cy="19" r="1.6" fill="currentColor"></circle>',
            rect: '<rect x="4" y="6" width="16" height="12" rx="1"></rect>',
            ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6"></ellipse>',
            triangle: '<path d="M12 4l9 16H3z"></path>',
            arrow: '<line x1="4" y1="20" x2="20" y2="4"></line><path d="M12 4h8v8"></path>',
            text: '<polyline points="5 5 19 5"></polyline><line x1="12" y1="5" x2="12" y2="19"></line><line x1="8" y1="19" x2="16" y2="19"></line>',
            brush: '<path d="M3 17c3-6 4-10 8-13 2 2 2 4 0 6-4 3-3 6-8 7z"></path><path d="M11 10l3 3"></path>',
            measure: '<rect x="4" y="9" width="16" height="6" rx="1"></rect><line x1="7" y1="9" x2="7" y2="15"></line><line x1="12" y1="9" x2="12" y2="15"></line><line x1="17" y1="9" x2="17" y2="15"></line>',
            pos_long: '<rect x="4" y="12" width="16" height="6" rx="1" opacity="0.4"></rect><rect x="4" y="6" width="16" height="6" rx="1"></rect><line x1="4" y1="9" x2="20" y2="9" stroke-dasharray="2 2"></line>',
            pos_short: '<rect x="4" y="6" width="16" height="6" rx="1" opacity="0.4"></rect><rect x="4" y="12" width="16" height="6" rx="1"></rect><line x1="4" y1="15" x2="20" y2="15" stroke-dasharray="2 2"></line>',
            undo: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path>',
            clear: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>',
            magnet: '<path d="M6 3v9a6 6 0 0 0 12 0V3"></path><path d="M6 3H2v9"></path><path d="M22 3h-4v9"></path>',
            lock: '<rect x="5" y="11" width="14" height="10" rx="1"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
            hide: '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.65 19.65 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.5 19.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line>',
            indicators: '<line x1="4" y1="6" x2="20" y2="6"></line><circle cx="9" cy="6" r="2" fill="currentColor"></circle><line x1="4" y1="12" x2="20" y2="12"></line><circle cx="15" cy="12" r="2" fill="currentColor"></circle><line x1="4" y1="18" x2="20" y2="18"></line><circle cx="7" cy="18" r="2" fill="currentColor"></circle>'
        };
        return '<svg ' + S + '>' + (ICONS[id] || ICONS.cursor) + '</svg>';
    }

    // "Göstergeler" flyout'unun içeriği — Göstergeler modalındaki iki
    // kategoriyle birebir aynı listeler (bkz. index.html indicator-modal-
    // category blokları). Buradaki her satır ayrı bir state TAŞIMIYOR —
    // tıklanınca doğrudan modal'daki gerçek #chk-*/.osc-checkbox elemanını
    // bulup değiştiriyor (bkz. wireIndicatorFlyoutClicks()), böylece rail'den
    // veya modaldan açma hiçbir zaman birbirinden ayrışmıyor.
    const INDICATOR_FLYOUT_OVERLAY = [
        { chk: 'chk-sma20', label: 'SMA 20' },
        { chk: 'chk-sma50', label: 'SMA 50' },
        { chk: 'chk-sma200', label: 'SMA 200' },
        { chk: 'chk-ema9', label: 'EMA 9' },
        { chk: 'chk-ema21', label: 'EMA 21' },
        { chk: 'chk-wma20', label: 'WMA 20' },
        { chk: 'chk-bollinger', label: 'Bollinger Bands' },
        { chk: 'chk-vwap', label: 'VWAP' },
        { chk: 'chk-ichimoku', label: 'Ichimoku Cloud' },
        { chk: 'chk-psar', label: 'Parabolic SAR' },
        { chk: 'chk-pivot', label: 'Pivot Points' },
        { chk: 'chk-supertrend', label: 'SuperTrend' },
        { chk: 'chk-keltner', label: 'Keltner Kanalları' },
        { chk: 'chk-donchian', label: 'Donchian Kanalları' }
    ];
    const INDICATOR_FLYOUT_OSCILLATOR = [
        { osc: 'rsi', label: 'RSI (14)' },
        { osc: 'macd', label: 'MACD' },
        { osc: 'stoch', label: 'Stochastic' },
        { osc: 'atr', label: 'ATR (14)' },
        { osc: 'adx', label: 'ADX (14)' },
        { osc: 'obv', label: 'OBV' },
        { osc: 'cci', label: 'CCI (20)' },
        { osc: 'mfi', label: 'MFI (14)' },
        { osc: 'willr', label: 'Williams %R' }
    ];

    function indicatorFlyoutItem(isActive, attr, attrVal, label) {
        return '<button type="button" class="tv-tool-flyout-item tv-indicator-flyout-item' + (isActive ? ' active' : '') +
            '" data-' + attr + '="' + attrVal + '" role="menuitemcheckbox" aria-checked="' + isActive + '">' +
            '<span class="tv-indicator-flyout-check"></span><span>' + label + '</span></button>';
    }

    function renderIndicatorFlyoutContent() {
        const overlayHtml = INDICATOR_FLYOUT_OVERLAY.map(def => {
            const el = byId(def.chk);
            return indicatorFlyoutItem(!!(el && el.checked), 'indicator-chk', def.chk, def.label);
        }).join('');
        const oscHtml = INDICATOR_FLYOUT_OSCILLATOR.map(def => {
            const el = document.querySelector('.osc-checkbox[data-osc="' + def.osc + '"]');
            return indicatorFlyoutItem(!!(el && el.checked), 'indicator-osc', def.osc, def.label);
        }).join('');

        return (
            '<div class="tv-indicator-flyout-label">Ana Grafik (Overlay)</div>' +
            overlayHtml +
            '<div class="tv-indicator-flyout-label">Osilatör Paneli</div>' +
            oscHtml +
            '<div class="tv-tool-flyout-divider"></div>' +
            '<button type="button" class="tv-tool-flyout-item tv-indicator-flyout-more" data-action="open-indicator-modal">Tüm Göstergeler / Ayarlar…</button>'
        );
    }

    // Flyout içindeki bir gösterge satırına tıklanınca gerçek checkbox'ı
    // (modal'daki #chk-* veya .osc-checkbox) bulup değiştirir, 'change'
    // event'ini dispatch eder (renderOverlays()/oscillator sürükle-sırala
    // altyapısı zaten bu event'i dinliyor — bkz. setupOverlayCheckboxes()/
    // setupOscillatorCheckboxes()), sonra flyout'u AÇIK tutarak içeriğini
    // güncel checked durumlarıyla yeniden çizer (kullanıcı art arda birden
    // fazla gösterge açıp kapatabilsin diye kapatmıyoruz).
    function handleIndicatorFlyoutClick(target) {
        const chkId = target.dataset.indicatorChk;
        const oscId = target.dataset.indicatorOsc;
        let el = null;
        if (chkId) el = byId(chkId);
        else if (oscId) el = document.querySelector('.osc-checkbox[data-osc="' + oscId + '"]');
        if (!el) return;
        el.checked = !el.checked;
        el.dispatchEvent(new Event('change'));

        const flyout = document.querySelector('.tv-tool-flyout[data-flyout="indicators"]');
        if (flyout) flyout.innerHTML = renderIndicatorFlyoutContent();
    }

    function renderToolbar() {
        const toolbar = byId('chart-toolbar');
        if (!toolbar) return;

        const groupsHtml = TOOL_GROUPS.map(g => {
            if (g.standalone) {
                const t = g.tools[0];
                const isActive = state.activeTool === t.id;
                return '<button type="button" class="tv-tool-btn' + (isActive ? ' active' : '') + '" data-tool="' + t.id + '" title="' + t.label + '">' + toolIcon(t.id) + '</button>';
            }
            if (g.checklist) {
                return (
                    '<div class="tv-tool-group" data-group="' + g.id + '">' +
                        '<button type="button" class="tv-tool-btn tv-tool-group-btn tv-tool-checklist-btn" data-checklist-toggle="' + g.id + '" title="' + g.label + '">' +
                            toolIcon(g.id) +
                            '<span class="tv-tool-caret" data-caret="' + g.id + '"><svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6l8 12 8-12z"></path></svg></span>' +
                        '</button>' +
                        '<div class="tv-tool-flyout tv-indicator-flyout" data-flyout="' + g.id + '" role="menu" aria-label="' + g.label + '">' +
                            renderIndicatorFlyoutContent() +
                        '</div>' +
                    '</div>'
                );
            }
            const lastId = groupLastTool[g.id] || g.tools[0].id;
            const lastDef = g.tools.find(t => t.id === lastId) || g.tools[0];
            const isGroupActive = g.tools.some(t => t.id === state.activeTool);
            return (
                '<div class="tv-tool-group" data-group="' + g.id + '">' +
                    '<button type="button" class="tv-tool-btn tv-tool-group-btn' + (isGroupActive ? ' active' : '') + '" data-tool="' + lastDef.id + '" title="' + lastDef.label + '">' +
                        toolIcon(lastDef.id) +
                        '<span class="tv-tool-caret" data-caret="' + g.id + '"><svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6l8 12 8-12z"></path></svg></span>' +
                    '</button>' +
                    '<div class="tv-tool-flyout" data-flyout="' + g.id + '" role="menu" aria-label="' + g.label + '">' +
                        g.tools.map(t => '<button type="button" class="tv-tool-flyout-item' + (t.id === state.activeTool ? ' active' : '') + '" data-tool="' + t.id + '" role="menuitem">' + toolIcon(t.id) + '<span>' + t.label + '</span></button>').join('') +
                    '</div>' +
                '</div>'
            );
        }).join('');

        const utilityHtml =
            '<span class="tv-toolbar-sep" aria-hidden="true"></span>' +
            '<button type="button" class="tv-tool-btn tv-tool-toggle' + (state.magnetMode ? ' active' : '') + '" data-action="magnet" title="Mıknatıs Modu">' + toolIcon('magnet') + '</button>' +
            '<button type="button" class="tv-tool-btn tv-tool-toggle' + (state.drawingsLocked ? ' active' : '') + '" data-action="lock" title="Çizimleri Kilitle">' + toolIcon('lock') + '</button>' +
            '<button type="button" class="tv-tool-btn tv-tool-toggle' + (state.drawingsHidden ? ' active' : '') + '" data-action="hide" title="Çizimleri Gizle/Göster">' + toolIcon('hide') + '</button>' +
            '<button type="button" class="tv-tool-btn" data-action="undo" title="Geri Al">' + toolIcon('undo') + '</button>' +
            '<button type="button" class="tv-tool-btn" data-action="clear" title="Tümünü Temizle">' + toolIcon('clear') + '</button>';

        toolbar.innerHTML = groupsHtml + utilityHtml;
    }

    function closeAllFlyouts() {
        document.querySelectorAll('.tv-tool-flyout.open').forEach(f => f.classList.remove('open'));
    }
    // (22 Temmuz 2026, on ikinci oturum — madde 7 "profil paneli") window.
    // __optipulseCloseOtherModals ile aynı köprü deseni: tradingEngine.js'teki
    // yeni profil paneli açılırken, bu dosyanın çizim araç flyout'larının
    // açık kalmaması için dışa açılıyor.
    window.__optipulseCloseAllFlyouts = closeAllFlyouts;

    function toggleFlyout(groupId) {
        const flyout = document.querySelector('.tv-tool-flyout[data-flyout="' + groupId + '"]');
        if (!flyout) return;
        const willOpen = !flyout.classList.contains('open');
        const groupEl = flyout.closest('.tv-tool-group');
        const anchorBtn = groupEl ? groupEl.querySelector('.tv-tool-group-btn') : null;
        closeAllFlyouts();
        const chartTypeDropdown = byId('chart-type-dropdown');
        if (chartTypeDropdown) chartTypeDropdown.classList.remove('open');
        if (willOpen) {
            if (anchorBtn) {
                const rect = anchorBtn.getBoundingClientRect();
                // Masaüstünde (>=981px) #chart-toolbar sol dikey raya sabitlenmiş
                // durumda (bkz. styles.css) — flyout'u ikonun ALTINA değil
                // SAĞINA açmak gerekiyor, yoksa menü rayın dışına, chart'ın
                // üzerine düşer. Dar ekranlarda araç çubuğu hâlâ yatay akışta
                // olduğundan eski (altına açılan) davranış korunuyor.
                const isVerticalRail = window.matchMedia('(min-width: 981px)').matches;
                if (isVerticalRail) {
                    flyout.style.top = rect.top + 'px';
                    flyout.style.left = (rect.right + 6) + 'px';
                } else {
                    flyout.style.top = (rect.bottom + 6) + 'px';
                    flyout.style.left = rect.left + 'px';
                }
            }
            flyout.classList.add('open');
        }
    }

    function selectTool(tool) {
        state.activeTool = tool;
        state.pendingShape = null;
        state.pendingPoints = null;
        // Ölçüm aracından başka bir araca geçilirken son ölçüm sonucu da
        // ekrandan kalkmalı (bkz. Madde 14 — measureShape artık kalıcı bir
        // çizim değil, sadece "aktif ölçüm aracı" ekranıyla ilişkili).
        if (state.activeTool !== 'measure') state.measureShape = null;
        updateToolbarActiveState();
        syncDrawCanvasCursor();
    }

    function updateToolbarActiveState() {
        const toolbar = byId('chart-toolbar');
        if (!toolbar) return;
        toolbar.querySelectorAll('.tv-tool-btn[data-tool], .tv-tool-flyout-item[data-tool]').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === state.activeTool);
        });
        toolbar.querySelectorAll('.tv-tool-group').forEach(g => {
            const groupDef = TOOL_GROUPS.find(gg => gg.id === g.dataset.group);
            const isActive = !!(groupDef && groupDef.tools.some(t => t.id === state.activeTool));
            const mainBtn = g.querySelector('.tv-tool-group-btn');
            if (mainBtn) mainBtn.classList.toggle('active', isActive);
        });
    }

    function syncDrawCanvasCursor() {
        if (!drawCanvas) return;
        const isCursor = state.activeTool === 'cursor';
        drawCanvas.style.pointerEvents = isCursor ? 'none' : 'auto';
        drawCanvas.style.cursor = isCursor ? 'default' : 'crosshair';
    }

    function updateToggleButtonState(action, on) {
        const toolbar = byId('chart-toolbar');
        if (!toolbar) return;
        const btn = toolbar.querySelector('[data-action="' + action + '"]');
        if (btn) btn.classList.toggle('active', on);
    }

    function handleToolbarAction(action) {
        if (action === 'clear') {
            // (29 Temmuz 2026 — Madde 7 düzeltmesi) Eskiden sadece tamamlanmış
            // state.drawings sıfırlanıyordu; kullanıcı bir şekli çizerken
            // (örn. trend çizgisinin ilk noktası tıklanmış, ikinci nokta
            // henüz bekleniyor) "Tümünü Sil"e basarsa state.pendingShape/
            // pendingPoints TEMİZLENMİYORDU — bu da yarım kalan çizimin
            // görünmeye devam etmesine veya bir sonraki tıklamada bozuk bir
            // şekle dönüşmesine yol açabiliyordu. selectTool() ve Escape
            // tuşu zaten bunu sıfırlıyor (bkz. aşağıda); "Tümünü Sil" de
            // aynı sıfırlamayı yapmalı.
            state.drawings = [];
            state.selectedDrawingIndex = -1;
            state.pendingShape = null;
            state.pendingPoints = null;
            state.measureShape = null;
            redrawDrawings();
        } else if (action === 'undo') {
            state.drawings.pop();
            state.selectedDrawingIndex = -1;
            redrawDrawings();
        } else if (action === 'magnet') {
            state.magnetMode = !state.magnetMode;
            updateToggleButtonState('magnet', state.magnetMode);
        } else if (action === 'lock') {
            state.drawingsLocked = !state.drawingsLocked;
            updateToggleButtonState('lock', state.drawingsLocked);
            if (state.drawingsLocked) selectDrawing(-1);
        } else if (action === 'hide') {
            state.drawingsHidden = !state.drawingsHidden;
            updateToggleButtonState('hide', state.drawingsHidden);
            redrawDrawings();
        }
    }

    function setupToolbar() {
        const toolbar = byId('chart-toolbar');
        if (!toolbar) return;
        renderToolbar();

        toolbar.addEventListener('click', (e) => {
            // "Göstergeler" flyout'una özel satırlar (checkbox tıklama /
            // "Tüm Göstergeler..." bağlantısı) — bunlar genel .tv-tool-flyout-item
            // eşleşmesinden ÖNCE ele alınmalı, aksi halde aşağıdaki genel dal
            // bunları bir "çizim aracı seç" tıklaması sanıp state.activeTool'u
            // bozardı.
            const indicatorItem = e.target.closest('.tv-indicator-flyout-item');
            if (indicatorItem) {
                handleIndicatorFlyoutClick(indicatorItem);
                return;
            }
            const moreLink = e.target.closest('[data-action="open-indicator-modal"]');
            if (moreLink) {
                closeAllFlyouts();
                byId('btn-open-indicators')?.click();
                return;
            }
            const checklistToggle = e.target.closest('[data-checklist-toggle]');
            if (checklistToggle) {
                toggleFlyout(checklistToggle.dataset.checklistToggle);
                return;
            }

            const flyoutItem = e.target.closest('.tv-tool-flyout-item');
            if (flyoutItem) {
                const groupEl = flyoutItem.closest('.tv-tool-group');
                const groupId = groupEl ? groupEl.dataset.group : null;
                if (groupId) groupLastTool[groupId] = flyoutItem.dataset.tool;
                selectTool(flyoutItem.dataset.tool);
                closeAllFlyouts();
                renderToolbar();
                return;
            }

            const caret = e.target.closest('.tv-tool-caret');
            if (caret) {
                e.stopPropagation();
                const groupEl = caret.closest('.tv-tool-group');
                if (groupEl) toggleFlyout(groupEl.dataset.group);
                return;
            }

            // (18 Temmuz 2026, onuncu oturum, beşinci tur) Önceden bu buton
            // doğrudan grubun SON KULLANILAN aracını seçiyordu — seçenekleri
            // görmek için sadece 7x7px'lik minik ok işaretine (.tv-tool-caret)
            // tam isabetle tıklamak gerekiyordu. Artık ikonun HERHANGİ bir
            // yerine basmak (checklist grubu — "Göstergeler" — ile aynı
            // davranış) o grubun tüm seçeneklerini gösteren flyout'u açıyor;
            // araç seçimi flyout'taki bir öğeye tıklanınca gerçekleşiyor.
            const groupBtn = e.target.closest('.tv-tool-group-btn');
            if (groupBtn) {
                const groupEl = groupBtn.closest('.tv-tool-group');
                if (groupEl) toggleFlyout(groupEl.dataset.group);
                return;
            }

            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                handleToolbarAction(actionBtn.dataset.action);
                return;
            }

            const plainBtn = e.target.closest('.tv-tool-btn[data-tool]');
            if (plainBtn) {
                selectTool(plainBtn.dataset.tool);
                closeAllFlyouts();
                return;
            }
        });

        document.addEventListener('click', (e) => {
            if (!toolbar.contains(e.target)) closeAllFlyouts();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllFlyouts();
                if (state.pendingPoints) {
                    // Cancel an in-progress multi-click drawing (e.g. Elliott
                    // Wave) without discarding the active tool selection.
                    state.pendingPoints = null;
                    state.pendingShape = null;
                    redrawDrawings();
                }
                // (29 Temmuz 2026 — Madde 14) Escape, ekranda duran son ölçüm
                // sonucunu da temizler — cetvel aracı seçili kalmaya devam
                // eder, sadece görüntü kalkar.
                if (state.measureShape) {
                    state.measureShape = null;
                    redrawDrawings();
                }
            }
        });
    }

    const SINGLE_POINT_TOOLS = ['vline', 'cross'];
    const FREEHAND_TOOLS = ['brush'];
    const DERIVED_THIRD_POINT_TOOLS = ['channel', 'triangle', 'pos_long', 'pos_short'];
    // Manuel Elliott Dalgası: tek bir sürükleme yerine, kullanıcının sırayla
    // tıklayarak 0-1-2-3-4-5 dalga noktalarını işaretlediği bir araç (klasik
    // 5 dalgalı itki + düzeltme sayımı). `state.pendingPoints` bu tıklamalar
    // arasında birikir; gerekli nokta sayısına ulaşınca çizim tamamlanır.
    const MULTI_CLICK_TOOLS = { elliott: 6, abcd: 4 };

    function priceRangeApprox() {
        if (!state.candles.length) return 1;
        // (2 Ağustos 2026 — revize planı madde 3) Paralel Kanal ve diğer "türetilmiş
        // üçüncü nokta" araçları (channel/triangle/pos_long/pos_short), ikinci çizginin
        // dikey ofsetini bu fonksiyonun döndürdüğü "fiyat aralığı"na göre hesaplıyor.
        // Eskiden bu aralık TÜM state.candles dizisi (750 günlük / ~3 yıllık geçmiş)
        // üzerinden hesaplanıyordu — kullanıcı yakınlaştırıp ekranda sadece son birkaç
        // günü görüntülerken bile ofset 3 yıllık min-max farkına göre belirleniyordu,
        // bu da ikinci çizgiyi ekranın çok dışına taşırıyor, kanal görünmez hale
        // geliyordu. Düzeltme: mümkünse sadece o an GÖRÜNÜR (visible logical range)
        // mum aralığındaki close değerlerini kullan; grafik hazır değilse veya görünür
        // aralık alınamıyorsa eski davranışa (tüm dizi) geri düş.
        let candles = state.candles;
        if (chart) {
            const vr = chart.timeScale().getVisibleLogicalRange();
            if (vr) {
                const from = Math.max(0, Math.floor(vr.from));
                const to = Math.min(state.candles.length - 1, Math.ceil(vr.to));
                if (to > from) {
                    const visible = state.candles.slice(from, to + 1);
                    if (visible.length) candles = visible;
                }
            }
        }
        const closes = candles.map(c => c.close);
        const range = Math.max(...closes) - Math.min(...closes);
        return range || Math.max(...closes) * 0.05 || 1;
    }

    function snapToOHLC(dp) {
        if (!state.magnetMode || dp.idx < 0 || !state.candles[dp.idx] || dp.price === null) return dp;
        const c = state.candles[dp.idx];
        const candidates = [c.open, c.high, c.low, c.close];
        let best = candidates[0], bestDist = Math.abs(dp.price - best);
        candidates.forEach(v => {
            const d = Math.abs(dp.price - v);
            if (d < bestDist) { bestDist = d; best = v; }
        });
        return { time: dp.time, price: best, idx: dp.idx };
    }

    // (3 Ağustos 2026 — kullanıcı/hoca geri bildirimi: "çizgi sağa gitmiyor")
    // Kök neden analizi: çizim noktaları HER ZAMAN state.candles içindeki
    // GERÇEK bir mumun index'ine ([0, state.candles.length-1]) sabitlenmek
    // zorundaydı — pixelToDataPoint() bunu SERT şekilde clamp ediyor,
    // dataPointToPixel()/indexForTime() ise findIndex ile arıyordu (bulamazsa
    // -1/null döner, çizim o noktada hiç görünmezdi). Bu yüzden bir çizgiyi
    // son muma (bugüne) ulaşana kadar sağa sürüklemek mümkündü, ama daha
    // ÖTESİNE (geleceğe) hiç geçilemiyordu — imleç sağa gitmeye devam etse
    // bile çizginin ucu son mumda kilitli kalıyordu.
    //
    // Çözüm: "sanal index" kavramı eklendi. Gerçek mum aralığının
    // ([0, length-1]) ÖTESİNDEKİ index'ler artık geçersiz sayılmıyor — bunun
    // yerine son mumun tarihinden itibaren, mumlar arasındaki gerçek bar
    // aralığı (inferBarIntervalSeconds()) kadar EKSTRAPOLE edilen sentetik
    // bir "time" değeri üretiliyor (virtualIndexToTime). virtualTimeToIndex
    // bunun tersini yapar: gerçek bir mum tarihiyle eşleşmeyen ama son
    // mumdan ilerideki bir zaman damgasını, geriye doğru aynı aralıkla
    // sanal index'e çevirir. Sol tarafta (index 0'ın altında) böyle bir
    // ekstrapolasyona gerek yok — geçmişe doğru "boş alan" sürüklemenin
    // kullanıcı için bir anlamı yok, o taraf hâlâ 0'da clamp'li kalıyor.
    //
    // Bu iki fonksiyon merkezi olduğu için (tüm çizim render/hit-test/
    // taşıma/uç-nokta-düzenleme kodu dataPointToPixel/pixelToDataPoint/
    // indexForTime üzerinden çalışıyor), buradaki değişiklik TÜM çizim
    // araçlarının geleceğe doğru uzatılabilmesini otomatik olarak sağlıyor —
    // ayrıca bkz. baseChartOptions()'a eklenen rightOffset (görsel olarak
    // sürüklenecek boş alan) ve translateShapePoints()/pasteDrawing()'teki
    // ilgili clamp güncellemeleri.
    const MAX_FUTURE_BARS = 2000; // aşırı/patolojik sürüklemelere karşı güvenlik sınırı, pratikte hiç dokunulmaz

    function inferBarIntervalSeconds() {
        if (state.candles.length >= 2) {
            const n = state.candles.length;
            const diff = state.candles[n - 1].date - state.candles[n - 2].date;
            if (diff > 0) return diff;
        }
        return 86400; // güvenli varsayılan: 1 gün
    }

    function virtualIndexToTime(idx) {
        if (!state.candles.length) return null;
        const lastIdx = state.candles.length - 1;
        const rounded = Math.round(idx);
        if (rounded <= lastIdx) {
            const clamped = Math.max(0, rounded);
            return state.candles[clamped].date;
        }
        const interval = inferBarIntervalSeconds();
        const stepsAhead = Math.min(rounded - lastIdx, MAX_FUTURE_BARS);
        return state.candles[lastIdx].date + stepsAhead * interval;
    }

    // Gerçek bir mum tarihini KESİN index'ine, son mumdan SONRAKİ sentetik
    // (virtualIndexToTime tarafından üretilmiş) bir zaman damgasını ise
    // ekstrapole edilmiş sanal index'ine çevirir. Eşleşmeyen ve son mumdan
    // ÖNCEKİ bir zaman için (normalde oluşmaz) eski davranışla tutarlı
    // olarak -1 döner.
    function virtualTimeToIndex(time) {
        if (time == null || !state.candles.length) return -1;
        const real = state.candles.findIndex(c => c.date === time);
        if (real >= 0) return real;
        const lastIdx = state.candles.length - 1;
        const lastDate = state.candles[lastIdx].date;
        if (time > lastDate) {
            const interval = inferBarIntervalSeconds();
            return lastIdx + Math.round((time - lastDate) / interval);
        }
        return -1;
    }

    function pixelToDataPoint(x, y) {
        if (!chart || !candleSeries || !state.candles.length) return { time: null, price: null, idx: -1 };
        const logical = chart.timeScale().coordinateToLogical(x);
        let idx = Math.round(logical);
        idx = Math.max(0, Math.min(state.candles.length - 1 + MAX_FUTURE_BARS, idx));
        const time = virtualIndexToTime(idx);
        const price = candleSeries.coordinateToPrice(y);
        return snapToOHLC({ time, price, idx });
    }

    function dataPointToPixel(point) {
        if (!chart || !candleSeries || !point) return { x: null, y: null };
        const idx = virtualTimeToIndex(point.time);
        const x = idx >= 0 ? chart.timeScale().logicalToCoordinate(idx) : null;
        const y = candleSeries.priceToCoordinate(point.price);
        return { x, y };
    }

    function indexForTime(time) {
        return virtualTimeToIndex(time);
    }

    function finishDrawing() {
        selectTool('cursor');
        redrawDrawings();
    }

    // (2 Ağustos 2026 — revize planı madde 8) Grafik notu modali — bkz.
    // onDrawStart()'taki 'text' aracı dalı ve setupChartNoteModal().
    let chartNotePendingPoint = null;

    function closeChartNoteModal() {
        const backdrop = byId('chart-note-modal-backdrop');
        if (backdrop) backdrop.classList.remove('open');
        chartNotePendingPoint = null;
    }

    function openChartNoteModal(dp) {
        const backdrop = byId('chart-note-modal-backdrop');
        const input = byId('chart-note-input');
        if (!backdrop) return;
        chartNotePendingPoint = dp;
        if (input) input.value = '';
        if (window.__optipulseCloseOtherModals) window.__optipulseCloseOtherModals('chart-note-modal-backdrop');
        backdrop.classList.add('open');
        if (input) setTimeout(() => input.focus(), 30);
    }

    function commitChartNote() {
        const input = byId('chart-note-input');
        const label = input ? input.value.trim() : '';
        if (label && chartNotePendingPoint) {
            state.drawings.push({ type: 'text', p1: chartNotePendingPoint, p2: chartNotePendingPoint, label });
            finishDrawing();
        } else {
            // Boş not girildiyse aracı seçili bırak (eski window.prompt()
            // davranışıyla aynı) — sadece modali kapat.
        }
        closeChartNoteModal();
    }

    function setupChartNoteModal() {
        const backdrop = byId('chart-note-modal-backdrop');
        const closeBtn = byId('btn-close-chart-note');
        const cancelBtn = byId('btn-chart-note-cancel');
        const saveBtn = byId('btn-chart-note-save');
        const input = byId('chart-note-input');
        if (!backdrop) return;

        if (closeBtn) closeBtn.addEventListener('click', closeChartNoteModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeChartNoteModal);
        if (saveBtn) saveBtn.addEventListener('click', commitChartNote);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeChartNoteModal(); });
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitChartNote(); }
                else if (e.key === 'Escape') { e.preventDefault(); closeChartNoteModal(); }
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('open')) closeChartNoteModal();
        });
    }

    function onDrawStart(e) {
        if (state.activeTool === 'cursor') return;
        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (!isInPlotArea(x, y)) return;
        const dp = pixelToDataPoint(x, y);
        if (dp.time === null || dp.price === null) return;

        if (state.activeTool === 'measure') {
            // Yeni bir ölçüme başlarken önceki geçici sonucu temizle.
            state.measureShape = null;
        }

        if (state.activeTool === 'text') {
            // (2 Ağustos 2026 — revize planı madde 8) Eskiden burada çıplak
            // window.prompt() kullanılıyordu — hem uygulamanın kendi görsel
            // dilinden kopuk hem de tarayıcı native dialog'u olduğu için
            // stillendirilemiyordu. Artık uygulamanın diğer modalleriyle
            // (SLTP, Alarm, vb.) aynı desendeki özel bir modal açılıyor;
            // asıl "not ekle" işlemi kullanıcı modalde Enter'a basınca ya da
            // "Ekle" butonuna tıklayınca commitChartNote() içinde yapılıyor.
            openChartNoteModal(dp);
            return;
        }

        if (SINGLE_POINT_TOOLS.includes(state.activeTool)) {
            state.drawings.push({ type: state.activeTool, p1: dp, p2: dp });
            finishDrawing();
            return;
        }

        if (MULTI_CLICK_TOOLS[state.activeTool]) {
            const required = MULTI_CLICK_TOOLS[state.activeTool];
            if (!state.pendingPoints) state.pendingPoints = [];
            state.pendingPoints.push(dp);
            if (state.pendingPoints.length >= required) {
                state.drawings.push({ type: state.activeTool, points: state.pendingPoints.slice() });
                state.pendingPoints = null;
                finishDrawing();
            } else {
                state.pendingShape = { type: state.activeTool, points: state.pendingPoints.slice() };
                redrawDrawings();
            }
            return;
        }

        if (FREEHAND_TOOLS.includes(state.activeTool)) {
            state.pendingShape = { type: state.activeTool, points: [dp], dragging: true };
            return;
        }

        state.pendingShape = { type: state.activeTool, p1: dp, p2: dp, dragging: true };
    }

    function onDrawMove(e) {
        if (state.pendingPoints && MULTI_CLICK_TOOLS[state.activeTool]) {
            // Rubber-band preview: show the committed points-so-far plus a
            // "live" segment following the cursor, without adding it to
            // state.pendingPoints (only an actual click commits a point).
            const rect = drawCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            if (!isInPlotArea(x, y)) return;
            const dp = pixelToDataPoint(x, y);
            if (dp.time === null || dp.price === null) return;
            state.pendingShape = { type: state.activeTool, points: state.pendingPoints.concat([dp]) };
            redrawDrawings();
            return;
        }
        if (!state.pendingShape || !state.pendingShape.dragging) return;
        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (!isInPlotArea(x, y)) return;
        const dp = pixelToDataPoint(x, y);
        if (dp.time === null || dp.price === null) return;

        if (state.pendingShape.points) {
            state.pendingShape.points.push(dp);
        } else {
            state.pendingShape.p2 = dp;
        }
        redrawDrawings();
    }

    function onDrawEnd() {
        if (!state.pendingShape || !state.pendingShape.dragging) return;
        const pending = state.pendingShape;
        pending.dragging = false;
        state.pendingShape = null;

        if (pending.type === 'measure') {
            // (29 Temmuz 2026 — Madde 14) Kalıcı bir çizim OLARAK eklenmiyor —
            // geçici measureShape'e yazılıyor ve araç "İmleç"e dönmüyor, aynı
            // araçla art arda ölçüm yapılabiliyor (finishDrawing() BİLEREK
            // çağrılmıyor).
            state.measureShape = { p1: pending.p1, p2: pending.p2 };
            redrawDrawings();
            return;
        }

        if (pending.points) {
            if (pending.points.length > 1) {
                state.drawings.push({ type: pending.type, points: pending.points });
            }
        } else if (DERIVED_THIRD_POINT_TOOLS.includes(pending.type)) {
            const range = priceRangeApprox();
            if (pending.type === 'channel') {
                state.drawings.push({ type: 'channel', p1: pending.p1, p2: pending.p2, offset: range * 0.12 });
            } else if (pending.type === 'triangle') {
                // (3 Ağustos 2026 EK) idx1/idx2 artık indexForTime()
                // (virtualTimeToIndex) sayesinde son mumun ÖTESİNDEKİ
                // (gelecekteki) p1/p2 noktalarını da doğru çözüyor; midIdx'in
                // üst sınırı da length-1 yerine virtualMaxIdx, apex zamanı da
                // virtualIndexToTime ile üretiliyor — üçgenin bir kısmı
                // gelecek alana çizildiğinde apex noktası de "yapışmıyor".
                const idx1 = indexForTime(pending.p1.time), idx2 = indexForTime(pending.p2.time);
                const virtualMaxIdx = state.candles.length - 1 + MAX_FUTURE_BARS;
                const midIdx = Math.max(0, Math.min(virtualMaxIdx, Math.round((idx1 + idx2) / 2)));
                const apexPrice = Math.max(pending.p1.price, pending.p2.price) + (Math.abs(pending.p1.price - pending.p2.price) || range * 0.1);
                state.drawings.push({
                    type: 'triangle', p1: pending.p1, p2: pending.p2,
                    apex: { time: virtualIndexToTime(midIdx), price: apexPrice }
                });
            } else {
                // pos_long / pos_short: p1 = entry, p2 = stop; target auto-computed at 2:1 reward:risk
                const entry = pending.p1.price, stop = pending.p2.price;
                const risk = Math.abs(entry - stop) || range * 0.05;
                const target = pending.type === 'pos_long' ? entry + risk * 2 : entry - risk * 2;
                state.drawings.push({ type: pending.type, p1: pending.p1, p2: pending.p2, target });
            }
        } else {
            state.drawings.push({ type: pending.type, p1: pending.p1, p2: pending.p2 });
        }

        finishDrawing();
    }

    function extendLineToEdge(from, to, rect) {
        const dx = to.x - from.x, dy = to.y - from.y;
        if (dx === 0 && dy === 0) return to;
        let tMax = Infinity;
        if (dx > 0) tMax = Math.min(tMax, (rect.width - to.x) / dx);
        else if (dx < 0) tMax = Math.min(tMax, (0 - to.x) / dx);
        if (dy > 0) tMax = Math.min(tMax, (rect.height - to.y) / dy);
        else if (dy < 0) tMax = Math.min(tMax, (0 - to.y) / dy);
        if (!isFinite(tMax) || tMax < 0) tMax = 0;
        return { x: to.x + dx * tMax, y: to.y + dy * tMax };
    }

    function drawFibLevels(a, b, shape, levels) {
        const xStart = Math.min(a.x, b.x);
        const xEnd = Math.max(a.x, b.x);
        const p1 = shape.p1.price, p2 = shape.p2.price;
        levels.forEach(lvl => {
            const price = p1 + (p2 - p1) * lvl;
            const y = candleSeries.priceToCoordinate(price);
            if (y === null) return;
            drawCtx.strokeStyle = fibLineColor();
            drawCtx.beginPath();
            drawCtx.moveTo(xStart, y);
            drawCtx.lineTo(xEnd, y);
            drawCtx.stroke();
            drawCtx.fillStyle = drawColor();
            drawCtx.font = '9px "Fira Code", monospace';
            drawCtx.fillText(`${(lvl * 100).toFixed(1)}%  ₺${fmtPrice(price)}`, xEnd + 4, y + 3);
        });
    }

    function redrawDrawings() {
        if (!drawCtx || !drawCanvas) return;
        const rect = drawCanvas.getBoundingClientRect();
        drawCtx.save();
        drawCtx.setTransform((window.devicePixelRatio || 1), 0, 0, (window.devicePixelRatio || 1), 0, 0);
        drawCtx.clearRect(0, 0, rect.width, rect.height);

        const plot = getPlotRect();
        drawCtx.beginPath();
        drawCtx.rect(0, 0, plot.width, plot.height);
        drawCtx.clip();

        if (!state.drawingsHidden) {
            state.drawings.forEach((shape, i) => drawShape(shape, i === state.selectedDrawingIndex));
        }
        if (state.pendingShape) drawShape(state.pendingShape, false);
        if (state.measureShape) drawShape({ type: 'measure', p1: state.measureShape.p1, p2: state.measureShape.p2 }, false);

        renderSessionCloseMarker(plot);
        drawCtx.restore();
    }

    // Thin dashed vertical marker + label at the most recent bar, shown only
    // while the market is closed (ties directly into the shared
    // DataController.isMarketOpenNow() market-hours engine) — makes it
    // visually obvious where "live" data stopped instead of leaving the
    // frozen last bar looking indistinguishable from an open session.
    function renderSessionCloseMarker(rect) {
        const DC = window.DataController;
        if (!DC || !DC.isMarketOpenNow || DC.isMarketOpenNow()) return;
        if (!chart || !state.candles.length) return;

        const idx = state.candles.length - 1;
        const x = chart.timeScale().logicalToCoordinate(idx);
        if (x === null || x === undefined || isNaN(x)) return;

        drawCtx.save();
        drawCtx.strokeStyle = 'rgba(255,167,38,0.55)'; // matches the header's CLOSED badge color
        drawCtx.lineWidth = 1;
        drawCtx.setLineDash([4, 4]);
        drawCtx.beginPath();
        drawCtx.moveTo(x, 0);
        drawCtx.lineTo(x, rect.height);
        drawCtx.stroke();
        drawCtx.setLineDash([]);

        drawCtx.fillStyle = 'rgba(255,167,38,0.9)';
        drawCtx.font = '10px "Fira Code", monospace';
        const label = 'Son Kapanış';
        const labelWidth = drawCtx.measureText(label).width;
        const labelX = Math.min(x + 4, Math.max(0, rect.width - labelWidth - 4));
        drawCtx.fillText(label, labelX, 12);
        drawCtx.restore();
    }

    // (23 Temmuz 2026 düzeltmesi) Kullanıcı geri bildirimi: açık (light) temada
    // varsayılan altın/sarı çizim rengi (#D4AF37) beyaza yakın arka plan
    // üzerinde neredeyse görünmüyordu. Sabit bir renk yerine artık TEMAYA
    // GÖRE seçiliyor: açık temada koyu/siyaha yakın bir ton (kontrast için),
    // koyu temada mevcut altın rengi aynen korunuyor (orada zaten okunaklıydı,
    // kullanıcı sadece açık temadaki görünürlükten şikayet etti).
    function drawColor() {
        return currentTheme === 'light' ? '#14161A' : COLORS.draw;
    }
    function fibLineColor() {
        return currentTheme === 'light' ? 'rgba(20,22,26,0.55)' : COLORS.fibLine;
    }

    function drawShape(shape, isSelected) {
        if (shape.type === 'brush' || shape.type === 'elliott' || shape.type === 'abcd') {
            if (!shape.points || shape.points.length < 2) return;
            const pts = shape.points.map(dataPointToPixel).filter(p => p.x !== null && p.y !== null);
            if (pts.length < 2) return;
            drawCtx.save();
            drawCtx.strokeStyle = isSelected ? '#4FC3F7' : drawColor();
            drawCtx.lineWidth = isSelected ? 3 : 2;
            drawCtx.lineJoin = 'round';
            drawCtx.lineCap = 'round';
            drawCtx.beginPath();
            drawCtx.moveTo(pts[0].x, pts[0].y);
            pts.slice(1).forEach(p => drawCtx.lineTo(p.x, p.y));
            drawCtx.stroke();
            if (shape.type === 'elliott') {
                // Wave-count labels — purely visual markers the user assigns
                // by click order (0 = başlangıç, 1-5 = itki dalgaları); this
                // tool does not attempt automatic Elliott Wave detection.
                const WAVE_LABELS = ['0', '1', '2', '3', '4', '5'];
                drawCtx.fillStyle = isSelected ? '#4FC3F7' : drawColor();
                drawCtx.font = 'bold 11px "Fira Code", monospace';
                pts.forEach((p, i) => {
                    drawCtx.fillText(WAVE_LABELS[i] !== undefined ? WAVE_LABELS[i] : String(i), p.x + 5, p.y - 5);
                });
            } else if (shape.type === 'abcd') {
                // (18 Temmuz 2026, onuncu oturum, ikinci tur) A-B-C-D deseni:
                // kullanıcının elle işaretlediği 4 nokta, sadece etiketleme —
                // Elliott aracıyla aynı dürüstlük ilkesi (otomatik desen
                // TANIMA yapılmıyor).
                const ABCD_LABELS = ['A', 'B', 'C', 'D'];
                drawCtx.fillStyle = isSelected ? '#4FC3F7' : drawColor();
                drawCtx.font = 'bold 11px "Fira Code", monospace';
                pts.forEach((p, i) => {
                    drawCtx.fillText(ABCD_LABELS[i] !== undefined ? ABCD_LABELS[i] : String(i), p.x + 5, p.y - 5);
                });
            }
            drawCtx.restore();
            return;
        }

        const a = dataPointToPixel(shape.p1);
        const b = dataPointToPixel(shape.p2);
        if (a.x === null || b.x === null || a.y === null || b.y === null) return;
        const rect = getPlotRect();

        drawCtx.save();
        drawCtx.strokeStyle = isSelected ? '#4FC3F7' : drawColor();
        drawCtx.fillStyle = isSelected ? 'rgba(79,195,247,0.12)' : 'rgba(212,175,55,0.10)';
        drawCtx.lineWidth = isSelected ? 2.25 : 1.5;
        if (isSelected) drawCtx.setLineDash([5, 3]);

        if (shape.type === 'trend') {
            // (23 Temmuz 2026, İKİNCİ düzeltme) Bir önceki turda buraya
            // 'ray' ile AYNI extendLineToEdge() mantığı eklenmişti ("sağa da
            // gitmeli" isteğine karşılık). Kullanıcı geri bildirimi bunun
            // pratikte "ışın gibi" göründüğünü ve istenmediğini gösterdi —
            // çünkü kısa/dik bir trend çizgisinin eğimi, kalan tüm barlara
            // yayılınca fiyat ekseninde çok abartılı bir sıçrama gibi
            // görünüyor (tam olarak 'ray' aracının YAPMASI GEREKEN şey, ama
            // 'trend' için istenmeyen bir yan etki). Bu yüzden 'trend'
            // GERİ ALINDI: yalnızca çizilen p1→p2 arasında düz bir segment,
            // uzatma YOK. Sağa doğru uzatma isteyen bir kullanıcı zaten
            // ayrı, bunun için var olan 'ray' (Işın) veya 'extended'
            // (Genişletilmiş Çizgi) araçlarını seçebilir.
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(b.x, b.y);
            drawCtx.stroke();
        } else if (shape.type === 'trend_projection') {
            // (18 Temmuz 2026, onuncu oturum, ikinci tur) Doğrusal trend
            // projeksiyonu: p1->p2 SOLID segment + aynı vektörün bir katı
            // kadar daha DASHED devamı — basit ekstrapolasyon, YATIRIM
            // TAVSİYESİ DEĞİLDİR. Üçüncü bir nokta saklamıyoruz; projeksiyon
            // ucu her zaman p1/p2'den render anında hesaplanıyor, böylece
            // seçim/taşıma/kopyalama gibi genel p1/p2 mantığı değişmeden
            // çalışıyor.
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(b.x, b.y);
            drawCtx.stroke();
            const projX = b.x + (b.x - a.x);
            const projY = b.y + (b.y - a.y);
            drawCtx.save();
            drawCtx.setLineDash([6, 4]);
            drawCtx.beginPath();
            drawCtx.moveTo(b.x, b.y);
            drawCtx.lineTo(projX, projY);
            drawCtx.stroke();
            drawCtx.restore();
            drawCtx.save();
            drawCtx.fillStyle = isSelected ? '#4FC3F7' : drawColor();
            drawCtx.font = '9px "Fira Code", monospace';
            drawCtx.fillText('Projeksiyon (doğrusal)', projX + 4, projY - 4);
            drawCtx.restore();
        } else if (shape.type === 'ray') {
            const ext = extendLineToEdge(a, b, rect);
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(ext.x, ext.y);
            drawCtx.stroke();
        } else if (shape.type === 'extended') {
            const extFwd = extendLineToEdge(a, b, rect);
            const extBack = extendLineToEdge(b, a, rect);
            drawCtx.beginPath();
            drawCtx.moveTo(extBack.x, extBack.y);
            drawCtx.lineTo(extFwd.x, extFwd.y);
            drawCtx.stroke();
        } else if (shape.type === 'horizontal') {
            drawCtx.beginPath();
            drawCtx.moveTo(0, a.y);
            drawCtx.lineTo(rect.width, a.y);
            drawCtx.stroke();
            drawCtx.fillStyle = drawColor();
            drawCtx.font = '10px "Fira Code", monospace';
            drawCtx.fillText('₺' + fmtPrice(shape.p1.price), 4, a.y - 4);
        } else if (shape.type === 'hray') {
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(rect.width, a.y);
            drawCtx.stroke();
            drawCtx.fillStyle = drawColor();
            drawCtx.font = '10px "Fira Code", monospace';
            drawCtx.fillText('₺' + fmtPrice(shape.p1.price), a.x + 4, a.y - 4);
        } else if (shape.type === 'vline') {
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, 0);
            drawCtx.lineTo(a.x, rect.height);
            drawCtx.stroke();
        } else if (shape.type === 'cross') {
            drawCtx.beginPath();
            drawCtx.moveTo(0, a.y);
            drawCtx.lineTo(rect.width, a.y);
            drawCtx.moveTo(a.x, 0);
            drawCtx.lineTo(a.x, rect.height);
            drawCtx.stroke();
        } else if (shape.type === 'rect') {
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
            drawCtx.fillRect(x, y, w, h);
            drawCtx.strokeRect(x, y, w, h);
        } else if (shape.type === 'ellipse') {
            const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
            const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
            drawCtx.beginPath();
            drawCtx.ellipse(cx, cy, rx || 0.01, ry || 0.01, 0, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.stroke();
        } else if (shape.type === 'triangle') {
            const c3 = dataPointToPixel(shape.apex);
            if (c3.x === null || c3.y === null) { drawCtx.restore(); return; }
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(b.x, b.y);
            drawCtx.lineTo(c3.x, c3.y);
            drawCtx.closePath();
            drawCtx.fill();
            drawCtx.stroke();
        } else if (shape.type === 'arrow') {
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(b.x, b.y);
            drawCtx.stroke();
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            const headLen = 10;
            drawCtx.beginPath();
            drawCtx.moveTo(b.x, b.y);
            drawCtx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
            drawCtx.moveTo(b.x, b.y);
            drawCtx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
            drawCtx.stroke();
        } else if (shape.type === 'text') {
            drawCtx.fillStyle = drawColor();
            drawCtx.font = '12px Outfit, sans-serif';
            drawCtx.fillText(shape.label || '', a.x + 4, a.y - 6);
        } else if (shape.type === 'measure') {
            drawCtx.setLineDash([4, 3]);
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(b.x, b.y);
            drawCtx.stroke();
            drawCtx.setLineDash([]);
            const priceDiff = shape.p2.price - shape.p1.price;
            const pct = shape.p1.price !== 0 ? (priceDiff / shape.p1.price * 100) : 0;
            const idx1 = indexForTime(shape.p1.time), idx2 = indexForTime(shape.p2.time);
            const bars = Math.abs(idx2 - idx1);
            const midX = (a.x + b.x) / 2;
            // (2 Ağustos 2026 — revize planı madde 2) Etiket kutusu, iki
            // noktanın tam ortasına (midY) hiçbir sınır kontrolü olmadan
            // çiziliyordu — ölçüm alt/üst kenara yakın iki nokta arasında
            // yapılırsa, kutu ana grafiğin en alt/üst şeridine (tarih
            // ekseninin oturduğu paylaşılan alan dahil) taşıp orayı görsel
            // olarak kaplayabiliyordu ("tarih bölümü kayboluyor" şikayeti).
            // Düzeltme: kutunun dikey konumu, üstte/altta küçük bir pay
            // (LABEL_EDGE_MARGIN_PX) bırakacak şekilde grafik alanının
            // içine kenetleniyor — ölçüm noktaları nerede olursa olsun
            // etiket her zaman görünür ve kenarları kaplamıyor.
            const LABEL_EDGE_MARGIN_PX = 16;
            const rawMidY = (a.y + b.y) / 2;
            const rect = drawCanvas.getBoundingClientRect();
            const midY = Math.min(Math.max(rawMidY, LABEL_EDGE_MARGIN_PX + 9), rect.height - LABEL_EDGE_MARGIN_PX - 9);
            const text = (priceDiff >= 0 ? '+' : '') + fmtPrice(priceDiff) + '  (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)  ' + bars + ' bar';
            drawCtx.font = '10px "Fira Code", monospace';
            const tw = drawCtx.measureText(text).width + 12;
            drawCtx.fillStyle = priceDiff >= 0 ? 'rgba(38,166,154,0.85)' : 'rgba(239,83,80,0.85)';
            drawCtx.fillRect(midX - tw / 2, midY - 10, tw, 18);
            drawCtx.fillStyle = '#fff';
            drawCtx.textAlign = 'center';
            drawCtx.fillText(text, midX, midY + 3);
            drawCtx.textAlign = 'left';
        } else if (shape.type === 'channel') {
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(b.x, b.y);
            drawCtx.stroke();
            const y1b = candleSeries.priceToCoordinate(shape.p1.price + shape.offset);
            const y2b = candleSeries.priceToCoordinate(shape.p2.price + shape.offset);
            if (y1b !== null && y2b !== null) {
                drawCtx.beginPath();
                drawCtx.moveTo(a.x, y1b);
                drawCtx.lineTo(b.x, y2b);
                drawCtx.stroke();
            }
        } else if (shape.type === 'pos_long' || shape.type === 'pos_short') {
            const targetY = candleSeries.priceToCoordinate(shape.target);
            const xStart = Math.min(a.x, b.x), xEnd = Math.max(a.x, b.x) + 60;
            const entryY = a.y, stopY = b.y;
            if (targetY !== null) {
                drawCtx.fillStyle = 'rgba(38,166,154,0.18)';
                drawCtx.fillRect(xStart, Math.min(entryY, targetY), xEnd - xStart, Math.abs(entryY - targetY));
            }
            drawCtx.fillStyle = 'rgba(239,83,80,0.18)';
            drawCtx.fillRect(xStart, Math.min(entryY, stopY), xEnd - xStart, Math.abs(entryY - stopY));
            drawCtx.strokeStyle = drawColor();
            drawCtx.beginPath();
            drawCtx.moveTo(xStart, entryY);
            drawCtx.lineTo(xEnd, entryY);
            drawCtx.stroke();
            drawCtx.fillStyle = '#e0e0e0';
            drawCtx.font = '9px "Fira Code", monospace';
            drawCtx.fillText('Giriş ₺' + fmtPrice(shape.p1.price), xStart + 4, entryY - 4);
            if (targetY !== null) drawCtx.fillText('Hedef ₺' + fmtPrice(shape.target), xStart + 4, targetY - 4);
            drawCtx.fillText('Stop ₺' + fmtPrice(shape.p2.price), xStart + 4, stopY + 12);
        } else if (shape.type === 'fib') {
            drawFibLevels(a, b, shape, [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
        } else if (shape.type === 'fib_ext') {
            drawFibLevels(a, b, shape, [0, 0.618, 1, 1.272, 1.618, 2, 2.618]);
        } else if (shape.type === 'fib_fan') {
            const levels = [0.236, 0.382, 0.5, 0.618, 0.786, 1];
            levels.forEach(lvl => {
                const price = shape.p1.price + (shape.p2.price - shape.p1.price) * lvl;
                const py = candleSeries.priceToCoordinate(price);
                if (py === null) return;
                const ext = extendLineToEdge(a, { x: b.x, y: py }, rect);
                drawCtx.strokeStyle = fibLineColor();
                drawCtx.beginPath();
                drawCtx.moveTo(a.x, a.y);
                drawCtx.lineTo(ext.x, ext.y);
                drawCtx.stroke();
            });
        } else if (shape.type === 'fib_time') {
            const idx1 = indexForTime(shape.p1.time), idx2 = indexForTime(shape.p2.time);
            const unit = Math.max(1, Math.abs(idx2 - idx1));
            const fibNums = [1, 2, 3, 5, 8, 13, 21];
            fibNums.forEach(n => {
                const idx = idx1 + unit * n;
                if (idx < 0 || idx >= state.candles.length) return;
                const lx = chart.timeScale().logicalToCoordinate(idx);
                if (lx === null) return;
                drawCtx.strokeStyle = fibLineColor();
                drawCtx.beginPath();
                drawCtx.moveTo(lx, 0);
                drawCtx.lineTo(lx, rect.height);
                drawCtx.stroke();
                drawCtx.fillStyle = drawColor();
                drawCtx.font = '9px "Fira Code", monospace';
                drawCtx.fillText(String(n), lx + 2, 12);
            });
        } else if (shape.type === 'gann_fan') {
            // Klasik Gann açı seti: p1 = pivot, p2 = "1x1" (45°) açısını
            // tanımlayan referans nokta. Her oran, p1->p2 fiyat/bar eğiminin
            // bir katı olarak p2'nin zaman indeksinde bir fiyat üretir, tıpkı
            // fib_fan'daki interpolasyon gibi — yalnızca oran seti farklı.
            const GANN_RATIOS = [
                { r: 1 / 8, label: '1x8' },
                { r: 1 / 4, label: '1x4' },
                { r: 1 / 3, label: '1x3' },
                { r: 1 / 2, label: '1x2' },
                { r: 1,     label: '1x1' },
                { r: 2,     label: '2x1' },
                { r: 3,     label: '3x1' },
                { r: 4,     label: '4x1' },
                { r: 8,     label: '8x1' }
            ];
            GANN_RATIOS.forEach(g => {
                const price = shape.p1.price + (shape.p2.price - shape.p1.price) * g.r;
                const py = candleSeries.priceToCoordinate(price);
                if (py === null) return;
                const ext = extendLineToEdge(a, { x: b.x, y: py }, rect);
                drawCtx.strokeStyle = g.r === 1 ? (isSelected ? '#4FC3F7' : drawColor()) : fibLineColor();
                drawCtx.lineWidth = g.r === 1 ? 2 : 1;
                drawCtx.beginPath();
                drawCtx.moveTo(a.x, a.y);
                drawCtx.lineTo(ext.x, ext.y);
                drawCtx.stroke();
                drawCtx.fillStyle = drawColor();
                drawCtx.font = '9px "Fira Code", monospace';
                drawCtx.fillText(g.label, ext.x - 24, ext.y - 3);
            });
        }

        if (isSelected) {
            drawCtx.setLineDash([]);
            drawCtx.fillStyle = '#4FC3F7';
            [a, b].forEach(pt => {
                drawCtx.beginPath();
                drawCtx.rect(pt.x - 3.5, pt.y - 3.5, 7, 7);
                drawCtx.fill();
            });
        }
        drawCtx.restore();
    }

    /* ────────── Drawing selection, copy/paste, delete ────────── */

    function distToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = x1 + t * dx, cy = y1 + t * dy;
        return Math.hypot(px - cx, py - cy);
    }

    function hitTestDrawings(x, y) {
        if (state.drawingsLocked || state.drawingsHidden) return -1;
        const HIT_TOLERANCE = 6;
        for (let i = state.drawings.length - 1; i >= 0; i--) {
            const shape = state.drawings[i];

            if (shape.type === 'brush' || shape.type === 'elliott' || shape.type === 'abcd') {
                if (!shape.points || shape.points.length < 2) continue;
                const pts = shape.points.map(dataPointToPixel).filter(p => p.x !== null && p.y !== null);
                for (let j = 0; j < pts.length - 1; j++) {
                    if (distToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) <= HIT_TOLERANCE) return i;
                }
                continue;
            }

            const a = dataPointToPixel(shape.p1);
            const b = dataPointToPixel(shape.p2);
            if (a.x === null || b.x === null || a.y === null || b.y === null) continue;

            if (shape.type === 'trend' || shape.type === 'arrow' || shape.type === 'ray' || shape.type === 'extended' || shape.type === 'channel') {
                if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_TOLERANCE) return i;
            } else if (shape.type === 'trend_projection') {
                if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_TOLERANCE) return i;
                const projX = b.x + (b.x - a.x), projY = b.y + (b.y - a.y);
                if (distToSegment(x, y, b.x, b.y, projX, projY) <= HIT_TOLERANCE) return i;
            } else if (shape.type === 'horizontal' || shape.type === 'hray') {
                if (Math.abs(y - a.y) <= HIT_TOLERANCE) return i;
            } else if (shape.type === 'vline') {
                if (Math.abs(x - a.x) <= HIT_TOLERANCE) return i;
            } else if (shape.type === 'cross') {
                if (Math.abs(x - a.x) <= HIT_TOLERANCE || Math.abs(y - a.y) <= HIT_TOLERANCE) return i;
            } else if (shape.type === 'text') {
                if (Math.abs(x - a.x) <= 40 && Math.abs(y - a.y) <= 14) return i;
            } else if (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'pos_long' || shape.type === 'pos_short') {
                const rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y);
                const rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
                if (x >= rx - HIT_TOLERANCE && x <= rx + rw + HIT_TOLERANCE &&
                    y >= ry - HIT_TOLERANCE && y <= ry + rh + HIT_TOLERANCE) return i;
            } else if (shape.type === 'triangle') {
                const c3 = dataPointToPixel(shape.apex);
                if (c3.x === null) continue;
                if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_TOLERANCE ||
                    distToSegment(x, y, b.x, b.y, c3.x, c3.y) <= HIT_TOLERANCE ||
                    distToSegment(x, y, c3.x, c3.y, a.x, a.y) <= HIT_TOLERANCE) return i;
            } else if (shape.type === 'measure') {
                if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_TOLERANCE) return i;
            } else if (shape.type === 'fib' || shape.type === 'fib_ext') {
                const levels = shape.type === 'fib' ? [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] : [0, 0.618, 1, 1.272, 1.618, 2, 2.618];
                const xStart = Math.min(a.x, b.x), xEnd = Math.max(a.x, b.x);
                if (x < xStart - HIT_TOLERANCE || x > xEnd + HIT_TOLERANCE) continue;
                const p1 = shape.p1.price, p2 = shape.p2.price;
                const hit = levels.some(lvl => {
                    const price = p1 + (p2 - p1) * lvl;
                    const ly = candleSeries.priceToCoordinate(price);
                    return ly !== null && Math.abs(y - ly) <= HIT_TOLERANCE;
                });
                if (hit) return i;
            } else if (shape.type === 'fib_fan' || shape.type === 'fib_time' || shape.type === 'gann_fan') {
                // Low-value to hit-test precisely (fan rays / time-zone verticals extend to the
                // canvas edge) — a generous bounding-box check keeps selection usable without
                // duplicating the render geometry here.
                const rx = Math.min(a.x, b.x) - 20, rw = Math.abs(b.x - a.x) + 40;
                if (x >= rx && x <= rx + rw) return i;
            }
        }
        return -1;
    }

    // (23 Temmuz 2026, on üçüncü oturum devamı) Bir şeklin p1/p2 uç nokta
    // tutamaçlarından birine yeterince yakın tıklanıp tıklanmadığını
    // döndürür ('p1' / 'p2' / null). Yalnızca gerçek iki-nokta çizimlerinde
    // (brush/elliott/abcd gibi points-dizisi tabanlı olanlar HARİÇ) anlamlı
    // olduğu için o tipler baştan eleniyor. p1===p2 olan tek-nokta
    // araçlarında (yatay/dikey/çapraz çizgi, metin) her iki tutamaç da aynı
    // pikselde çakışır — bilerek ÖNCE p1 kontrol ediliyor ki grab her zaman
    // render'ı etkileyen noktaya (p1) denk gelsin.
    function hitTestHandle(shape, x, y) {
        if (!shape || !shape.p1 || !shape.p2) return null;
        if (shape.type === 'brush' || shape.type === 'elliott' || shape.type === 'abcd') return null;
        const HANDLE_TOLERANCE = 8;
        const a = dataPointToPixel(shape.p1);
        if (a.x !== null && a.y !== null && Math.hypot(x - a.x, y - a.y) <= HANDLE_TOLERANCE) return 'p1';
        const b = dataPointToPixel(shape.p2);
        if (b.x !== null && b.y !== null && Math.hypot(x - b.x, y - b.y) <= HANDLE_TOLERANCE) return 'p2';
        return null;
    }

    function selectDrawing(index) {
        state.selectedDrawingIndex = index;
        redrawDrawings();
    }

    function copySelectedDrawing() {
        if (state.selectedDrawingIndex < 0) return false;
        copiedDrawing = JSON.parse(JSON.stringify(state.drawings[state.selectedDrawingIndex]));
        return true;
    }

    function pasteDrawing() {
        if (!copiedDrawing || !state.candles.length) return false;
        // (29 Temmuz 2026 — Madde 13 düzeltmesi) Eskiden sadece ZAMAN ekseninde
        // 3 mumluk bir kayma uygulanıyordu. Bu, konumu SADECE fiyata bağlı
        // olan çizim türlerinde (örn. "Yatay Çizgi" — tüm grafik genişliğini
        // p1.price'a göre çizer, x/zaman konumunu hiç kullanmaz) görsel
        // olarak HİÇBİR fark yaratmıyordu: yapıştırılan kopya orijinalin TAM
        // üzerine düşüyor, kullanıcı ayırt edip ayırmak için ok tuşlarıyla
        // elle taşımak zorunda kalıyordu ("Hareket kısıtlılığı" şikayeti).
        // Artık fiyat ekseninde de küçük (%1) bir kayma uygulanıyor — şekil
        // türü ne olursa olsun yapıştırılan kopya orijinalden görünür şekilde
        // ayrışıyor.
        // (3 Ağustos 2026 EK — "çizgi sağa gitmiyor" düzeltmesi) idx artık
        // virtualTimeToIndex ile hesaplanıyor (kopyalanan şekil zaten son
        // mumun ÖTESİNDE — gelecekte — bir noktaya sahipse doğru sanal
        // index'ini bulur; eskiden findIndex bunu bulamayıp -1/0'a
        // düşüyordu, bu da geleceğe yerleştirilmiş bir çizimin
        // yapıştırılınca sıfırıncı muma "ışınlanmasına" sebep olurdu). Üst
        // sınır da length-1 yerine virtualMaxIdx.
        const virtualMaxIdx = state.candles.length - 1 + MAX_FUTURE_BARS;
        const shiftPoint = (point) => {
            if (!point) return point;
            const idx = virtualTimeToIndex(point.time);
            const newIdx = Math.max(0, Math.min(virtualMaxIdx, (idx >= 0 ? idx : 0) + 3));
            const shiftedPrice = (typeof point.price === 'number') ? point.price * 1.01 : point.price;
            return { time: virtualIndexToTime(newIdx), price: shiftedPrice };
        };

        let clone;
        if (copiedDrawing.type === 'brush' || copiedDrawing.type === 'elliott' || copiedDrawing.type === 'abcd') {
            clone = { type: copiedDrawing.type, points: (copiedDrawing.points || []).map(shiftPoint) };
            if (clone.points.length < 2) return false;
        } else {
            clone = { type: copiedDrawing.type, p1: shiftPoint(copiedDrawing.p1), p2: shiftPoint(copiedDrawing.p2) };
            if (copiedDrawing.apex) clone.apex = shiftPoint(copiedDrawing.apex);
            if (copiedDrawing.offset !== undefined) clone.offset = copiedDrawing.offset;
            if (copiedDrawing.target !== undefined) clone.target = copiedDrawing.target;
            if (copiedDrawing.label !== undefined) clone.label = copiedDrawing.label;
        }

        state.drawings.push(clone);
        state.selectedDrawingIndex = state.drawings.length - 1;
        redrawDrawings();
        return true;
    }

    function deleteSelectedDrawing() {
        if (state.selectedDrawingIndex < 0) return false;
        if (state.drawingsLocked) return false;
        state.drawings.splice(state.selectedDrawingIndex, 1);
        state.selectedDrawingIndex = -1;
        redrawDrawings();
        return true;
    }

    // (19 Temmuz 2026, on ikinci oturum) Bir çizimi indexDelta (mum sayısı
    // cinsinden zaman kayması) ve priceDelta (mutlak fiyat kayması) kadar
    // öteleyip YENİ bir şekil nesnesi döndürür — orijinali mutasyona
    // uğratmaz, moveDrag her mousemove'da bunu "orijinal + o anki toplam
    // fark" olarak yeniden hesaplar. target/offset gibi tek bir sayı olan
    // (nokta OLMAYAN) alanlar sadece fiyatça kayar, zaman kayması onlara
    // uygulanmaz.
    function translateShapePoints(shape, indexDelta, priceDelta) {
        // (3 Ağustos 2026 — kullanıcı video geri bildirimi: "üstteki trend
        // çizgisini kopyalayıp alta bir tane daha koyduğumda ve onu sağa
        // sola kaydırdığımda eğimi değişiyor ve hissenin güncel fiyatından
        // daha sağa gitmiyor") Kök neden: aşağıdaki shiftPoint() her NOKTAYI
        // BAĞIMSIZ olarak [0, son mum] aralığına clamp ediyordu. Bir çizginin
        // sağ ucu son muma (bugüne) ulaşıp orada kilitlenirken, sol ucu aynı
        // indexDelta kadar kaymaya DEVAM ediyordu — bu da tüm gövdeyi
        // TAŞIRKEN çizginin EĞİMİNİ bozuyordu (gerçek bir trend çizgisi
        // taşınırken şekli/eğimi hiç değişmemeli, yalnızca konumu kayar).
        // Düzeltme: önce şeklin TÜM noktalarının orijinal index'lerine bakıp,
        // hangi yönde ne kadar kaymaya izin verildiğini (en soldaki nokta 0'a,
        // en sağdaki nokta son muma değene kadar) hesaplayıp indexDelta'yı
        // TEK SEFERDE, ŞEKLİN TAMAMI İÇİN clamp ediyoruz — sonra bu ORTAK
        // (tek) delta'yı her noktaya aynı şekilde uyguluyoruz. Böylece çizgi
        // sınırdan öteye kaymayı durdurur ama eğimi/şekli hiç bozulmaz.
        //
        // (3 Ağustos 2026 EK — "çizgi sağa gitmiyor" düzeltmesi) Yukarıdaki
        // clamp mantığı (tek ortak delta) AYNEN korunuyor — sadece üst sınır
        // artık state.candles.length-1 değil, pixelToDataPoint()'teki ile
        // TUTARLI olan (length-1+MAX_FUTURE_BARS) sanal üst sınır. Böylece
        // bir şeklin sağ ucu artık son mumun ÖTESİNE (geleceğe) de
        // kayabiliyor — index/time dönüşümleri virtualTimeToIndex/
        // virtualIndexToTime üzerinden yapılıyor, findIndex ile ARANAMAYAN
        // (henüz gerçek bir mumla eşleşmeyen) sentetik gelecek zaman
        // damgaları da doğru şekilde çözülüyor.
        const points = [];
        if (shape.points) points.push(...shape.points);
        if (shape.p1) points.push(shape.p1);
        if (shape.p2) points.push(shape.p2);
        if (shape.apex) points.push(shape.apex);

        const virtualMaxIdx = state.candles.length - 1 + MAX_FUTURE_BARS;
        let clampedDelta = indexDelta;
        const origIndices = points
            .filter(p => p && p.time != null)
            .map(p => { const idx = virtualTimeToIndex(p.time); return idx >= 0 ? idx : 0; });
        if (origIndices.length) {
            const minOrig = Math.min(...origIndices);
            const maxOrig = Math.max(...origIndices);
            const minAllowedDelta = 0 - minOrig;
            const maxAllowedDelta = virtualMaxIdx - maxOrig;
            clampedDelta = Math.max(minAllowedDelta, Math.min(maxAllowedDelta, indexDelta));
        }

        const shiftPoint = (point) => {
            if (!point || point.time == null) return point;
            const curIdx = virtualTimeToIndex(point.time);
            const newIdx = Math.max(0, Math.min(virtualMaxIdx, (curIdx >= 0 ? curIdx : 0) + clampedDelta));
            const newTime = virtualIndexToTime(newIdx);
            return { time: newTime, price: point.price + priceDelta };
        };

        const moved = { type: shape.type };
        if (shape.points) {
            moved.points = shape.points.map(shiftPoint);
        }
        if (shape.p1) moved.p1 = shiftPoint(shape.p1);
        if (shape.p2) moved.p2 = shiftPoint(shape.p2);
        if (shape.apex) moved.apex = shiftPoint(shape.apex);
        if (shape.offset !== undefined) moved.offset = shape.offset;
        if (shape.target !== undefined) moved.target = shape.target + priceDelta;
        if (shape.label !== undefined) moved.label = shape.label;
        return moved;
    }

    function setupDrawingSelection() {
        if (!chartContainer) return;

        // Capture-phase listener: run BEFORE Lightweight Charts' own pan/zoom
        // handlers so we can intercept clicks that land on a drawing, while
        // letting clicks on empty chart area fall through untouched for
        // normal chart panning.
        chartContainer.addEventListener('mousedown', (e) => {
            if (state.activeTool !== 'cursor') return;
            const rect = chartContainer.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;

            // (23 Temmuz 2026 — eğim/uç nokta düzenleme) Zaten seçili bir
            // çizimin uç nokta tutamaçlarından birine basılırsa, aşağıdaki
            // genel gövde-sürükleme (moveDrag) mantığına hiç girmeden SADECE
            // o uç noktayı taşıyacak şekilde endpointDrag başlatılır —
            // böylece tüm şekil kaymaz, yalnızca eğimi değişir.
            if (state.selectedDrawingIndex >= 0 && !state.drawingsLocked) {
                const selShape = state.drawings[state.selectedDrawingIndex];
                const handle = hitTestHandle(selShape, x, y);
                if (handle) {
                    e.preventDefault();
                    e.stopPropagation();
                    endpointDrag = {
                        index: state.selectedDrawingIndex,
                        which: handle,
                        original: JSON.parse(JSON.stringify(selShape))
                    };
                    return;
                }
            }

            const hitIndex = hitTestDrawings(x, y);
            if (hitIndex >= 0) {
                e.preventDefault();
                e.stopPropagation();
                selectDrawing(hitIndex);
                // (19 Temmuz 2026, on ikinci oturum — "taşıma") Kilitli değilse,
                // seçili çizimin üstüne basıp sürüklemek onu olduğu yerde
                // taşır — kopyala/yapıştır/sil ile aynı seviyede temel bir
                // düzenleme eylemi, ayrı bir "taşıma modu" seçmeye gerek yok.
                if (!state.drawingsLocked) {
                    const dp = pixelToDataPoint(x, y);
                    if (dp.idx >= 0) {
                        moveDrag = {
                            index: hitIndex,
                            startIdx: dp.idx,
                            startPrice: dp.price,
                            original: JSON.parse(JSON.stringify(state.drawings[hitIndex]))
                        };
                    }
                }
            } else if (state.selectedDrawingIndex >= 0) {
                selectDrawing(-1);
            }
        }, true);

        // Sürükleme sırasında şekli sürekli yeniden hesapla (orijinalden +
        // o anki toplam fark) — mousedown/mouseup'tan bağımsız, window
        // seviyesinde dinliyoruz ki imleç çizim alanının dışına taşsa bile
        // sürükleme kopmasın (onDrawMove/onDrawEnd'in zaten kullandığı
        // desenin aynısı).
        window.addEventListener('mousemove', (e) => {
            const rect = chartContainer.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;

            // (23 Temmuz 2026 — eğim/uç nokta düzenleme) Uç nokta sürükleme
            // aktifse, güncel imleç konumu SADECE endpointDrag.which alanına
            // yazılır — original'daki diğer uç nokta hiç dokunulmadan kalır.
            if (endpointDrag) {
                const dp = pixelToDataPoint(x, y);
                if (dp.idx < 0 || dp.time === null) return;
                const updated = Object.assign({}, endpointDrag.original);
                updated[endpointDrag.which] = { time: dp.time, price: dp.price };
                state.drawings[endpointDrag.index] = updated;
                redrawDrawings();
                return;
            }

            if (!moveDrag) return;
            const dp = pixelToDataPoint(x, y);
            if (dp.idx < 0) return;
            const indexDelta = dp.idx - moveDrag.startIdx;
            const priceDelta = dp.price - moveDrag.startPrice;
            state.drawings[moveDrag.index] = translateShapePoints(moveDrag.original, indexDelta, priceDelta);
            redrawDrawings();
        });

        window.addEventListener('mouseup', () => {
            moveDrag = null;
            endpointDrag = null;
        });

        // Seçili çizimin üstündeyken (henüz sürüklemeden) fare imlecini
        // "move" yaparak taşınabilir olduğunu gösterir — yeni özelliğin
        // keşfedilebilirliği için ucuz ama gerçek bir ipucu. Seçili şeklin
        // bir uç nokta tutamacının üzerindeyken ise farklı bir imleç
        // ("crosshair") gösterilir — kullanıcı gövdeyi mi taşıyacağını yoksa
        // tek bir ucu mu (eğimi değiştirerek) sürükleyeceğini önceden ayırt
        // edebilsin diye.
        chartContainer.addEventListener('mousemove', (e) => {
            if (state.activeTool !== 'cursor' || moveDrag || endpointDrag || state.drawingsLocked) return;
            const rect = chartContainer.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;

            if (state.selectedDrawingIndex >= 0) {
                const selShape = state.drawings[state.selectedDrawingIndex];
                const handle = hitTestHandle(selShape, x, y);
                if (handle) {
                    chartContainer.style.cursor = 'crosshair';
                    return;
                }
            }

            const hitIndex = hitTestDrawings(x, y);
            chartContainer.style.cursor = hitIndex >= 0 ? 'move' : '';
        });

        chartContainer.addEventListener('contextmenu', (e) => {
            if (state.activeTool !== 'cursor') return;
            const rect = chartContainer.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;
            const hitIndex = hitTestDrawings(x, y);
            if (hitIndex >= 0) {
                e.preventDefault();
                e.stopPropagation();
                selectDrawing(hitIndex);
                showDrawingContextMenu(e.clientX, e.clientY);
            } else {
                hideDrawingContextMenu();
            }
        }, true);

        document.addEventListener('click', (e) => {
            const menu = byId('drawing-context-menu');
            if (menu && !menu.contains(e.target)) hideDrawingContextMenu();
        });

        document.addEventListener('keydown', (e) => {
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // don't hijack typing
            const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
            const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
            const isDelete = e.key === 'Delete' || e.key === 'Backspace';
            if (isCopy && state.selectedDrawingIndex >= 0) {
                copySelectedDrawing();
            } else if (isPaste && copiedDrawing) {
                pasteDrawing();
            } else if (isDelete && state.selectedDrawingIndex >= 0) {
                e.preventDefault();
                deleteSelectedDrawing();
            }
        });

        // Context menu actions
        const menu = byId('drawing-context-menu');
        if (menu) {
            menu.querySelector('[data-action="copy"]').addEventListener('click', () => {
                copySelectedDrawing();
                hideDrawingContextMenu();
            });
            menu.querySelector('[data-action="paste"]').addEventListener('click', () => {
                pasteDrawing();
                hideDrawingContextMenu();
            });
            menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
                deleteSelectedDrawing();
                hideDrawingContextMenu();
            });
        }
    }

    function showDrawingContextMenu(clientX, clientY) {
        const menu = byId('drawing-context-menu');
        if (!menu) return;
        const pasteItem = menu.querySelector('[data-action="paste"]');
        if (pasteItem) pasteItem.classList.toggle('disabled', !copiedDrawing);
        menu.style.left = clientX + 'px';
        menu.style.top = clientY + 'px';
        menu.classList.add('open');
    }

    function hideDrawingContextMenu() {
        const menu = byId('drawing-context-menu');
        if (menu) menu.classList.remove('open');
    }

    /* ────────── Resize ────────── */

    function resizeAll() {
        if (chart && chartContainer) {
            chart.applyOptions({ width: chartContainer.clientWidth, height: chartContainer.clientHeight });
        }
        resizeOscillatorPanes();
        const dualContainer = byId('tv-main-chart-2');
        if (dualChart && dualContainer) {
            dualChart.applyOptions({ width: dualContainer.clientWidth, height: dualContainer.clientHeight });
        }
        resizeDualOscillatorPanes();
        resizeDrawCanvas();
    }

    function setupResize() {
        const ro = new ResizeObserver(() => {
            resizeAll();
            redrawDrawings();
            requestAnimationFrame(() => redrawDrawings());
        });
        if (chartContainer) ro.observe(chartContainer);
    }

    /* ────────── Public API ────────── */

    function setTheme(theme) {
        currentTheme = resolveThemeName(theme);
        // (9 Ağustos 2026 — admin panelinden "Kurumsal Mavi" tema kontrolü)
        // Altın'a bağlı COLORS anahtarlarını (mum/hacim/gösterge/çizim
        // renkleri) yerinde günceller — bkz. applyChartColorPaletteForTheme()
        // yorumu. Koyu/Açık temalar arasında geçişte bu her zaman
        // GOLD_DEFAULT_CHART_COLORS'a (orijinal altın değerler) geri döner,
        // hiçbir şeyi bozmaz.
        applyChartColorPaletteForTheme();

        const c = THEME_CHART_COLORS[currentTheme];
        const crosshairColor = currentTheme === 'fintech' ? 'rgba(61,111,238,0.35)' : 'rgba(212,175,55,0.35)';
        const opts = {
            layout: { background: { color: c.bg }, textColor: c.text },
            grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
            rightPriceScale: { borderColor: c.border },
            timeScale: { borderColor: c.border },
            crosshair: {
                vertLine: { color: crosshairColor, labelBackgroundColor: COLORS.draw },
                horzLine: { color: crosshairColor, labelBackgroundColor: COLORS.draw }
            }
        };
        if (chart) chart.applyOptions(opts);
        Object.values(oscillatorPanes).forEach(p => { if (p.chart) p.chart.applyOptions(opts); });
        if (dualChart) dualChart.applyOptions(opts);

        // Zaten oluşturulmuş serileri de yeniden boyarız — aksi halde admin
        // temayı değiştirdiğinde, o an ekranda açık olan mumlar/hacim
        // çubukları bir sonraki sembol yüklemesine kadar eski renkte kalırdı.
        const candleColors = {
            upColor: COLORS.up, downColor: COLORS.down,
            borderUpColor: COLORS.up, borderDownColor: COLORS.down,
            wickUpColor: COLORS.wickUp, wickDownColor: COLORS.wickDown
        };
        if (candleSeries) candleSeries.applyOptions(candleColors);
        if (dualSeries) dualSeries.applyOptions(candleColors);
        if (typeof applyVolumeVisibility === 'function') applyVolumeVisibility();
    }

    // (2 Ağustos 2026 — revize planı madde 12) "Örnek bir özet detay
    // konulabilir" — referans (mobil uygulama) ekran görüntüsündeki
    // Günlük/Aylık/Yıllık aralık çubuklarının basitleştirilmiş bir sürümü.
    // Ham hesaplama burada (state.dailyCandles üzerinden) yapılıyor;
    // tradingEngine.js'teki Özet Detay sekmesi sadece bu hazır özeti render
    // ediyor — iki dosyanın birbirinin iç state'ine erişmesine gerek kalmıyor
    // (getLastClose/getLastATR ile aynı köprü deseni).
    function getDailyRangeSummary() {
        const daily = state.dailyCandles;
        if (!daily || !daily.length) return null;
        const last = daily[daily.length - 1].close;
        function rangeOver(n) {
            const slice = daily.slice(-n);
            return {
                low: Math.min(...slice.map(c => c.low)),
                high: Math.max(...slice.map(c => c.high))
            };
        }
        return {
            last,
            daily: rangeOver(1),
            monthly: rangeOver(21),  // ~1 işlem ayı (gün sayısı)
            yearly: rangeOver(252)   // ~1 işlem yılı (gün sayısı)
        };
    }

    // (27 Ağustos 2026 — yarışma günü hız hazırlığı: "popüler hisseleri
    // önceden ısıt") Aktif grafiği/ekranı HİÇ ETKİLEMEDEN, verilen sembolün
    // günlük OHLCV'sini arka planda çekip fetchOhlcvCached()'in kendi
    // önbelleğine (symbolHistoryCache, 3 dakika TTL) düşürür — böylece o
    // sembol GERÇEKTEN seçildiğinde (loadSymbol çağrıldığında) ağdan
    // beklemek yerine anında önbellekten gelir. tradingEngine.js sayfa
    // açılışından birkaç saniye sonra, dikkatlice ARALIKLI şekilde (backend'i
    // bir anda yormamak için) birkaç sembol için bunu çağırır. Başarısız
    // olursa (ağ hatası, Yahoo rate-limit) sessizce yutulur — bu sadece bir
    // ön-yükleme denemesi, hiçbir zaman kullanıcıya görünür bir hataya yol
    // açmamalı.
    async function prewarmSymbol(ticker) {
        try {
            await fetchOhlcvCached(ticker);
        } catch (e) {
            // sessiz — ısıtma denemesi kritik değil, chart yüklemesini
            // etkilemez.
        }
    }

    return Object.freeze({
        init,
        loadSymbol,
        prewarmSymbol,
        updateLastPrice,
        renderOverlays,
        renderAllOscillatorPanes,
        getLastClose,
        getLastATR,
        getDailyRangeSummary,
        getIndicatorAlertSnapshot,
        refreshUserTradeMarkers,
        setTheme,
        setChartType,
        setVolumeVisible,
        setResolution,
        setPriceScaleMode,
        // Read-only introspection, useful for QA/debugging — no external
        // caller in the app itself relies on this.
        debugGetDrawings: () => JSON.parse(JSON.stringify(state.drawings)),
        debugGetSelectedIndex: () => state.selectedDrawingIndex,
        debugSelectDrawing: (index) => selectDrawing(index),
        debugCopySelected: () => copySelectedDrawing(),
        debugPaste: () => pasteDrawing(),
        debugDeleteSelected: () => deleteSelectedDrawing(),
        debugGetChartType: () => state.chartType,
        debugGetActiveTool: () => state.activeTool,
        debugGetResolution: () => state.resolution,
        debugGetCandleCount: () => state.candles.length,
        debugIsDualActive: () => dualActive,
        debugGetDualResolution: () => dualResolution,
        debugIsFullscreenActive: () => fullscreenActive,
        debugGetActiveOscillators: () => state.activeOscillators.slice(),
        debugGetOscillatorPaneCount: () => Object.keys(oscillatorPanes).length,
        // (29 Temmuz 2026 — Madde 6 doğrulaması) Test/QA amaçlı: dual-chart
        // panelinde EN SON çizilen mumun kapanışını döndürür — "ayna" modunda
        // (dualSymbol=null) ana sembol değiştiğinde bu değerin de gerçekten
        // değiştiğini empirik olarak doğrulamak için eklendi.
        debugGetDualLastClose: () => dualLastRenderedCandles.length ? dualLastRenderedCandles[dualLastRenderedCandles.length - 1].close : null,
        // (29 Temmuz 2026 — Madde 14 doğrulaması) Ölçüm aracının artık
        // state.drawings'e KALICI eklenmediğini, sadece geçici measureShape'te
        // tutulduğunu doğrulamak için.
        debugGetMeasureShape: () => state.measureShape ? JSON.parse(JSON.stringify(state.measureShape)) : null,
        // (29 Temmuz 2026 — Madde 18 doğrulaması) Kullanıcının gerçek al-sat
        // işaretçilerinin hesaplanan halini (aktif sembol için) döndürür.
        debugGetUserTradeMarkers: () => computeUserTradeMarkers()
    });
})();

window.TradingChart = TradingChart;
