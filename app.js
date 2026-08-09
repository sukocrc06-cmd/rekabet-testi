/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB APPLICATION CONTROLLER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * (23 Temmuz 2026, on üçüncü oturum — "motoru güçlendirme" temizliği)
 * Bu dosya önceden, artık var olmayan bir "Geriye Dönük Test Ayarları" paneli
 * ve Canvas tabanlı (chartRenderer.js) bir backtest raporlama arayüzü
 * etrafında kurulmuş ~1000 satırlık ölü bir kod tabanı taşıyordu — tetikleyici
 * düğmesi (#btn-run-backtest) ve hedef DOM elemanlarının (canvas'lar, metrik
 * kartları, karşılaştırma paneli, risk monitörü, OOS doğrulama vb.) HİÇBİRİ
 * artık index.html'de bulunmuyordu (grep ile tek tek doğrulandı), yani bu
 * kod hiçbir kullanıcı etkileşimiyle asla çalışamıyordu. Üstelik bu ölü
 * kodun içinde SAHTE/UYDURMA performans metrikleri de vardı (ör. Sharpe
 * Oranı `total_profit > 0 ? 1.85 : 0.45` gibi ikili bir varsayımdan
 * üretiliyordu, gerçek hiçbir hesaplamaya dayanmıyordu) — projenin "sahte
 * veri yok" ilkesiyle çelişen bir risk olduğu için tamamen kaldırıldı.
 *
 * Bu dosyada artık SADECE gerçekten çalışan/ulaşılabilen şeyler var:
 *   • "Sıfırla" butonu → canlı kağıt-üzerinde-işlem (paper trading) portföyünü sıfırlar
 *   • Mobil kayar (drawer) paneller
 *   • Backend heartbeat (canlı/offline motor durumu) + ipucu metni
 *   • Canlı veri noktası (yeşil/gri gösterge) durumu
 *   • Saat ve piyasa açık/kapalı durumu
 *
 * Canvas tabanlı grafik render motoru (chartRenderer.js) artık hiçbir yerden
 * çağrılmadığı için index.html'den de kaldırıldı.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {

    function safeGetElement(id) {
        return document.getElementById(id) || null;
    }

    const DC = window.DataController;

    if (!DC) {
        console.error('[OptiPulseLab] DataController not found. Ensure dataController.js loads first.');
        return;
    }

    /* ────────────── DOM Cache ────────────── */

    const $ = (sel) => document.querySelector(sel);

    const el = {
        engineStatus: $('#engine-status'),
        marketTime: $('#market-time'),
        marketStatusVal: $('#market-status-val'),
        marketStatusSub: $('#market-status-sub')
    };

    /* ────────────── Reset ──────────────
     * (6 Ağustos 2026 — "portföy sıfırlama artık sadece admin yapabilsin")
     * Bu, header'daki "Reset" butonuna bağlıydı ve yarışmacının kendi
     * portföyünü TEK TIKLA (hiçbir onay sormadan) sıfırlamasına izin
     * veriyordu. Buton index.html'den kaldırıldı, bu wiring de onunla
     * birlikte kaldırıldı — sıfırlama artık SADECE admin panelinden
     * (finteclubBridge.js'in dinlediği komut kanalı üzerinden) yapılabiliyor.
     * window.TradingEngine.resetPortfolio() fonksiyonunun kendisi hâlâ
     * mevcut ve donmuş genel API'de duruyor — sadece buradaki kullanıcı
     * tetikleyicisi kaldırıldı. */

    /* ────────────── Mobil/Dar Ekran Kayar (Drawer) Paneller ──────────────
     * 980px altında sidebar (Piyasa) ve işlem paneli artık sabit sütun
     * değil, header'daki iki ikon butonla açılıp kapanan kayar panellere
     * dönüşüyor (bkz. styles.css "Responsive Adjustments" bölümü, 17
     * Temmuz 2026 yedinci oturum). Aynı anda sadece bir panel açık kalsın
     * diye biri açılırken diğeri kapatılıyor; backdrop'a tıklamak veya Esc
     * her ikisini de kapatıyor. */
    (function setupMobileDrawers() {
        const sidebar = document.getElementById('sidebar-panel');
        const tradePanel = document.getElementById('trading-panel');
        const backdrop = document.getElementById('mobile-drawer-backdrop');
        const btnSidebar = document.getElementById('btn-toggle-sidebar');
        const btnTradePanel = document.getElementById('btn-toggle-tradepanel');
        if (!sidebar || !tradePanel || !backdrop || !btnSidebar || !btnTradePanel) return;

        function closeAllDrawers() {
            sidebar.classList.remove('drawer-open');
            tradePanel.classList.remove('drawer-open');
            backdrop.classList.remove('visible');
        }

        function toggleDrawer(panelEl) {
            const willOpen = !panelEl.classList.contains('drawer-open');
            closeAllDrawers();
            if (willOpen) {
                panelEl.classList.add('drawer-open');
                backdrop.classList.add('visible');
            }
        }

        btnSidebar.addEventListener('click', () => toggleDrawer(sidebar));
        btnTradePanel.addEventListener('click', () => toggleDrawer(tradePanel));
        backdrop.addEventListener('click', closeAllDrawers);

        // Panel içindeki net "X" kapatma butonları — arka planın dar bir
        // kesimine dokunmaya güvenmek yerine belirsizliksiz bir kapatma yolu.
        const btnCloseSidebar = document.getElementById('btn-close-sidebar-drawer');
        const btnCloseTradePanel = document.getElementById('btn-close-tradepanel-drawer');
        if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeAllDrawers);
        if (btnCloseTradePanel) btnCloseTradePanel.addEventListener('click', closeAllDrawers);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllDrawers();
        });

        // Bir hisse seçildiğinde (sidebar'daki izleme listesinden) dar
        // ekranda sidebar'ı otomatik kapatıp grafiği göstermek daha doğal —
        // TradingEngine bunu dinleyebilsin diye global bir yardımcı bırak.
        window.__optipulseCloseMobileDrawers = closeAllDrawers;

        // Geniş ekrana geri dönüldüğünde (ör. pencere büyütme) drawer
        // state'i takılı kalmasın.
        window.addEventListener('resize', () => {
            if (window.innerWidth > 980) closeAllDrawers();
        });
    })();

    /* ────────────── Live Clock & Heartbeat ────────────── */

    function updateClock() {
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
    }

    function checkBackendHeartbeat() {
        // Poll health endpoint. This calls a local address (127.0.0.1) from
        // a page that may be loaded over public HTTPS (e.g. the Vercel
        // deployment), which Chrome flags under its "Private Network
        // Access" policy. Kept on a slow interval (not every second) to
        // minimize that footprint; the backend also opts in explicitly via
        // the Access-Control-Allow-Private-Network response header. It also
        // sets targetAddressSpace: 'loopback' (127.0.0.1 is specifically the
        // "loopback" address space, not "local" — Chrome distinguishes the
        // two) so Chrome correctly recognizes this as a loopback request
        // under its Local Network Access (LNA) permission model instead of
        // blocking it with an address-space mismatch error.
        fetch(`${window.OPTIPULSE_CONFIG.BACKEND_HTTP}/api/v1/health`, window.optipulseFetchOpts())
            .then(res => {
                if (!res.ok) throw new Error('Unhealthy status');
                return res.json();
            })
            .then(data => {
                if (data.status === 'ok') {
                    if (el.engineStatus) {
                        el.engineStatus.innerText = 'ONLINE';
                        // (9 Ağustos 2026 — "Kurumsal Mavi" tema düzeltmesi)
                        // Önceden 'var(--profit)' idi — styles.css'te HİÇBİR
                        // YERDE tanımlı değildi (kontrol edildi), yani bu satır
                        // hep sessizce başarısız oluyor, metin miras alınan
                        // varsayılan renkte kalıyordu. Gerçekten tanımlı ve
                        // her üç temada da (Koyu/Açık/Kurumsal Mavi) doğru
                        // yeşile karşılık gelen '--success' kullanılıyor.
                        el.engineStatus.style.color = 'var(--success)';
                    }
                }
                updateEngineTooltip();
            })
            .catch(err => {
                console.warn('[Heartbeat] Backend server connection failed:', err);
                if (el.engineStatus) {
                    el.engineStatus.innerText = 'OFFLINE';
                    // (9 Ağustos 2026) Sabit '#F44336' yerine '--danger' —
                    // yukarıdaki ONLINE düzeltmesiyle aynı gerekçe.
                    el.engineStatus.style.color = 'var(--danger)';
                }
                updateEngineTooltip();
            });
    }

    // (17-18 Temmuz 2026, sekizinci oturum — "motor" geliştirmesi) Aktif
    // sembol için kurulan WebSocket canlı veri akışının durumunu, mevcut
    // ENGINE rozetine YENİ bir panel/metin eklemeden, sadece üzerine
    // gelince görünen bir ipucuyla (native tooltip) gösteriyoruz — rozetin
    // görünür metni hâlâ sadece backend'in ayakta olup olmadığını (REST
    // heartbeat) yansıtıyor, ayrıntı isteyen fare ile üzerine gelip bakıyor.
    let lastLiveFeedStatus = { active: false, symbol: null, lastTickAt: null };
    function updateEngineTooltip() {
        updateLiveDataDot();
        if (!el.engineStatus) return;
        const target = safeGetElement('engine-status-item') || el.engineStatus;
        const backendUp = el.engineStatus.innerText === 'ONLINE';
        if (!backendUp) {
            target.title = 'Backend sunucusuna ulaşılamıyor — fiyatlar tamamen yerel simülasyondan geliyor.';
            return;
        }
        // (18 Temmuz 2026, onuncu oturum, beşinci tur — Madde: "veri gecikme/
        // güncellik etiketini netleştir") yfinance ücretsiz veri kaynağı
        // gerçek ama genelde birkaç dakika gecikmeli oluyor (borsanın kendi
        // gerçek zamanlı/ücretli veri akışıyla birebir aynı anda değil) —
        // önceden bu ayrım tooltip metninde netleşmiyordu, "gerçek zamanlı"
        // ifadesi yanlış bir kesinlik izlenimi verebiliyordu. Artık her iki
        // dalda da bu netleştirilmiş.
        if (lastLiveFeedStatus.active && lastLiveFeedStatus.symbol) {
            const secsAgo = lastLiveFeedStatus.lastTickAt ? Math.round((Date.now() - lastLiveFeedStatus.lastTickAt) / 1000) : null;
            target.title = lastLiveFeedStatus.symbol + ' için gerçek yfinance verisi akıyor (genelde birkaç dakika gecikmeli — anlık/ücretli borsa verisi değildir)' +
                (secsAgo !== null ? '; son güncelleme ' + secsAgo + 'sn önce.' : '.');
        } else {
            target.title = 'Backend çalışıyor. Şu an gösterilen fiyatlar yerel simülasyon — canlı veri akışı henüz bağlanmadı veya bu sembol için kullanılamıyor. (Bağlandığında da yfinance verisi genelde birkaç dakika gecikmeli olur.)';
        }
    }
    // (18 Temmuz 2026, dokuzuncu oturum — "canlı veri durumu için küçük
    // görsel gösterge") Grafik başlığındaki sembol adının yanına, o an
    // ekrandaki fiyatın gerçek WebSocket akışından mı yoksa yerel
    // simülasyondan mı geldiğini gösteren küçük bir nokta. Ayrı bir "motor
    // paneli" değil — mevcut sembol başlığının yanına eklenen minik bir
    // durum işareti (kullanıcının seçtiği "arayüz" özelliği).
    function updateLiveDataDot() {
        const dot = safeGetElement('live-data-dot');
        if (!dot) return;
        const symbolEl = safeGetElement('tv-symbol-name');
        // tv-symbol-name metni "THYAO.IS" gibi ".IS" sonekli gösteriliyor
        // (bkz. tradingChart.js → setSymbolHeader), ama lastLiveFeedStatus
        // yalın sembolü ("THYAO") taşıyor — karşılaştırmadan önce soneği at.
        const currentSymbol = symbolEl ? symbolEl.textContent.trim().replace(/\.IS$/i, '') : null;
        const isLiveForCurrentSymbol = lastLiveFeedStatus.active &&
            lastLiveFeedStatus.symbol &&
            currentSymbol &&
            lastLiveFeedStatus.symbol === currentSymbol;
        dot.classList.toggle('is-live', !!isLiveForCurrentSymbol);
        dot.title = isLiveForCurrentSymbol
            ? 'Gerçek yfinance verisi akıyor (genelde birkaç dakika gecikmeli)'
            : 'Yerel simülasyon fiyatı';
    }
    window.__optipulseSetLiveFeedStatus = (status) => {
        lastLiveFeedStatus = status || { active: false, symbol: null, lastTickAt: null };
        updateEngineTooltip();
    };

    setInterval(updateClock, 1000);
    updateClock();

    setInterval(checkBackendHeartbeat, 8000);
    checkBackendHeartbeat();

    /* ────────────── Market Session Status Check (Ankara Trading Hours) ────────────── */

    let isMarketOpen = true;

    function checkMarketStatus() {
        // Single source of truth lives in DataController.isMarketOpenNow() so the
        // header badge and the live price-tick engine (tradingEngine.js) can never
        // disagree about whether BIST is in session.
        isMarketOpen = window.DataController && window.DataController.isMarketOpenNow
            ? window.DataController.isMarketOpenNow()
            : true;

        if (el.marketStatusVal) {
            if (isMarketOpen) {
                el.marketStatusVal.innerText = 'OPEN';
                // (9 Ağustos 2026 — "Kurumsal Mavi" tema düzeltmesi) Önceden
                // 'var(--profit)' idi — tanımsız bir değişken (bkz. app.js
                // checkBackendHeartbeat()'teki aynı düzeltmenin yorumu),
                // metin hep miras alınan renkte kalıyordu. '--success' HER
                // temada (Koyu/Açık/Kurumsal Mavi) doğru yeşile karşılık gelir.
                el.marketStatusVal.style.color = 'var(--success)';
                if (el.marketStatusSub) el.marketStatusSub.style.display = 'none';
            } else {
                el.marketStatusVal.innerText = 'CLOSED';
                // (9 Ağustos 2026) Sabit '#FFA726' yerine '--warning' — hangi
                // tema aktifse o temanın uyarı rengini kullanır, "Kurumsal
                // Mavi" temaya geçilince de sarı kalakalmaz.
                el.marketStatusVal.style.color = 'var(--warning)';
                if (el.marketStatusSub) el.marketStatusSub.style.display = 'inline';
            }
        }
    }

    checkMarketStatus();
    // (9 Ağustos 2026 — kullanıcı bildirimi: "market kapanmasına rağmen OPEN
    // yazıyor, F5 atınca CLOSED dönüyor") Bu kontrol önceden sayfa açıldığında
    // BİR KEZ çalışıp bir daha asla tekrar çalıştırılmıyordu — piyasa
    // açık/kapalı geçiş anında sayfada zaten açık olan biri, kendisi
    // yenilemeden rozetin güncellendiğini asla göremezdi. updateClock()
    // (saniyede bir) ve checkBackendHeartbeat() (8 saniyede bir) ile AYNI
    // desen: 30 saniyede bir yeniden kontrol, dakika hassasiyetli bir sınır
    // için yeterli, gereksiz sıklıkta da değil.
    setInterval(checkMarketStatus, 30000);
});
