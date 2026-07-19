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
    const COLORS = { up: '#D4AF37', down: '#555555', wickUp: '#D4AF37', wickDown: '#777777', sma20: '#42A5F5', ema9: '#26C6DA' };

    // (18 Temmuz 2026, onuncu oturum, üçüncü tur) Her hücreye sade SMA20/EMA9
    // overlay göstergesi eklendi — Dual-Chart Panel 2'deki "tam gösterge
    // motorunu çoğaltma, sadece 2 sabit gösterge" yaklaşımının aynısı. Aç/kapa
    // durumu hücre bazında localStorage'da kalıcı.
    const OVERLAY_STORAGE_KEY = 'optipulselab_grid_overlay_v1';

    let DC = null;
    let active = false;
    let cellSymbols = DEFAULT_SYMBOLS.slice();
    let cellOverlayActive = [false, false, false, false];
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

    function loadCellOverlayActive() {
        try {
            const raw = localStorage.getItem(OVERLAY_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length === CELL_COUNT) return parsed.map(Boolean);
            }
        } catch (e) { /* private mode / corrupt storage — fall back to defaults */ }
        return [false, false, false, false];
    }

    function saveCellOverlayActive() {
        try { localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(cellOverlayActive)); } catch (e) { /* ignore */ }
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
        refreshCellOverlay(index);
        entry.chart.timeScale().fitContent();
    }

    // Sade SMA20/EMA9 overlay çizimi — açıksa entry.lastCandles'tan hesaplanıp
    // çiziliyor, kapalıysa var olan seriler temizleniyor. Yeni veri her
    // geldiğinde (sembol değişimi) loadCell() bunu otomatik çağırıyor.
    function refreshCellOverlay(index) {
        const entry = cellCharts[index];
        if (!entry) return;
        Object.values(entry.overlaySeries).forEach(s => { try { entry.chart.removeSeries(s); } catch (e) {} });
        entry.overlaySeries = {};
        if (!cellOverlayActive[index] || !entry.lastCandles.length || !DC) return;

        const dates = entry.lastCandles.map(c => c.time);
        const closes = entry.lastCandles.map(c => c.close);
        const sma20 = DC.computeSMA(closes, 20);
        const ema9 = DC.computeEMA(closes, 9);
        const toPoints = (values) => {
            const out = [];
            for (let i = 0; i < dates.length; i++) {
                if (values[i] === null || values[i] === undefined) continue;
                out.push({ time: dates[i], value: values[i] });
            }
            return out;
        };
        entry.overlaySeries.sma20 = entry.chart.addLineSeries({ color: COLORS.sma20, lineWidth: 1.25, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        entry.overlaySeries.sma20.setData(toPoints(sma20));
        entry.overlaySeries.ema9 = entry.chart.addLineSeries({ color: COLORS.ema9, lineWidth: 1.25, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: LightweightCharts.LineStyle.Dashed });
        entry.overlaySeries.ema9.setData(toPoints(ema9));
    }

    function toggleCellOverlay(index) {
        cellOverlayActive[index] = !cellOverlayActive[index];
        saveCellOverlayActive();
        const btn = document.querySelector(`.tv-grid-indicator-btn[data-cell="${index}"]`);
        if (btn) btn.classList.toggle('active', cellOverlayActive[index]);
        refreshCellOverlay(index);
    }

    function populateSelect(select, selectedSymbol) {
        if (!DC || !DC.BIST100) return;
        select.innerHTML = DC.BIST100.map(s => `<option value="${s.symbol}">${s.symbol} — ${s.name}</option>`).join('');
        select.value = selectedSymbol;
    }

    function resizeAll() {
        cellCharts.forEach((entry, i) => {
            if (!entry) return;
            const container = byId('tv-grid-chart-' + i);
            if (container) entry.chart.resize(container.clientWidth, container.clientHeight);
        });
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
        destroyCharts();
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

        document.querySelectorAll('.tv-grid-indicator-btn').forEach(btn => {
            const i = parseInt(btn.dataset.cell, 10);
            btn.classList.toggle('active', cellOverlayActive[i]);
            btn.addEventListener('click', () => toggleCellOverlay(i));
        });

        window.addEventListener('resize', () => { if (active) resizeAll(); });
    }

    function init() {
        DC = window.DataController;
        if (!DC) {
            console.error('[MultiChartGrid] DataController not found.');
            return;
        }
        cellSymbols = loadCellSymbols();
        cellOverlayActive = loadCellOverlayActive();
        setupControls();
    }

    return Object.freeze({
        init,
        isActive: () => active
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
