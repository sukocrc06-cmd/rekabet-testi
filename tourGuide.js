/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPTIPULSELAB — FEATURE TOUR / DEMO WIZARD (tanıtım sihirbazı)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * An opt-in, step-by-step walkthrough of the app's key features, meant for
 * live presentations (e.g. showing a professor what changed). It shows a
 * small floating card docked below the header — no dark overlay, no
 * element-highlighting. Behind the card, each step drives the REAL UI (opens
 * the real modal, switches the real panel tab) so the audience sees the
 * actual app working, not screenshots.
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

    function buildSteps() {
        return [
            {
                welcome: true,
                title: 'OptiPulseLab Özellik Turu',
                desc: 'Son güncellemede eklenen 13 yeniliğe hızlı bir bakış atalım — sunum yaparken kullanabileceğiniz canlı bir tur. Her adımda ilgili panel gerçekten açılacak. Devam etmek için "İleri"ye basın, istediğiniz an "Turu Kapat" ile çıkabilirsiniz.'
            },
            {
                setup: async () => { closeAllAppModals(); },
                title: 'Çoklu Grafik Sekmeleri',
                desc: 'Grafiğin üstündeki sekme çubuğuna bakın — artık aynı anda birden fazla sembolü açık tutabilirsiniz (en fazla 8 sekme). Sekmeler arası geçiş için 1-9 rakam tuşlarını veya [ / ] kısayollarını kullanabilirsiniz.'
            },
            {
                title: 'Çizim Araçları + Kopyala/Yapıştır',
                desc: 'Grafiğin üstündeki araç çubuğunda trend çizgisi, yatay çizgi, dikdörtgen ve Fibonacci retracement bulunuyor. Çizimleri ve gösterge ayarlarını artık Ctrl+C / Ctrl+V ile kopyalayıp yapıştırabilirsiniz.'
            },
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-indicators')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                title: 'Göstergeler Artık Kenar Çubuğunda Değil',
                desc: 'Göstergeler eskiden sol paneldeydi; şimdi az önce açılan bu pencerede, kaldırılabilir "chip" etiketleriyle yönetiliyor.'
            },
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-alerts')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                title: 'Fiyat Alarmları',
                desc: 'Açılan pencereden bir sembol için hedef fiyat belirleyebilirsiniz — fiyat o seviyeye ulaştığında uygulama içinde (isterseniz tarayıcı bildirimi olarak da) haberdar olursunuz.'
            },
            {
                setup: async () => { closeAllAppModals(); },
                title: 'Sadeleştirilmiş İzleme Listesi',
                desc: 'Sol taraftaki izleme listesine bakın — daha sade bir tasarıma kavuştu, arama kutusuyla semboller arasında hızlıca gezinebilirsiniz.'
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
                title: 'Stop-Loss / Take-Profit',
                desc: 'Sağdaki emir panelinde şimdi açılan alanlara bakın — emir girerken ya da açık bir pozisyonda sonradan Stop-Loss / Take-Profit seviyeleri belirleyebilirsiniz. Fiyat o seviyeye ulaştığında pozisyon otomatik kapanır.'
            },
            {
                setup: async () => { closeAllAppModals(); switchPanelTab('orderbook'); },
                title: 'Emir Defteri (Order Book)',
                desc: 'Sağdaki panel şimdi "Emir Defteri" sekmesinde — Binance tarzı simüle edilmiş alım/satım derinliği, canlı değişen fiyat kademeleri ve orta fiyat çizgisiyle.'
            },
            {
                setup: async () => { switchPanelTab('trades'); },
                title: 'Son İşlemler Akışı',
                desc: 'Şimdi "Son İşlemler" sekmesindesiniz — simüle edilmiş canlı işlem akışı (trade tape), her işlemin fiyatı, miktarı ve saatiyle birlikte akıyor.'
            },
            {
                setup: async () => { switchPanelTab('performance'); },
                title: 'Portföy Performans Analitiği',
                desc: '"Performans" sekmesinde toplam K/Z, kazanma oranı, profit factor ve canlı özkaynak eğrisiyle performansınızı tek ekrandan takip edebilirsiniz.'
            },
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-heatmap')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                title: 'BIST100 Isı Haritası',
                desc: 'Açılan pencerede tüm BIST100 sembollerinin günlük performansını renk yoğunluğuna göre tek bakışta görebilirsiniz; bir kareye tıklayarak o sembole geçebilirsiniz.'
            },
            {
                setup: async () => { closeAllAppModals(); switchPanelTab('trade'); },
                title: 'İşlem Geçmişini CSV Olarak İndir',
                desc: 'Sağ paneldeki "Son Emirler" bölümünün yanındaki CSV düğmesiyle tüm işlem geçmişinizi Excel uyumlu (Türkçe karakter destekli) bir dosya olarak dışa aktarabilirsiniz.'
            },
            {
                setup: async () => { closeAllAppModals(); byId('btn-open-shortcuts')?.click(); await wait(150); },
                teardown: () => closeAllAppModals(),
                title: 'Klavye Kısayolları',
                desc: 'Açılan pencerede tüm kısayolları görebilirsiniz: B/S ile alım-satım yönü, 1-9 ile grafik sekmeleri, T ile tema, ? ile bu pencere... Elinizi klavyeden kaldırmadan uygulamayı kullanabilirsiniz.'
            },
            {
                setup: async () => { closeAllAppModals(); },
                title: 'Koyu / Açık Tema',
                desc: 'Sağ üstteki tema düğmesi veya "T" kısayoluyla koyu ve açık tema arasında anında geçiş yapabilirsiniz; tercihiniz tarayıcınızda hatırlanır.'
            },
            {
                finish: true,
                title: 'Tur Tamamlandı',
                desc: 'Bu turda 13 yeni özelliği gördünüz: çoklu grafik sekmeleri, çizim kopyala/yapıştır, taşınan göstergeler paneli, fiyat alarmları, sade izleme listesi, Stop-Loss/Take-Profit, emir defteri, son işlemler, performans analitiği, ısı haritası, CSV dışa aktarma, klavye kısayolları ve koyu/açık tema. Turu istediğiniz an "Tanıtım Turu" düğmesinden yeniden başlatabilirsiniz.'
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

    /* ────────── Step lifecycle ────────── */
    function renderStep(step, index) {
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
        currentIndex = index;
        const step = STEPS[index];

        if (step.setup) {
            try { await step.setup(); } catch (e) { console.warn('[TourGuide] setup failed', e); }
        }
        if (!active) return; // tour may have been closed while awaiting
        renderStep(step, index);
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
        await goTo(0);
    }

    function end() {
        if (!active) return;
        teardownStep(currentIndex);
        active = false;
        currentIndex = -1;
        document.removeEventListener('keydown', onKeyDown, true);
        if (cardEl) cardEl.classList.remove('tour-visible');
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
