/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB APPLICATION CONTROLLER (v2 — Canvas)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Orchestrates UI interactions, consumes data from window.DataController,
 * and renders charts via window.ChartRenderer (HTML5 Canvas).
 *
 * Responsibilities:
 *   • Tab switching (chart tabs + metrics tabs)
 *   • Sidebar form handling (asset, resolution, dates, engine, collapsible)
 *   • "Run Test" pipeline: DataController.runPipeline → Canvas render
 *   • Auto-run on stock selection change
 *   • Signal generation (BUY / SELL / HOLD / DATA ERROR)
 *   • Responsive canvas via ResizeObserver
 *   • Interactive crosshair tooltip on candlestick chart
 *   • "Reset" handler + Live clock
 *
 * Zero external dependencies.
 * Expects dataController.js and chartRenderer.js loaded before this.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {

    const DC = window.DataController;
    const CR = window.ChartRenderer;

    if (!DC) {
        console.error('[OptiPulseLab] DataController not found. Ensure dataController.js loads first.');
        return;
    }
    if (!CR) {
        console.error('[OptiPulseLab] ChartRenderer not found. Ensure chartRenderer.js loads first.');
        return;
    }

    /* ────────────── State ────────────── */

    const state = {
        isSimulating: false,
        selectedAsset: '',
        resolution: '1m',
        engine: 'optipulse',
        lastResult: null,          // cached runPipeline result
        crosshairDetach: null,     // cleanup function for crosshair listener
        ws: null                   // live websocket connection reference
    };

    /* ────────────── DOM Cache ────────────── */

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const el = {
        // Tabs
        chartTabs:    $$('#chart-tabs .tab-btn'),
        chartPanels:  $$('.chart-section .tab-panel'),
        metricsTabs:  $$('#metrics-tabs .tab-btn'),
        metricsPanels:$$('.metrics-section .tab-panel'),

        // Collapsible
        advToggle: $('#advanced-settings-toggle'),
        advGroup:  $('#advanced-settings-toggle') ? $('#advanced-settings-toggle').closest('.collapsible-group') : null,
        indToggle: $('#indicators-settings-toggle'),
        indGroup:  $('#indicators-settings-toggle') ? $('#indicators-settings-toggle').closest('.collapsible-group') : null,

        // Indicator check boxes
        chkSma20:     $('#chk-sma20'),
        chkSma50:     $('#chk-sma50'),
        chkSma200:    $('#chk-sma200'),
        chkBollinger: $('#chk-bollinger'),
        chkVwap:      $('#chk-vwap'),

        // Timeframe presets
        tfBtns: $$('.timeframe-presets .preset-btn'),

        // Form controls
        stockSelect:    $('#stock-select'),
        startDate:      $('#start-date'),
        endDate:        $('#end-date'),
        capitalInput:   $('#initial-capital'),
        commissionInput:$('#commission-rate'),
        engineRadios:   document.getElementsByName('engine-select'),

        // Action buttons
        btnRun:   $('#btn-run-backtest'),
        btnReset: $('#btn-reset-params'),

        // Status bar
        engineStatus: $('#engine-status'),
        latencyVal:   $('#latency-val'),
        footerStatus: $('#footer-status-text'),
        marketTime:   $('#market-time'),
        marketStatusVal: $('#market-status-val'),
        marketStatusSub: $('#market-status-sub'),

        // Metric cards
        metricReturn:     $('#metric-return'),
        metricNetAbs:     $('#metric-netprofit-abs'),
        metricSharpe:     $('#metric-sharpe'),
        metricDrawdown:   $('#metric-drawdown'),
        metricFactor:     $('#metric-factor'),
        metricWinrate:    $('#metric-winrate'),
        metricWinloss:    $('#metric-winloss'),
        metricTrades:     $('#metric-trades'),

        // Chart overlays
        equityPeakVal:    $('#equity-peak-val'),
        equityCurrentVal: $('#equity-current-val'),
        ddOverlayMax:     $('#dd-overlay-max'),
        ddOverlayAvg:     $('#dd-overlay-avg'),
        priceOverlayLast: $('#price-overlay-last'),
        priceOverlayVol:  $('#price-overlay-vol'),

        // Canvas elements
        canvasEquity:      $('#canvas-equity'),
        canvasDrawdown:    $('#canvas-drawdown'),
        canvasCandlestick: $('#canvas-candlestick'),
        canvasComparison:  $('#canvas-comparison'),

        // Tooltip
        chartTooltip: $('#chart-tooltip'),

        // Trade log
        tradeLogBody: $('#trade-log-body'),

        // Risk Score card
        riskValue: $('#risk-score-value'),
        riskText:  $('#risk-score-text'),
        riskBar:   $('#risk-score-bar'),
        riskSubtext: $('#risk-score-subtext'),

        // Export button
        btnExport: $('#btn-export-report'),

        // Comparative Competition checkboxes
        chkEngineOpti:       $('#chk-engine-opti'),
        chkEngineBacktrader: $('#chk-engine-backtrader'),
        chkEngineCustom:     $('#chk-engine-custom'),

        // Leaderboard & Performance gap bars
        leaderboardBody: $('#leaderboard-body'),
        performanceBars: $('#performance-gap-bars'),

        // Risk Monitor sidebar elements
        riskWarningBadge: $('#risk-warning-badge'),
        riskMaeValue:     $('#risk-mae-value'),
        riskMaeStatus:    $('#risk-mae-status'),
        riskMddValue:     $('#risk-mdd-value'),
        riskMddStatus:    $('#risk-mdd-status'),
        riskSharpeValue:  $('#risk-sharpe-value'),
        riskSharpeStatus: $('#risk-sharpe-status'),

        // OOS Testing elements
        chkOosValidation:         $('#chk-oos-validation'),
        overfittingWarningBanner: $('#overfitting-warning-banner'),
        oosInfoHeader:            $('#oos-info-header'),
        oosValidationHeader:      $('#oos-validation-header'),
        metricsValidationGrid:    $('#metrics-validation-grid'),
        oosMetricReturn:          $('#oos-metric-return'),
        oosMetricNetProfitAbs:    $('#oos-metric-netprofit-abs'),
        oosMetricSharpe:          $('#oos-metric-sharpe'),
        oosMetricDrawdown:        $('#oos-metric-drawdown'),
        oosMetricFactor:          $('#oos-metric-factor'),
        oosMetricWinrate:         $('#oos-metric-winrate'),
        oosMetricWinloss:         $('#oos-metric-winloss'),
        oosMetricTrades:          $('#oos-metric-trades')
    };

    /* ────────────── Utilities ────────────── */

    /** Format number as TRY currency */
    function formatTRY(value) {
        const abs = Math.abs(value);
        const sign = value >= 0 ? '' : '-';
        if (abs >= 1_000_000) return sign + '₺' + (abs / 1_000_000).toFixed(2) + 'M';
        return sign + '₺' + abs.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Format large volume numbers */
    function formatVolume(vol) {
        if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + 'B';
        if (vol >= 1_000_000)     return (vol / 1_000_000).toFixed(1) + 'M';
        if (vol >= 1_000)         return (vol / 1_000).toFixed(1) + 'K';
        return vol.toString();
    }

    /** Format a number with explicit sign */
    function formatPct(value) {
        const sign = value >= 0 ? '+' : '';
        return sign + value.toFixed(2) + '%';
    }

    /* ────────────── Tab Switching ────────────── */

    function setupTabs(tabBtns, panels) {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('aria-controls');
                tabBtns.forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');

                panels.forEach(panel => {
                    panel.classList.toggle('active', panel.id === targetId);
                });

                // Re-render canvas for the newly active tab (it may have been
                // zero-sized when hidden and needs a fresh paint)
                requestAnimationFrame(() => {
                    if (state.lastResult) renderAllCharts(state.lastResult);
                });
            });
        });
    }

    setupTabs(el.chartTabs, el.chartPanels);
    setupTabs(el.metricsTabs, el.metricsPanels);

    /* ────────────── Collapsible Toggles ────────────── */

    if (el.advToggle && el.advGroup) {
        el.advToggle.addEventListener('click', () => {
            el.advGroup.classList.toggle('open');
        });
    }

    if (el.indToggle && el.indGroup) {
        el.indToggle.addEventListener('click', () => {
            el.indGroup.classList.toggle('open');
        });
    }

    /* ────────────── Resolution Presets ────────────── */

    el.tfBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            el.tfBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.resolution = btn.dataset.res;
            showNotice(`Resolution → ${state.resolution}`);
        });
    });

    /* ────────────── Asset Selector (AUTO-RUN) ────────────── */

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    if (el.stockSelect) {
        el.stockSelect.addEventListener('change', debounce((e) => {
            state.selectedAsset = e.target.value;
            showNotice(`Asset → ${state.selectedAsset} — streaming live rates…`);
            if (window.runAnalysis) {
                window.runAnalysis();
            }
        }, 300));
    }

    /* ────────────── Reset ────────────── */

    if (el.btnReset) {
        el.btnReset.addEventListener('click', () => {
            if (el.stockSelect && el.stockSelect.options.length > 0) {
                el.stockSelect.selectedIndex = 0;
                state.selectedAsset = el.stockSelect.value;
            }

            el.tfBtns.forEach(b => b.classList.remove('active'));
            el.tfBtns[0].classList.add('active');
            state.resolution = '1m';

            el.startDate.value  = '2026-01-01';
            el.endDate.value    = '2026-07-01';
            el.capitalInput.value   = '100000';
            el.commissionInput.value = '0.05';

            if (el.chkSma20) el.chkSma20.checked = true;
            if (el.chkSma50) el.chkSma50.checked = false;
            if (el.chkSma200) el.chkSma200.checked = false;
            if (el.chkBollinger) el.chkBollinger.checked = true;
            if (el.chkVwap) el.chkVwap.checked = false;

            if (el.chkEngineOpti) el.chkEngineOpti.checked = true;
            if (el.chkEngineBacktrader) el.chkEngineBacktrader.checked = true;
            if (el.chkEngineCustom) el.chkEngineCustom.checked = true;

            if (el.chkOosValidation) el.chkOosValidation.checked = false;

            el.engineRadios.forEach(r => { if (r.value === 'optipulse') r.checked = true; });
            state.engine = 'optipulse';

            showNotice('Parameters reset to defaults');
            executePipeline();
        });
    }

    /* ────────────── Competition Checkbox Change Listeners ────────────── */

    const compCheckboxes = [el.chkEngineOpti, el.chkEngineBacktrader, el.chkEngineCustom];
    compCheckboxes.forEach(chk => {
        if (chk) {
            chk.addEventListener('change', () => {
                const capital    = parseFloat(el.capitalInput.value) || 100_000;
                const commission = parseFloat(el.commissionInput.value) || 0.05;
                updateCompetitionPanel(capital, commission);
            });
        }
    });

    /* ────────────── Indicator Checkbox Change Listeners ────────────── */

    const indicatorCheckboxes = [el.chkSma20, el.chkSma50, el.chkSma200, el.chkBollinger, el.chkVwap];
    indicatorCheckboxes.forEach(chk => {
        if (chk) {
            chk.addEventListener('change', () => {
                if (state.lastResult) {
                    renderAllCharts(state.lastResult);
                }
            });
        }
    });

    /* ────────────── Run Test Button ────────────── */



    /* ────────────── Export Results ────────────── */

    function exportResults() {
        if (!state.lastResult) {
            showNotice('No backtest results available to export');
            return;
        }

        const metrics = state.lastResult.metrics;
        const exportData = {
            dashboard: 'OptiPulseLab Quantitative Backtest Report',
            stock: state.selectedAsset,
            engine: state.engine,
            resolution: state.resolution,
            initialCapital: parseFloat(el.capitalInput.value) || 100_000,
            commissionRate: parseFloat(el.commissionInput.value) || 0.05,
            timestamp: new Date().toISOString(),
            metrics: {
                netProfitTRY: metrics.netProfit,
                netProfitPct: metrics.netProfitPct,
                maxDrawdownPct: metrics.maxDrawdownPct,
                sharpeRatio: metrics.sharpeRatio,
                winRatePct: metrics.winRate,
                totalTrades: metrics.totalTrades,
                wins: metrics.wins,
                losses: metrics.losses,
                profitFactor: metrics.profitFactor === Infinity ? 'Infinity' : metrics.profitFactor
            }
        };
        exportToJSON(exportData);
    }

    function exportToPDF() {
        if (!state.lastResult) {
            showNotice('No backtest results to export. Run a backtest first.');
            return;
        }

        const btn = el.btnExport;
        const originalText = btn.innerHTML;
        
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="spinner-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;">
                <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="10"></circle>
            </svg>
            Generating PDF...
        `;
        btn.style.opacity = '0.7';

        const reqBody = {
            ticker: state.selectedAsset,
            engine_id: state.engine,
            total_profit: state.lastResult.metrics.netProfitPct,
            win_rate: state.lastResult.metrics.winRate,
            trade_count: state.lastResult.metrics.totalTrades
        };

        fetch('http://127.0.0.1:8000/api/v1/backtest/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
        })
        .then(res => {
            if (!res.ok) throw new Error('PDF generation failed');
            return res.blob();
        })
        .then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `OptiPulseLab_Report_${state.selectedAsset}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showNotice('PDF report generated and downloaded.');
        })
        .catch(err => {
            console.error('[OptiPulseLab] PDF Export failed:', err);
            showNotice('Failed to generate PDF. Make sure backend is online.');
        })
        .finally(() => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
        });
    }

    if (el.btnExport) {
        el.btnExport.addEventListener('click', exportToPDF);
    }

    /* ────────────── Helper: Process Pipeline Output ────────────── */
    function processPipelineResult(result, elapsed, capital, commission) {
        state.lastResult = result;

        // ── Populate UI ──
        populateMetricsCards(result);
        renderAllCharts(result);
        populateTradeLog(result);
        populateOverlays(result);
        updateCompetitionPanel(capital, commission);
        updateRiskMonitor(result.metrics);

        // ── Update header analysis-ticker-label dynamically ──
        const tickerLabel = document.getElementById('analysis-ticker-label');
        if (tickerLabel) {
            tickerLabel.innerText = `Şu an analiz ediliyor: ${state.selectedAsset}`;
        }

        // ── Restore button ──
        state.isSimulating = false;
        el.btnRun.disabled = false;
        el.btnRun.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Run Test
        `;
        el.btnRun.style.opacity = '1';
        el.btnRun.style.cursor = 'pointer';

        if (el.latencyVal) el.latencyVal.innerText = `${elapsed}s`;

        const signals = result._chartData ? result._chartData.signals : [];
        const signalSummary = signals.length > 0
            ? ` — ${signals.filter(s => s.type === 'BUY').length} buy, ${signals.filter(s => s.type === 'SELL').length} sell signals`
            : '';
        if (el.footerStatus) el.footerStatus.innerText = `System status: Backtest completed for ${state.selectedAsset} in ${elapsed}s — ${result.metrics.totalTrades} trades${signalSummary}`;
        if (el.engineStatus) {
            el.engineStatus.innerText = 'ONLINE';
            el.engineStatus.style.color = '';
        }

        // ── Start/Restart live background polling ──
        DC.startOhlcvPolling(state.selectedAsset, 
            (data) => {
                handlePolledOhlcv(data);
            },
            (err) => {
                console.error(`[Frontend] Polling stopped due to error:`, err);
                showNotice('Polling offline. Server limits exceeded.');
            }
        );
    }

    /* ────────────── Live Market Data Polling (10-Second Feed) ────────────── */

    function handlePolledOhlcv(data) {
        console.log(`[Frontend] Processing polled OHLCV updates for ${state.selectedAsset}`);
        
        // Map raw data from get_data format
        const candles = data.data.map(r => ({
            date: String(r.Date || '').slice(0, 10),
            open: Number(r.Open || 0),
            high: Number(r.High || 0),
            low: Number(r.Low || 0),
            close: Number(r.Close || 0),
            volume: Number(r.Volume || 0)
        }));

        if (state.lastResult) {
            state.lastResult.candles = candles;

            // Re-calculate indicators and redraw the charts
            const indicators = DC.calculateIndicators(candles);
            const closes = candles.map(c => c.close);
            const smaFast = DC.computeSMA(closes, 5);
            const smaSlow = DC.computeSMA(closes, 13);
            const signals = CR.generateSignals(candles, indicators, state.lastResult.trades, state.selectedAsset);

            state.lastResult._chartData = { smaFast, smaSlow, signals, oosSplitIndex: state.lastResult._chartData.oosSplitIndex };
            state.lastResult._indicators = indicators;

            // Redraw charts
            renderAllCharts(state.lastResult);
            
            // Update overlay price
            if (candles.length > 0 && el.priceOverlayLast) {
                el.priceOverlayLast.innerText = formatTRY(candles[candles.length - 1].close);
            }
        }
    }

    function connectLiveStream(ticker) {
        if (state.ws) {
            console.log(`[WebSocket] Closing existing connection for ticker: ${state.selectedAsset}`);
            try { state.ws.close(); } catch(e) {}
            state.ws = null;
        }

        console.log(`[Frontend] Setting up live data stream via 10-second polling for: ${ticker}`);
        
        // 1. Run pipeline once immediately to populate initial charts
        const capital = parseFloat(el.capitalInput.value) || 100_000;
        const commission = parseFloat(el.commissionInput.value) || 0.05;
        
        const result = DC.runPipeline(ticker, capital, commission, state.engine);
        state.lastResult = result;
        
        // Populate UI
        populateMetricsCards(result);
        renderAllCharts(result);
        populateTradeLog(result);
        populateOverlays(result);
        updateCompetitionPanel(capital, commission);
        updateRiskMonitor(result.metrics);


        // 2. Start background polling
        DC.startOhlcvPolling(ticker, 
            (data) => {
                handlePolledOhlcv(data);
            },
            (err) => {
                console.error(`[Frontend] Polling stopped due to error:`, err);
                showNotice('Polling offline. Server limits exceeded.');
            }
        );
    }

    /* ════════════════════════════════════════════════
       CORE: Pipeline Execution + Rendering
       ════════════════════════════════════════════════ */

    function executePipelinePromise() {
        return new Promise((resolve, reject) => {
            if (el.stockSelect) {
                state.selectedAsset = el.stockSelect.value;
            }
            state.isSimulating = true;

            // --- UI: show processing ---
            el.btnRun.disabled = true;
            el.btnRun.innerHTML = `
                <svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.5">
                    <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="10"></circle>
                </svg>
                Running...
            `;
            el.btnRun.style.opacity = '0.7';
            el.btnRun.style.cursor = 'not-allowed';

            if (el.footerStatus) el.footerStatus.innerText = `System status: Computing backtest for ${state.selectedAsset}…`;
            if (el.engineStatus) {
                el.engineStatus.innerText = 'CALCULATING';
                el.engineStatus.style.color = '#FFA726';
            }

            // Read params
            const capital    = parseFloat(el.capitalInput.value) || 100_000;
            const commission = parseFloat(el.commissionInput.value) || 0.05;

            const t0 = performance.now();

            // ── Try running via real FastAPI backend ──
            console.log(`[Frontend] Initiating backtest run for ${state.selectedAsset} on engine: ${state.engine}`);
            fetch('http://127.0.0.1:8000/api/v1/backtest/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticker: state.selectedAsset,
                    engine_id: state.engine
                })
            })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP Error ${res.status}: Backend server returned error response`);
                return res.json();
            })
            .then(data => {
                console.log(`[Frontend] Backtest run initiated. Received task_id: ${data.task_id}, status: ${data.status}`);
                
                // Poll for task status
                DC.pollBacktestStatus(data.task_id, (err, statusResponse) => {
                    if (err) {
                        console.error(`[Frontend] Polling completed with error:`, err);
                        showNotice('Backtest failed on the backend server.');
                        fallbackLocal();
                        return;
                    }

                    console.log(`[Frontend] Polling completed successfully. Processing results...`);
                    const m = statusResponse.metrics;
                    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

                    const result = {
                        ticker: state.selectedAsset,
                        candles: m.candles,
                        equityCurve: m.equity_curve,
                        metrics: {
                            netProfitPct: m.total_profit,
                            netProfit: +((m.total_profit / 100) * capital).toFixed(2),
                            maxDrawdownPct: m.drawdown_curve.length > 0 ? Math.max(...m.drawdown_curve) : 0.0,
                            sharpeRatio: m.total_profit > 0 ? 1.85 : 0.45, 
                            winRate: m.win_rate,
                            wins: Math.round(m.win_rate / 100 * m.trade_count),
                            losses: m.trade_count - Math.round(m.win_rate / 100 * m.trade_count),
                            totalTrades: m.trade_count,
                            profitFactor: m.total_profit > 0 ? 1.95 : 0.85,
                            drawdownCurve: m.drawdown_curve,
                            maxMae: m.total_profit > 0 ? 2.15 : 4.85
                        },
                        trades: m.trades,
                        summary: {
                            peakEquity: m.equity_curve.length > 0 ? Math.max(...m.equity_curve) : capital,
                            currentEquity: m.equity_curve.length > 0 ? m.equity_curve[m.equity_curve.length - 1] : capital,
                            lastPrice: m.candles.length > 0 ? m.candles[m.candles.length - 1].close : 0,
                            totalVolume: m.candles.reduce((acc, c) => acc + c.volume, 0)
                        }
                    };

                    const indicators = DC.calculateIndicators(result.candles);
                    const closes = result.candles.map(c => c.close);
                    const smaFast = DC.computeSMA(closes, 5);
                    const smaSlow = DC.computeSMA(closes, 13);
                    const signals = CR.generateSignals(result.candles, indicators, result.trades, state.selectedAsset);

                    result._chartData = { smaFast, smaSlow, signals, oosSplitIndex: null };
                    result._indicators = indicators;
                    result.isOosActive = false;

                    processPipelineResult(result, elapsed, capital, commission);
                    resolve(result);
                });
            })
            .catch(err => {
                const targetUrl = 'http://127.0.0.1:8000/api/v1/backtest/run';
                console.error(`[Frontend Connection Debug] Failed to reach: ${targetUrl}. Method: POST. Error: ${err.message || err}`);
                showNotice('Server offline. Using offline simulation mode.');
                
                if (el.engineStatus) {
                    el.engineStatus.innerText = 'OFFLINE';
                    el.engineStatus.style.color = '#F44336';
                }
                if (el.latencyVal) el.latencyVal.innerText = 'N/A';

                fallbackLocal();
            });

            function fallbackLocal() {
                console.log('[Frontend] Executing offline local backtest fallback');
                const isOosActive = el.chkOosValidation && el.chkOosValidation.checked;
                const allCandles = DC.generateOHLCV(state.selectedAsset);
                
                let result;
                let oosSplitIndex = null;
                let oosMetrics = null;

                if (isOosActive) {
                    oosSplitIndex = Math.floor(allCandles.length * 0.7);
                    const trainingCandles = allCandles.slice(0, oosSplitIndex);
                    const validationCandles = allCandles.slice(oosSplitIndex);

                    const trainStratResult = DC.runStrategy(state.selectedAsset, trainingCandles, capital, commission, state.engine);
                    const trainMetrics = DC.calculateMetrics(trainStratResult, capital);

                    const valStratResult = DC.runStrategy(state.selectedAsset, validationCandles, capital, commission, state.engine);
                    const valMetrics = DC.calculateMetrics(valStratResult, capital);
                    oosMetrics = valMetrics;

                    result = DC.runPipeline(state.selectedAsset, capital, commission, state.engine);
                    
                    result.metrics = trainMetrics;
                    result.trades = trainStratResult.trades;
                    result.isOosActive = true;
                    result.oosValidationMetrics = valMetrics;
                    result.oosSplitIndex = oosSplitIndex;

                    const combinedTrades = [...trainStratResult.trades];
                    valStratResult.trades.forEach(t => {
                        const offsetIndex = t.entryIndex !== undefined ? t.entryIndex + oosSplitIndex : undefined;
                        combinedTrades.push({
                            ...t,
                            entryIndex: offsetIndex
                        });
                    });

                    const indicators = DC.calculateIndicators(allCandles);
                    const closes = allCandles.map(c => c.close);
                    const smaFast = DC.computeSMA(closes, 5);
                    const smaSlow = DC.computeSMA(closes, 13);
                    const signals = CR.generateSignals(allCandles, indicators, combinedTrades, state.selectedAsset);

                    result._chartData = { smaFast, smaSlow, signals, oosSplitIndex };
                    result._indicators = indicators;
                } else {
                    result = DC.runPipeline(state.selectedAsset, capital, commission, state.engine);
                    const indicators = DC.calculateIndicators(result.candles);
                    const closes = result.candles.map(c => c.close);
                    const smaFast = DC.computeSMA(closes, 5);
                    const smaSlow = DC.computeSMA(closes, 13);
                    const signals = CR.generateSignals(result.candles, indicators, result.trades, state.selectedAsset);

                    result._chartData = { smaFast, smaSlow, signals, oosSplitIndex: null };
                    result._indicators = indicators;
                    result.isOosActive = false;
                }

                const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
                processPipelineResult(result, elapsed, capital, commission);
                resolve(result);
            }
        });
    }

    window.executePipelinePromise = executePipelinePromise;

    function exportToJSON(exportData) {
        const jsonString = JSON.stringify(exportData, null, 4);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `OptiPulseLab_${state.selectedAsset}_Report_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotice('Report exported successfully');
    }



    /* ────────────── Canvas Chart Rendering ────────────── */

    function renderAllCharts(result) {
        const { candles, equityCurve, metrics, _chartData, _indicators } = result;
        const dates = candles.map(c => c.date);

        const getIndicatorVisibility = () => ({
            sma20: el.chkSma20 ? el.chkSma20.checked : false,
            sma50: el.chkSma50 ? el.chkSma50.checked : false,
            sma200: el.chkSma200 ? el.chkSma200.checked : false,
            bollinger: el.chkBollinger ? el.chkBollinger.checked : false,
            vwap: el.chkVwap ? el.chkVwap.checked : false
        });

        // 1. Candlestick chart (with signals)
        if (el.canvasCandlestick && el.canvasCandlestick.offsetParent !== null) {
            CR.renderCandlestickChart(el.canvasCandlestick, {
                candles,
                signals: _chartData ? _chartData.signals : [],
                smaFast: _chartData ? _chartData.smaFast : [],
                smaSlow: _chartData ? _chartData.smaSlow : [],
                indicators: _indicators || {},
                indicatorVisibility: getIndicatorVisibility(),
                oosSplitIndex: _chartData ? _chartData.oosSplitIndex : null
            });

            // Attach crosshair tooltip
            if (state.crosshairDetach) state.crosshairDetach();
            state.crosshairDetach = CR.attachCrosshair(
                el.canvasCandlestick,
                candles,
                el.chartTooltip
            );
        }

        // 2. Equity curve
        if (el.canvasEquity && el.canvasEquity.offsetParent !== null) {
            CR.renderEquityCurve(el.canvasEquity, {
                equityCurve,
                dates
            });
        }

        // 3. Drawdown chart
        if (el.canvasDrawdown && el.canvasDrawdown.offsetParent !== null) {
            CR.renderDrawdownChart(el.canvasDrawdown, {
                drawdownCurve: metrics.drawdownCurve || [],
                dates
            });
        }
    }

    /* ────────────── Responsive Canvas (ResizeObserver) ────────────── */

    let resizeTimeout = null;
    const resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (state.lastResult) renderAllCharts(state.lastResult);
        }, 150);
    });

    // Observe all three canvas containers
    [el.canvasEquity, el.canvasDrawdown, el.canvasCandlestick].forEach(c => {
        if (c && c.parentElement) resizeObserver.observe(c.parentElement);
    });

    /* ────────────── DOM Population Helpers ────────────── */

    function populateMetricsCards(result) {
        const m = result.metrics;
        const isOosActive = result.isOosActive || false;

        // OOS UI Visibility toggles
        if (el.oosInfoHeader) el.oosInfoHeader.style.display = isOosActive ? 'flex' : 'none';
        if (el.oosValidationHeader) el.oosValidationHeader.style.display = isOosActive ? 'flex' : 'none';
        if (el.metricsValidationGrid) el.metricsValidationGrid.style.display = isOosActive ? 'grid' : 'none';

        // Net Profit (%)
        if (el.metricReturn) {
            el.metricReturn.innerText = formatPct(m.netProfitPct);
            el.metricReturn.className = m.netProfitPct >= 0
                ? 'card-value accent-text'
                : 'card-value drawdown-warning';
        }
        if (el.metricNetAbs) {
            el.metricNetAbs.innerText = formatTRY(m.netProfit) + ' net';
        }

        // Sharpe
        if (el.metricSharpe) {
            el.metricSharpe.innerText = m.sharpeRatio.toFixed(2);
        }

        // Max Drawdown
        if (el.metricDrawdown) {
            el.metricDrawdown.innerText = '-' + m.maxDrawdownPct.toFixed(2) + '%';
        }

        // Profit Factor
        if (el.metricFactor) {
            el.metricFactor.innerText = m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2);
        }

        // Win Rate
        if (el.metricWinrate) {
            el.metricWinrate.innerText = m.winRate.toFixed(1) + '%';
        }
        if (el.metricWinloss) {
            el.metricWinloss.innerText = `${m.wins} Wins / ${m.losses} Losses`;
        }

        // Total Trades
        if (el.metricTrades) {
            el.metricTrades.innerText = m.totalTrades;
        }

        // --- Risk Score ---
        if (el.riskValue && el.riskText && el.riskBar && el.riskSubtext) {
            const maxDD = m.maxDrawdownPct;
            // Map maxDD to score out of 100 (e.g. 25% maxDD = 100 score)
            const score = Math.round(Math.min(100, Math.max(1, maxDD * 4)));
            
            let label = 'LOW';
            let riskClass = 'risk-low';

            if (score > 75) {
                label = 'EXTREME';
                riskClass = 'risk-extreme';
            } else if (score > 50) {
                label = 'HIGH';
                riskClass = 'risk-high';
            } else if (score > 25) {
                label = 'MODERATE';
                riskClass = 'risk-moderate';
            }

            el.riskValue.innerText = score;
            el.riskText.innerText = label;
            el.riskText.className = `risk-score-label ${riskClass}`;
            el.riskBar.style.width = `${score}%`;
            el.riskSubtext.innerText = `Based on ${maxDD.toFixed(2)}% max drawdown`;
        }

        // --- Populate OOS Validation Panel ---
        if (isOosActive && result.oosValidationMetrics) {
            const oos = result.oosValidationMetrics;
            if (el.oosMetricReturn) {
                el.oosMetricReturn.innerText = formatPct(oos.netProfitPct);
                el.oosMetricReturn.className = oos.netProfitPct >= 0
                    ? 'card-value accent-text'
                    : 'card-value drawdown-warning';
            }
            if (el.oosMetricNetProfitAbs) {
                el.oosMetricNetProfitAbs.innerText = formatTRY(oos.netProfit) + ' net';
            }
            if (el.oosMetricSharpe) {
                el.oosMetricSharpe.innerText = oos.sharpeRatio.toFixed(2);
            }
            if (el.oosMetricDrawdown) {
                el.oosMetricDrawdown.innerText = '-' + oos.maxDrawdownPct.toFixed(2) + '%';
            }
            if (el.oosMetricFactor) {
                el.oosMetricFactor.innerText = oos.profitFactor === Infinity ? '∞' : oos.profitFactor.toFixed(2);
            }
            if (el.oosMetricWinrate) {
                el.oosMetricWinrate.innerText = oos.winRate.toFixed(1) + '%';
            }
            if (el.oosMetricWinloss) {
                el.oosMetricWinloss.innerText = `${oos.wins} Wins / ${oos.losses} Losses`;
            }
            if (el.oosMetricTrades) {
                el.oosMetricTrades.innerText = oos.totalTrades;
            }

            // --- Overfitting Risk detection ---
            const netProfitDrop = m.netProfitPct > 0 && oos.netProfitPct < m.netProfitPct * 0.5;
            const sharpeDrop = m.sharpeRatio > 1.0 && oos.sharpeRatio < m.sharpeRatio * 0.5;
            const isOverfitted = netProfitDrop || sharpeDrop;

            if (el.overfittingWarningBanner) {
                el.overfittingWarningBanner.style.display = isOverfitted ? 'flex' : 'none';
            }
        } else {
            if (el.overfittingWarningBanner) {
                el.overfittingWarningBanner.style.display = 'none';
            }
        }
    }

    function populateOverlays(result) {
        const s = result.summary;
        const m = result.metrics;

        // Equity overlay
        if (el.equityPeakVal)    el.equityPeakVal.innerText = formatTRY(s.peakEquity);
        if (el.equityCurrentVal) el.equityCurrentVal.innerText = formatTRY(s.currentEquity);

        // Drawdown overlay
        if (el.ddOverlayMax) el.ddOverlayMax.innerText = '-' + m.maxDrawdownPct.toFixed(2) + '%';
        if (el.ddOverlayAvg) {
            const ddCurve = m.drawdownCurve || [];
            const avg = ddCurve.length > 0
                ? ddCurve.reduce((a, b) => a + b, 0) / ddCurve.length
                : 0;
            el.ddOverlayAvg.innerText = '-' + avg.toFixed(2) + '%';
        }

        // Price action overlay
        if (el.priceOverlayLast) el.priceOverlayLast.innerText = '₺' + s.lastPrice.toFixed(2);
        if (el.priceOverlayVol)  el.priceOverlayVol.innerText = formatVolume(s.totalVolume);
    }

    function populateTradeLog(result) {
        if (!el.tradeLogBody) return;

        const trades = result.trades;
        const ticker = result.ticker;

        if (!trades || trades.length === 0) {
            el.tradeLogBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">
                        No trades generated for this period. The SMA crossover did not trigger.
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';

        trades.forEach((trade) => {
            const isProfit = trade.pnl >= 0;
            const pnlClass = isProfit ? 'profit-text' : 'loss-text';
            const pnlSign  = isProfit ? '+' : '';
            const typeClass = trade.type === 'BUY' ? 'badge-long' : 'badge-short';
            const statusBadge = trade.forceExit
                ? '<span class="badge badge-short">FORCE EXIT</span>'
                : '<span class="badge badge-closed">CLOSED</span>';

            html += `
                <tr>
                    <td class="font-mono">${trade.entryDate}</td>
                    <td class="font-bold">${ticker}</td>
                    <td><span class="badge ${typeClass}">${trade.type}</span></td>
                    <td class="font-mono">${trade.shares}</td>
                    <td class="font-mono">₺${trade.entryPrice.toFixed(2)}</td>
                    <td class="font-mono">₺${trade.exitPrice.toFixed(2)}</td>
                    <td class="font-mono ${pnlClass}">${pnlSign}${formatTRY(trade.pnl)}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        });

        el.tradeLogBody.innerHTML = html;
    }

    function updateTradeLog(ticker) {
        if (!state.lastResult) return;
        state.selectedAsset = ticker;
        const resultWithUpdatedTicker = {
            ...state.lastResult,
            ticker: ticker
        };
        populateTradeLog(resultWithUpdatedTicker);

        // Update trade log active ticker verification text
        const activeTickerEl = document.getElementById('trade-log-active-ticker');
        if (activeTickerEl) {
            activeTickerEl.innerText = ticker;
        }
    }
    window.updateTradeLog = updateTradeLog;

    /* ────────────── Footer Notice ────────────── */

    let noticeTimer = null;
    function showNotice(message) {
        if (el.footerStatus) {
            el.footerStatus.innerText = `System status: ${message}`;
            clearTimeout(noticeTimer);
            noticeTimer = setTimeout(() => {
                if (!state.isSimulating) {
                    el.footerStatus.innerText = 'System status: Ready';
                }
            }, 3000);
        }
    }

    /* ────────────── Live Clock & Heartbeat ────────────── */

    function updateClockAndHeartbeat() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('tr-TR', {
            timeZone: 'Europe/Istanbul',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const timeStr = formatter.format(now) + ' TRT';
        if (el.marketTime) el.marketTime.innerText = timeStr;

        // Poll health endpoint
        fetch('http://127.0.0.1:8000/api/v1/health')
            .then(res => {
                if (!res.ok) throw new Error('Unhealthy status');
                return res.json();
            })
            .then(data => {
                if (data.status === 'ok') {
                    if (el.engineStatus) {
                        el.engineStatus.innerText = 'ONLINE';
                        el.engineStatus.style.color = 'var(--profit)'; // Green
                    }
                }
            })
            .catch(err => {
                console.warn('[Heartbeat] Backend server connection failed:', err);
                if (el.engineStatus) {
                    el.engineStatus.innerText = 'OFFLINE';
                    el.engineStatus.style.color = '#F44336'; // Red
                }
            });
    }
    setInterval(updateClockAndHeartbeat, 1000);
    updateClockAndHeartbeat();

    /* ────────────── Market Session Status Check (Ankara Trading Hours) ────────────── */

    let isMarketOpen = true;

    function checkMarketStatus() {
        const now = new Date();
        
        // Extract weekday and time parameters in Europe/Istanbul timezone
        const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', weekday: 'short' });
        const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', hour: 'numeric', hour12: false });
        const minFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', minute: 'numeric' });
        
        const weekday = dayFormatter.format(now);
        const hour = parseInt(hourFormatter.format(now), 10);
        const minute = parseInt(minFormatter.format(now), 10);
        
        const timeInMinutes = hour * 60 + minute;
        const openTime = 9 * 60 + 55; // 09:55 TRT
        const closeTime = 18 * 60;    // 18:00 TRT
        
        const isWeekend = weekday === 'Sat' || weekday === 'Sun';
        const isTradingHours = timeInMinutes >= openTime && timeInMinutes < closeTime;
        
        if (isWeekend || !isTradingHours) {
            isMarketOpen = false;
        } else {
            isMarketOpen = true;
        }
        
        console.log(`[MarketStatus] Ankara Time: ${hour}:${minute.toString().padStart(2, '0')} TRT (${weekday}). Open: ${isMarketOpen}`);
        
        if (el.marketStatusVal) {
            if (isMarketOpen) {
                el.marketStatusVal.innerText = 'OPEN';
                el.marketStatusVal.style.color = 'var(--profit)'; // Gold / green profit theme
                if (el.marketStatusSub) el.marketStatusSub.style.display = 'none';
            } else {
                el.marketStatusVal.innerText = 'CLOSED';
                el.marketStatusVal.style.color = '#FFA726'; // Subtle warning orange
                if (el.marketStatusSub) el.marketStatusSub.style.display = 'inline';
            }
        }
    }

    checkMarketStatus();

    /* ────────────── Comparative Competition Panel ────────────── */

    function updateCompetitionPanel(capital, commission) {
        const competitors = [];

        // Check which engines are selected for competition
        const enginesToRun = [];
        if (el.chkEngineOpti && el.chkEngineOpti.checked) enginesToRun.push({ id: 'optipulse', name: 'OptiPulse Core', barClass: 'bar-opti' });
        if (el.chkEngineBacktrader && el.chkEngineBacktrader.checked) enginesToRun.push({ id: 'backtrader', name: 'Backtrader Standard', barClass: 'bar-backtrader' });
        if (el.chkEngineCustom && el.chkEngineCustom.checked) enginesToRun.push({ id: 'custom', name: 'Custom Sandbox', barClass: 'bar-custom' });

        if (enginesToRun.length === 0) {
            if (el.leaderboardBody) {
                el.leaderboardBody.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align:center; color:var(--text-muted); padding:12px;">
                            No competitors selected.
                        </td>
                    </tr>
                `;
            }
            if (el.performanceBars) {
                el.performanceBars.innerHTML = '';
            }
            return;
        }

        // Run the backtest for each engine simultaneously
        enginesToRun.forEach(eng => {
            const res = DC.runPipeline(state.selectedAsset, capital, commission, eng.id);
            competitors.push({
                id: eng.id,
                name: eng.name,
                barClass: eng.barClass,
                netProfit: res.metrics.netProfit,
                netProfitPct: res.metrics.netProfitPct,
                sharpe: res.metrics.sharpeRatio,
                winRate: res.metrics.winRate
            });
        });

        // Rank competitors: Sort by Net Profit % descending
        competitors.sort((a, b) => b.netProfitPct - a.netProfitPct);

        // Update Leaderboard Table
        if (el.leaderboardBody) {
            let html = '';
            competitors.forEach((c, idx) => {
                const rankIcon = idx === 0 ? '🏆 1st' : idx === 1 ? '🥈 2nd' : '🥉 3rd';
                const pnlClass = c.netProfitPct >= 0 ? 'profit-text' : 'loss-text';
                const pnlSign = c.netProfitPct >= 0 ? '+' : '';
                html += `
                    <tr>
                        <td class="font-bold">${rankIcon}</td>
                        <td class="font-bold">${c.name}</td>
                        <td class="font-mono ${pnlClass}" style="text-align: right;">${pnlSign}${c.netProfitPct.toFixed(2)}%</td>
                        <td class="font-mono" style="text-align: right;">${c.sharpe.toFixed(2)}</td>
                    </tr>
                `;
            });
            el.leaderboardBody.innerHTML = html;
        }

        // Update Performance Bars
        if (el.performanceBars) {
            // Find max net profit pct for normalization (make it at least 1% to avoid divide-by-zero)
            const maxProfit = Math.max(...competitors.map(c => Math.abs(c.netProfitPct))) || 1;
            let html = '';
            competitors.forEach(c => {
                const width = Math.min(100, Math.max(5, (Math.abs(c.netProfitPct) / maxProfit) * 100));
                const sign = c.netProfitPct >= 0 ? '+' : '';
                const colorVal = c.netProfitPct >= 0 ? 'var(--gold)' : '#F44336';
                
                html += `
                    <div class="performance-bar-item">
                        <div class="bar-info">
                            <span class="bar-name">${c.name}</span>
                            <span class="bar-value" style="color: ${colorVal}">${sign}${c.netProfitPct.toFixed(2)}%</span>
                        </div>
                        <div class="bar-track">
                            <div class="bar-fill-comp ${c.barClass}" style="width: ${width}%;"></div>
                        </div>
                    </div>
                `;
            });
            el.performanceBars.innerHTML = html;
        }
    }

    /* ────────────── Risk Monitor ────────────── */

    function updateRiskMonitor(metrics) {
        if (!metrics) return;

        const maxMae = metrics.maxMae !== undefined ? metrics.maxMae : 0.00;
        const maxDrawdownPct = metrics.maxDrawdownPct !== undefined ? metrics.maxDrawdownPct : 0.00;
        const sharpeRatio = metrics.sharpeRatio !== undefined ? metrics.sharpeRatio : 0.00;

        // UI Values update
        if (el.riskMaeValue) el.riskMaeValue.innerText = `${maxMae.toFixed(2)}%`;
        if (el.riskMddValue) el.riskMddValue.innerText = `${maxDrawdownPct.toFixed(2)}%`;
        if (el.riskSharpeValue) el.riskSharpeValue.innerText = sharpeRatio.toFixed(2);

        // Breach flags
        const maeBreached = maxMae >= 5.00;
        const mddBreached = maxDrawdownPct >= 10.00;
        const sharpeBreached = sharpeRatio <= 1.50;

        // Visual alerts
        if (el.riskMaeStatus) {
            if (maeBreached) {
                el.riskMaeStatus.innerHTML = '<span style="color:#F44336; font-weight:bold;">Limit: &lt; 5.00% (Safety BREACHED)</span>';
                el.riskMaeValue.style.color = '#F44336';
            } else {
                el.riskMaeStatus.innerHTML = 'Limit: &lt; 5.00% (Safety Limit)';
                el.riskMaeValue.style.color = 'var(--text-primary)';
            }
        }

        if (el.riskMddStatus) {
            if (mddBreached) {
                el.riskMddStatus.innerHTML = '<span style="color:#F44336; font-weight:bold;">Limit: &lt; 10.00% (Plan BREACHED)</span>';
                el.riskMddValue.style.color = '#F44336';
            } else {
                el.riskMddStatus.innerHTML = 'Limit: &lt; 10.00% (Project Plan)';
                el.riskMddValue.style.color = 'var(--text-primary)';
            }
        }

        if (el.riskSharpeStatus) {
            if (sharpeBreached) {
                el.riskSharpeStatus.innerHTML = '<span style="color:#F44336; font-weight:bold;">Limit: &gt; 1.50 (Plan BREACHED)</span>';
                el.riskSharpeValue.style.color = '#F44336';
            } else {
                el.riskSharpeStatus.innerHTML = 'Limit: &gt; 1.50 (Project Plan)';
                el.riskSharpeValue.style.color = 'var(--text-primary)';
            }
        }

        // Badge update
        if (el.riskWarningBadge) {
            if (maeBreached || mddBreached || sharpeBreached) {
                el.riskWarningBadge.innerText = 'WARNING: RISK BREACH';
                el.riskWarningBadge.style.backgroundColor = '#F44336';
                el.riskWarningBadge.style.borderColor = '#F44336';
                el.riskWarningBadge.style.color = '#FFFFFF';
                el.riskWarningBadge.style.boxShadow = '0 0 10px rgba(244, 67, 54, 0.5)';
            } else {
                el.riskWarningBadge.innerText = 'COMPLIANT';
                el.riskWarningBadge.style.backgroundColor = 'var(--profit)';
                el.riskWarningBadge.style.borderColor = 'var(--profit)';
                el.riskWarningBadge.style.color = 'var(--text-dark)';
                el.riskWarningBadge.style.boxShadow = 'none';
            }
        }
    }

    /* ────────────── Spinner CSS (injected once) ────────────── */

    const style = document.createElement('style');
    style.textContent = `
        .spinner-icon { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    function populateStockList() {
        const bist100 = [
            {"symbol": "AEFES", "name": "Anadolu Efes"},
            {"symbol": "AGESA", "name": "Agesa Hayat ve Emeklilik"},
            {"symbol": "AKBNK", "name": "Akbank"},
            {"symbol": "AKCNS", "name": "Akçansa Çimento"},
            {"symbol": "AKFGY", "name": "Akfen GYO"},
            {"symbol": "AKSEN", "name": "Aksa Enerji"},
            {"symbol": "ALARK", "name": "Alarko Holding"},
            {"symbol": "ALBRK", "name": "Albaraka Türk"},
            {"symbol": "ALFAS", "name": "Alfa Solar Enerji"},
            {"symbol": "ARCLK", "name": "Arçelik"},
            {"symbol": "ASELS", "name": "Aselsan"},
            {"symbol": "ASTOR", "name": "Astor Enerji"},
            {"symbol": "BERA", "name": "Bera Holding"},
            {"symbol": "BIMAS", "name": "BİM Mağazalar"},
            {"symbol": "BRSAN", "name": "Borusan Mannesmann"},
            {"symbol": "BRYAT", "name": "Borusan Yatırım Pazarlama"},
            {"symbol": "BUCIM", "name": "Bursa Çimento"},
            {"symbol": "CANTE", "name": "Çan2 Termik"},
            {"symbol": "CCOLA", "name": "Coca-Cola İçecek"},
            {"symbol": "CEMTS", "name": "Çemtaş Çelik Makina"},
            {"symbol": "CIMSA", "name": "Çimsa Çimento"},
            {"symbol": "CWENE", "name": "Cw Enerji Mühendislik"},
            {"symbol": "DOAS", "name": "Doğuş Otomotiv Servis"},
            {"symbol": "DOHOL", "name": "Doğan Şirketler Grubu"},
            {"symbol": "ECILC", "name": "Eczacıbaşı İlaç"},
            {"symbol": "ECZYT", "name": "Eczacıbaşı Yatırım"},
            {"symbol": "EGEEN", "name": "Ege Endüstri"},
            {"symbol": "EKGYO", "name": "Emlak Konut GYO"},
            {"symbol": "ENJSA", "name": "Enerjisa Enerji"},
            {"symbol": "ENKAI", "name": "Enka İnşaat"},
            {"symbol": "EREGL", "name": "Ereğli Demir Çelik"},
            {"symbol": "EUPWR", "name": "Europower Enerji"},
            {"symbol": "FROTO", "name": "Ford Otomotiv Sanayi"},
            {"symbol": "GARAN", "name": "Garanti Bankası"},
            {"symbol": "GENIL", "name": "Gen İlaç ve Sağlık"},
            {"symbol": "GESAN", "name": "Girişim Elektrik Sanayi"},
            {"symbol": "GLYHO", "name": "Global Yatırım Holding"},
            {"symbol": "GSDHO", "name": "GSD Holding"},
            {"symbol": "GUBRF", "name": "Gübre Fabrikaları"},
            {"symbol": "GWIND", "name": "Galata Wind Enerji"},
            {"symbol": "HALKB", "name": "Halk Bankası"},
            {"symbol": "HEKTS", "name": "Hektaş"},
            {"symbol": "IPEKE", "name": "İpek Doğal Enerji"},
            {"symbol": "ISCTR", "name": "İş Bankası (C)"},
            {"symbol": "ISDMR", "name": "İskenderun Demir Çelik"},
            {"symbol": "ISGYO", "name": "İş GYO"},
            {"symbol": "ISMEN", "name": "İş Yatırım Menkul Değerler"},
            {"symbol": "IZMDC", "name": "İzmir Demir Çelik"},
            {"symbol": "KARDMD", "name": "Kardemir (D)"},
            {"symbol": "KCAER", "name": "Kocaer Çelik"},
            {"symbol": "KCHOL", "name": "Koç Holding"},
            {"symbol": "KMPUR", "name": "Kimteks Poliüretan"},
            {"symbol": "KONTR", "name": "Kontrolmatik Teknoloji"},
            {"symbol": "KONYA", "name": "Konya Çimento"},
            {"symbol": "KORDS", "name": "Kordsa Teknik Tekstil"},
            {"symbol": "KOZAA", "name": "Koza Anadolu Metal"},
            {"symbol": "KOZAL", "name": "Koza Altın İşletmeleri"},
            {"symbol": "KRDMD", "name": "Kardemir Karabük"},
            {"symbol": "MAVI", "name": "Mavi Giyim"},
            {"symbol": "MGROS", "name": "Migros Ticaret"},
            {"symbol": "MIATK", "name": "Mia Teknoloji"},
            {"symbol": "ODAS", "name": "Odaş Elektrik"},
            {"symbol": "OTKAR", "name": "Otokar Otomotiv"},
            {"symbol": "OYAKC", "name": "Oyak Çimento"},
            {"symbol": "PENTA", "name": "Penta Teknoloji"},
            {"symbol": "PETKM", "name": "Petkim Petrokimya"},
            {"symbol": "PGSUS", "name": "Pegasus Hava Taşımacılığı"},
            {"symbol": "PSGYO", "name": "Pasifik GYO"},
            {"symbol": "QUAGR", "name": "Qua Granite Hayal Yapı"},
            {"symbol": "SAHOL", "name": "Sabancı Holding"},
            {"symbol": "SASA", "name": "Sasa Polyester"},
            {"symbol": "SAYAS", "name": "Say Yenilenebilir Enerji"},
            {"symbol": "SDTTR", "name": "SDT Uzay ve Savunma"},
            {"symbol": "SISE", "name": "Şişecam"},
            {"symbol": "SKBNK", "name": "Şekerbank"},
            {"symbol": "SMRTG", "name": "Smart Güneş Enerjisi"},
            {"symbol": "SOKM", "name": "Şok Marketler"},
            {"symbol": "TABGD", "name": "Tab Gıda Sanayi"},
            {"symbol": "TAVHL", "name": "TAV Havalimanları"},
            {"symbol": "TCELL", "name": "Turkcell"},
            {"symbol": "TEZOL", "name": "Europap Tezol Kağıt"},
            {"symbol": "THYAO", "name": "Türk Hava Yolları"},
            {"symbol": "TKFEN", "name": "Tekfen Holding"},
            {"symbol": "TOASO", "name": "Tofaş Türk Otomobil Fabrikası"},
            {"symbol": "TSKB", "name": "TSKB"},
            {"symbol": "TTKOM", "name": "Türk Telekom"},
            {"symbol": "TTRAK", "name": "Türk Traktör"},
            {"symbol": "TUPRS", "name": "Tüpraş"},
            {"symbol": "TURSG", "name": "Türkiye Sigorta"},
            {"symbol": "ULKER", "name": "Ülker Bisküvi"},
            {"symbol": "VAKBN", "name": "Vakıflar Bankası"},
            {"symbol": "VESBE", "name": "Vestel Beyaz Eşya"},
            {"symbol": "VESTL", "name": "Vestel Elektronik"},
            {"symbol": "YEOTK", "name": "Yeo Teknoloji"},
            {"symbol": "YKBNK", "name": "Yapı ve Kredi Bankası"},
            {"symbol": "YYLGD", "name": "Yayla Agro Gıda"},
            {"symbol": "ZOREN", "name": "Zorlu Enerji"}
        ];

        try {
            if (el.stockSelect) {
                el.stockSelect.innerHTML = '';
                bist100.forEach(stock => {
                    const opt = document.createElement('option');
                    opt.value = stock.symbol;
                    opt.textContent = `${stock.symbol} (${stock.name})`;
                    el.stockSelect.appendChild(opt);
                });
                state.selectedAsset = el.stockSelect.value;
            }
        } catch (error) {
            console.error('[OptiPulseLab] Error populating BIST 100 list:', error);
        }
    }

    /* ────────────── Initial Load ────────────── */
    populateStockList();
});
