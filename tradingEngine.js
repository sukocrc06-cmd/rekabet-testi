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
    const DEFAULT_BALANCE = 100000;
    const TICK_MS = 2000;

    let DC = null;
    let priceProfiles = {};
    let portfolio = null;

    const state = {
        activeSymbol: null,
        side: 'BUY',          // BUY | SELL
        orderType: 'MARKET',  // MARKET | LIMIT
        watchlistFilter: ''
    };

    /* ────────── DOM helpers ────────── */
    function byId(id) { return document.getElementById(id); }

    // All full-screen modal backdrop ids in the app — used so opening one
    // reliably closes any other that might already be open.
    const ALL_MODAL_BACKDROP_IDS = ['indicator-modal-backdrop', 'alerts-modal-backdrop', 'sltp-modal-backdrop', 'heatmap-modal-backdrop', 'shortcuts-modal-backdrop'];
    function closeOtherModals(exceptId) {
        ALL_MODAL_BACKDROP_IDS.forEach(id => {
            if (id === exceptId) return;
            const el = byId(id);
            if (el) el.classList.remove('open');
        });
    }
    window.__optipulseCloseOtherModals = closeOtherModals; // used by tradingChart.js's indicator modal

    function fmtTRY(v) {
        const sign = v < 0 ? '-' : '';
        return sign + '₺' + Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtPrice(v) {
        if (v === null || v === undefined || isNaN(v)) return '--';
        return v >= 1000 ? v.toFixed(0) : v.toFixed(2);
    }
    function genId() { return 'ord_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    /* ════════════════════════════════════════════════
       Portfolio persistence
       ════════════════════════════════════════════════ */

    function loadPortfolio() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.balance === 'number') return parsed;
            }
        } catch (e) { /* ignore corrupt storage */ }
        return { balance: DEFAULT_BALANCE, positions: {}, history: [] };
    }

    function savePortfolio() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio)); } catch (e) { /* quota / private mode */ }
    }

    function resetPortfolio() {
        portfolio = { balance: DEFAULT_BALANCE, positions: {}, history: [] };
        savePortfolio();
        renderPositions();
        renderOrders();
        renderAccountSummary();
        equityHistory.length = 0;
        sampleEquity();
        renderPerformanceTab();
        showToast('Portföy sıfırlandı: ' + fmtTRY(DEFAULT_BALANCE));
    }

    /* ════════════════════════════════════════════════
       Price simulation
       ════════════════════════════════════════════════ */

    function buildPriceProfiles() {
        const profiles = {};
        DC.BIST100.forEach(({ symbol }) => {
            const known = DC.STOCK_PROFILES[symbol];
            if (known) {
                profiles[symbol] = { price: known.basePrice, dayOpen: known.basePrice, volatility: known.volatility, name: known.name };
                return;
            }
            const hash = Array.from(symbol).reduce((s, c) => s * 31 + c.charCodeAt(0), 0);
            const base = +(15 + Math.abs(hash % 400) + (Math.abs(hash) % 100) / 100).toFixed(2);
            profiles[symbol] = { price: base, dayOpen: base, volatility: 0.012 + (Math.abs(hash) % 8) / 1000 };
        });
        return profiles;
    }

    function tickPrices() {
        Object.keys(priceProfiles).forEach(sym => {
            const p = priceProfiles[sym];
            const meanReversion = (p.dayOpen - p.price) * 0.02;
            const shock = (Math.random() - 0.5) * p.volatility * p.price;
            let next = p.price + shock + meanReversion;
            const capUp = p.dayOpen * 1.06, capDown = p.dayOpen * 0.94;
            next = Math.max(capDown, Math.min(capUp, next));
            p.price = +next.toFixed(2);
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
        checkAlerts();

        sampleEquity();
        if (byId('panel-tab-performance')?.classList.contains('active')) renderPerformanceTab();
        if (byId('heatmap-modal-backdrop')?.classList.contains('open')) renderHeatmap();
    }

    function getPrice(symbol) {
        return priceProfiles[symbol] ? priceProfiles[symbol].price : null;
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

        return { closed, wins, losses, grossProfit, grossLoss, totalPnl, winRate, profitFactor, best, worst, bySymbol };
    }

    function renderPerformanceTab() {
        const totalPnlEl = byId('perf-total-pnl');
        if (!totalPnlEl) return; // tab markup not present

        const stats = computePerformanceStats();
        const winRateEl = byId('perf-win-rate');
        const tradeCountEl = byId('perf-trade-count');
        const pfEl = byId('perf-profit-factor');
        const bestEl = byId('perf-best-trade');
        const worstEl = byId('perf-worst-trade');
        const listEl = byId('perf-symbol-list');

        totalPnlEl.textContent = (stats.totalPnl >= 0 ? '+' : '') + fmtTRY(stats.totalPnl);
        totalPnlEl.className = 'perf-stat-val ' + (stats.totalPnl >= 0 ? 'profit-text' : 'loss-text');

        if (winRateEl) winRateEl.textContent = stats.closed.length ? stats.winRate.toFixed(1) + '%' : '--';
        if (tradeCountEl) tradeCountEl.textContent = String(stats.closed.length);
        if (pfEl) pfEl.textContent = stats.closed.length ? (stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)) : '--';
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
            return { symbol, price: p.price, chgPct };
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

    function renderHeatmap() {
        const grid = byId('heatmap-grid');
        if (!grid) return;
        const data = computeHeatmapData().sort((a, b) => b.chgPct - a.chgPct);
        grid.innerHTML = data.map(d => {
            const sign = d.chgPct >= 0 ? '+' : '';
            return '<div class="heatmap-tile" style="background-color:' + heatmapColor(d.chgPct) + '" data-symbol="' + d.symbol + '" title="' + d.symbol + ' ' + sign + d.chgPct.toFixed(2) + '% · ₺' + fmtPrice(d.price) + '">' +
                '<span class="heatmap-tile-symbol">' + d.symbol + '</span>' +
                '<span class="heatmap-tile-chg">' + sign + d.chgPct.toFixed(2) + '%</span>' +
                '</div>';
        }).join('');

        grid.querySelectorAll('.heatmap-tile').forEach(tile => {
            tile.addEventListener('click', () => {
                const symbol = tile.dataset.symbol;
                byId('heatmap-modal-backdrop')?.classList.remove('open');
                selectSymbol(symbol);
            });
        });
    }

    function setupHeatmapModal() {
        const backdrop = byId('heatmap-modal-backdrop');
        const openBtn = byId('btn-open-heatmap');
        const closeBtn = byId('btn-close-heatmap');
        if (!backdrop || !openBtn) return;

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

            // Ctrl/Cmd+K or '/' focuses the symbol search box.
            if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !isTyping)) {
                e.preventDefault();
                byId('watchlist-search')?.focus();
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
                    document.querySelector('#chart-toolbar [data-tool="undo"]')?.click();
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
            }
        });
    }

    /* ════════════════════════════════════════════════
       Watchlist
       ════════════════════════════════════════════════ */

    function renderWatchlistRows() {
        const body = byId('watchlist-body');
        if (!body) return;
        let html = '';
        DC.BIST100.forEach(({ symbol, name }) => {
            html += `
                <div class="watchlist-row" data-symbol="${symbol}" data-name="${name.toLowerCase()}">
                    <div class="wl-main">
                        <span class="wl-symbol">${symbol}</span>
                        <span class="wl-name">${name}</span>
                    </div>
                    <div class="wl-price-col">
                        <span class="wl-price" id="wl-price-${symbol}">--</span>
                        <span class="wl-change" id="wl-change-${symbol}">--</span>
                    </div>
                </div>
            `;
        });
        body.innerHTML = html;

        body.querySelectorAll('.watchlist-row').forEach(row => {
            row.addEventListener('click', () => selectSymbol(row.dataset.symbol));
        });
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
        });
    }

    function setupWatchlistSearch() {
        const input = byId('watchlist-search');
        if (!input) return;
        input.addEventListener('input', () => {
            const term = input.value.trim().toLowerCase();
            state.watchlistFilter = term;
            document.querySelectorAll('.watchlist-row').forEach(row => {
                const match = !term || row.dataset.symbol.toLowerCase().includes(term) || row.dataset.name.includes(term);
                row.style.display = match ? 'flex' : 'none';
            });
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
        const bar = byId('tv-chart-tabs-bar');
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
        state.activeSymbol = symbol;
        openSymbolTab(symbol);
        renderChartTabs();

        document.querySelectorAll('.watchlist-row').forEach(row => {
            row.classList.toggle('active', row.dataset.symbol === symbol);
        });

        // Keep the (hidden) legacy <select> in sync so the existing backtest
        // pipeline (app.js) continues to auto-run on symbol changes. This is
        // what feeds the "Price Action" (Analiz Paneli) chart with real
        // fetched OHLCV data.
        const select = byId('stock-select');
        if (select) {
            select.value = symbol;
            select.dispatchEvent(new Event('change'));
        }

        updateActiveSymbolTicket();
        renderPositions();
        renderOrderBook(symbol);
        renderRecentTrades(symbol);

        if (window.TradingChart) {
            const chartInfo = await window.TradingChart.loadSymbol(symbol);
            // Re-anchor the simulated demo tick price to the real last close
            // that was just fetched, instead of the hardcoded STOCK_PROFILES
            // fallback seed. Without this, the live trading chart drifts
            // toward a fabricated price while the Price Action (backtest)
            // chart — which uses the real fetched data — keeps showing the
            // actual last close, so the two charts silently disagree on
            // "the current price" for the same symbol.
            if (chartInfo && chartInfo.lastClose && priceProfiles[symbol]) {
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
        const qtyInput = byId('qt-qty');
        const limitInput = byId('qt-limit-price');
        const submitBtn = byId('qt-submit');
        const resetBtn = byId('qt-reset-portfolio');
        const sltpToggle = byId('qt-sltp-toggle');
        const sltpRow = byId('qt-sltp-row');

        if (buyTab) buyTab.addEventListener('click', () => setSide('BUY'));
        if (sellTab) sellTab.addEventListener('click', () => setSide('SELL'));
        if (marketTab) marketTab.addEventListener('click', () => setOrderType('MARKET'));
        if (limitTab) limitTab.addEventListener('click', () => setOrderType('LIMIT'));
        if (qtyInput) qtyInput.addEventListener('input', updateEstimate);
        if (limitInput) limitInput.addEventListener('input', updateEstimate);
        if (sltpToggle && sltpRow) {
            sltpToggle.addEventListener('change', () => {
                sltpRow.style.display = sltpToggle.checked ? 'flex' : 'none';
            });
        }

        document.querySelectorAll('.qty-pct-btn').forEach(btn => {
            btn.addEventListener('click', () => applyQtyPct(parseInt(btn.dataset.pct, 10)));
        });

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
        const limitRow = byId('qt-limit-row');
        if (marketTab) marketTab.classList.toggle('active', type === 'MARKET');
        if (limitTab) limitTab.classList.toggle('active', type === 'LIMIT');
        if (limitRow) limitRow.style.display = type === 'LIMIT' ? 'flex' : 'none';
        updateEstimate();
    }

    function applyQtyPct(pct) {
        if (!state.activeSymbol) return;
        const price = effectivePrice();
        if (!price) return;
        const commissionPct = getCommissionPct();
        let qty;
        if (state.side === 'BUY') {
            const usable = portfolio.balance * (pct / 100);
            qty = Math.floor(usable / (price * (1 + commissionPct / 100)));
        } else {
            const pos = portfolio.positions[state.activeSymbol];
            if (pos && pos.side === 'LONG') {
                qty = Math.floor(pos.qty * (pct / 100));
            } else {
                const usable = portfolio.balance * (pct / 100);
                qty = Math.floor(usable / price);
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
        if (!estEl) return;
        const price = effectivePrice();
        const qtyInput = byId('qt-qty');
        const qty = qtyInput ? parseInt(qtyInput.value, 10) || 0 : 0;
        if (!price || !qty) { estEl.textContent = '--'; return; }
        const commissionPct = getCommissionPct();
        const commission = price * qty * (commissionPct / 100);
        const total = price * qty + commission;
        estEl.textContent = `${fmtTRY(total)} (kom. ${fmtTRY(commission)})`;
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
        if (!state.activeSymbol) { showToast('Önce bir sembol seçin.'); return; }
        const qtyInput = byId('qt-qty');
        const qty = qtyInput ? Math.floor(Number(qtyInput.value)) : 0;
        const price = effectivePrice();
        const commissionPct = getCommissionPct();

        if (!qty || qty <= 0) { showToast('Geçerli bir miktar girin.'); return; }
        if (!price || price <= 0) { showToast('Fiyat bilgisi alınamadı.'); return; }

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
                showToast(`Stop-Loss fiyatı ${willBeLong ? 'giriş fiyatının altında' : 'giriş fiyatının üzerinde'} olmalı.`);
                return;
            }
            if (tpPrice !== null && ((willBeLong && tpPrice <= price) || (!willBeLong && tpPrice >= price))) {
                showToast(`Take-Profit fiyatı ${willBeLong ? 'giriş fiyatının üzerinde' : 'giriş fiyatının altında'} olmalı.`);
                return;
            }
        }

        if (state.orderType === 'LIMIT') {
            // Simplified: simulate immediate fill against current market for demo purposes,
            // since this is a sandbox with no real order book.
            showToast(`Limit emir ${fmtPrice(price)} seviyesinden gerçekleşti (demo).`);
        }

        const result = placeOrder(state.activeSymbol, state.side, qty, price, commissionPct);
        if (!result.ok) {
            showToast(result.msg);
            return;
        }

        // Attach SL/TP only if this order actually opened/added to a position in its
        // own direction (not just reducing/closing an opposite one).
        if ((slPrice !== null || tpPrice !== null)) {
            const pos = portfolio.positions[state.activeSymbol];
            const expectedSide = state.side === 'BUY' ? 'LONG' : 'SHORT';
            if (pos && pos.side === expectedSide) {
                if (slPrice !== null) pos.sl = slPrice;
                if (tpPrice !== null) pos.tp = tpPrice;
                savePortfolio();
            }
        }

        renderPositions();
        renderOrders();
        renderAccountSummary();
        showToast(`${state.side === 'BUY' ? 'Alım' : 'Satım'} emri gerçekleşti: ${qty} adet ${state.activeSymbol} @ ₺${fmtPrice(price)}`);
        if (qtyInput) qtyInput.value = '';
        if (sltpToggle) { sltpToggle.checked = false; }
        const sltpRow = byId('qt-sltp-row');
        if (sltpRow) sltpRow.style.display = 'none';
        const slInput = byId('qt-sl-price'), tpInput = byId('qt-tp-price');
        if (slInput) slInput.value = '';
        if (tpInput) tpInput.value = '';
        updateEstimate();
    }

    function placeOrder(symbol, side, qty, price, commissionPct) {
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
            let realizedPnl;

            if (pos.side === 'LONG') {
                realizedPnl = (price - pos.avgPrice) * closeQty - closeCommission;
                portfolio.balance += closeQty * price - closeCommission;
            } else {
                realizedPnl = (pos.avgPrice - price) * closeQty - closeCommission;
                portfolio.balance -= closeQty * price + closeCommission;
            }

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

            if (newSide === 'LONG') {
                const cost = price * remainingQty + openCommission;
                if (portfolio.balance < cost) {
                    savePortfolio();
                    return { ok: false, msg: 'Yetersiz demo bakiye.' };
                }
                portfolio.balance -= cost;
            } else {
                portfolio.balance += price * remainingQty - openCommission;
            }

            if (!portfolio.positions[symbol]) {
                portfolio.positions[symbol] = { side: newSide, qty: remainingQty, avgPrice: price };
            } else {
                const p = portfolio.positions[symbol];
                const totalQty = p.qty + remainingQty;
                p.avgPrice = (p.avgPrice * p.qty + price * remainingQty) / totalQty;
                p.qty = totalQty;
            }

            portfolio.history.unshift({
                id: genId(), ts: Date.now(), symbol, side, qty: remainingQty, price,
                type: 'OPEN', commission: +openCommission.toFixed(2), pnl: null
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
                    : `${symbol} pozisyonu kapatıldı.`;
            showToast(msg);
        }
    }
    window.__optipulseClosePosition = closePosition; // used by inline onclick in rendered rows

    /* ════════════════════════════════════════════════
       Stop-Loss / Take-Profit auto-execution
       ════════════════════════════════════════════════ */

    function checkStopLossTakeProfit() {
        Object.keys(portfolio.positions).forEach(symbol => {
            const pos = portfolio.positions[symbol];
            if (!pos.sl && !pos.tp) return;
            const price = getPrice(symbol);
            if (!price) return;
            if (pos.side === 'LONG') {
                if (pos.sl && price <= pos.sl) { closePosition(symbol, 'SL'); return; }
                if (pos.tp && price >= pos.tp) { closePosition(symbol, 'TP'); return; }
            } else {
                if (pos.sl && price >= pos.sl) { closePosition(symbol, 'SL'); return; }
                if (pos.tp && price <= pos.tp) { closePosition(symbol, 'TP'); return; }
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
            body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px; font-size:11px;">Açık pozisyon yok</td></tr>`;
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
            html += `
                <tr>
                    <td class="font-bold">${symbol}${sltpSub}</td>
                    <td><span class="badge ${sideClass}">${pos.side}</span></td>
                    <td class="font-mono">${pos.qty}</td>
                    <td class="font-mono">₺${fmtPrice(pos.avgPrice)}</td>
                    <td class="font-mono ${pnlClass}">${unrealized >= 0 ? '+' : ''}${fmtTRY(unrealized)}</td>
                    <td>
                        <div class="pos-actions-cell">
                            <button class="btn-sltp-edit ${hasSltp ? 'has-sltp' : ''}" onclick="window.__optipulseOpenSltp('${symbol}')" title="Stop-Loss / Take-Profit">SL/TP</button>
                            <button class="btn-close-pos" onclick="window.__optipulseClosePosition('${symbol}')">Kapat</button>
                        </div>
                    </td>
                </tr>
            `;
        });
        body.innerHTML = html;
    }

    function renderOrders() {
        const body = byId('qt-orders-body');
        if (!body) return;
        if (!portfolio.history.length) {
            body.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px; font-size:11px;">Emir geçmişi yok</td></tr>`;
            return;
        }
        let html = '';
        portfolio.history.slice(0, 12).forEach(h => {
            const t = new Date(h.ts);
            const timeStr = t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const sideClass = h.side === 'BUY' ? 'badge-long' : 'badge-short';
            const pnlStr = h.pnl !== null ? `<span class="${h.pnl >= 0 ? 'profit-text' : 'loss-text'}">${h.pnl >= 0 ? '+' : ''}${fmtTRY(h.pnl)}</span>` : '<span class="font-mono" style="color:var(--text-muted)">--</span>';
            html += `
                <tr>
                    <td class="font-mono" style="font-size:10px;">${timeStr}</td>
                    <td class="font-bold">${h.symbol}</td>
                    <td><span class="badge ${sideClass}">${h.side}</span></td>
                    <td class="font-mono">${h.qty}@₺${fmtPrice(h.price)}</td>
                    <td>${pnlStr}</td>
                </tr>
            `;
        });
        body.innerHTML = html;
    }

    function renderAccountSummary() {
        let longValue = 0, shortValue = 0, openPnl = 0;
        Object.keys(portfolio.positions).forEach(symbol => {
            const pos = portfolio.positions[symbol];
            const current = getPrice(symbol) || pos.avgPrice;
            if (pos.side === 'LONG') {
                longValue += pos.qty * current;
                openPnl += (current - pos.avgPrice) * pos.qty;
            } else {
                shortValue += pos.qty * current;
                openPnl += (pos.avgPrice - current) * pos.qty;
            }
        });
        const equity = portfolio.balance + longValue - shortValue;

        // Balance now lives in the header pill (top right) rather than the trade ticket itself
        const headerBalEl = byId('header-balance-value');
        const eqEl = byId('qt-equity');
        const pnlEl = byId('qt-openpnl');
        if (headerBalEl) headerBalEl.textContent = fmtTRY(portfolio.balance);
        if (eqEl) eqEl.textContent = fmtTRY(equity);
        if (pnlEl) {
            pnlEl.textContent = (openPnl >= 0 ? '+' : '') + fmtTRY(openPnl);
            pnlEl.className = 'acct-value ' + (openPnl >= 0 ? 'profit-text' : 'loss-text');
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
        setupGlobalShortcuts();
        renderPositions();
        renderOrders();
        renderAccountSummary();
        updateAlertBadge();
        sampleEquity();

        setInterval(tickPrices, TICK_MS);

        // Select a sensible default symbol on load
        const first = DC.BIST100.find(s => s.symbol === 'THYAO') || DC.BIST100[0];
        if (first) selectSymbol(first.symbol);
    }

    return Object.freeze({
        init,
        selectSymbol,
        getPrice,
        closePosition,
        resetPortfolio
    });
})();

window.TradingEngine = TradingEngine;
