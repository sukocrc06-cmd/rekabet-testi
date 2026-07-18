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
    const COLORS = { up: '#D4AF37', down: '#555555', wickUp: '#D4AF37', wickDown: '#777777' };

    let DC = null;
    let active = false;
    let cellSymbols = DEFAULT_SYMBOLS.slice();
    const cellCharts = []; // { chart, series } per cell, recreated each time the grid is opened

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
        return { chart, series };
    }

    // Basitleştirilmiş fetch: ana grafikteki gibi retry/12sn timeout yerine
    // kısa bir tek deneme yeterli — bu bir "genel bakış" ızgarası, başarısız
    // olursa (dataController.js'in artık gerçekçi STOCK_PROFILES'a dayanan)
    // simüle veri üretimine sorunsuzca düşer.
    async function fetchCellCandles(symbol) {
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/v1/ohlcv/${symbol}`, { signal: AbortSignal.timeout(5000), targetAddressSpace: 'loopback' });
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
        entry.chart.timeScale().fitContent();
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
        const subpane = byId('tv-subpane-wrap');
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
        const subpane = byId('tv-subpane-wrap');
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

        window.addEventListener('resize', () => { if (active) resizeAll(); });
    }

    function init() {
        DC = window.DataController;
        if (!DC) {
            console.error('[MultiChartGrid] DataController not found.');
            return;
        }
        cellSymbols = loadCellSymbols();
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
