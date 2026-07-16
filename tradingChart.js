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
        fibLine: 'rgba(212, 175, 55, 0.5)'
    };

    let chart = null;
    let subChart = null;
    let candleSeries = null;
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
        activeTool: 'cursor',
        drawings: [],          // committed shapes
        pendingShape: null,    // in-progress shape while dragging
        dayOpenPrice: null
    };

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
        setupOscillatorSelect();
        setupOverlayCheckboxes();
        setupResize();

        window.addEventListener('resize', () => {
            resizeAll();
            redrawDrawings();
        });
    }

    function baseChartOptions(container, isSub) {
        return {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: {
                background: { color: '#1E1E1E' },
                textColor: COLORS.text,
                fontFamily: "'Fira Code', monospace"
            },
            grid: {
                vertLines: { color: COLORS.grid },
                horzLines: { color: COLORS.grid }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: 'rgba(212,175,55,0.35)', width: 1, style: 3, labelBackgroundColor: '#D4AF37' },
                horzLine: { color: 'rgba(212,175,55,0.35)', width: 1, style: 3, labelBackgroundColor: '#D4AF37' }
            },
            rightPriceScale: {
                borderColor: 'rgba(212,175,55,0.15)',
                scaleMargins: isSub ? { top: 0.15, bottom: 0.05 } : { top: 0.08, bottom: 0.02 }
            },
            timeScale: {
                borderColor: 'rgba(212,175,55,0.15)',
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
        state.ticker = ticker;
        setSymbolHeader(ticker, null, null);

        let candles = null;
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/v1/ohlcv/${ticker}`, { signal: AbortSignal.timeout(6000), targetAddressSpace: 'local' });
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

        const lwcData = candles.map(c => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close }));
        candleSeries.setData(lwcData);

        state.indicators = window.DataController.calculateIndicators(candles);
        renderOverlays();
        renderOscillatorPane();

        chart.timeScale().fitContent();

        const last = candles[candles.length - 1];
        const prev = candles.length > 1 ? candles[candles.length - 2] : last;
        setSymbolHeader(ticker, last ? last.close : null, prev ? prev.close : null);

        state.drawings = [];
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

        candleSeries.update({ time: last.date, open: last.open, high: last.high, low: last.low, close: last.close });

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

    function updateLegend(vis) {
        const legend = byId('tv-overlay-legend');
        if (!legend) return;
        const items = [];
        if (vis.sma20)  items.push('<span style="color:' + COLORS.sma20 + '">■ SMA20</span>');
        if (vis.sma50)  items.push('<span style="color:' + COLORS.sma50 + '">■ SMA50</span>');
        if (vis.sma200) items.push('<span style="color:' + COLORS.sma200 + '">■ SMA200</span>');
        if (vis.ema9)   items.push('<span style="color:' + COLORS.ema9 + '">■ EMA9</span>');
        if (vis.ema21)  items.push('<span style="color:' + COLORS.ema21 + '">■ EMA21</span>');
        if (vis.bollinger) items.push('<span style="color:' + COLORS.bbLine + '">■ BB(20,2)</span>');
        if (vis.vwap)   items.push('<span style="color:' + COLORS.vwap + '">■ VWAP</span>');
        legend.innerHTML = items.join(' &nbsp; ');
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

    function setupToolbar() {
        const toolbar = byId('chart-toolbar');
        if (!toolbar) return;
        toolbar.querySelectorAll('[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                if (tool === 'clear') {
                    state.drawings = [];
                    redrawDrawings();
                    return;
                }
                if (tool === 'undo') {
                    state.drawings.pop();
                    redrawDrawings();
                    return;
                }
                state.activeTool = tool;
                toolbar.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
                if (tool !== 'clear' && tool !== 'undo') btn.classList.add('active');

                if (drawCanvas) {
                    drawCanvas.style.pointerEvents = (tool === 'cursor') ? 'none' : 'auto';
                    drawCanvas.style.cursor = (tool === 'cursor') ? 'default' : 'crosshair';
                }
            });
        });
    }

    function pixelToDataPoint(x, y) {
        if (!chart || !candleSeries || !state.candles.length) return { time: null, price: null, idx: -1 };
        const logical = chart.timeScale().coordinateToLogical(x);
        let idx = Math.round(logical);
        idx = Math.max(0, Math.min(state.candles.length - 1, idx));
        const time = state.candles[idx] ? state.candles[idx].date : null;
        const price = candleSeries.coordinateToPrice(y);
        return { time, price, idx };
    }

    function dataPointToPixel(point) {
        if (!chart || !candleSeries) return { x: null, y: null };
        const idx = state.candles.findIndex(c => c.date === point.time);
        const x = idx >= 0 ? chart.timeScale().logicalToCoordinate(idx) : null;
        const y = candleSeries.priceToCoordinate(point.price);
        return { x, y };
    }

    function onDrawStart(e) {
        if (state.activeTool === 'cursor') return;
        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dp = pixelToDataPoint(x, y);
        if (dp.time === null || dp.price === null) return;

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
        state.pendingShape.p2 = dp;
        redrawDrawings();
    }

    function onDrawEnd() {
        if (!state.pendingShape || !state.pendingShape.dragging) return;
        state.pendingShape.dragging = false;
        state.drawings.push({ type: state.pendingShape.type, p1: state.pendingShape.p1, p2: state.pendingShape.p2 });
        state.pendingShape = null;

        // Auto return to cursor mode after a completed drawing
        state.activeTool = 'cursor';
        const toolbar = byId('chart-toolbar');
        if (toolbar) {
            toolbar.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
            const cursorBtn = toolbar.querySelector('[data-tool="cursor"]');
            if (cursorBtn) cursorBtn.classList.add('active');
        }
        if (drawCanvas) {
            drawCanvas.style.pointerEvents = 'none';
            drawCanvas.style.cursor = 'default';
        }
        redrawDrawings();
    }

    function redrawDrawings() {
        if (!drawCtx || !drawCanvas) return;
        const rect = drawCanvas.getBoundingClientRect();
        drawCtx.clearRect(0, 0, rect.width, rect.height);

        const all = state.pendingShape ? [...state.drawings, state.pendingShape] : state.drawings;
        all.forEach(shape => drawShape(shape));
    }

    function drawShape(shape) {
        const a = dataPointToPixel(shape.p1);
        const b = dataPointToPixel(shape.p2);
        if (a.x === null || b.x === null || a.y === null || b.y === null) return;

        drawCtx.save();
        drawCtx.strokeStyle = COLORS.draw;
        drawCtx.fillStyle = 'rgba(212,175,55,0.10)';
        drawCtx.lineWidth = 1.5;

        if (shape.type === 'trend') {
            drawCtx.beginPath();
            drawCtx.moveTo(a.x, a.y);
            drawCtx.lineTo(b.x, b.y);
            drawCtx.stroke();
        } else if (shape.type === 'horizontal') {
            const rect = drawCanvas.getBoundingClientRect();
            drawCtx.beginPath();
            drawCtx.moveTo(0, a.y);
            drawCtx.lineTo(rect.width, a.y);
            drawCtx.stroke();
            drawCtx.fillStyle = COLORS.draw;
            drawCtx.font = '10px "Fira Code", monospace';
            drawCtx.fillText('₺' + fmtPrice(shape.p1.price), 4, a.y - 4);
        } else if (shape.type === 'rect') {
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
            drawCtx.fillRect(x, y, w, h);
            drawCtx.strokeRect(x, y, w, h);
        } else if (shape.type === 'fib') {
            const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
            const rect = drawCanvas.getBoundingClientRect();
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
        drawCtx.restore();
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

    return Object.freeze({
        init,
        loadSymbol,
        updateLastPrice,
        renderOverlays,
        renderOscillatorPane,
        getLastClose
    });
})();

window.TradingChart = TradingChart;
