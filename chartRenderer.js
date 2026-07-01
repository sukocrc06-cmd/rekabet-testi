/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB CANVAS CHART RENDERER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * High-performance HTML5 Canvas renderer for financial charts.
 * Renders candlestick OHLCV, equity curves, drawdown waterfalls,
 * SMA overlays, volume bars, and signal markers (BUY/SELL/HOLD/DATA ERROR).
 *
 * Exposed as window.ChartRenderer — stateless, pure-render functions.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const ChartRenderer = (() => {

    /* ────────── Theme Constants (matches CSS vars) ────────── */
    const THEME = {
        bg:         '#1E1E1E',
        gridLine:   '#2A2A2A',
        gridLabel:  '#555555',
        axisLabel:  '#888888',
        gold:       '#D4AF37',
        goldLight:  '#F3E5AB',
        goldDark:   '#AA7C11',
        goldGlow:   'rgba(212, 175, 55, 0.35)',
        goldDim:    'rgba(212, 175, 55, 0.12)',
        goldBorder: 'rgba(212, 175, 55, 0.25)',
        candleUp:   '#D4AF37',
        candleDown: '#555555',
        wickColor:  '#D4AF37',
        volumeUp:   'rgba(212, 175, 55, 0.20)',
        volumeDown: 'rgba(85, 85, 85, 0.20)',
        smaFast:    '#FFF3A8',
        smaSlow:    'rgba(212, 175, 55, 0.6)',
        textPrimary:'#F0F0F0',
        textMuted:  '#666666',
        profit:     '#4CAF50',
        loss:       '#F44336',
        warning:    '#EF6C00',
        white:      '#FFFFFF',
        fontMono:   "'Fira Code', monospace",
        fontSans:   "'Outfit', sans-serif",
        // Indicator overlays
        sma20:      '#42A5F5',       // blue
        sma50:      '#AB47BC',       // purple
        sma200:     '#EF5350',       // red
        bbFill:     'rgba(66, 165, 245, 0.06)',
        bbStroke:   'rgba(66, 165, 245, 0.35)',
        vwap:       '#26A69A',       // teal
    };

    /* Signal types */
    const SIGNAL = {
        BUY:   'BUY',
        SELL:  'SELL',
        HOLD:  'HOLD',
        ERROR: 'DATA_ERROR'
    };

    /* ────────── Utility: DPR-aware canvas sizing ────────── */

    function setupCanvas(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width  = rect.width  * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        return { ctx, w: rect.width, h: rect.height, dpr };
    }

    /* ────────── Utility: price → y coordinate ────────── */

    function priceToY(price, minPrice, maxPrice, chartTop, chartHeight) {
        const range = maxPrice - minPrice || 1;
        return chartTop + chartHeight * (1 - (price - minPrice) / range);
    }

    /* ────────── Utility: format price for axis labels ────────── */

    function drawSandboxWatermark(ctx, xCenter, yCenter) {
        ctx.save();
        ctx.font = 'bold 36px var(--font-sans)';
        ctx.fillStyle = 'rgba(212, 175, 55, 0.055)'; // very faint gold accent watermark
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(xCenter, yCenter);
        ctx.rotate(-Math.PI / 12); // -15 degrees rotation
        ctx.fillText('SANDBOX MODE - NON-LIVE', 0, 0);
        ctx.restore();
    }

    function formatAxisPrice(val) {
        if (val >= 1000) return val.toFixed(0);
        if (val >= 100)  return val.toFixed(1);
        return val.toFixed(2);
    }

    function formatShortDate(dateStr) {
        const parts = dateStr.split('-');
        return parts[2] + '/' + parts[1];
    }

    /* ══════════════════════════════════════════════════════════
       1. CANDLESTICK CHART with Volume, SMAs, and Signals
       ══════════════════════════════════════════════════════════ */

    /**
     * Render a full candlestick chart with volume bars, SMA overlays, and signal markers.
     *
     * @param {HTMLCanvasElement} canvas
     * @param {Object}           data
     * @param {Array}            data.candles   — OHLCV array
     * @param {Array}            data.signals   — signal markers [{index, type, label}]
     * @param {Array}            data.smaFast   — SMA fast line values (or null entries)
     * @param {Array}            data.smaSlow   — SMA slow line values (or null entries)
     * @param {Object}           [opts]         — rendering options
     */
    function renderCandlestickChart(canvas, data, opts = {}) {
        const { ctx, w, h } = setupCanvas(canvas);
        const { candles, signals = [], smaFast = [], smaSlow = [],
                indicators = {}, indicatorVisibility = {}, oosSplitIndex = null } = data;

        if (!candles || candles.length === 0) {
            drawEmptyState(ctx, w, h, 'No OHLCV data available');
            return;
        }

        // Layout regions
        const pad = { top: 16, right: 64, bottom: 40, left: 12 };
        const volumeHeight = h * 0.18;
        const chartTop = pad.top;
        const chartHeight = h - pad.top - pad.bottom - volumeHeight - 8;
        const volTop = chartTop + chartHeight + 8;
        const chartRight = w - pad.right;
        const chartWidth = chartRight - pad.left;

        // Clear
        ctx.fillStyle = THEME.bg;
        ctx.fillRect(0, 0, w, h);

        // Compute price range
        const allHighs = candles.map(c => c.high);
        const allLows  = candles.map(c => c.low);
        let minP = Math.min(...allLows);
        let maxP = Math.max(...allHighs);
        // Add 3% padding
        const pRange = maxP - minP || 1;
        minP -= pRange * 0.03;
        maxP += pRange * 0.03;

        // Volume range
        const maxVol = Math.max(...candles.map(c => c.volume)) || 1;

        // Candle geometry
        const gap = chartWidth / candles.length;
        const candleW = Math.max(2, gap * 0.55);

        const toY = (price) => priceToY(price, minP, maxP, chartTop, chartHeight);
        const toX = (i) => pad.left + i * gap + gap / 2;

        // ── Grid lines & price axis ──
        drawGrid(ctx, minP, maxP, chartTop, chartHeight, pad.left, chartRight, w);

        // ── Compliance Watermark ──
        drawSandboxWatermark(ctx, pad.left + chartWidth / 2, chartTop + chartHeight / 2);

        // ── Out-of-Sample (OOS) Split Line ──
        if (oosSplitIndex !== null && oosSplitIndex > 0 && oosSplitIndex < candles.length) {
            const splitX = toX(oosSplitIndex);
            ctx.save();
            ctx.strokeStyle = THEME.gold;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(splitX, chartTop);
            ctx.lineTo(splitX, chartTop + chartHeight);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw labels
            ctx.fillStyle = THEME.gold;
            ctx.font = `bold 9px ${THEME.fontSans}`;
            ctx.textAlign = 'right';
            ctx.fillText('TRAINING (IN-SAMPLE) ◄', splitX - 8, chartTop + 14);
            ctx.textAlign = 'left';
            ctx.fillText('► VALIDATION (OOS)', splitX + 8, chartTop + 14);
            ctx.restore();
        }

        // ── Date axis ──
        drawDateAxis(ctx, candles, toX, h - pad.bottom + 4, h);

        // ── Volume bars ──
        candles.forEach((c, i) => {
            const x = toX(i);
            const isUp = c.close >= c.open;
            const volH = (c.volume / maxVol) * volumeHeight;
            ctx.fillStyle = isUp ? THEME.volumeUp : THEME.volumeDown;
            ctx.fillRect(x - candleW / 2, volTop + volumeHeight - volH, candleW, volH);
        });

        // Volume label
        ctx.fillStyle = THEME.gridLabel;
        ctx.font = `9px ${THEME.fontMono}`;
        ctx.textAlign = 'right';
        ctx.fillText('VOL', chartRight + 50, volTop + 10);

        // ── Indicator overlays (below candles for layering) ──
        renderIndicatorOverlays(ctx, indicators, indicatorVisibility, toX, toY, pad.left, chartRight, chartTop, chartHeight);

        // ── Strategy SMA lines (5/13 — always shown) ──
        drawSmaLine(ctx, smaSlow, toX, toY, THEME.smaSlow, 1.5);
        drawSmaLine(ctx, smaFast, toX, toY, THEME.smaFast, 1.5);

        // ── Candlesticks ──
        candles.forEach((c, i) => {
            const x = toX(i);
            const isUp = c.close >= c.open;

            const yHigh  = toY(c.high);
            const yLow   = toY(c.low);
            const yOpen  = toY(c.open);
            const yClose = toY(c.close);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH   = Math.max(1, Math.abs(yOpen - yClose));

            // Wick
            ctx.strokeStyle = THEME.wickColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, yHigh);
            ctx.lineTo(x, yLow);
            ctx.stroke();

            // Body
            if (isUp) {
                ctx.fillStyle = THEME.candleUp;
                ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
            } else {
                ctx.strokeStyle = THEME.candleDown;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH);
                ctx.fillStyle = 'rgba(85, 85, 85, 0.3)';
                ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
            }
        });

        // ── Signal markers ──
        signals.forEach(sig => {
            const x = toX(sig.index);
            const candle = candles[sig.index];
            if (!candle) return;

            switch (sig.type) {
                case SIGNAL.BUY:
                    drawBuyArrow(ctx, x, toY(candle.low) + 14, sig.label);
                    break;
                case SIGNAL.SELL:
                    drawSellArrow(ctx, x, toY(candle.high) - 14, sig.label);
                    break;
                case SIGNAL.HOLD:
                    drawHoldBadge(ctx, x, toY(candle.high) - 16, sig.label);
                    break;
                case SIGNAL.ERROR:
                    drawErrorBadge(ctx, x, toY(candle.high) - 16, sig.label);
                    break;
            }
        });

        // ── Dynamic Legend (strategy SMAs + active indicators) ──
        drawDynamicLegend(ctx, pad.left + 6, chartTop + 6, indicatorVisibility);

        // ── Last price line ──
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) {
            const lastY = toY(lastCandle.close);
            ctx.strokeStyle = THEME.goldBorder;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(pad.left, lastY);
            ctx.lineTo(chartRight, lastY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Price label on right axis
            const labelW = 56;
            const labelH = 18;
            ctx.fillStyle = THEME.gold;
            roundRect(ctx, chartRight + 2, lastY - labelH / 2, labelW, labelH, 3);
            ctx.fill();
            ctx.fillStyle = '#121212';
            ctx.font = `bold 10px ${THEME.fontMono}`;
            ctx.textAlign = 'center';
            ctx.fillText('₺' + formatAxisPrice(lastCandle.close), chartRight + 2 + labelW / 2, lastY + 4);
        }
    }

    /* ── Grid helpers ── */

    function drawGrid(ctx, minP, maxP, chartTop, chartHeight, leftX, rightX, totalW) {
        const gridLines = 5;
        const step = (maxP - minP) / gridLines;

        ctx.strokeStyle = THEME.gridLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.fillStyle = THEME.gridLabel;
        ctx.font = `10px ${THEME.fontMono}`;
        ctx.textAlign = 'right';

        for (let i = 0; i <= gridLines; i++) {
            const price = minP + step * i;
            const y = priceToY(price, minP, maxP, chartTop, chartHeight);

            ctx.beginPath();
            ctx.moveTo(leftX, y);
            ctx.lineTo(rightX, y);
            ctx.stroke();

            ctx.fillText('₺' + formatAxisPrice(price), totalW - 4, y + 3);
        }

        ctx.setLineDash([]);
    }

    function drawDateAxis(ctx, candles, toX, labelY, totalH) {
        ctx.fillStyle = THEME.gridLabel;
        ctx.font = `9px ${THEME.fontMono}`;
        ctx.textAlign = 'center';

        // Show every Nth date based on count
        const interval = candles.length <= 15 ? 2 : candles.length <= 30 ? 4 : 7;
        candles.forEach((c, i) => {
            if (i % interval === 0 || i === candles.length - 1) {
                const x = toX(i);
                ctx.fillText(formatShortDate(c.date), x, labelY + 14);

                // Small tick
                ctx.strokeStyle = THEME.gridLine;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, labelY);
                ctx.lineTo(x, labelY + 4);
                ctx.stroke();
            }
        });
    }

    function drawSmaLine(ctx, smaData, toX, toY, color, lineWidth, dashPattern) {
        if (!smaData || smaData.length === 0) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(dashPattern || []);
        ctx.beginPath();
        let started = false;
        smaData.forEach((val, i) => {
            if (val === null || val === undefined) return;
            const x = toX(i);
            const y = toY(val);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function drawSmaLegend(ctx, x, y) {
        // Fast SMA
        ctx.strokeStyle = THEME.smaFast;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x + 16, y + 6);
        ctx.stroke();
        ctx.fillStyle = THEME.axisLabel;
        ctx.font = `10px ${THEME.fontSans}`;
        ctx.textAlign = 'left';
        ctx.fillText('SMA 5', x + 20, y + 10);

        // Slow SMA
        ctx.strokeStyle = THEME.smaSlow;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 70, y + 6);
        ctx.lineTo(x + 86, y + 6);
        ctx.stroke();
        ctx.fillStyle = THEME.axisLabel;
        ctx.fillText('SMA 13', x + 90, y + 10);
    }

    /* ── Dynamic legend that includes active indicator overlays ── */
    function drawDynamicLegend(ctx, x, y, vis) {
        const items = [
            { label: 'SMA 5',  color: THEME.smaFast, dash: [], show: true },
            { label: 'SMA 13', color: THEME.smaSlow, dash: [], show: true },
        ];

        if (vis.sma20)  items.push({ label: 'SMA 20',  color: THEME.sma20,  dash: [], show: true });
        if (vis.sma50)  items.push({ label: 'SMA 50',  color: THEME.sma50,  dash: [], show: true });
        if (vis.sma200) items.push({ label: 'SMA 200', color: THEME.sma200, dash: [], show: true });
        if (vis.bollinger) items.push({ label: 'BB(20,2)', color: THEME.bbStroke, dash: [3, 3], show: true });
        if (vis.vwap)   items.push({ label: 'VWAP',    color: THEME.vwap,   dash: [5, 3], show: true });

        let offsetX = 0;
        items.forEach(item => {
            if (!item.show) return;
            // Line sample
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 2;
            ctx.setLineDash(item.dash);
            ctx.beginPath();
            ctx.moveTo(x + offsetX, y + 6);
            ctx.lineTo(x + offsetX + 16, y + 6);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label
            ctx.fillStyle = THEME.axisLabel;
            ctx.font = `10px ${THEME.fontSans}`;
            ctx.textAlign = 'left';
            ctx.fillText(item.label, x + offsetX + 20, y + 10);

            offsetX += ctx.measureText(item.label).width + 32;
        });
    }

    /* ── Indicator overlay rendering ── */

    function renderIndicatorOverlays(ctx, indicators, vis, toX, toY, leftX, rightX, chartTop, chartHeight) {
        if (!indicators || !vis) return;

        // Bollinger Bands — shaded area first (behind everything)
        if (vis.bollinger && indicators.bollingerUpper && indicators.bollingerLower) {
            const upper = indicators.bollingerUpper;
            const lower = indicators.bollingerLower;

            // Shaded fill between upper and lower
            ctx.fillStyle = THEME.bbFill;
            ctx.beginPath();
            let started = false;
            const validPoints = [];
            for (let i = 0; i < upper.length; i++) {
                if (upper[i] === null || lower[i] === null) continue;
                if (!started) { ctx.moveTo(toX(i), toY(upper[i])); started = true; }
                else ctx.lineTo(toX(i), toY(upper[i]));
                validPoints.push(i);
            }
            // Trace back along lower
            for (let j = validPoints.length - 1; j >= 0; j--) {
                const i = validPoints[j];
                ctx.lineTo(toX(i), toY(lower[i]));
            }
            ctx.closePath();
            ctx.fill();

            // Upper band line
            drawSmaLine(ctx, upper, toX, toY, THEME.bbStroke, 1, [3, 3]);
            // Lower band line
            drawSmaLine(ctx, lower, toX, toY, THEME.bbStroke, 1, [3, 3]);
        }

        // SMA 20
        if (vis.sma20 && indicators.sma20) {
            drawSmaLine(ctx, indicators.sma20, toX, toY, THEME.sma20, 1.5);
        }

        // SMA 50
        if (vis.sma50 && indicators.sma50) {
            drawSmaLine(ctx, indicators.sma50, toX, toY, THEME.sma50, 1.5);
        }

        // SMA 200
        if (vis.sma200 && indicators.sma200) {
            drawSmaLine(ctx, indicators.sma200, toX, toY, THEME.sma200, 1.5);
        }

        // VWAP
        if (vis.vwap && indicators.vwap) {
            drawSmaLine(ctx, indicators.vwap, toX, toY, THEME.vwap, 2, [5, 3]);
        }
    }

    /* ── Signal markers ── */

    function drawBuyArrow(ctx, x, y, label) {
        // Upward gold arrow
        ctx.fillStyle = THEME.gold;
        ctx.beginPath();
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x - 6, y);
        ctx.lineTo(x - 3, y);
        ctx.lineTo(x - 3, y + 6);
        ctx.lineTo(x + 3, y + 6);
        ctx.lineTo(x + 3, y);
        ctx.lineTo(x + 6, y);
        ctx.closePath();
        ctx.fill();

        // Glow
        ctx.shadowColor = THEME.goldGlow;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = THEME.profit;
        ctx.font = `bold 8px ${THEME.fontSans}`;
        ctx.textAlign = 'center';
        ctx.fillText(label || 'BUY', x, y + 18);
    }

    function drawSellArrow(ctx, x, y, label) {
        // Downward red arrow
        ctx.fillStyle = THEME.loss;
        ctx.beginPath();
        ctx.moveTo(x, y + 10);
        ctx.lineTo(x - 6, y);
        ctx.lineTo(x - 3, y);
        ctx.lineTo(x - 3, y - 6);
        ctx.lineTo(x + 3, y - 6);
        ctx.lineTo(x + 3, y);
        ctx.lineTo(x + 6, y);
        ctx.closePath();
        ctx.fill();

        // Glow
        ctx.shadowColor = 'rgba(244, 67, 54, 0.3)';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = THEME.loss;
        ctx.font = `bold 8px ${THEME.fontSans}`;
        ctx.textAlign = 'center';
        ctx.fillText(label || 'SELL', x, y - 12);
    }

    function drawHoldBadge(ctx, x, y, label) {
        const text = label || 'HOLD';
        ctx.font = `bold 8px ${THEME.fontSans}`;
        const tw = ctx.measureText(text).width;
        const bw = tw + 10;
        const bh = 14;

        ctx.fillStyle = THEME.goldDim;
        roundRect(ctx, x - bw / 2, y - bh / 2, bw, bh, 3);
        ctx.fill();
        ctx.strokeStyle = THEME.goldBorder;
        ctx.lineWidth = 1;
        roundRect(ctx, x - bw / 2, y - bh / 2, bw, bh, 3);
        ctx.stroke();

        ctx.fillStyle = THEME.gold;
        ctx.textAlign = 'center';
        ctx.fillText(text, x, y + 3);
    }

    function drawErrorBadge(ctx, x, y, label) {
        const text = label || 'ERR';
        ctx.font = `bold 8px ${THEME.fontSans}`;
        const tw = ctx.measureText(text).width;
        const bw = tw + 10;
        const bh = 14;

        ctx.fillStyle = 'rgba(239, 108, 0, 0.15)';
        roundRect(ctx, x - bw / 2, y - bh / 2, bw, bh, 3);
        ctx.fill();
        ctx.strokeStyle = THEME.warning;
        ctx.lineWidth = 1;
        roundRect(ctx, x - bw / 2, y - bh / 2, bw, bh, 3);
        ctx.stroke();

        ctx.fillStyle = THEME.warning;
        ctx.textAlign = 'center';
        ctx.fillText(text, x, y + 3);

        // Warning triangle icon
        ctx.fillStyle = THEME.warning;
        ctx.font = `10px ${THEME.fontSans}`;
        ctx.fillText('⚠', x, y - 10);
    }

    /* ── Rounded rect helper ── */

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /* ══════════════════════════════════════════════════════════
       2. EQUITY CURVE CHART
       ══════════════════════════════════════════════════════════ */

    function renderEquityCurve(canvas, data, opts = {}) {
        const { ctx, w, h } = setupCanvas(canvas);
        const { equityCurve = [], dates = [] } = data;

        if (equityCurve.length < 2) {
            drawEmptyState(ctx, w, h, 'Run a backtest to see equity curve');
            return;
        }

        const pad = { top: 20, right: 64, bottom: 36, left: 12 };
        const chartTop = pad.top;
        const chartHeight = h - pad.top - pad.bottom;
        const chartRight = w - pad.right;
        const chartWidth = chartRight - pad.left;

        // Clear
        ctx.fillStyle = THEME.bg;
        ctx.fillRect(0, 0, w, h);

        // Value range
        let minV = Math.min(...equityCurve);
        let maxV = Math.max(...equityCurve);
        const vRange = maxV - minV || 1;
        minV -= vRange * 0.05;
        maxV += vRange * 0.05;

        const toY = (v) => priceToY(v, minV, maxV, chartTop, chartHeight);
        const toX = (i) => pad.left + (i / (equityCurve.length - 1)) * chartWidth;

        // Grid
        drawGrid(ctx, minV, maxV, chartTop, chartHeight, pad.left, chartRight, w);

        // ── Compliance Watermark ──
        drawSandboxWatermark(ctx, pad.left + chartWidth / 2, chartTop + chartHeight / 2);

        // Date axis
        if (dates.length > 0) {
            const interval = Math.ceil(dates.length / 6);
            ctx.fillStyle = THEME.gridLabel;
            ctx.font = `9px ${THEME.fontMono}`;
            ctx.textAlign = 'center';
            dates.forEach((d, i) => {
                if (i % interval === 0 || i === dates.length - 1) {
                    ctx.fillText(formatShortDate(d), toX(i), h - pad.bottom + 18);
                }
            });
        }

        // Gradient fill
        const gradient = ctx.createLinearGradient(0, chartTop, 0, chartTop + chartHeight);
        gradient.addColorStop(0, 'rgba(212, 175, 55, 0.25)');
        gradient.addColorStop(1, 'rgba(212, 175, 55, 0.0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(equityCurve[0]));
        for (let i = 1; i < equityCurve.length; i++) {
            ctx.lineTo(toX(i), toY(equityCurve[i]));
        }
        ctx.lineTo(toX(equityCurve.length - 1), chartTop + chartHeight);
        ctx.lineTo(toX(0), chartTop + chartHeight);
        ctx.closePath();
        ctx.fill();

        // Main line with gradient stroke
        const lineGrad = ctx.createLinearGradient(pad.left, 0, chartRight, 0);
        lineGrad.addColorStop(0, THEME.goldDark);
        lineGrad.addColorStop(0.5, THEME.gold);
        lineGrad.addColorStop(1, THEME.goldLight);

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(equityCurve[0]));
        for (let i = 1; i < equityCurve.length; i++) {
            ctx.lineTo(toX(i), toY(equityCurve[i]));
        }
        ctx.stroke();

        // Glow dots on last two points
        const n = equityCurve.length;
        [n - 2, n - 1].forEach(idx => {
            if (idx < 0) return;
            const x = toX(idx);
            const y = toY(equityCurve[idx]);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = THEME.gold;
            ctx.fill();

            // Glow
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(212, 175, 55, 0.15)';
            ctx.fill();
        });

        // Peak marker
        const peakIdx = equityCurve.indexOf(Math.max(...equityCurve));
        if (peakIdx >= 0) {
            const px = toX(peakIdx);
            const py = toY(equityCurve[peakIdx]);
            ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px, chartTop + chartHeight);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = THEME.axisLabel;
            ctx.font = `9px ${THEME.fontSans}`;
            ctx.textAlign = 'center';
            ctx.fillText('PEAK', px, py - 6);
        }
    }

    /* ══════════════════════════════════════════════════════════
       3. DRAWDOWN CHART
       ══════════════════════════════════════════════════════════ */

    function renderDrawdownChart(canvas, data, opts = {}) {
        const { ctx, w, h } = setupCanvas(canvas);
        const { drawdownCurve = [], dates = [] } = data;

        if (drawdownCurve.length < 2) {
            drawEmptyState(ctx, w, h, 'Run a backtest to see drawdown');
            return;
        }

        const pad = { top: 16, right: 64, bottom: 36, left: 12 };
        const chartTop = pad.top;
        const chartHeight = h - pad.top - pad.bottom;
        const chartRight = w - pad.right;
        const chartWidth = chartRight - pad.left;

        ctx.fillStyle = THEME.bg;
        ctx.fillRect(0, 0, w, h);

        const maxDD = Math.max(...drawdownCurve) || 1;
        const ceiling = maxDD * 1.15;

        const toY = (v) => chartTop + (v / ceiling) * chartHeight;
        const toX = (i) => pad.left + (i / (drawdownCurve.length - 1)) * chartWidth;

        // Grid (inverted — 0% at top, maxDD at bottom)
        const gridSteps = 4;
        ctx.strokeStyle = THEME.gridLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.fillStyle = THEME.gridLabel;
        ctx.font = `10px ${THEME.fontMono}`;
        ctx.textAlign = 'right';

        for (let i = 0; i <= gridSteps; i++) {
            const pct = (ceiling / gridSteps) * i;
            const y = toY(pct);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(chartRight, y);
            ctx.stroke();
            ctx.fillText('-' + pct.toFixed(1) + '%', w - 4, y + 4);
        }
        ctx.setLineDash([]);

        // ── Compliance Watermark ──
        drawSandboxWatermark(ctx, pad.left + chartWidth / 2, chartTop + chartHeight / 2);

        // Date axis
        if (dates.length > 0) {
            const interval = Math.ceil(dates.length / 6);
            ctx.fillStyle = THEME.gridLabel;
            ctx.font = `9px ${THEME.fontMono}`;
            ctx.textAlign = 'center';
            dates.forEach((d, i) => {
                if (i % interval === 0 || i === dates.length - 1) {
                    ctx.fillText(formatShortDate(d), toX(i), h - pad.bottom + 18);
                }
            });
        }

        // Area fill
        const gradient = ctx.createLinearGradient(0, chartTop, 0, chartTop + chartHeight);
        gradient.addColorStop(0, 'rgba(30, 30, 30, 0.1)');
        gradient.addColorStop(1, 'rgba(212, 175, 55, 0.20)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(toX(0), chartTop);
        for (let i = 0; i < drawdownCurve.length; i++) {
            ctx.lineTo(toX(i), toY(drawdownCurve[i]));
        }
        ctx.lineTo(toX(drawdownCurve.length - 1), chartTop);
        ctx.closePath();
        ctx.fill();

        // Line
        ctx.strokeStyle = THEME.gold;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < drawdownCurve.length; i++) {
            const x = toX(i);
            const y = toY(drawdownCurve[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Max-drawdown marker
        const maxIdx = drawdownCurve.indexOf(Math.max(...drawdownCurve));
        if (maxIdx >= 0) {
            const mx = toX(maxIdx);
            const my = toY(drawdownCurve[maxIdx]);

            ctx.beginPath();
            ctx.arc(mx, my, 5, 0, Math.PI * 2);
            ctx.fillStyle = THEME.gold;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(mx, my, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(212, 175, 55, 0.15)';
            ctx.fill();

            // Label
            ctx.fillStyle = THEME.loss;
            ctx.font = `bold 10px ${THEME.fontMono}`;
            ctx.textAlign = 'center';
            ctx.fillText('-' + drawdownCurve[maxIdx].toFixed(2) + '%', mx, my + 18);

            ctx.fillStyle = THEME.axisLabel;
            ctx.font = `9px ${THEME.fontSans}`;
            ctx.fillText('MAX DD', mx, my + 30);
        }
    }

    /* ── Empty state placeholder ── */

    function drawEmptyState(ctx, w, h, message) {
        ctx.fillStyle = THEME.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = THEME.textMuted;
        ctx.font = `13px ${THEME.fontSans}`;
        ctx.textAlign = 'center';
        ctx.fillText(message, w / 2, h / 2);
    }

    /* ══════════════════════════════════════════════════════════
       4. INTERACTIVE CROSSHAIR TOOLTIP
       ══════════════════════════════════════════════════════════ */

    /**
     * Attach a mousemove crosshair to a candlestick canvas.
     * Returns a cleanup function to remove the listener.
     *
     * @param {HTMLCanvasElement} canvas
     * @param {Array}            candles
     * @param {HTMLElement}       tooltipEl — a pre-existing tooltip div
     * @returns {Function} detach
     */
    function attachCrosshair(canvas, candles, tooltipEl) {
        if (!canvas || !candles || candles.length === 0 || !tooltipEl) return () => {};

        const pad = { top: 16, right: 64, bottom: 40, left: 12 };

        function onMove(e) {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const chartRight = rect.width - pad.right;
            const chartWidth = chartRight - pad.left;
            const gap = chartWidth / candles.length;

            const idx = Math.floor((mx - pad.left) / gap);
            if (idx < 0 || idx >= candles.length) {
                tooltipEl.style.display = 'none';
                return;
            }

            const c = candles[idx];
            tooltipEl.innerHTML = `
                <div class="tt-date">${c.date}</div>
                <div class="tt-row"><span>O</span><span>₺${c.open.toFixed(2)}</span></div>
                <div class="tt-row"><span>H</span><span>₺${c.high.toFixed(2)}</span></div>
                <div class="tt-row"><span>L</span><span>₺${c.low.toFixed(2)}</span></div>
                <div class="tt-row"><span>C</span><span class="${c.close >= c.open ? 'tt-up' : 'tt-down'}">₺${c.close.toFixed(2)}</span></div>
                <div class="tt-row"><span>Vol</span><span>${formatVolShort(c.volume)}</span></div>
            `;

            tooltipEl.style.display = 'block';

            // Position: right of cursor, clamp to viewport
            let tx = e.clientX - rect.left + 16;
            let ty = e.clientY - rect.top - 20;
            if (tx + 140 > rect.width) tx = e.clientX - rect.left - 150;
            if (ty < 0) ty = 4;
            tooltipEl.style.left = tx + 'px';
            tooltipEl.style.top = ty + 'px';
        }

        function onLeave() {
            tooltipEl.style.display = 'none';
        }

        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseleave', onLeave);

        return () => {
            canvas.removeEventListener('mousemove', onMove);
            canvas.removeEventListener('mouseleave', onLeave);
        };
    }

    function formatVolShort(vol) {
        if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + 'B';
        if (vol >= 1_000_000)     return (vol / 1_000_000).toFixed(1) + 'M';
        if (vol >= 1_000)         return (vol / 1_000).toFixed(1) + 'K';
        return vol.toString();
    }

    /* ══════════════════════════════════════════════════════════
       5. SIGNAL GENERATOR (SMA crossover based)
       ══════════════════════════════════════════════════════════ */

    /**
     * Generate trading signal markers matching stock-specific strategies.
     * Maps trades directly to BUY and SELL signals for consistency.
     * Places HOLD signals periodically during active holdings,
     * and DATA_ERROR signals for severe volume drop anomalies.
     *
     * @param {Array} candles
     * @param {Object} indicators
     * @param {Array} trades
     * @param {string} ticker
     * @returns {Array<{index:number, type:string, label:string}>}
     */
    function generateSignals(candles, indicators, trades, ticker) {
        const signals = [];
        if (!candles || candles.length === 0) return signals;

        const avgVol = candles.reduce((s, c) => s + c.volume, 0) / candles.length;

        // Map date to index
        const dateToIndex = {};
        candles.forEach((c, idx) => {
            dateToIndex[c.date] = idx;
        });

        // 1. Map trades to BUY and SELL signals
        if (trades) {
            trades.forEach(trade => {
                const entryIdx = dateToIndex[trade.entryDate];
                const exitIdx = dateToIndex[trade.exitDate];

                if (entryIdx !== undefined) {
                    signals.push({
                        index: entryIdx,
                        type: SIGNAL.BUY,
                        label: ticker === 'THYAO' ? 'EMA20 BUY' :
                               ticker === 'ASELS' ? 'BOUNCE BUY' :
                               ticker === 'BIMAS' ? 'CHAN BUY' :
                               ticker === 'TUPRS' ? 'BREAK BUY' :
                               'EMA50 BUY'
                    });
                }

                if (exitIdx !== undefined) {
                    signals.push({
                        index: exitIdx,
                        type: SIGNAL.SELL,
                        label: trade.forceExit ? 'FORCE EXIT' : (
                               ticker === 'THYAO' ? 'RSI SELL' :
                               ticker === 'ASELS' ? 'RES SELL' :
                               ticker === 'BIMAS' ? 'CHAN SELL' :
                               ticker === 'TUPRS' ? (trade.pnl < 0 ? 'STOP LOSS' : 'RES SELL') :
                               'TARGET SELL'
                        )
                    });
                }
            });
        }

        // 2. Add HOLD signals during active positions
        if (trades) {
            trades.forEach(trade => {
                const entryIdx = dateToIndex[trade.entryDate];
                const exitIdx = dateToIndex[trade.exitDate];
                if (entryIdx !== undefined && exitIdx !== undefined) {
                    // Place HOLD every 6 candles between entry and exit
                    for (let i = entryIdx + 6; i < exitIdx; i += 6) {
                        signals.push({
                            index: i,
                            type: SIGNAL.HOLD,
                            label: 'HOLDING'
                        });
                    }
                }
            });
        }

        // 3. Add DATA ERROR signals for volume anomalies (<10% of avg volume)
        candles.forEach((c, i) => {
            if (c.volume < avgVol * 0.1) {
                const exists = signals.some(s => s.index === i);
                if (!exists) {
                    signals.push({
                        index: i,
                        type: SIGNAL.ERROR,
                        label: 'VOL ERR'
                    });
                }
            }
        });

        // Sort signals by index
        signals.sort((a, b) => a.index - b.index);
        return signals;
    }

    /* ────────── Public API ────────── */

    return Object.freeze({
        SIGNAL,
        renderCandlestickChart,
        renderEquityCurve,
        renderDrawdownChart,
        attachCrosshair,
        generateSignals,
        setupCanvas
    });
})();

window.ChartRenderer = ChartRenderer;
