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
        bbLine: 'rgba(66, 165, 245, 0.55)',
        bbFill: 'rgba(66, 165, 245, 0.06)',
        vwap: '#26A69A',
        draw: '#D4AF37',
        fibLine: 'rgba(212, 175, 55, 0.5)',
        volUp: 'rgba(212, 175, 55, 0.45)',
        volDown: 'rgba(120, 120, 120, 0.35)',
        baselineTop: '#D4AF37',
        baselineBottom: '#EF5350'
    };

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

    // Lightweight Charts renders to <canvas> internally, so its background/
    // text/grid colors are set via JS options, not CSS — this mirrors the
    // page's [data-theme] attribute (read once at load; kept in sync by
    // setTheme() whenever the user toggles the theme).
    const THEME_CHART_COLORS = {
        dark: { bg: '#1E1E1E', text: '#888888', grid: 'rgba(255,255,255,0.04)', border: 'rgba(212,175,55,0.15)' },
        light: { bg: '#FFFFFF', text: '#5A5D63', grid: 'rgba(20,22,28,0.07)', border: 'rgba(184,134,11,0.22)' }
    };
    let currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

    let chart = null;
    let subChart = null;
    let candleSeries = null;      // always-present OHLC series; the price-scale anchor
                                   // for coordinate<->price conversions and drawing tools.
                                   // Hidden (visible:false) whenever an alternate chart
                                   // type (bars/line/area/baseline) is active.
    let typeSeries = null;        // the currently visible alt-type series, or null when
                                   // chartType is 'candles' | 'hollow' | 'heikin_ashi'
                                   // (those render directly on candleSeries).
    let volumeSeries = null;      // optional volume histogram, own price scale
    let overlaySeries = {};       // { sma20: LineSeries, ... }
    let subSeries = {};           // active oscillator pane series
    let drawCanvas = null;
    let drawCtx = null;
    let chartContainer = null;

    let state = {
        ticker: null,
        candles: [],
        indicators: null,
        oscillator: 'rsi',
        chartType: 'candles',
        showVolume: false,
        activeTool: 'cursor',
        magnetMode: false,
        drawingsLocked: false,
        drawingsHidden: false,
        drawings: [],          // committed shapes
        pendingShape: null,    // in-progress shape while dragging
        pendingPoints: null,   // accumulated points for multi-click tools (channel/triangle/position)
        selectedDrawingIndex: -1,
        dayOpenPrice: null
    };

    let copiedDrawing = null;

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

        chartContainer = byId('tv-main-chart');
        const subContainer = byId('tv-sub-chart');
        if (!chartContainer || !subContainer) {
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

        subChart = LightweightCharts.createChart(subContainer, baseChartOptions(subContainer, true));

        // Sync sub-chart time scale to main chart
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range) subChart.timeScale().setVisibleLogicalRange(range);
            redrawDrawings();
        });
        subChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range) chart.timeScale().setVisibleLogicalRange(range);
        });

        // Crosshair -> OHLC legend
        chart.subscribeCrosshairMove(handleCrosshairMove);

        setupDrawCanvas();
        setupToolbar();
        setupChartTypeMenu();
        setupOscillatorSelect();
        setupOverlayCheckboxes();
        setupIndicatorModal();
        setupDrawingSelection();
        setupResize();

        window.addEventListener('resize', () => {
            resizeAll();
            redrawDrawings();
        });
    }

    function baseChartOptions(container, isSub) {
        const c = THEME_CHART_COLORS[currentTheme];
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
                vertLine: { color: 'rgba(212,175,55,0.35)', width: 1, style: 3, labelBackgroundColor: '#D4AF37' },
                horzLine: { color: 'rgba(212,175,55,0.35)', width: 1, style: 3, labelBackgroundColor: '#D4AF37' }
            },
            rightPriceScale: {
                borderColor: c.border,
                scaleMargins: isSub ? { top: 0.15, bottom: 0.05 } : { top: 0.08, bottom: 0.02 }
            },
            timeScale: {
                borderColor: c.border,
                timeVisible: false,
                secondsVisible: false,
                visible: !isSub ? false : true // main chart hides its own time axis; sub-chart shows the shared axis
            },
            handleScroll: true,
            handleScale: true
        };
    }

    /* ────────── Symbol loading ────────── */

    async function loadSymbol(ticker) {
        if (!chart || !candleSeries) {
            console.warn('[TradingChart] Chart not initialized (library failed to load?) — skipping loadSymbol.');
            return;
        }

        // Persist the outgoing symbol's drawings so multi-tab switching
        // doesn't wipe a user's trend lines / fib levels on that symbol.
        if (state.ticker && state.ticker !== ticker) {
            drawingsBySymbol[state.ticker] = state.drawings;
        }

        state.ticker = ticker;
        setSymbolHeader(ticker, null, null);

        let candles = null;
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/v1/ohlcv/${ticker}`, { signal: AbortSignal.timeout(6000), targetAddressSpace: 'loopback' });
            if (res.ok) {
                const json = await res.json();
                if (json && Array.isArray(json.data) && json.data.length > 5) {
                    candles = json.data.map(r => ({
                        date: String(r.Date || '').slice(0, 10),
                        open: Number(r.Open || 0),
                        high: Number(r.High || 0),
                        low: Number(r.Low || 0),
                        close: Number(r.Close || 0),
                        volume: Number(r.Volume || 0)
                    })).filter(c => c.date);
                }
            }
        } catch (err) {
            console.warn('[TradingChart] Backend OHLCV fetch failed, falling back to simulated data:', err.message || err);
        }

        if (!candles || candles.length < 5) {
            candles = window.DataController.generateOHLCV(ticker, 90);
        }

        // Lightweight Charts requires strictly ascending unique time values
        const seen = new Set();
        candles = candles.filter(c => {
            if (seen.has(c.date)) return false;
            seen.add(c.date);
            return true;
        }).sort((a, b) => (a.date < b.date ? -1 : 1));

        state.candles = candles;
        state.dayOpenPrice = candles.length ? candles[candles.length - 1].open : null;

        applyChartType();

        state.indicators = window.DataController.calculateIndicators(candles);
        renderOverlays();
        renderOscillatorPane();

        chart.timeScale().fitContent();

        const last = candles[candles.length - 1];
        const prev = candles.length > 1 ? candles[candles.length - 2] : last;
        setSymbolHeader(ticker, last ? last.close : null, prev ? prev.close : null);

        state.drawings = drawingsBySymbol[ticker] ? drawingsBySymbol[ticker].slice() : [];
        state.selectedDrawingIndex = -1;
        redrawDrawings();

        // Hand the real last close back to the caller (TradingEngine) so its
        // simulated live-tick price walk can anchor to the actual fetched
        // price instead of a hardcoded fallback — otherwise the "Price
        // Action" backtest chart and this live chart would slowly disagree
        // on what the current price even is.
        return { ticker, lastClose: last ? last.close : null, dayOpen: last ? last.open : null };
    }

    function getLastClose() {
        if (!state.candles.length) return null;
        const last = state.candles[state.candles.length - 1];
        return { ticker: state.ticker, lastClose: last.close, dayOpen: last.open };
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
                typeSeries = chart.addLineSeries({
                    color: COLORS.up, lineWidth: 2, priceLineVisible: true, lastValueVisible: true,
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
        const nameEl = byId('tv-symbol-name');
        const priceEl = byId('tv-last-price');
        const chgEl = byId('tv-price-change');
        if (nameEl) nameEl.textContent = ticker ? `${ticker}.IS` : '---';
        if (priceEl) priceEl.textContent = price !== null ? '₺' + fmtPrice(price) : '---';
        if (chgEl) {
            if (price !== null && prevClose) {
                const chg = ((price - prevClose) / prevClose) * 100;
                chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
                chgEl.className = 'tv-price-change ' + (chg >= 0 ? 'profit-text' : 'loss-text');
            } else {
                chgEl.textContent = '';
            }
        }
    }

    /* ────────── Live tick update (updates last bar only) ────────── */

    function updateLastPrice(ticker, price) {
        if (!chart || !candleSeries) return;
        if (ticker !== state.ticker || !state.candles.length) return;
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

        const prevClose = state.candles.length > 1 ? state.candles[state.candles.length - 2].close : last.open;
        setSymbolHeader(ticker, price, prevClose);
    }

    /* ────────── Overlay indicators on main chart ────────── */

    function renderOverlays() {
        if (!chart || !candleSeries) return;
        // Clear existing overlay series
        Object.values(overlaySeries).forEach(s => { try { chart.removeSeries(s); } catch (e) {} });
        overlaySeries = {};

        if (!state.indicators || !state.candles.length) return;
        const dates = state.candles.map(c => c.date);
        const ind = state.indicators;

        const vis = {
            sma20: checked('chk-sma20'),
            sma50: checked('chk-sma50'),
            sma200: checked('chk-sma200'),
            ema9: checked('chk-ema9'),
            ema21: checked('chk-ema21'),
            bollinger: checked('chk-bollinger'),
            vwap: checked('chk-vwap')
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
        if (vis.vwap)   addLine('vwap', ind.vwap, COLORS.vwap, { lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 2 });

        if (vis.bollinger) {
            addLine('bbUpper', ind.bollingerUpper, COLORS.bbLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
            addLine('bbLower', ind.bollingerLower, COLORS.bbLine, { lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });
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
        { key: 'bollinger', label: 'BB(20,2)',   colorKey: 'bbLine', chk: 'chk-bollinger' },
        { key: 'vwap',      label: 'VWAP',       colorKey: 'vwap',   chk: 'chk-vwap' }
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
        ['chk-sma20', 'chk-sma50', 'chk-sma200', 'chk-ema9', 'chk-ema21', 'chk-bollinger', 'chk-vwap'].forEach(id => {
            const el = byId(id);
            if (el) el.addEventListener('change', renderOverlays);
        });
    }

    /* ────────── Oscillator sub-pane ────────── */

    function setupOscillatorSelect() {
        const sel = byId('oscillator-type-select');
        if (!sel) return;
        sel.addEventListener('change', () => {
            state.oscillator = sel.value;
            renderOscillatorPane();
        });
    }

    // TradingView-style clickable oscillator list inside the indicator modal.
    // Drives the (now hidden) native <select id="oscillator-type-select"> so
    // the rest of the oscillator-rendering logic doesn't need to change.
    function setupOscillatorButtons() {
        const list = byId('indicator-oscillator-list');
        const sel = byId('oscillator-type-select');
        if (!list || !sel) return;
        list.querySelectorAll('.indicator-osc-item').forEach(btn => {
            btn.addEventListener('click', () => {
                list.querySelectorAll('.indicator-osc-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                sel.value = btn.dataset.osc;
                sel.dispatchEvent(new Event('change'));
            });
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

        setupOscillatorButtons();
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
        document.querySelectorAll('.indicator-modal-category').forEach(cat => {
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
                oscillator: byId('oscillator-type-select') ? byId('oscillator-type-select').value : state.oscillator
            };
            ['chk-sma20', 'chk-sma50', 'chk-sma200', 'chk-ema9', 'chk-ema21', 'chk-bollinger', 'chk-vwap'].forEach(id => {
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
            const sel = byId('oscillator-type-select');
            const list = byId('indicator-oscillator-list');
            if (sel) {
                sel.value = copiedIndicatorSettings.oscillator;
                state.oscillator = sel.value;
                if (list) {
                    list.querySelectorAll('.indicator-osc-item').forEach(b => {
                        b.classList.toggle('active', b.dataset.osc === sel.value);
                    });
                }
                renderOscillatorPane();
            }
            pasteBtn.textContent = 'Yapıştırıldı ✓';
            setTimeout(() => { pasteBtn.textContent = 'Yapıştır'; }, 1400);
        });
    }

    function renderOscillatorPane() {
        if (!subChart || !chart || !candleSeries) return;
        Object.values(subSeries).forEach(s => { try { subChart.removeSeries(s); } catch (e) {} });
        subSeries = {};
        if (!state.indicators || !state.candles.length) return;

        const dates = state.candles.map(c => c.date);
        const ind = state.indicators;
        const type = state.oscillator;
        const titleEl = byId('tv-oscillator-title');

        if (type === 'rsi') {
            subSeries.rsi = subChart.addLineSeries({ color: '#D4AF37', lineWidth: 1.5, priceLineVisible: false });
            subSeries.rsi.setData(seriesFromValues(dates, ind.rsi14));
            subSeries.rsi.createPriceLine({ price: 70, color: 'rgba(244,67,54,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '70' });
            subSeries.rsi.createPriceLine({ price: 30, color: 'rgba(76,175,80,0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '30' });
            if (titleEl) titleEl.textContent = 'RSI (14)';
        } else if (type === 'macd') {
            subSeries.hist = subChart.addHistogramSeries({ priceLineVisible: false, color: '#42A5F5' });
            subSeries.hist.setData(seriesFromValues(dates, ind.macd.histogram).map(p => ({
                time: p.time, value: p.value, color: p.value >= 0 ? 'rgba(76,175,80,0.55)' : 'rgba(244,67,54,0.55)'
            })));
            subSeries.macd = subChart.addLineSeries({ color: '#D4AF37', lineWidth: 1.5, priceLineVisible: false });
            subSeries.macd.setData(seriesFromValues(dates, ind.macd.macdLine));
            subSeries.signal = subChart.addLineSeries({ color: '#42A5F5', lineWidth: 1.5, priceLineVisible: false });
            subSeries.signal.setData(seriesFromValues(dates, ind.macd.signalLine));
            if (titleEl) titleEl.textContent = 'MACD (12,26,9)';
        } else if (type === 'stoch') {
            subSeries.k = subChart.addLineSeries({ color: '#D4AF37', lineWidth: 1.5, priceLineVisible: false });
            subSeries.k.setData(seriesFromValues(dates, ind.stochastic.k));
            subSeries.d = subChart.addLineSeries({ color: '#42A5F5', lineWidth: 1.5, priceLineVisible: false });
            subSeries.d.setData(seriesFromValues(dates, ind.stochastic.d));
            if (titleEl) titleEl.textContent = 'Stochastic (14,3)';
        } else if (type === 'atr') {
            subSeries.atr = subChart.addLineSeries({ color: '#EF6C00', lineWidth: 1.5, priceLineVisible: false });
            subSeries.atr.setData(seriesFromValues(dates, ind.atr14));
            if (titleEl) titleEl.textContent = 'ATR (14)';
        } else if (type === 'adx') {
            subSeries.adx = subChart.addLineSeries({ color: '#AB47BC', lineWidth: 1.5, priceLineVisible: false });
            subSeries.adx.setData(seriesFromValues(dates, ind.adx14));
            if (titleEl) titleEl.textContent = 'ADX (14)';
        } else if (type === 'obv') {
            subSeries.obv = subChart.addLineSeries({ color: '#26A69A', lineWidth: 1.5, priceLineVisible: false });
            subSeries.obv.setData(seriesFromValues(dates, ind.obv));
            if (titleEl) titleEl.textContent = 'OBV';
        }

        // Keep sub-chart time range in sync with main chart after redraw
        const range = chart.timeScale().getVisibleLogicalRange();
        if (range) subChart.timeScale().setVisibleLogicalRange(range);
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
            <span class="ohlc-date">${candle.date}</span>
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
        const rect = chartContainer.getBoundingClientRect();
        drawCanvas.style.width = rect.width + 'px';
        drawCanvas.style.height = rect.height + 'px';
        drawCanvas.width = rect.width * dpr;
        drawCanvas.height = rect.height * dpr;
        drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

    /* ────────── Drawing tools toolbar (grouped flyout menus, Tier 1) ────────── */

    // Tier-1 drawing tool catalog, grouped TradingView-style. `standalone`
    // groups render as a single flat button; the rest render as a button
    // (showing the last-picked tool in that group) plus a caret that opens
    // a flyout listing every tool in the group.
    const TOOL_GROUPS = [
        { id: 'cursor', standalone: true, tools: [{ id: 'cursor', label: 'İmleç' }] },
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
            hide: '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.65 19.65 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.5 19.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line>'
        };
        return '<svg ' + S + '>' + (ICONS[id] || ICONS.cursor) + '</svg>';
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
                flyout.style.top = (rect.bottom + 6) + 'px';
                flyout.style.left = rect.left + 'px';
            }
            flyout.classList.add('open');
        }
    }

    function selectTool(tool) {
        state.activeTool = tool;
        state.pendingShape = null;
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
            state.drawings = [];
            state.selectedDrawingIndex = -1;
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

            const groupBtn = e.target.closest('.tv-tool-group-btn');
            if (groupBtn) {
                selectTool(groupBtn.dataset.tool);
                closeAllFlyouts();
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
            if (e.key === 'Escape') closeAllFlyouts();
        });
    }

    const SINGLE_POINT_TOOLS = ['vline', 'cross'];
    const FREEHAND_TOOLS = ['brush'];
    const DERIVED_THIRD_POINT_TOOLS = ['channel', 'triangle', 'pos_long', 'pos_short'];

    function priceRangeApprox() {
        if (!state.candles.length) return 1;
        const closes = state.candles.map(c => c.close);
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

    function pixelToDataPoint(x, y) {
        if (!chart || !candleSeries || !state.candles.length) return { time: null, price: null, idx: -1 };
        const logical = chart.timeScale().coordinateToLogical(x);
        let idx = Math.round(logical);
        idx = Math.max(0, Math.min(state.candles.length - 1, idx));
        const time = state.candles[idx] ? state.candles[idx].date : null;
        const price = candleSeries.coordinateToPrice(y);
        return snapToOHLC({ time, price, idx });
    }

    function dataPointToPixel(point) {
        if (!chart || !candleSeries || !point) return { x: null, y: null };
        const idx = state.candles.findIndex(c => c.date === point.time);
        const x = idx >= 0 ? chart.timeScale().logicalToCoordinate(idx) : null;
        const y = candleSeries.priceToCoordinate(point.price);
        return { x, y };
    }

    function indexForTime(time) {
        return state.candles.findIndex(c => c.date === time);
    }

    function finishDrawing() {
        selectTool('cursor');
        redrawDrawings();
    }

    function onDrawStart(e) {
        if (state.activeTool === 'cursor') return;
        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dp = pixelToDataPoint(x, y);
        if (dp.time === null || dp.price === null) return;

        if (state.activeTool === 'text') {
            const label = window.prompt('Grafik notu:', '');
            if (label === null || label.trim() === '') return;
            state.drawings.push({ type: 'text', p1: dp, p2: dp, label: label.trim() });
            finishDrawing();
            return;
        }

        if (SINGLE_POINT_TOOLS.includes(state.activeTool)) {
            state.drawings.push({ type: state.activeTool, p1: dp, p2: dp });
            finishDrawing();
            return;
        }

        if (FREEHAND_TOOLS.includes(state.activeTool)) {
            state.pendingShape = { type: state.activeTool, points: [dp], dragging: true };
            return;
        }

        state.pendingShape = { type: state.activeTool, p1: dp, p2: dp, dragging: true };
    }

    function onDrawMove(e) {
        if (!state.pendingShape || !state.pendingShape.dragging) return;
        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
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

        if (pending.points) {
            if (pending.points.length > 1) {
                state.drawings.push({ type: pending.type, points: pending.points });
            }
        } else if (DERIVED_THIRD_POINT_TOOLS.includes(pending.type)) {
            const range = priceRangeApprox();
            if (pending.type === 'channel') {
                state.drawings.push({ type: 'channel', p1: pending.p1, p2: pending.p2, offset: range * 0.12 });
            } else if (pending.type === 'triangle') {
                const idx1 = indexForTime(pending.p1.time), idx2 = indexForTime(pending.p2.time);
                const midIdx = Math.max(0, Math.min(state.candles.length - 1, Math.round((idx1 + idx2) / 2)));
                const apexPrice = Math.max(pending.p1.price, pending.p2.price) + (Math.abs(pending.p1.price - pending.p2.price) || range * 0.1);
                state.drawings.push({
                    type: 'triangle', p1: pending.p1, p2: pending.p2,
                    apex: { time: state.candles[midIdx].date, price: apexPrice }
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
            drawCtx.strokeStyle = COLORS.fibLine;
            drawCtx.beginPath();
            drawCtx.moveTo(xStart, y);
            drawCtx.lineTo(xEnd, y);
            drawCtx.stroke();
            drawCtx.fillStyle = COLORS.draw;
            drawCtx.font = '9px "Fira Code", monospace';
            drawCtx.fillText(`${(lvl * 100).toFixed(1)}%  ₺${fmtPrice(price)}`, xEnd + 4, y + 3);
        });
    }

    function redrawDrawings() {
        if (!drawCtx || !drawCanvas) return;
        const rect = drawCanvas.getBoundingClientRect();
        drawCtx.clearRect(0, 0, rect.width, rect.height);

        if (!state.drawingsHidden) {
            state.drawings.forEach((shape, i) => drawShape(shape, i === state.selectedDrawingIndex));
        }
        if (state.pendingShape) drawShape(state.pendingShape, false);
    }

    function drawShape(shape, isSelected) {
        if (shape.type === 'brush') {
            if (!shape.points || shape.points.length < 2) return;
            const pts = shape.points.map(dataPointToPixel).filter(p => p.x !== null && p.y !== null);
            if (pts.length < 2) return;
            drawCtx.save();
            drawCtx.strokeStyle = isSelected ? '#4FC3F7' : COLORS.draw;
            drawCtx.lineWidth = isSelected ? 3 : 2;
            drawCtx.lineJoin = 'round';
            drawCtx.lineCap = 'round';
            drawCtx.beginPath();
            drawCtx.moveTo(pts[0].x, pts[0].y);
            pts.slice(1).forEach(p => drawCtx.lineTo(p.x, p.y));
            drawCtx.stroke();
            drawCtx.restore();
            return;
        }

        const a = dataPointToPixel(shape.p1);
        const b = dataPointToPixel(shape.p2);
        if (a.x === null || b.x === null || a.y === null || b.y === null) return;
        const rect = drawCanvas.getBoundingClientRect();

        drawCtx.save();
        drawCtx.strokeStyle = isSelected ? '#4FC3F7' : COLORS.draw;
        drawCtx.fillStyle = isSelected ? 'rgba(79,195,247,0.12)' : 'rgba(212,175,55,0.10)';
        drawCtx.lineWidth = isSelected ? 2.25 : 1.5;
        if (isSelected) drawCtx.setLineDash([5, 3]);

        if (shape.type === 'trend') {
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(b.x, b.y);
            drawCtx.stroke();
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
            drawCtx.fillStyle = COLORS.draw;
            drawCtx.font = '10px "Fira Code", monospace';
            drawCtx.fillText('₺' + fmtPrice(shape.p1.price), 4, a.y - 4);
        } else if (shape.type === 'hray') {
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(rect.width, a.y);
            drawCtx.stroke();
            drawCtx.fillStyle = COLORS.draw;
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
            drawCtx.fillStyle = COLORS.draw;
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
            const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
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
            drawCtx.strokeStyle = COLORS.draw;
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
                drawCtx.strokeStyle = COLORS.fibLine;
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
                drawCtx.strokeStyle = COLORS.fibLine;
                drawCtx.beginPath();
                drawCtx.moveTo(lx, 0);
                drawCtx.lineTo(lx, rect.height);
                drawCtx.stroke();
                drawCtx.fillStyle = COLORS.draw;
                drawCtx.font = '9px "Fira Code", monospace';
                drawCtx.fillText(String(n), lx + 2, 12);
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

            if (shape.type === 'brush') {
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
            } else if (shape.type === 'fib_fan' || shape.type === 'fib_time') {
                // Low-value to hit-test precisely (fan rays / time-zone verticals extend to the
                // canvas edge) — a generous bounding-box check keeps selection usable without
                // duplicating the render geometry here.
                const rx = Math.min(a.x, b.x) - 20, rw = Math.abs(b.x - a.x) + 40;
                if (x >= rx && x <= rx + rw) return i;
            }
        }
        return -1;
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
        const shiftPoint = (point) => {
            if (!point) return point;
            const idx = state.candles.findIndex(c => c.date === point.time);
            const newIdx = Math.max(0, Math.min(state.candles.length - 1, (idx >= 0 ? idx : 0) + 3));
            return { time: state.candles[newIdx].date, price: point.price };
        };

        let clone;
        if (copiedDrawing.type === 'brush') {
            clone = { type: 'brush', points: (copiedDrawing.points || []).map(shiftPoint) };
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
            const hitIndex = hitTestDrawings(x, y);
            if (hitIndex >= 0) {
                e.preventDefault();
                e.stopPropagation();
                selectDrawing(hitIndex);
            } else if (state.selectedDrawingIndex >= 0) {
                selectDrawing(-1);
            }
        }, true);

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
        const subContainer = byId('tv-sub-chart');
        if (subChart && subContainer) {
            subChart.applyOptions({ width: subContainer.clientWidth, height: subContainer.clientHeight });
        }
        resizeDrawCanvas();
    }

    function setupResize() {
        const ro = new ResizeObserver(() => {
            resizeAll();
            redrawDrawings();
        });
        if (chartContainer) ro.observe(chartContainer);
    }

    /* ────────── Public API ────────── */

    function setTheme(theme) {
        currentTheme = theme === 'light' ? 'light' : 'dark';
        const c = THEME_CHART_COLORS[currentTheme];
        const opts = {
            layout: { background: { color: c.bg }, textColor: c.text },
            grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
            rightPriceScale: { borderColor: c.border },
            timeScale: { borderColor: c.border }
        };
        if (chart) chart.applyOptions(opts);
        if (subChart) subChart.applyOptions(opts);
    }

    return Object.freeze({
        init,
        loadSymbol,
        updateLastPrice,
        renderOverlays,
        renderOscillatorPane,
        getLastClose,
        setTheme,
        setChartType,
        setVolumeVisible,
        // Read-only introspection, useful for QA/debugging — no external
        // caller in the app itself relies on this.
        debugGetDrawings: () => JSON.parse(JSON.stringify(state.drawings)),
        debugGetSelectedIndex: () => state.selectedDrawingIndex,
        debugSelectDrawing: (index) => selectDrawing(index),
        debugCopySelected: () => copySelectedDrawing(),
        debugPaste: () => pasteDrawing(),
        debugDeleteSelected: () => deleteSelectedDrawing(),
        debugGetChartType: () => state.chartType,
        debugGetActiveTool: () => state.activeTool
    });
})();

window.TradingChart = TradingChart;
