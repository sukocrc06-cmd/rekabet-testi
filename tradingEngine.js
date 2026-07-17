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

        checkAlerts();
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
            });
        });
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
            // Only one modal at a time — close the indicators modal if it's open.
            const indBackdrop = byId('indicator-modal-backdrop');
            if (indBackdrop) indBackdrop.classList.remove('open');

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

    async function selectSymbol(symbol) {
        state.activeSymbol = symbol;

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

        if (buyTab) buyTab.addEventListener('click', () => setSide('BUY'));
        if (sellTab) sellTab.addEventListener('click', () => setSide('SELL'));
        if (marketTab) marketTab.addEventListener('click', () => setOrderType('MARKET'));
        if (limitTab) limitTab.addEventListener('click', () => setOrderType('LIMIT'));
        if (qtyInput) qtyInput.addEventListener('input', updateEstimate);
        if (limitInput) limitInput.addEventListener('input', updateEstimate);

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

        renderPositions();
        renderOrders();
        renderAccountSummary();
        showToast(`${state.side === 'BUY' ? 'Alım' : 'Satım'} emri gerçekleşti: ${qty} adet ${state.activeSymbol} @ ₺${fmtPrice(price)}`);
        if (qtyInput) qtyInput.value = '';
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

    function closePosition(symbol) {
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
            showToast(`${symbol} pozisyonu kapatıldı.`);
        }
    }
    window.__optipulseClosePosition = closePosition; // used by inline onclick in rendered rows

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
            html += `
                <tr>
                    <td class="font-bold">${symbol}</td>
                    <td><span class="badge ${sideClass}">${pos.side}</span></td>
                    <td class="font-mono">${pos.qty}</td>
                    <td class="font-mono">₺${fmtPrice(pos.avgPrice)}</td>
                    <td class="font-mono ${pnlClass}">${unrealized >= 0 ? '+' : ''}${fmtTRY(unrealized)}</td>
                    <td><button class="btn-close-pos" onclick="window.__optipulseClosePosition('${symbol}')">Kapat</button></td>
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
        renderPositions();
        renderOrders();
        renderAccountSummary();
        updateAlertBadge();

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
