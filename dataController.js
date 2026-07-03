/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB DATA CONTROLLER MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Self-contained, framework-free data layer for the OptiPulseLab dashboard.
 *
 * Architecture:
 *   1. OHLCVGenerator  — deterministic pseudo-random 30-day OHLCV for 5 BIST stocks
 *   2. StrategyEngine   — SMA-crossover dummy strategy producing a trade list
 *   3. MetricsCalculator — Net Profit, Max Drawdown, Sharpe Ratio, Win Rate
 *   4. ChartPathBuilder — SVG path strings from equity / drawdown curves
 *
 * All functions are pure; no DOM access. The public API is exposed via
 * window.DataController so app.js can consume it without bundler imports.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const DataController = (() => {

    /* ──────────────── Constants ──────────────── */
    const TRADING_DAYS = 30;
    const ANNUALIZE_FACTOR = 252;               // trading days / year
    const RISK_FREE_DAILY = 0.05 / ANNUALIZE_FACTOR; // ~5 % annual risk-free

    /* Stock universe with realistic BIST parameters (TRY-denominated) */
    const STOCK_PROFILES = {
        THYAO: { name: 'Türk Hava Yolları',   sector: 'Havacılık',    basePrice: 293.50, volatility: 0.022, drift: 0.0008, avgVolume: 48_000_000 },
        ASELS: { name: 'ASELSAN',              sector: 'Savunma',      basePrice: 57.40,  volatility: 0.018, drift: 0.0006, avgVolume: 62_000_000 },
        BIMAS: { name: 'BİM Mağazalar',        sector: 'Perakende',    basePrice: 570.00, volatility: 0.014, drift: 0.0004, avgVolume: 3_200_000  },
        TUPRS: { name: 'Tüpraş',               sector: 'Enerji',       basePrice: 172.30, volatility: 0.020, drift: 0.0005, avgVolume: 7_500_000  },
        AKBNK: { name: 'Akbank',               sector: 'Bankacılık',   basePrice: 56.90,  volatility: 0.019, drift: 0.0007, avgVolume: 120_000_000 }
    };

    /* ──────────────── Seeded PRNG (Mulberry32) ──────────────── */
    function mulberry32(seed) {
        return () => {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    /** Box-Muller transform: 2 uniform → 1 normal */
    function normalRandom(rng) {
        let u1, u2;
        do { u1 = rng(); } while (u1 === 0);
        u2 = rng();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    /* ──────────────── 1. OHLCV Generator ──────────────── */

    /**
     * Generate deterministic 30-day OHLCV candles for a given ticker.
     * @param {string} ticker  — one of the STOCK_PROFILES keys
     * @param {number} [days]  — number of trading days (default 30)
     * @returns {Array<{date:string, open:number, high:number, low:number, close:number, volume:number}>}
     */
    function generateOHLCV(ticker, days = TRADING_DAYS) {
        const profile = STOCK_PROFILES[ticker];
        if (!profile) throw new Error(`Unknown ticker: ${ticker}`);

        // Seed by ticker hash so each stock is reproducible but distinct
        const seed = Array.from(ticker).reduce((s, c) => s * 31 + c.charCodeAt(0), 0);
        const rng = mulberry32(seed);

        const candles = [];
        let prevClose = profile.basePrice;
        const startDate = new Date('2026-06-01T00:00:00');

        for (let i = 0; i < days; i++) {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + i);
            // Skip weekends
            if (date.getDay() === 0 || date.getDay() === 6) {
                days++;        // extend iteration so we get 30 *trading* days
                continue;
            }

            const dailyReturn = profile.drift + profile.volatility * normalRandom(rng);
            const open  = +(prevClose * (1 + (rng() - 0.5) * 0.003)).toFixed(2);
            const close = +(open * (1 + dailyReturn)).toFixed(2);

            const intraRange = Math.abs(close - open) + profile.volatility * prevClose * rng();
            const high = +(Math.max(open, close) + intraRange * 0.5 * rng()).toFixed(2);
            const low  = +(Math.min(open, close) - intraRange * 0.5 * rng()).toFixed(2);

            const volumeNoise = 0.7 + rng() * 0.6;   // ±30 %
            const volume = Math.round(profile.avgVolume * volumeNoise);

            candles.push({
                date: date.toISOString().slice(0, 10),
                open, high, low, close, volume
            });

            prevClose = close;
        }

        return candles;
    }

    /**
     * Generate OHLCV data for ALL tickers in the stock universe.
     * @returns {Object<string, Array>}
     */
    function generateAllOHLCV() {
        const result = {};
        for (const ticker of Object.keys(STOCK_PROFILES)) {
            result[ticker] = generateOHLCV(ticker);
        }
        return result;
    }

    /* ──────────────── 2. Strategy Engine (SMA Crossover) ──────────────── */

    /**
     * Compute Simple Moving Average of `close` prices.
     * @param {number[]} closes
     * @param {number}   period
     * @returns {(number|null)[]}
     */
    function computeSMA(closes, period) {
        const sma = [];
        for (let i = 0; i < closes.length; i++) {
            if (i < period - 1) { sma.push(null); continue; }
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += closes[j];
            sma.push(+(sum / period).toFixed(4));
        }
        return sma;
    }

    /**
     * Compute Exponential Moving Average.
     */
    function computeEMA(values, period) {
        const ema = [];
        const k = 2 / (period + 1);
        let prevEma = null;
        for (let i = 0; i < values.length; i++) {
            if (i < period - 1) {
                ema.push(null);
            } else if (i === period - 1) {
                let sum = 0;
                for (let j = 0; j < period; j++) {
                    sum += values[j];
                }
                prevEma = sum / period;
                ema.push(+prevEma.toFixed(4));
            } else {
                prevEma = values[i] * k + prevEma * (1 - k);
                ema.push(+prevEma.toFixed(4));
            }
        }
        return ema;
    }

    /**
     * Compute Relative Strength Index using Wilder's smoothing technique.
     */
    function computeRSI(closes, period = 14) {
        const rsi = [];
        if (closes.length <= period) {
            return Array(closes.length).fill(null);
        }
        for (let i = 0; i < period; i++) {
            rsi.push(null);
        }
        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) {
                avgGain += change;
            } else {
                avgLoss -= change;
            }
        }
        avgGain /= period;
        avgLoss /= period;
        
        let rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        let firstRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
        rsi.push(+firstRsi.toFixed(4));

        for (let i = period + 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
            const val = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
            rsi.push(+val.toFixed(4));
        }
        return rsi;
    }

    /**
     * Compute rolling minimum of lows of previous period.
     */
    function computeSupport(candles, period = 15) {
        const support = [];
        for (let i = 0; i < candles.length; i++) {
            if (i < period) {
                support.push(null);
                continue;
            }
            let minLow = Infinity;
            for (let j = i - period; j <= i - 1; j++) {
                if (candles[j].low < minLow) {
                    minLow = candles[j].low;
                }
            }
            support.push(minLow);
        }
        return support;
    }

    /**
     * Compute rolling maximum of highs of previous period.
     */
    function computeResistance(candles, period = 15) {
        const resistance = [];
        for (let i = 0; i < candles.length; i++) {
            if (i < period) {
                resistance.push(null);
                continue;
            }
            let maxHigh = -Infinity;
            for (let j = i - period; j <= i - 1; j++) {
                if (candles[j].high > maxHigh) {
                    maxHigh = candles[j].high;
                }
            }
            resistance.push(maxHigh);
        }
        return resistance;
    }

    /**
     * Run ticker-specific trading strategy over OHLCV candles.
     *
     * @param {string} ticker          — target stock symbol
     * @param {Array}  candles         — from generateOHLCV
     * @param {number} initialCapital  — starting TRY
     * @param {number} commissionPct   — e.g. 0.05 means 0.05 %
     * @param {string} engine          — backtesting engine
     * @returns {{trades: Array, equityCurve: number[], dailyReturns: number[]}}
     */
    function runStrategy(ticker, candles, initialCapital = 100_000, commissionPct = 0.05, engine = 'optipulse') {
        let adjustedComm = commissionPct;
        let ema20Period = 20;
        let ema50Period = 50;
        let rsiPeriod = 14;
        let supResPeriod = 15;
        let targetPct = 1.08;
        let stopPct = 0.95;
        let volMult = 1.3;
        let bbPeriod = 20;

        if (engine === 'backtrader') {
            adjustedComm = commissionPct + 0.02;
            ema20Period = 25;
            ema50Period = 60;
            rsiPeriod = 16;
            supResPeriod = 20;
            targetPct = 1.06;
            stopPct = 0.96;
            volMult = 1.4;
            bbPeriod = 24;
        } else if (engine === 'custom') {
            adjustedComm = commissionPct + 0.05;
            ema20Period = 30;
            ema50Period = 75;
            rsiPeriod = 12;
            supResPeriod = 12;
            targetPct = 1.05;
            stopPct = 0.97;
            volMult = 1.2;
            bbPeriod = 15;
        }

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const volumes = candles.map(c => c.volume);
        const opens = candles.map(c => c.open);
        const ema20 = computeEMA(closes, ema20Period);
        const ema50 = computeEMA(closes, ema50Period);
        const rsi = computeRSI(closes, rsiPeriod);
        const support = computeSupport(candles, supResPeriod);
        const resistance = computeResistance(candles, supResPeriod);

        // Calculate Bollinger Lower and Upper bands locally
        const smaBB = computeSMA(closes, bbPeriod);
        const bbUpper = [];
        const bbLower = [];
        for (let idx = 0; idx < closes.length; idx++) {
            if (idx < bbPeriod - 1) {
                bbUpper.push(null);
                bbLower.push(null);
            } else {
                const mean = smaBB[idx];
                let sumSq = 0;
                for (let j = idx - bbPeriod + 1; j <= idx; j++) {
                    const diff = closes[j] - mean;
                    sumSq += diff * diff;
                }
                const stddev = Math.sqrt(sumSq / bbPeriod);
                bbUpper.push(+(mean + 2 * stddev).toFixed(4));
                bbLower.push(+(mean - 2 * stddev).toFixed(4));
            }
        }

        const trades = [];
        const equityCurve = [];
        let cash = initialCapital;
        let position = null;       // { shares, entryPrice, entryDate, entryIndex }

        const commRate = adjustedComm / 100;

        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];
            const portfolioValue = position
                ? cash + position.shares * candle.close
                : cash;

            equityCurve.push(+portfolioValue.toFixed(2));

            if (i < 1) continue;

            let buySignal = false;
            let sellSignal = false;

            if (ticker === 'THYAO') {
                if (ema20[i - 1] !== null && ema20[i] !== null) {
                    buySignal = closes[i] > ema20[i] && closes[i - 1] <= ema20[i - 1];
                }
                if (rsi[i] !== null) {
                    sellSignal = rsi[i] > 70;
                }
            } else if (ticker === 'ASELS') {
                if (support[i] !== null) {
                    buySignal = lows[i] <= support[i] * 1.005 && closes[i] > opens[i];
                }
                if (resistance[i] !== null) {
                    sellSignal = highs[i] >= resistance[i] * 0.995;
                }
            } else if (ticker === 'BIMAS') {
                if (bbLower[i] !== null) {
                    buySignal = closes[i] < bbLower[i];
                }
                if (bbUpper[i] !== null) {
                    sellSignal = closes[i] > bbUpper[i];
                }
            } else if (ticker === 'TUPRS') {
                if (resistance[i - 1] !== null && resistance[i] !== null && i >= supResPeriod) {
                    let volSum = 0;
                    for (let j = i - supResPeriod; j <= i - 1; j++) {
                        volSum += volumes[j];
                    }
                    const avgVol = volSum / supResPeriod;
                    buySignal = closes[i] > resistance[i] && closes[i - 1] <= resistance[i - 1] && volumes[i] > volMult * avgVol;
                }
                if (position) {
                    const stopLossHit = closes[i] <= position.entryPrice * stopPct;
                    const resistanceHit = resistance[i] !== null && highs[i] >= resistance[i] * 0.995;
                    sellSignal = stopLossHit || resistanceHit;
                }
            } else if (ticker === 'AKBNK') {
                if (ema50[i - 1] !== null && ema50[i] !== null) {
                    buySignal = closes[i] > ema50[i] && closes[i - 1] <= ema50[i - 1];
                }
                if (position) {
                    sellSignal = closes[i] >= position.entryPrice * targetPct;
                }
            }

            if (buySignal && !position) {
                const price = candle.close;
                const commission = price * commRate;
                const costPerShare = price + commission;
                const shares = Math.floor(cash / costPerShare);
                if (shares > 0) {
                    const totalCost = shares * costPerShare;
                    cash -= totalCost;
                    position = { shares, entryPrice: price, entryDate: candle.date, entryIndex: i };
                }
            } else if (sellSignal && position) {
                const price = candle.close;
                const commission = price * commRate;
                const revenue = position.shares * (price - commission);
                cash += revenue;

                const pnl = revenue - position.shares * (position.entryPrice + position.entryPrice * commRate);
                let minLowDuringTrade = position.entryPrice;
                for (let k = position.entryIndex; k <= i; k++) {
                    if (lows[k] !== undefined && lows[k] !== null && lows[k] < minLowDuringTrade) {
                        minLowDuringTrade = lows[k];
                    }
                }
                const maeVal = ((position.entryPrice - minLowDuringTrade) / position.entryPrice) * 100;
                trades.push({
                    entryDate: position.entryDate,
                    exitDate: candle.date,
                    type: 'BUY',
                    shares: position.shares,
                    entryPrice: position.entryPrice,
                    exitPrice: price,
                    pnl: +pnl.toFixed(2),
                    holdingDays: i - position.entryIndex,
                    mae: +maeVal.toFixed(4)
                });

                position = null;
            }
        }

        // Close any open position at end-of-period at last close
        if (position && candles.length > 0) {
            const lastCandle = candles[candles.length - 1];
            const price = lastCandle.close;
            const commission = price * commRate;
            const revenue = position.shares * (price - commission);
            cash += revenue;

            const pnl = revenue - position.shares * (position.entryPrice + position.entryPrice * commRate);
            let minLowDuringTrade = position.entryPrice;
            for (let k = position.entryIndex; k < candles.length; k++) {
                if (lows[k] !== undefined && lows[k] !== null && lows[k] < minLowDuringTrade) {
                    minLowDuringTrade = lows[k];
                }
            }
            const maeVal = ((position.entryPrice - minLowDuringTrade) / position.entryPrice) * 100;
            trades.push({
                entryDate: position.entryDate,
                exitDate: lastCandle.date,
                type: 'BUY',
                shares: position.shares,
                entryPrice: position.entryPrice,
                exitPrice: price,
                pnl: +pnl.toFixed(2),
                holdingDays: candles.length - 1 - position.entryIndex,
                forceExit: true,
                mae: +maeVal.toFixed(4)
            });
            position = null;

            if (equityCurve.length > 0) {
                equityCurve[equityCurve.length - 1] = +cash.toFixed(2);
            }
        }

        // Compute daily log-returns from equity curve
        const dailyReturns = [];
        for (let i = 1; i < equityCurve.length; i++) {
            if (equityCurve[i - 1] === 0) { dailyReturns.push(0); continue; }
            dailyReturns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
        }

        return { trades, equityCurve, dailyReturns };
    }

    /* ──────────────── 3. Metrics Calculator ──────────────── */

    /**
     * Compute strategy performance metrics from strategy output.
     *
     * @param {{trades:Array, equityCurve:number[], dailyReturns:number[]}} strategyResult
     * @param {number} initialCapital
     * @returns {{netProfit:number, netProfitPct:number, maxDrawdown:number, maxDrawdownPct:number,
     *            sharpeRatio:number, winRate:number, wins:number, losses:number, totalTrades:number,
     *            profitFactor:number, avgHoldingDays:number, bestTrade:number, worstTrade:number,
     *            finalEquity:number, peakEquity:number}}
     */
    function calculateMetrics(strategyResult, initialCapital = 100_000) {
        const { trades, equityCurve, dailyReturns } = strategyResult;

        const maes = trades.map(t => t.mae || 0);
        const maxMae = maes.length > 0 ? Math.max(...maes) : 0;

        // --- Net Profit ---
        const finalEquity = equityCurve[equityCurve.length - 1] || initialCapital;
        const netProfit = +(finalEquity - initialCapital).toFixed(2);
        const netProfitPct = +((netProfit / initialCapital) * 100).toFixed(2);

        // --- Max Drawdown ---
        let peak = -Infinity;
        let maxDD = 0;
        let maxDDPct = 0;
        const drawdownCurve = [];

        for (let i = 0; i < equityCurve.length; i++) {
            const val = equityCurve[i];
            if (val > peak) peak = val;
            const dd = peak - val;
            const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
            if (dd > maxDD) { maxDD = dd; maxDDPct = ddPct; }
            drawdownCurve.push(+ddPct.toFixed(2));
        }

        // --- Sharpe Ratio (annualized) ---
        let sharpeRatio = 0;
        if (dailyReturns.length > 1) {
            const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
            const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
            const stdDev = Math.sqrt(variance);
            sharpeRatio = stdDev > 0
                ? +((mean - RISK_FREE_DAILY) / stdDev * Math.sqrt(ANNUALIZE_FACTOR)).toFixed(2)
                : 0;
        }

        // --- Win Rate ---
        const wins   = trades.filter(t => t.pnl > 0).length;
        const losses = trades.filter(t => t.pnl <= 0).length;
        const totalTrades = trades.length;
        const winRate = totalTrades > 0 ? +((wins / totalTrades) * 100).toFixed(1) : 0;

        // --- Profit Factor ---
        const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
        const grossLoss   = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
        const profitFactor = grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? Infinity : 0);

        // --- Auxiliary ---
        const avgHoldingDays = totalTrades > 0
            ? +(trades.reduce((s, t) => s + t.holdingDays, 0) / totalTrades).toFixed(1)
            : 0;
        const bestTrade  = totalTrades > 0 ? Math.max(...trades.map(t => t.pnl)) : 0;
        const worstTrade = totalTrades > 0 ? Math.min(...trades.map(t => t.pnl)) : 0;

        return {
            netProfit,
            netProfitPct,
            maxDrawdown: +maxDD.toFixed(2),
            maxDrawdownPct: +maxDDPct.toFixed(2),
            sharpeRatio,
            winRate,
            wins,
            losses,
            totalTrades,
            profitFactor,
            avgHoldingDays,
            bestTrade: +bestTrade.toFixed(2),
            worstTrade: +worstTrade.toFixed(2),
            maxMae: +maxMae.toFixed(2),
            finalEquity: +finalEquity.toFixed(2),
            peakEquity: +peak.toFixed(2),
            drawdownCurve
        };
    }

    /**
     * Compute a comprehensive set of technical indicators from OHLCV candles.
     *
     * @param {Array} candles — array of {open, high, low, close, volume} objects
     * @returns {{
     *   sma20: (number|null)[],
     *   sma50: (number|null)[],
     *   sma200: (number|null)[],
     *   bollingerUpper: (number|null)[],
     *   bollingerMiddle: (number|null)[],
     *   bollingerLower: (number|null)[],
     *   vwap: number[]
     * }}
     */
    function calculateIndicators(candles) {
        const closes = candles.map(c => c.close);

        // --- Simple Moving Averages ---
        const sma20  = computeSMA(closes, 20);
        const sma50  = computeSMA(closes, 50);
        const sma200 = computeSMA(closes, 200);

        // --- Bollinger Bands (20-period, 2 std-dev) ---
        const bbPeriod = 20;
        const bbMult   = 2;
        const bollingerUpper  = [];
        const bollingerMiddle = sma20;          // alias
        const bollingerLower  = [];

        for (let i = 0; i < closes.length; i++) {
            if (i < bbPeriod - 1) {
                bollingerUpper.push(null);
                bollingerLower.push(null);
                continue;
            }
            // rolling standard deviation over the window
            const mean = sma20[i];              // already computed
            let sumSq = 0;
            for (let j = i - bbPeriod + 1; j <= i; j++) {
                const diff = closes[j] - mean;
                sumSq += diff * diff;
            }
            const stddev = Math.sqrt(sumSq / bbPeriod);
            bollingerUpper.push(+(mean + bbMult * stddev).toFixed(4));
            bollingerLower.push(+(mean - bbMult * stddev).toFixed(4));
        }

        // --- Cumulative VWAP ---
        const vwap = [];
        let cumTPV = 0;   // cumulative (typicalPrice × volume)
        let cumVol = 0;   // cumulative volume

        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            const tp = (c.high + c.low + c.close) / 3;
            cumTPV += tp * c.volume;
            cumVol += c.volume;
            vwap.push(+(cumTPV / cumVol).toFixed(4));
        }

        return { sma20, sma50, sma200, bollingerUpper, bollingerMiddle, bollingerLower, vwap };
    }

    /* ──────────────── 4. SVG Path Builder ──────────────── */

    /**
     * Convert a numeric series into an SVG polyline path string.
     * The path is normalized to fit within 0..800 (x) and minY..maxY (y).
     *
     * @param {number[]} series    — the values (e.g. equity curve)
     * @param {number}   [width]   — SVG viewBox width  (default 800)
     * @param {number}   [height]  — SVG viewBox height (default 280)
     * @param {number}   [padTop]  — top padding in SVG units
     * @param {number}   [padBot]  — bottom padding in SVG units
     * @returns {{linePath:string, areaPath:string}}
     */
    function buildSvgPath(series, width = 800, height = 280, padTop = 15, padBot = 20) {
        if (!series || series.length < 2) {
            return {
                linePath: `M 0 ${height / 2} L ${width} ${height / 2}`,
                areaPath: `M 0 ${height / 2} L ${width} ${height / 2} L ${width} ${height} L 0 ${height} Z`
            };
        }

        const min = Math.min(...series);
        const max = Math.max(...series);
        const range = max - min || 1;
        const usableHeight = height - padTop - padBot;
        const step = width / (series.length - 1);

        const points = series.map((val, i) => {
            const x = +(i * step).toFixed(1);
            // Invert Y: higher value = lower y-coordinate
            const y = +(padTop + usableHeight * (1 - (val - min) / range)).toFixed(1);
            return { x, y };
        });

        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const areaPath = linePath + ` L ${width} ${height} L 0 ${height} Z`;

        return { linePath, areaPath };
    }

    /**
     * Build a drawdown SVG path. Drawdown percentages are flipped
     * so higher drawdown → lower on the chart.
     */
    function buildDrawdownSvgPath(ddCurve, width = 800, height = 280) {
        if (!ddCurve || ddCurve.length < 2) {
            return {
                linePath: `M 0 0 L ${width} 0`,
                areaPath: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`
            };
        }

        const maxDD = Math.max(...ddCurve) || 1;
        const step = width / (ddCurve.length - 1);
        const padTop = 10;
        const usable = height - padTop - 10;

        const points = ddCurve.map((val, i) => {
            const x = +(i * step).toFixed(1);
            const y = +(padTop + (val / maxDD) * usable).toFixed(1);
            return { x, y };
        });

        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const areaPath = linePath + ` L ${width} ${height} L 0 ${height} Z`;

        return { linePath, areaPath };
    }

    /* ──────────────── 5. Candlestick SVG Builder ──────────────── */

    /**
     * Build SVG elements string for candlestick chart from OHLCV data.
     * @param {Array} candles
     * @param {number} width
     * @param {number} height
     * @returns {string} SVG inner HTML
     */
    function buildCandlestickSvg(candles, width = 800, height = 280) {
        if (!candles || candles.length === 0) return '';

        const pad = { top: 15, bottom: 20, left: 10, right: 10 };
        const usableW = width - pad.left - pad.right;
        const usableH = height - pad.top - pad.bottom;

        const allPrices = candles.flatMap(c => [c.high, c.low]);
        const priceMin = Math.min(...allPrices);
        const priceMax = Math.max(...allPrices);
        const priceRange = priceMax - priceMin || 1;

        const candleWidth = Math.max(2, (usableW / candles.length) * 0.6);
        const gap = usableW / candles.length;

        const toY = (price) => +(pad.top + usableH * (1 - (price - priceMin) / priceRange)).toFixed(1);

        let svg = '';

        // Grid lines
        for (let i = 1; i <= 4; i++) {
            const y = +(pad.top + (usableH / 5) * i).toFixed(1);
            svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#2A2A2A" stroke-width="1" stroke-dasharray="4 4" />`;
        }

        // Moving average line (SMA 5)
        const closes = candles.map(c => c.close);
        const sma5 = computeSMA(closes, 5);
        const maPoints = [];
        sma5.forEach((val, i) => {
            if (val === null) return;
            const x = +(pad.left + i * gap + gap / 2).toFixed(1);
            const y = toY(val);
            maPoints.push(`${maPoints.length === 0 ? 'M' : 'L'} ${x} ${y}`);
        });
        if (maPoints.length > 1) {
            svg += `<path d="${maPoints.join(' ')}" fill="none" stroke="#FFF" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.5" />`;
        }

        // Candles
        candles.forEach((c, i) => {
            const x = +(pad.left + i * gap + gap / 2).toFixed(1);
            const yHigh = toY(c.high);
            const yLow  = toY(c.low);
            const yOpen = toY(c.open);
            const yClose = toY(c.close);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1, Math.abs(yOpen - yClose));
            const isUp = c.close >= c.open;

            // Wick
            svg += `<line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="#D4AF37" stroke-width="1.5" />`;
            // Body
            svg += `<rect x="${+(x - candleWidth / 2).toFixed(1)}" y="${bodyTop}" width="${candleWidth.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${isUp ? '#D4AF37' : 'none'}" stroke="#D4AF37" stroke-width="${isUp ? '1' : '2'}" rx="1" />`;
        });

        return svg;
    }

    /* ──────────────── 6. Full Pipeline ──────────────── */

    /**
     * Run the entire pipeline for a single ticker:
     *   OHLCV → Strategy → Metrics → SVG Paths
     *
     * @param {string} ticker
     * @param {number} initialCapital
     * @param {number} commissionPct
     * @param {string} engine
     * @returns {Object}  — everything the UI needs
     */
    function runPipeline(ticker, initialCapital = 100_000, commissionPct = 0.05, engine = 'optipulse') {
        const profile = STOCK_PROFILES[ticker];
        const candles = generateOHLCV(ticker);
        const stratResult = runStrategy(ticker, candles, initialCapital, commissionPct, engine);
        const metrics = calculateMetrics(stratResult, initialCapital);

        const equityPaths = buildSvgPath(stratResult.equityCurve);
        const drawdownPaths = buildDrawdownSvgPath(metrics.drawdownCurve);
        const candlestickSvg = buildCandlestickSvg(candles);

        // Last candle stats
        const lastCandle = candles[candles.length - 1];
        const totalVolume = candles.reduce((s, c) => s + c.volume, 0);

        return {
            ticker,
            engine,
            profile,
            candles,
            trades: stratResult.trades,
            equityCurve: stratResult.equityCurve,
            metrics,
            svg: {
                equityLine: equityPaths.linePath,
                equityArea: equityPaths.areaPath,
                drawdownLine: drawdownPaths.linePath,
                drawdownArea: drawdownPaths.areaPath,
                candlestick: candlestickSvg
            },
            summary: {
                lastPrice: lastCandle ? lastCandle.close : 0,
                totalVolume,
                peakEquity: metrics.peakEquity,
                currentEquity: metrics.finalEquity
            }
        };
    }

    /**
     * Polls the backend status endpoint for a given task_id until completed.
     * Uses console.log for step-by-step audit debugging.
     *
     * @param {string} taskId
     * @param {function} callback
     */
    function pollBacktestStatus(taskId, callback) {
        console.log(`[DataController] Initiating polling for task_id: ${taskId}`);
        const intervalId = setInterval(() => {
            console.log(`[DataController] Polling task status: ${taskId}`);
            fetch(`https://optipulse-backend-production.up.railway.app/api/v1/backtest/status/${taskId}`)
                .then(res => {
                    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
                    return res.json();
                })
                .then(data => {
                    console.log(`[DataController] Received status response for ${taskId}:`, data);
                    if (data.status === 'completed') {
                        clearInterval(intervalId);
                        console.log(`[DataController] Backtest completed successfully for task_id: ${taskId}`);
                        callback(null, data);
                    } else if (data.status === 'failed') {
                        clearInterval(intervalId);
                        console.error(`[DataController] Backtest failed for task_id: ${taskId}`);
                        callback(new Error('Backtest failed on server'), null);
                    }
                })
                .catch(err => {
                    console.error(`[DataController] Polling error for task_id: ${taskId}:`, err);
                });
        }, 1000);
    }

    let ohlcvPollIntervalId = null;
    let isFetchingOhlcv = false;

    /**
     * Polls the backend ohlcv endpoint for a given ticker every 10 seconds,
     * protecting against overlapping requests using an isFetching flag.
     *
     * @param {string} ticker
     * @param {function} onData
     * @param {function} onError
     */
    function startOhlcvPolling(ticker, onData, onError) {
        if (ohlcvPollIntervalId) {
            console.log(`[DataController] Clearing existing OHLCV polling`);
            clearInterval(ohlcvPollIntervalId);
        }

        console.log(`[DataController] Initiating OHLCV polling for: ${ticker}`);
        ohlcvPollIntervalId = setInterval(() => {
            if (isFetchingOhlcv) {
                console.log(`[DataController] Preceding fetch is still active, skipping poll`);
                return;
            }

            isFetchingOhlcv = true;
            console.log(`[DataController] Fetching latest OHLCV data for: ${ticker}`);
            
            fetch(`https://optipulse-backend-production.up.railway.app/api/v1/ohlcv/${ticker}`)
                .then(res => {
                    if (!res.ok) {
                        throw { status: res.status, message: `Server error: ${res.statusText}` };
                    }
                    return res.json();
                })
                .then(data => {
                    isFetchingOhlcv = false;
                    console.log(`[DataController] OHLCV fetch completed successfully for: ${ticker}`);
                    onData(data);
                })
                .catch(err => {
                    isFetchingOhlcv = false;
                    console.error(`[DataController] OHLCV fetch failed:`, err);
                    clearInterval(ohlcvPollIntervalId);
                    ohlcvPollIntervalId = null;
                    onError(err);
                });
        }, 10000);
    }

    function stopOhlcvPolling() {
        if (ohlcvPollIntervalId) {
            console.log(`[DataController] Stopping OHLCV polling`);
            clearInterval(ohlcvPollIntervalId);
            ohlcvPollIntervalId = null;
        }
    }

    /* ──────────────── Public API ──────────────── */

    return Object.freeze({
        STOCK_PROFILES,
        TRADING_DAYS,

        // Data generation
        generateOHLCV,
        generateAllOHLCV,

        // Strategy
        runStrategy,
        computeSMA,
        computeEMA,
        computeRSI,
        computeSupport,
        computeResistance,

        // Metrics
        calculateMetrics,
        calculateIndicators,

        // SVG helpers
        buildSvgPath,
        buildDrawdownSvgPath,
        buildCandlestickSvg,

        // Full pipeline
        runPipeline,
        pollBacktestStatus,
        startOhlcvPolling,
        stopOhlcvPolling
    });
})();

/* Expose globally for non-module script consumption */
window.DataController = DataController;
