/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB ÇOKLU GRAFİK / 2x2 IZGARA DÜZENİ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * (17 Temmuz 2026, yedinci oturum) Ana grafik (tradingChart.js / window.
 * TradingChart) tek bir sembolü, çizim araçları + gösterge + çözünürlük
 * motoruyla birlikte gösteren büyük ve karmaşık bir modül — tüm bu altyapıyı
 * 4 eşzamanlı örneğe çıkarmak (her biri kendi çizimleri/göstergeleriyle)
 * modülün tamamen singleton mimarisini (module-level `state`/`chart`/
 * `candleSeries` değişkenleri) yeniden yazmayı gerektirirdi — riski, bu
 * özelliğin getirisine kıyasla çok yüksek.
 *
 * Bunun yerine bu dosya, ana grafiğin YERİNE geçen (yanında değil) sade,
 * salt-okunur bir "genel bakış" ızgarası sağlıyor: 4 hücre, her biri
 * bağımsız bir sembol seçip günlük mum verisini gösteriyor (çizim aracı /
 * gösterge / çözünürlük seçimi yok — kasıtlı olarak basit). Bir hücrenin
 * sağ üstündeki ⤢ butonu o sembolü ana (tekli, tam özellikli) grafiğe
 * "yükseltir".
 *
 * Exposed as window.MultiChartGrid. Depends on: window.LightweightCharts,
 * window.DataController, window.TradingEngine (yalnızca "yükselt" için).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const MultiChartGrid = (() => {

    const CELL_COUNT = 4;
    const STORAGE_KEY = 'optipulselab_grid_symbols_v1';
    const DEFAULT_SYMBOLS = ['THYAO', 'AKBNK', 'ASELS', 'BIMAS'];

    const THEME_CHART_COLORS = {
        dark: { bg: '#1E1E1E', text: '#888888', grid: 'rgba(255,255,255,0.04)', border: 'rgba(212,175,55,0.15)' },
        light: { bg: '#FFFFFF', text: '#5A5D63', grid: 'rgba(20,22,28,0.07)', border: 'rgba(184,134,11,0.22)' }
    };
    const COLORS = { up: '#D4AF37', down: '#555555', wickUp: '#D4AF37', wickDown: '#777777', sma20: '#42A5F5', ema9: '#26C6DA', bbLine: '#AB47BC', draw: '#D4AF37' };

    // (18 Temmuz 2026, onuncu oturum, üçüncü tur → 22 Temmuz 2026, on ikinci
    // oturum'da genişletildi) Her hücreye sade bir gösterge seçimi eklendi —
    // Dual-Chart Panel 2'deki "tam gösterge motorunu çoğaltma, sadece sabit
    // birkaç gösterge" yaklaşımının aynısı. Artık tek bir aç/kapa yerine
    // hücre başına İKİ FARKLI gösterge arasında seçim var: 'none' | 'trend'
    // (SMA20+EMA9, eskisiyle aynı) | 'bollinger' (BB 20,2, yeni). Seçim hücre
    // bazında localStorage'da kalıcı. (Depolanan değerler artık string mod
    // olduğu için anahtar adı da güncellendi; eski boolean anahtarı sessizce
    // terk ediliyor.)
    const INDICATOR_STORAGE_KEY = 'optipulselab_grid_indicator_v1';

    // (22 Temmuz 2026, on ikinci oturum — madde 3, "ızgarada anlık fiyat")
    // Ana motordaki TICK_MS (tradingEngine.js) ile aynı ritimde, ama ayrı bir
    // interval: ızgara sadece açıkken (active) çalışır, kapanınca durur —
    // kapalıyken gereksiz CPU/timer harcamamak için.
    const GRID_TICK_MS = 2000;

    let DC = null;
    let active = false;
    let cellSymbols = DEFAULT_SYMBOLS.slice();
    let cellIndicatorMode = ['none', 'none', 'none', 'none'];
    let gridTickTimer = null;
    // (22 Temmuz 2026, on ikinci oturum — madde 5, "ızgarada çizim") Hücre
    // başına çizimler ve aktif araç — bilinçli olarak SESSION-ONLY (grid
    // kapanınca / sembol değişince temizlenir, localStorage'a yazılmıyor).
    // Kalıcılık, hücre+sembol kombinasyonu başına ayrı bir anahtarlama şeması
    // gerektirir ki bu, bu dosyanın başındaki "sade/salt-okunur genel bakış"
    // mimari sınırını zorlar — kapsam bilinçli olarak dar tutuldu.
    let cellDrawings = [[], [], [], []];
    let cellActiveDrawTool = [null, null, null, null];
    let trendDragStart = null; // { index, x, y } — sürükleyerek trend çizgisi oluştururken
    const cellCharts = []; // { chart, series, overlaySeries, lastCandles } per cell, recreated each time the grid is opened

    function byId(id) { return document.getElementById(id); }

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    function loadCellSymbols() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length === CELL_COUNT) return parsed;
            }
        } catch (e) { /* private mode / corrupt storage — fall back to defaults */ }
        return DEFAULT_SYMBOLS.slice();
    }

    function saveCellSymbols() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cellSymbols)); } catch (e) { /* ignore */ }
    }

    const VALID_INDICATOR_MODES = ['none', 'trend', 'bollinger'];

    function loadCellIndicatorMode() {
        try {
            const raw = localStorage.getItem(INDICATOR_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length === CELL_COUNT && parsed.every(v => VALID_INDICATOR_MODES.includes(v))) return parsed;
            }
        } catch (e) { /* private mode / corrupt storage — fall back to defaults */ }
        return ['none', 'none', 'none', 'none'];
    }

    function saveCellIndicatorMode() {
        try { localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(cellIndicatorMode)); } catch (e) { /* ignore */ }
    }

    // Basit Bollinger Bantları (20, 2) hesabı — dataController.js'in
    // computeSMA'sını kullanıp standart sapmayı burada satır içi hesaplıyor;
    // ana grafiğin (tradingChart.js) aynı formülünün (bkz. dataController.js
    // ~satır 1210) sadeleştirilmiş, ızgaraya özel bir kopyası.
    function computeBollinger(closes, period = 20, mult = 2) {
        const sma = DC.computeSMA(closes, period);
        const upper = [], lower = [];
        for (let i = 0; i < closes.length; i++) {
            if (i < period - 1 || sma[i] == null) { upper.push(null); lower.push(null); continue; }
            const mean = sma[i];
            let sumSq = 0;
            for (let j = i - period + 1; j <= i; j++) { const d = closes[j] - mean; sumSq += d * d; }
            const stddev = Math.sqrt(sumSq / period);
            upper.push(mean + mult * stddev);
            lower.push(mean - mult * stddev);
        }
        return { upper, lower };
    }

    function destroyCharts() {
        cellCharts.forEach(entry => {
            if (entry && entry.chart) {
                try { entry.chart.remove(); } catch (e) { /* already gone */ }
            }
        });
        cellCharts.length = 0;
    }

    function createCell(index) {
        const container = byId('tv-grid-chart-' + index);
        if (!container || !window.LightweightCharts) return null;
        const c = THEME_CHART_COLORS[currentTheme()];
        const chart = LightweightCharts.createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: { background: { color: c.bg }, textColor: c.text, fontFamily: "'Fira Code', monospace" },
            grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
            rightPriceScale: { borderColor: c.border },
            timeScale: { borderColor: c.border, timeVisible: false, secondsVisible: false },
            handleScroll: false,
            handleScale: false
        });
        const series = chart.addCandlestickSeries({
            upColor: COLORS.up,
            downColor: COLORS.down,
            borderUpColor: COLORS.up,
            borderDownColor: COLORS.down,
            wickUpColor: COLORS.wickUp,
            wickDownColor: COLORS.wickDown
        });
        return { chart, series, overlaySeries: {}, lastCandles: [] };
    }

    // Basitleştirilmiş fetch: ana grafikteki gibi retry/12sn timeout yerine
    // kısa bir tek deneme yeterli — bu bir "genel bakış" ızgarası, başarısız
    // olursa (dataController.js'in artık gerçekçi STOCK_PROFILES'a dayanan)
    // simüle veri üretimine sorunsuzca düşer.
    //
    // (22 Temmuz 2026, on ikinci oturum — madde 6 "tam geçmiş erişimi"
    // notu) Ana grafik (tradingChart.js) artık backend'den "max" dönem +
    // simüle yedekte TRADING_DAYS=750 gün kullanıyor. Buradaki simüle yedek
    // BİLİNÇLİ OLARAK 90 günde bırakıldı: bu bir "genel bakış" ızgarasıdır,
    // amacı derin geçmiş analizi değil son durumu hızlıca özetlemek — 4
    // hücrenin her biri için 750 günlük veri üretmek/çizmek gereksiz yük
    // ekler ve ızgaranın "sade" tasarım felsefesiyle çelişir. Tam geçmiş
    // isteyen kullanıcı zaten ⤢ ile sembolü ana grafiğe yükseltebiliyor.
    async function fetchCellCandles(symbol) {
        try {
            const backendHttp = window.OPTIPULSE_CONFIG ? window.OPTIPULSE_CONFIG.BACKEND_HTTP : 'http://127.0.0.1:8000';
            const fetchOpts = window.optipulseFetchOpts ? window.optipulseFetchOpts({ signal: AbortSignal.timeout(5000) }) : { signal: AbortSignal.timeout(5000) };
            const res = await fetch(`${backendHttp}/api/v1/ohlcv/${symbol}`, fetchOpts);
            if (res.ok) {
                const json = await res.json();
                if (json && Array.isArray(json.data) && json.data.length > 5) {
                    const seen = new Set();
                    const candles = json.data.map(r => {
                        const dateStr = String(r.Date || '').slice(0, 10);
                        const parts = dateStr.split('-').map(Number);
                        const time = parts.length === 3 && !parts.some(isNaN) ? Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 1000) : null;
                        return { time, open: Number(r.Open || 0), high: Number(r.High || 0), low: Number(r.Low || 0), close: Number(r.Close || 0) };
                    }).filter(c => c.time !== null && !seen.has(c.time) && seen.add(c.time));
                    candles.sort((a, b) => a.time - b.time);
                    if (candles.length > 5) return candles;
                }
            }
        } catch (e) { /* fall through to simulated data */ }

        const generated = DC.generateOHLCV(symbol, 90);
        return generated.map(c => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close }));
    }

    async function loadCell(index, symbol) {
        const entry = cellCharts[index];
        if (!entry) return;
        const candles = await fetchCellCandles(symbol);
        entry.series.setData(candles);
        entry.lastCandles = candles;
        // Bu hücrenin az önce getirdiği/ürettiği verinin son kapanışına,
        // simüle canlı tick fiyatını çapala — aksi halde tickGrid()'in ilk
        // güncellemesinde fiyat rozeti ve mum, önceden birikmiş ayrı bir
        // simülasyon durumuna aniden ve gerçekçi olmayan bir şekilde
        // sıçrayabilir (bkz. syncPriceAnchor yorumu, tradingEngine.js).
        if (window.TradingEngine && candles.length && typeof window.TradingEngine.syncPriceAnchor === 'function') {
            window.TradingEngine.syncPriceAnchor(symbol, candles[candles.length - 1].close);
        }
        refreshCellOverlay(index);
        entry.chart.timeScale().fitContent();
        // Sembol değişti — bu hücredeki eski çizimler yeni verinin zaman/fiyat
        // eksenine göre anlamsız kalır, temizleniyor (bkz. cellDrawings notu).
        cellDrawings[index] = [];
        cellActiveDrawTool[index] = null;
        updateDrawToolButtons(index);
        redrawCellCanvas(index);
        updatePriceBadge(index);
    }

    // Sade gösterge çizimi — mod 'none' ise var olan seriler sadece
    // temizlenir; 'trend' ise eskisiyle aynı SMA20+EMA9 kombinasyonu, yeni
    // 'bollinger' modu ise BB(20,2) üst/alt bantlarını çiziyor. Yeni veri her
    // geldiğinde (sembol değişimi / canlı tick) bu fonksiyon çağrılıyor.
    function refreshCellOverlay(index) {
        const entry = cellCharts[index];
        if (!entry) return;
        Object.values(entry.overlaySeries).forEach(s => { try { entry.chart.removeSeries(s); } catch (e) {} });
        entry.overlaySeries = {};
        const mode = cellIndicatorMode[index];
        if (mode === 'none' || !entry.lastCandles.length || !DC) return;

        const dates = entry.lastCandles.map(c => c.time);
        const closes = entry.lastCandles.map(c => c.close);
        const toPoints = (values) => {
            const out = [];
            for (let i = 0; i < dates.length; i++) {
                if (values[i] === null || values[i] === undefined) continue;
                out.push({ time: dates[i], value: values[i] });
            }
            return out;
        };

        if (mode === 'trend') {
            const sma20 = DC.computeSMA(closes, 20);
            const ema9 = DC.computeEMA(closes, 9);
            entry.overlaySeries.sma20 = entry.chart.addLineSeries({ color: COLORS.sma20, lineWidth: 1.25, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            entry.overlaySeries.sma20.setData(toPoints(sma20));
            entry.overlaySeries.ema9 = entry.chart.addLineSeries({ color: COLORS.ema9, lineWidth: 1.25, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: LightweightCharts.LineStyle.Dashed });
            entry.overlaySeries.ema9.setData(toPoints(ema9));
        } else if (mode === 'bollinger') {
            const { upper, lower } = computeBollinger(closes, 20, 2);
            entry.overlaySeries.bbUpper = entry.chart.addLineSeries({ color: COLORS.bbLine, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            entry.overlaySeries.bbUpper.setData(toPoints(upper));
            entry.overlaySeries.bbLower = entry.chart.addLineSeries({ color: COLORS.bbLine, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            entry.overlaySeries.bbLower.setData(toPoints(lower));
        }
    }

    function setCellIndicatorMode(index, mode) {
        if (!VALID_INDICATOR_MODES.includes(mode)) return;
        cellIndicatorMode[index] = mode;
        saveCellIndicatorMode();
        refreshCellOverlay(index);
    }

    // (22 Temmuz 2026, on ikinci oturum — madde 3 "ızgarada anlık fiyat")
    // Hücre başlığındaki .tv-grid-price-badge'i günceller. price/chgPct
    // verilmezse TradingEngine'den okunur (grid kapalıyken / motor henüz
    // hazır değilken sessizce "—" gösterir).
    function updatePriceBadge(index, price, chgPct) {
        const el = document.querySelector(`.tv-grid-price-badge[data-cell="${index}"]`);
        if (!el) return;
        const symbol = cellSymbols[index];
        const TE = window.TradingEngine;
        if (price === undefined) price = TE ? TE.getPrice(symbol) : null;
        if (chgPct === undefined) chgPct = TE ? TE.getChangePercent(symbol) : null;
        if (price == null) { el.textContent = '—'; el.classList.remove('up', 'down'); return; }
        const priceStr = TE && TE.fmtPrice ? TE.fmtPrice(price) : price.toFixed(2);
        const chgStr = chgPct == null ? '' : ` ${chgPct >= 0 ? '▲' : '▼'}${Math.abs(chgPct).toFixed(2)}%`;
        el.textContent = `₺${priceStr}${chgStr}`;
        el.classList.toggle('up', chgPct != null && chgPct >= 0);
        el.classList.toggle('down', chgPct != null && chgPct < 0);
    }

    function populateSelect(select, selectedSymbol) {
        if (!DC || !DC.BIST100) return;
        select.innerHTML = DC.BIST100.map(s => `<option value="${s.symbol}">${s.symbol} — ${s.name}</option>`).join('');
        select.value = selectedSymbol;
    }

    function getDrawCanvas(index) {
        return document.querySelector(`.tv-grid-draw-canvas[data-cell="${index}"]`);
    }

    function resizeAll() {
        cellCharts.forEach((entry, i) => {
            if (!entry) return;
            const container = byId('tv-grid-chart-' + i);
            if (container) entry.chart.resize(container.clientWidth, container.clientHeight);
            const canvas = getDrawCanvas(i);
            if (canvas && container) {
                canvas.width = container.clientWidth;
                canvas.height = container.clientHeight;
            }
            redrawCellCanvas(i);
        });
    }

    // (22 Temmuz 2026, on ikinci oturum — madde 5 "ızgarada indikatör çizimi")
    // Ana grafiğin (tradingChart.js) tam çizim motorunu 4 kopyaya çıkarmak
    // yerine sade bir <canvas> katmanı: {time, price} olarak saklanan
    // şekiller, her çağrıda GEÇERLİ ölçek üzerinden piksele çevrilip yeniden
    // çiziliyor (tıpkı ana grafik gibi) — bu sayede fiyat ekseni otomatik
    // ölçeklendiğinde (örn. canlı tick yeni bir yüksek/düşük getirdiğinde)
    // çizimler kaymadan doğru konumda kalıyor.
    //
    // (22 Temmuz 2026, on ikinci oturum) x ekseni dönüşümü, ana grafiğin
    // (tradingChart.js pixelToDataPoint/dataPointToPixel) kullandığı MANTIK
    // (LOGICAL) İNDEKS yaklaşımıyla aynı — timeToCoordinate/coordinateToTime
    // yerine coordinateToLogical/logicalToCoordinate + mum dizisindeki
    // indeks araması kullanılıyor. Bu, kodun geri kalanıyla tutarlı ve
    // kenar/boşluk durumlarında daha güvenilir.
    function pixelXToCandleTime(entry, x) {
        const logical = entry.chart.timeScale().coordinateToLogical(x);
        if (logical == null) return null;
        const idx = Math.round(logical);
        const candles = entry.lastCandles;
        if (idx < 0 || idx >= candles.length) return null;
        return candles[idx].time;
    }

    function candleTimeToPixelX(entry, time) {
        const idx = entry.lastCandles.findIndex(c => c.time === time);
        if (idx < 0) return null;
        return entry.chart.timeScale().logicalToCoordinate(idx);
    }

    function redrawCellCanvas(index) {
        const entry = cellCharts[index];
        const canvas = getDrawCanvas(index);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!entry) return;
        const shapes = cellDrawings[index] || [];
        const toXY = (time, price) => {
            const x = candleTimeToPixelX(entry, time);
            const y = entry.series.priceToCoordinate(price);
            return (x == null || y == null) ? null : { x, y };
        };
        ctx.strokeStyle = COLORS.draw;
        ctx.lineWidth = 1.5;
        shapes.forEach(shape => {
            if (shape.type === 'trend') {
                const a = toXY(shape.p1.time, shape.p1.price);
                const b = toXY(shape.p2.time, shape.p2.price);
                if (!a || !b) return;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            } else if (shape.type === 'hline') {
                const y = entry.series.priceToCoordinate(shape.price);
                if (y == null) return;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
        });
        // Sürüklenmekte olan trend çizgisinin önizlemesi (henüz kaydedilmedi)
        if (trendDragStart && trendDragStart.index === index && trendDragStart.previewX != null) {
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(trendDragStart.x, trendDragStart.y);
            ctx.lineTo(trendDragStart.previewX, trendDragStart.previewY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    function updateDrawToolButtons(index) {
        document.querySelectorAll(`.tv-grid-draw-btn[data-cell="${index}"]`).forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === cellActiveDrawTool[index]);
        });
    }

    // (22 Temmuz 2026, on ikinci oturum — madde 3 "ızgarada anlık fiyat")
    // Grid açıkken periyodik olarak TradingEngine'in zaten ürettiği canlı
    // fiyatları okur (ayrı bir simülasyon motoru KURMUYOR — tek gerçek kaynak
    // hâlâ tradingEngine.js'teki priceProfiles) ve: (a) fiyat rozetini,
    // (b) o hücrenin son mumunu (close/high/low) series.update() ile
    // günceller, (c) göstergeyi son veriyle yeniden hesaplar, (d) fiyat
    // ekseni otomatik ölçeklendiği için çizimleri yeniden konumlandırır.
    function tickGrid() {
        const DCref = window.DataController;
        if (DCref && DCref.isMarketOpenNow && !DCref.isMarketOpenNow()) return;
        const TE = window.TradingEngine;
        if (!TE) return;
        cellCharts.forEach((entry, i) => {
            if (!entry || !entry.lastCandles.length) return;
            const symbol = cellSymbols[i];
            const price = TE.getPrice(symbol);
            if (price == null) return;
            const last = entry.lastCandles[entry.lastCandles.length - 1];
            const updated = { time: last.time, open: last.open, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
            entry.lastCandles[entry.lastCandles.length - 1] = updated;
            entry.series.update(updated);
            updatePriceBadge(i, price, TE.getChangePercent(symbol));
            refreshCellOverlay(i);
            redrawCellCanvas(i);
        });
    }

    function startTicking() {
        stopTicking();
        gridTickTimer = setInterval(tickGrid, GRID_TICK_MS);
    }

    function stopTicking() {
        if (gridTickTimer) { clearInterval(gridTickTimer); gridTickTimer = null; }
    }

    function openGridView() {
        active = true;
        const single = byId('tv-chart-area-single');
        const gridView = byId('tv-grid-view');
        const resBar = byId('tv-resolution-bar');
        const subpane = byId('tv-subpanes-container');
        const toggleBtn = byId('btn-toggle-grid-view');
        if (single) single.style.display = 'none';
        if (resBar) resBar.style.display = 'none';
        if (subpane) subpane.style.display = 'none';
        if (gridView) gridView.style.display = 'grid';
        if (toggleBtn) toggleBtn.classList.add('active');

        destroyCharts();
        for (let i = 0; i < CELL_COUNT; i++) {
            const select = document.querySelector(`.tv-grid-symbol-select[data-cell="${i}"]`);
            if (select) populateSelect(select, cellSymbols[i]);
            cellCharts[i] = createCell(i);
        }
        // Layout only settles after display:grid takes effect — defer sizing/data a tick.
        setTimeout(() => {
            resizeAll();
            cellSymbols.forEach((sym, i) => loadCell(i, sym));
            startTicking();
        }, 30);
    }

    function closeGridView() {
        active = false;
        const single = byId('tv-chart-area-single');
        const gridView = byId('tv-grid-view');
        const resBar = byId('tv-resolution-bar');
        const subpane = byId('tv-subpanes-container');
        const toggleBtn = byId('btn-toggle-grid-view');
        if (single) single.style.display = '';
        if (resBar) resBar.style.display = '';
        if (subpane) subpane.style.display = '';
        if (gridView) gridView.style.display = 'none';
        if (toggleBtn) toggleBtn.classList.remove('active');
        stopTicking();
        destroyCharts();
        // Grid kapandığında oturuma özel çizimler/aktif araç temizleniyor —
        // bkz. cellDrawings tanımındaki "session-only" gerekçesi.
        cellDrawings = [[], [], [], []];
        cellActiveDrawTool = [null, null, null, null];
        trendDragStart = null;
        for (let i = 0; i < CELL_COUNT; i++) updateDrawToolButtons(i);
    }

    function toggleGridView() {
        if (active) closeGridView(); else openGridView();
    }

    function setupControls() {
        const toggleBtn = byId('btn-toggle-grid-view');
        if (toggleBtn) toggleBtn.addEventListener('click', toggleGridView);

        document.querySelectorAll('.tv-grid-symbol-select').forEach(select => {
            select.addEventListener('change', () => {
                const i = parseInt(select.dataset.cell, 10);
                cellSymbols[i] = select.value;
                saveCellSymbols();
                loadCell(i, select.value);
            });
        });

        document.querySelectorAll('.tv-grid-promote-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.cell, 10);
                const symbol = cellSymbols[i];
                closeGridView();
                if (window.TradingEngine && typeof window.TradingEngine.selectSymbol === 'function') {
                    window.TradingEngine.selectSymbol(symbol);
                }
            });
        });

        document.querySelectorAll('.tv-grid-indicator-select').forEach(select => {
            const i = parseInt(select.dataset.cell, 10);
            select.value = cellIndicatorMode[i];
            select.addEventListener('change', () => setCellIndicatorMode(i, select.value));
        });

        setupDrawToolbar();

        window.addEventListener('resize', () => { if (active) resizeAll(); });
    }

    // (22 Temmuz 2026, on ikinci oturum — madde 5 "ızgarada indikatör çizimi")
    // Araç butonları (trend/yatay/temizle) ve canvas fare olayları — hücre
    // başına tek seferlik kurulum, init() sırasında (statik DOM, ızgara her
    // açılıp kapandığında yeniden oluşturulmuyor).
    function setupDrawToolbar() {
        document.querySelectorAll('.tv-grid-draw-btn').forEach(btn => {
            const i = parseInt(btn.dataset.cell, 10);
            const tool = btn.dataset.tool;
            btn.addEventListener('click', () => {
                if (!cellCharts[i]) return; // ızgara kapalıyken araçlar pasif
                if (tool === 'clear') {
                    cellDrawings[i] = [];
                    redrawCellCanvas(i);
                    return;
                }
                cellActiveDrawTool[i] = (cellActiveDrawTool[i] === tool) ? null : tool;
                trendDragStart = null;
                updateDrawToolButtons(i);
            });
        });

        document.querySelectorAll('.tv-grid-draw-canvas').forEach(canvas => {
            const i = parseInt(canvas.dataset.cell, 10);
            canvas.addEventListener('mousedown', (e) => {
                const entry = cellCharts[i];
                const tool = cellActiveDrawTool[i];
                if (!entry || !tool) return;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left, y = e.clientY - rect.top;
                if (tool === 'hline') {
                    const price = entry.series.coordinateToPrice(y);
                    if (price == null) return;
                    cellDrawings[i].push({ type: 'hline', price });
                    cellActiveDrawTool[i] = null;
                    updateDrawToolButtons(i);
                    redrawCellCanvas(i);
                } else if (tool === 'trend') {
                    trendDragStart = { index: i, x, y, previewX: x, previewY: y };
                }
            });
        });

        // Sürükleme önizlemesi ve bitişi — tek bir window-level listener,
        // ana grafiğin (tradingChart.js) drag-to-draw desenindeki gibi.
        window.addEventListener('mousemove', (e) => {
            if (!trendDragStart) return;
            const canvas = getDrawCanvas(trendDragStart.index);
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            trendDragStart.previewX = e.clientX - rect.left;
            trendDragStart.previewY = e.clientY - rect.top;
            redrawCellCanvas(trendDragStart.index);
        });

        window.addEventListener('mouseup', () => {
            if (!trendDragStart) return;
            const { index, x, y, previewX, previewY } = trendDragStart;
            const entry = cellCharts[index];
            trendDragStart = null;
            if (entry && (Math.abs(previewX - x) > 3 || Math.abs(previewY - y) > 3)) {
                const t1 = pixelXToCandleTime(entry, x);
                const p1 = entry.series.coordinateToPrice(y);
                const t2 = pixelXToCandleTime(entry, previewX);
                const p2 = entry.series.coordinateToPrice(previewY);
                if (t1 != null && p1 != null && t2 != null && p2 != null) {
                    cellDrawings[index].push({ type: 'trend', p1: { time: t1, price: p1 }, p2: { time: t2, price: p2 } });
                }
            }
            cellActiveDrawTool[index] = null;
            updateDrawToolButtons(index);
            redrawCellCanvas(index);
        });
    }

    function init() {
        DC = window.DataController;
        if (!DC) {
            console.error('[MultiChartGrid] DataController not found.');
            return;
        }
        cellSymbols = loadCellSymbols();
        cellIndicatorMode = loadCellIndicatorMode();
        setupControls();
    }

    return Object.freeze({
        init,
        isActive: () => active,
        // (22 Temmuz 2026, on ikinci oturum) tradingChart.js'teki debug API
        // deseninin aynısı — Playwright testleri gerçek zamanlayıcıyı
        // beklemeden/gerçek fare olaylarını simüle etmeden iç durumu
        // doğrulayabilsin diye.
        debugGetIndicatorMode: (i) => cellIndicatorMode[i],
        debugGetDrawings: (i) => cellDrawings[i],
        debugGetActiveDrawTool: (i) => cellActiveDrawTool[i],
        debugTick: () => tickGrid(),
        debugGetLastCandle: (i) => cellCharts[i] ? cellCharts[i].lastCandles[cellCharts[i].lastCandles.length - 1] : null
    });
})();

window.MultiChartGrid = MultiChartGrid;
document.addEventListener('DOMContentLoaded', () => {
    // tradingChart.js / tradingEngine.js already init on DOMContentLoaded;
    // this module only needs DataController + the grid DOM, both present by
    // the time this listener fires, and has no ordering dependency on the
    // other two initializing first.
    MultiChartGrid.init();
});
