/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB — FEATURE TOUR / DEMO WIZARD (tanıtım sihirbazı)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * An opt-in, step-by-step walkthrough of the app's key features, meant for
 * live presentations (e.g. showing a professor what changed). Each step
 * drives the REAL UI (opens the real modal, switches the real panel tab),
 * draws a gold glow ring around the real element being described, and docks
 * the narration card right next to it — so the audience sees the actual app
 * working and knows exactly where to look, not screenshots.
 *
 * Depends on: window.TradingEngine, window.TradingChart already initialized
 * (script is included after both in index.html).
 *
 * Exposed as window.TourGuide.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const TourGuide = (() => {

    function byId(id) { return document.getElementById(id); }

    let cardEl = null;
    let active = false;
    let currentIndex = -1;
    let highlightedEl = null;
    let lastTargetEl = null;
    let repositionRaf = null;

    /* ────────── Step definitions ────────── */
    // Each step optionally has:
    //   setup():    async, runs when entering the step (open a modal/tab, reveal a row, ...)
    //   teardown(): sync, runs when leaving the step (close what setup() opened)
    //   welcome / finish: true marks the two centered, bookend steps
    function closeAllAppModals() {
        if (window.__optipulseCloseOtherModals) window.__optipulseCloseOtherModals('__tour_none__');
    }
    function switchPanelTab(tabName) {
        const tab = document.querySelector('.panel-subtab[data-panel-tab="' + tabName + '"]');
        if (tab && !tab.classList.contains('active')) tab.click();
    }
    function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    // ────────── Mobil kayar (drawer) panel desteği (19 Temmuz 2026, on
    // birinci oturum) ──────────
    // 980px altında sol "Piyasa" paneli (#sidebar-panel) ve sağ işlem paneli
    // (#trading-panel) artık sabit sütun değil, header'daki ikonlarla açılıp
    // kapanan kayar (off-canvas) panellere dönüşüyor (bkz. app.js
    // setupMobileDrawers()). Tur bunu bilmeden önce, ör. izleme listesi veya
    // Stop-Loss/Take-Profit adımlarında hedef element ekranın tamamen
    // dışında kalıyor, tur kartı "solda... bakın" derken görünürde hiçbir
    // şey olmuyordu. Adımlara eklenen `mobilePanel: 'sidebar' | 'trade'`
    // alanı, o adıma girerken ilgili drawer'ı (tıklama tabanlı toggle yerine
    // doğrudan class ekleyerek — olası bir çift-tıklama/kapanma yarışını
    // önlemek için) açıyor, diğerini kapatıyor.
    function applyMobileDrawer(step) {
        if (window.innerWidth > 980) return;
        const sidebar = byId('sidebar-panel');
        const tradePanel = byId('trading-panel');
        const backdrop = byId('mobile-drawer-backdrop');
        if (!sidebar || !tradePanel) return;
        const wantSidebar = step.mobilePanel === 'sidebar';
        const wantTrade = step.mobilePanel === 'trade';
        sidebar.classList.toggle('drawer-open', wantSidebar);
        tradePanel.classList.toggle('drawer-open', wantTrade);
        if (backdrop) backdrop.classList.toggle('visible', wantSidebar || wantTrade);
    }

    function buildSteps() {
        return [
            {
                welcome: true,
                title: 'OptiPulseLab Özellik Turu',
                desc: 'Eklenen 26 yeniliğe hızlı bir bakış atalım — sunum yaparken kullanabileceğiniz canlı bir tur. Her adımda ilgili panel gerçekten açılacak. Devam etmek için "İleri"ye basın, istediğiniz an "Turu Kapat" ile çıkabilirsiniz.'
            },
            // (18 Temmuz 2026, onuncu oturum, dördüncü tur özelliği — bu turda
            // tanıtım turuna eklendi) Header artık taşmıyor; ikincil butonlar
            // (Tur/Isı Haritası/Kısayollar/Yardım/Kompakt Görünüm/Reset) bu
            // ☰ menüye taşındı.
            {
                setup: async () => {
                    closeAllAppModals();
                    // ÖNEMLİ: bu adıma geçişi tetikleyen "İleri" tıklamasının
                    // olay balonlanması (bubbling) henüz document'e ulaşmadan
                    // burada senkron biçimde .click() çağrılırsa, o dış olay
                    // document'e vardığında "menünün dışına tıklandı" sanıp
                    // menüyü anında kapatıyordu (header-menu-dropdown'ın
                    // dışarı-tıklama-ile-kapan mantığı — bkz. tradingChart.js
                    // setupHeaderMenu()). Bir sonraki event loop turuna (0ms)
                    // erteleyerek bu yarış durumunu ortadan kaldırıyoruz.
                    await wait(0);
                    const dropdown = byId('header-menu-dropdown');
                    if (dropdown && !dropdown.classList.contains('open')) byId('btn-header-menu')?.click();
                    await wait(150);
                },
                teardown: () => {
                    const dropdown = byId('header-menu-dropdown');
                    if (dropdown && dropdown.classList.contains('open')) byId('btn-header-menu')?.click();
                },
                selector: '#header-menu-dropdown',
                title: 'Sadeleşen Header + "☰" Menü',
                desc: 'Header artık genişlemiyor/taşmıyor. Sık kullanılmayan işlemler (Tanıtım Turu, Isı Haritası, Kısayollar, Yardım, Kompakt Görünüm, Reset) buradaki tek bir menüde toplandı. "Kompakt Görünüm" izleme listesini ve durum çubuğunu daha sık aralıklı gösterir.'
            },
            {
                setup: async () => { closeAllAppModals(); },
                selector: '#tv-chart-tabs-bar',
                title: 'Çoklu Grafik Sekmeleri',
                desc: 'Grafiğin üstündeki sekme çubuğuna bakın — artık aynı anda birden fazla sembolü açık tutabilirsiniz (en fazla 8 sekme). Sekmeler arası geçiş için 1-9 rakam tuşlarını veya [ / ] kısayollarını kullanabilirsiniz.'
            },
            {
                setup: async () => {
                    closeAllAppModals();
                    const gridBtn = byId('btn-toggle-grid-view');
                    if (gridBtn && window.MultiChartGrid && !window.MultiChartGrid.isActive()) gridBtn.click();
                    await wait(150);
                },
                teardown: () => {
                    const gridBtn = byId('btn-toggle-grid-view');
                    if (gridBtn && window.MultiChartGrid && window.MultiChartGrid.isActive()) gridBtn.click();
                },
                selector: '#tv-grid-view',
                title: '2x2 Çoklu Grafik Izgarası',
                desc: 'Sekmelerin yanı sıra artık dört sembolü aynı anda küçük ızgara halinde de izleyebilirsiniz — her hücrenin sembolünü ayrı ayrı değiştirebilir, isteğe bağlı SMA20/EMA9 göstergelerini açabilir, sağ üstteki ⤢ ile bir hücreyi tek tıkla ana (tam özellikli) grafiğe büyütebilirsiniz.'
            },
            // (birinci tur özelliği — bu turda tanıtım turuna eklendi) Aynı
            // sembolü, biri tam özellikli biri bağımsız çözünürlüklü iki
            // grafikte karşılaştırmalı gösteriyor — 2x2 ızgaradan farkı: orada
            // 4 FARKLI sembol var, burada TEK sembolün iki görünümü.
            {
                setup: async () => {
                    closeAllAppModals();
                    const btn = byId('btn-toggle-dual-chart');
                    if (btn && !btn.classList.contains('active')) btn.click();
                    await wait(200);
                },
                teardown: () => {
                    const btn = byId('btn-toggle-dual-chart');
                    if (btn && btn.classList.contains('active')) btn.click();
                },
                selector: '#tv-chart-area-single',
                title: 'Dual-Chart: Aynı Sembol, İki Grafik',
                desc: 'Ana (tam özellikli, çizim araçlı) grafiğin yanında ikinci, sade bir "karşılaştırma" paneli açılıyor — kendi bağımsız zaman dilimi (1H/4H/1D/1W) ve SMA20/EMA9 göstergeleriyle. İkisi de aynı sembolü, farklı açılardan gösteriyor.'
            },
            // (birinci tur özelliği — bu turda tanıtım turuna eklendi) Header,
            // sol izleme listesi ve sağ işlem panelini gizleyip grafiği tüm
            // viewport'a büyütüyor.
            {
                setup: async () => {
                    closeAllAppModals();
                    const btn = byId('btn-toggle-fullscreen');
                    if (btn && !btn.classList.contains('active')) btn.click();
                    await wait(200);
                },
                teardown: () => {
                    const btn = byId('btn-toggle-fullscreen');
                    if (btn && btn.classList.contains('active')) btn.click();
                },
                selector: '#btn-toggle-fullscreen',
                title: 'Tam Ekran Grafik Modu',
                desc: 'Tam şu anda gördüğünüz gibi — header, izleme listesi ve işlem paneli gizlenip grafik tüm ekranı kaplıyor. Aynı düğmeye tekrar basarak ya da "Esc" ile normal görünüme dönebilirsiniz (turdan sonra otomatik geri dönecek).'
            },
            // (22 Temmuz 2026, on ikinci oturum, üçüncü tur özelliği — bu turda
            // tanıtım turuna eklendi) Sinyal Anlatıcısı: motorların AL/SAT
            // kararlarını grafiğin üzerinde ok işareti olarak gösterir.
            {
                setup: async () => {
                    closeAllAppModals();
                    const btn = byId('btn-toggle-signal-explainer');
                    if (btn && !btn.classList.contains('active')) btn.click();
                    await wait(200);
                },
                teardown: () => {
                    const btn = byId('btn-toggle-signal-explainer');
                    if (btn && btn.classList.contains('active')) btn.click();
                },
                selector: '#btn-toggle-signal-explainer',
                title: 'Sinyal Anlatıcısı',
                desc: 'Şimdi açılan bu düğmeyle grafik üzerinde AL/SAT ok işaretleri beliriyor. Bir işarete tıklarsanız, motorun (SMA5/SMA20 kesişimi ya da RSI+MACD kombinasyonu) o sinyali NEDEN verdiğini açıklayan bir balon açılır. Gerçek bir emir veya backtest değildir — sadece motor mantığının görsel anlatımıdır.'
            },
            // (22 Temmuz 2026, on ikinci oturum, üçüncü tur özelliği — bu turda
            // tanıtım turuna eklendi) Strateji Tekrarı / Zaman Makinesi: mevcut
            // yüklü veriyi bar bar yeniden oynatan kontrol şeridi.
            {
                setup: async () => {
                    closeAllAppModals();
                    const btn = byId('btn-toggle-replay');
                    if (btn && !btn.classList.contains('active')) btn.click();
                    await wait(200);
                },
                teardown: () => {
                    const btn = byId('btn-toggle-replay');
                    if (btn && btn.classList.contains('active')) btn.click();
                },
                selector: '#tv-replay-bar',
                title: 'Strateji Tekrarı (Zaman Makinesi)',
                desc: 'Açılan bu şeritle geçmiş fiyat hareketini bar bar, oynat/durdur ve 1x/2x/5x hız seçenekleriyle yeniden izleyebilir, kaydırıcıyı sürükleyerek istediğiniz ana atlayabilirsiniz. Sinyal Anlatıcısı otomatik olarak birlikte açılır, böylece geçmişte hangi noktada neden AL/SAT sinyali verildiğini adım adım görebilirsiniz. Yeni veri çekmez — zaten yüklü olan geçmişi yeniden canlandırır.'
            },
            // (22 Temmuz 2026, on ikinci oturum, dördüncü tur — backend/fiyat
            // düzeltmesi sonrası eklendi) Yeşil/gri canlı veri noktası daha
            // önce turda hiç yoktu; hocanın "bu canlı mı?" sorusuna doğrudan
            // yanıt veren gösterge burada.
            {
                setup: async () => { closeAllAppModals(); },
                selector: '.tv-symbol-block',
                title: 'Canlı Veri Göstergesi (Yeşil Nokta)',
                desc: 'Sembol adının yanındaki küçük noktaya bakın — yanıp sönen YEŞİL nokta, bu sembol için gerçek zamanlı (WebSocket) canlı veri akışının aktif olduğu anlamına gelir; soluk GRİ nokta ise o an yerel simülasyon fiyatı gösterildiğini belirtir. Üzerine gelince (hover) hangi durumda olduğu yazıyla da görünür.'
            },
            {
                selector: '#chart-toolbar',
                title: 'Çizim Araçları (Sol Dikey Ray)',
                desc: 'Çizim araçları artık ekranın en soluna sabitlenmiş dikey bir rayda — Çizgiler, Fibonacci, Gelişmiş (Gann/Elliott), Şekiller, Not & Ok, Ölçüm, Pozisyon, Desenler (ABCD) ve Tahmin (Trend Projeksiyonu) kategorileriyle, 20\'den fazla araç. Bir ikona basınca o grubun tüm seçenekleri hemen açılır. Çizimleri ve gösterge ayarlarını Ctrl+C / Ctrl+V ile kopyalayıp yapıştırabilir, rayı kenardaki okla daraltabilirsiniz.'
            },
            // (ikinci tur özelliği — bu turda tanıtım turuna eklendi) RSI/MACD
            // gibi birden fazla osilatörü AYNI ANDA gösterip sürükleyerek
            // yeniden sıralayabildiğiniz panel.
            {
                setup: async () => { closeAllAppModals(); },
                selector: '#tv-subpanes-container',
                title: 'Çoklu Osilatör Paneli (Sürükle-Sırala)',
                desc: 'RSI, MACD, Stochastic, ADX gibi birden fazla osilatörü Göstergeler penceresinden işaretleyip AYNI ANDA, kendi ayrı panellerinde görebilirsiniz — ⋮⋮ tutamacından sürükleyerek sırayı değiştirebilir, alt kenarından yükseklik ayarlayabilir, × ile kapatabilirsiniz. Tercihiniz tarayıcınızda hatırlanır.'
            },
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-indicators')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                selector: '#indicator-modal-backdrop .indicator-modal',
                title: 'Göstergeler Artık Kenar Çubuğunda Değil',
                desc: 'Göstergeler eskiden sol paneldeydi; şimdi az önce açılan bu pencerede, kaldırılabilir "chip" etiketleriyle yönetiliyor. Set genişledi: SMA/EMA/Bollinger/VWAP\'ın yanına Ichimoku Bulutu, Parabolic SAR, Pivot Noktaları, SuperTrend, CCI, Keltner ve Donchian Kanalları, MFI eklendi (sol raydaki "Göstergeler" flyout\'undan da hızlıca açıp kapatabilirsiniz).'
            },
            // (18 Temmuz 2026, onuncu oturum, beşinci tur özelliği — bu turda
            // tanıtım turuna eklendi) Şirket temel verileri.
            {
                setup: async () => { closeAllAppModals(); },
                selector: '#tv-fundamentals-bar',
                title: 'Şirket Temel Verileri (F/K, Piyasa Değeri, Temettü)',
                desc: 'Sembol başlığının hemen altında artık F/K oranı, piyasa değeri ve temettü verimi de görünüyor — yfinance\'ten gerçek veri, ama genelde birkaç dakika gecikmeli ve yatırım tavsiyesi değildir.'
            },
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-alerts')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                selector: '#alerts-modal-backdrop .indicator-modal',
                title: 'Fiyat Alarmları',
                desc: 'Açılan pencereden bir sembol için hedef fiyat belirleyebilirsiniz — fiyat o seviyeye ulaştığında uygulama içinde (isterseniz tarayıcı bildirimi olarak da) haberdar olursunuz.'
            },
            {
                setup: async () => { closeAllAppModals(); },
                mobilePanel: 'sidebar',
                selector: () => byId('watchlist-body')?.closest('.form-group') || byId('watchlist-body'),
                title: 'Sadeleştirilmiş İzleme Listesi',
                desc: 'Sol taraftaki izleme listesine bakın — daha sade bir tasarıma kavuştu, arama kutusuyla semboller arasında hızlıca gezinebilir, her satırdaki küçük grafikle (sparkline) son fiyat hareketini görebilirsiniz.'
            },
            {
                setup: async () => {
                    closeAllAppModals();
                    switchPanelTab('trade');
                    const chk = byId('qt-sltp-toggle');
                    if (chk && !chk.checked) {
                        chk.checked = true;
                        chk.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                },
                teardown: () => {
                    const chk = byId('qt-sltp-toggle');
                    if (chk && chk.checked) {
                        chk.checked = false;
                        chk.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                },
                mobilePanel: 'trade',
                selector: '#qt-sltp-row',
                title: 'Stop-Loss / Take-Profit',
                desc: 'Sağdaki emir panelinde şimdi açılan alanlara bakın — emir girerken ya da açık bir pozisyonda sonradan Stop-Loss / Take-Profit seviyeleri belirleyebilirsiniz. Fiyat o seviyeye ulaştığında pozisyon otomatik kapanır.'
            },
            {
                setup: async () => {
                    closeAllAppModals();
                    switchPanelTab('trade');
                    const btn5x = document.querySelector('.leverage-btn[data-leverage="5"]');
                    if (btn5x && !btn5x.classList.contains('active')) btn5x.click();
                },
                teardown: () => {
                    const btn1x = document.querySelector('.leverage-btn[data-leverage="1"]');
                    if (btn1x && !btn1x.classList.contains('active')) btn1x.click();
                },
                mobilePanel: 'trade',
                selector: () => document.querySelector('.leverage-selector')?.closest('.form-group') || document.querySelector('.leverage-selector'),
                title: 'Kaldıraç / Marj Sistemi',
                desc: 'Emir panelinde hazır 1x/2x/5x/10x düğmeleri, 1-20x arası serbest manuel giriş ve 3x/7x/15x/20x hızlı-seçim çipleriyle kaldıraç seçebilirsiniz — pozisyon açarken bakiyenizden sadece gereken marj (teminat) kilitlenir. Yüksek kaldıraçta zarar marjın belirli bir oranını aşarsa pozisyon otomatik kapanır (marj çağrısı simülasyonu).'
            },
            {
                setup: async () => {
                    closeAllAppModals();
                    switchPanelTab('trade');
                    const ocoTab = byId('qt-order-oco');
                    if (ocoTab && !ocoTab.classList.contains('active')) ocoTab.click();
                },
                teardown: () => {
                    const marketTab = byId('qt-order-market');
                    if (marketTab && !marketTab.classList.contains('active')) marketTab.click();
                },
                mobilePanel: 'trade',
                selector: '#qt-oco-row',
                title: 'Gelişmiş Emirler: OCO / Trailing Stop',
                desc: '"OCO" sekmesinde üst ve alt tetikleyici fiyat girerek bekleyen bir emir çifti oluşturabilirsiniz — biri gerçekleşince diğeri otomatik iptal olur. SL/TP alanında ise sabit bir stop yerine fiyatı lehte takip eden "Trailing Stop" seçilebiliyor.'
            },
            {
                setup: async () => { closeAllAppModals(); switchPanelTab('orderbook'); },
                mobilePanel: 'trade',
                selector: '#panel-tab-orderbook',
                title: 'Emir Defteri (Order Book)',
                desc: 'Sağdaki panel şimdi "Emir Defteri" sekmesinde — Binance tarzı simüle edilmiş alım/satım derinliği, canlı değişen fiyat kademeleri ve orta fiyat çizgisiyle.'
            },
            {
                setup: async () => { switchPanelTab('trades'); },
                mobilePanel: 'trade',
                selector: '#panel-tab-trades',
                title: 'Son İşlemler Akışı',
                desc: 'Şimdi "Son İşlemler" sekmesindesiniz — simüle edilmiş canlı işlem akışı (trade tape), her işlemin fiyatı, miktarı ve saatiyle birlikte akıyor.'
            },
            {
                setup: async () => { switchPanelTab('performance'); },
                mobilePanel: 'trade',
                selector: '#panel-tab-performance',
                title: 'Portföy Performans Analitiği',
                desc: '"Performans" sekmesinde toplam K/Z, kazanma oranı, profit factor ve canlı özkaynak eğrisiyle performansınızı tek ekrandan takip edebilirsiniz.'
            },
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-heatmap')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                selector: '.heatmap-modal',
                title: 'BIST100 Isı Haritası',
                desc: 'Açılan pencerede tüm BIST100 sembollerinin günlük performansını renk yoğunluğuna göre tek bakışta görebilirsiniz; bir kareye tıklayarak o sembole geçebilirsiniz. Üstteki "Sektöre Göre" düğmesiyle hisseleri gerçek sektörlerine (Bankacılık, Enerji, Ulaştırma vb.) göre gruplanmış olarak da görüntüleyebilirsiniz.'
            },
            {
                setup: async () => { closeAllAppModals(); switchPanelTab('trade'); },
                mobilePanel: 'trade',
                selector: '#btn-export-history-csv',
                title: 'İşlem Geçmişini CSV Olarak İndir',
                desc: 'Sağ paneldeki "Son Emirler" bölümünün yanındaki CSV düğmesiyle tüm işlem geçmişinizi Excel uyumlu (Türkçe karakter destekli) bir dosya olarak dışa aktarabilirsiniz.'
            },
            // (18 Temmuz 2026, onuncu oturum, dördüncü tur özelliği — bu turda
            // tanıtım turuna eklendi) Ctrl+K / "/" ile açılan, sembol arama +
            // hızlı işlemleri birleştiren komut paleti.
            {
                setup: async () => {
                    closeAllAppModals();
                    if (window.__optipulseOpenCommandPalette) window.__optipulseOpenCommandPalette();
                    await wait(150);
                },
                teardown: () => closeAllAppModals(),
                selector: '#command-palette-backdrop .command-palette-modal',
                title: 'Komut Paleti',
                desc: '"Ctrl+K" veya "/" ile her yerden açılır — tek bir kutuda hem BIST100 sembol arayabilir hem de tema/ses/kompakt görünüm değiştirme, panel açma, reset gibi hızlı işlemleri çalıştırabilirsiniz. Ok tuşlarıyla gezinip Enter ile seçin.'
            },
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-shortcuts')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                selector: '#shortcuts-modal-backdrop .indicator-modal',
                title: 'Klavye Kısayolları',
                desc: 'Açılan pencerede tüm kısayolları görebilirsiniz: B/S ile alım-satım yönü, 1-9 ile grafik sekmeleri, F ile tam ekran, T ile tema, ? ile bu pencere... Elinizi klavyeden kaldırmadan uygulamayı kullanabilirsiniz.'
            },
            // (bu turda eklendi) Yardım/Hakkında modalı daha önce turda hiç
            // yoktu; ayrıca aynı turda düzeltilen bir hata yüzünden (bkz.
            // filterIndicatorList() — Göstergeler modalı bir kez açıldığında
            // bu modalın içeriğini kalıcı olarak "display:none" yapıyordu)
            // önceden boş görünebiliyordu.
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-help')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                selector: '#help-modal-backdrop .indicator-modal',
                title: 'Yardım / Hakkında',
                desc: 'Bu pencerede uygulamanın demo/simülasyon olduğunun açıklaması, temel özellik özeti ve veri kaynağı/gecikme notu yer alıyor — biri "bu gerçek mi?" diye sorarsa göstereceğiniz yer burası.'
            },
            {
                setup: async () => { closeAllAppModals(); },
                selector: '#btn-theme-toggle',
                title: 'Koyu / Açık Tema',
                desc: 'Sağ üstteki tema düğmesi veya "T" kısayoluyla koyu ve açık tema arasında anında geçiş yapabilirsiniz; tercihiniz tarayıcınızda hatırlanır.'
            },
            {
                finish: true,
                title: 'Tur Tamamlandı',
                desc: 'Bu turda 26 özelliği gördünüz: sadeleşen header + ☰ menü, çoklu grafik sekmeleri, 2x2 grafik ızgarası, Dual-Chart, tam ekran grafik modu, Sinyal Anlatıcısı, Strateji Tekrarı (Zaman Makinesi), canlı veri göstergesi (yeşil/gri nokta), sol dikey çizim rayı, çoklu osilatör paneli, genişletilmiş göstergeler (Ichimoku/PSAR/Pivot/SuperTrend/CCI/Keltner/Donchian/MFI), şirket temel verileri, fiyat alarmları, sade izleme listesi, Stop-Loss/Take-Profit, kaldıraç/marj sistemi (manuel + hızlı çipler), OCO/Trailing Stop, emir defteri, son işlemler, performans analitiği, sektörel ısı haritası, CSV dışa aktarma, komut paleti, klavye kısayolları, Yardım/Hakkında ve koyu/açık tema. Turu istediğiniz an "☰" menüsündeki "Tanıtım Turu" düğmesinden yeniden başlatabilirsiniz.'
            }
        ];
    }

    let STEPS = [];

    /* ────────── DOM scaffold ────────── */
    function ensureDom() {
        if (cardEl) return;
        cardEl = document.createElement('div');
        cardEl.className = 'tour-card';
        cardEl.innerHTML =
            '<div class="tour-card-eyebrow">' +
                '<span class="tour-step-count" id="tour-step-count"></span>' +
                '<button type="button" class="tour-close-btn" id="tour-close-btn" title="Turu Kapat (Esc)">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
                '</button>' +
            '</div>' +
            '<h3 class="tour-card-title" id="tour-card-title"></h3>' +
            '<p class="tour-card-desc" id="tour-card-desc"></p>' +
            '<div class="tour-card-footer">' +
                '<div class="tour-progress-track"><div class="tour-progress-fill" id="tour-progress-fill"></div></div>' +
                '<div class="tour-nav-buttons">' +
                    '<button type="button" class="tour-btn tour-btn-skip" id="tour-btn-skip">Turu Atla</button>' +
                    '<button type="button" class="tour-btn" id="tour-btn-prev">Geri</button>' +
                    '<button type="button" class="tour-btn tour-btn-primary" id="tour-btn-next">İleri</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(cardEl);

        byId('tour-close-btn').addEventListener('click', end);
        byId('tour-btn-skip').addEventListener('click', end);
        byId('tour-btn-prev').addEventListener('click', prev);
        byId('tour-btn-next').addEventListener('click', next);
    }

    /* ────────── Highlight ring ────────── */
    function clearHighlight() {
        if (highlightedEl) {
            highlightedEl.classList.remove('tour-highlight-ring');
            highlightedEl = null;
        }
    }
    function setHighlight(el) {
        clearHighlight();
        if (el) {
            el.classList.add('tour-highlight-ring');
            highlightedEl = el;
        }
    }

    /* ────────── Positioning: dock the card next to the real target ────────── */
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function positionNear(rect) {
        const vw = window.innerWidth, vh = window.innerHeight;
        const margin = 16;
        const cardW = cardEl.offsetWidth || 380;
        const cardH = cardEl.offsetHeight || 160;

        if (!rect) {
            // Centered bookend steps (welcome / finish) — dock below the header, centered.
            cardEl.style.top = '80px';
            cardEl.style.left = clamp(vw / 2 - cardW / 2, margin, vw - cardW - margin) + 'px';
            return;
        }

        const spaceBelow = vh - rect.bottom;
        const spaceAbove = rect.top;
        const spaceRight = vw - rect.right;
        const spaceLeft = rect.left;
        let top, left;

        if (spaceBelow > cardH + 24) {
            top = rect.bottom + 16;
            left = clamp(rect.left + rect.width / 2 - cardW / 2, margin, vw - cardW - margin);
        } else if (spaceRight > cardW + 24) {
            left = rect.right + 16;
            top = clamp(rect.top + rect.height / 2 - cardH / 2, margin, vh - cardH - margin);
        } else if (spaceLeft > cardW + 24) {
            left = rect.left - cardW - 16;
            top = clamp(rect.top + rect.height / 2 - cardH / 2, margin, vh - cardH - margin);
        } else if (spaceAbove > cardH + 24) {
            top = rect.top - cardH - 16;
            left = clamp(rect.left + rect.width / 2 - cardW / 2, margin, vw - cardW - margin);
        } else {
            // Nothing fits cleanly (e.g. a very large modal) — dock below the
            // header instead of covering the target's most important area.
            top = 80;
            left = clamp(vw / 2 - cardW / 2, margin, vw - cardW - margin);
        }

        cardEl.style.top = top + 'px';
        cardEl.style.left = left + 'px';
    }

    function reposition() {
        if (!active) return;
        const rect = lastTargetEl ? lastTargetEl.getBoundingClientRect() : null;
        positionNear(rect);
    }
    function scheduleReposition() {
        if (repositionRaf) return;
        repositionRaf = requestAnimationFrame(() => { repositionRaf = null; reposition(); });
    }

    async function resolveStepEl(step) {
        if (!step.selector) return null;
        let el = typeof step.selector === 'function' ? step.selector() : document.querySelector(step.selector);
        if (!el) return null;
        try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch (e) { /* ignore */ }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return el;
    }

    /* ────────── Step lifecycle ────────── */
    function renderStep(step, index, el) {
        byId('tour-step-count').textContent = (index + 1) + ' / ' + STEPS.length;
        byId('tour-card-title').textContent = step.title || '';
        byId('tour-card-desc').textContent = step.desc || '';
        const pct = STEPS.length > 1 ? Math.round((index / (STEPS.length - 1)) * 100) : 100;
        byId('tour-progress-fill').style.width = pct + '%';

        const prevBtn = byId('tour-btn-prev');
        prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
        byId('tour-btn-next').textContent = index === STEPS.length - 1 ? 'Bitir' : 'İleri';

        cardEl.classList.toggle('tour-welcome', !!step.welcome);
        cardEl.classList.toggle('tour-finish', !!step.finish);

        lastTargetEl = el || null;
        setHighlight(el || null);
        const rect = el ? el.getBoundingClientRect() : null;
        positionNear(rect);

        cardEl.classList.add('tour-visible');
    }

    function teardownStep(index) {
        if (index < 0 || index >= STEPS.length) return;
        const step = STEPS[index];
        if (step.teardown) {
            try { step.teardown(); } catch (e) { console.warn('[TourGuide] teardown failed', e); }
        }
    }

    async function goTo(index) {
        if (!active || index < 0 || index >= STEPS.length) return;
        teardownStep(currentIndex);
        clearHighlight();
        currentIndex = index;
        const step = STEPS[index];

        applyMobileDrawer(step);
        if (step.setup) {
            try { await step.setup(); } catch (e) { console.warn('[TourGuide] setup failed', e); }
        }
        if (!active) return; // tour may have been closed while awaiting
        const el = await resolveStepEl(step);
        if (!active) return; // ...or while awaiting the scroll-into-view frame
        renderStep(step, index, el);
    }

    function next() {
        if (!active) return;
        if (currentIndex >= STEPS.length - 1) { end(); return; }
        goTo(currentIndex + 1);
    }

    function prev() {
        if (!active || currentIndex <= 0) return;
        goTo(currentIndex - 1);
    }

    function onKeyDown(e) {
        if (!active) return;
        const target = e.target;
        const isTyping = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable));
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
        else if (e.key === 'ArrowRight' && !isTyping) { e.preventDefault(); next(); }
        else if (e.key === 'ArrowLeft' && !isTyping) { e.preventDefault(); prev(); }
    }

    async function start() {
        if (active) return;
        STEPS = buildSteps();
        if (!STEPS.length) return;
        ensureDom();
        active = true;
        currentIndex = -1;
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', scheduleReposition);
        window.addEventListener('scroll', scheduleReposition, true);
        await goTo(0);
    }

    function end() {
        if (!active) return;
        teardownStep(currentIndex);
        clearHighlight();
        active = false;
        currentIndex = -1;
        lastTargetEl = null;
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', scheduleReposition);
        window.removeEventListener('scroll', scheduleReposition, true);
        if (cardEl) cardEl.classList.remove('tour-visible');
        // Mobilde bir drawer açık kalmışsa tur biterken/kapanırken kapat.
        if (window.__optipulseCloseMobileDrawers) window.__optipulseCloseMobileDrawers();
    }

    /* ────────── Wiring ────────── */
    function setupTriggerButton() {
        const btn = byId('btn-open-tour');
        if (btn) btn.addEventListener('click', () => { if (active) end(); else start(); });
    }

    function init() {
        setupTriggerButton();
    }

    return Object.freeze({ init, start, end, next, prev });
})();

window.TourGuide = TourGuide;
