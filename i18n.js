/* OPLab — Türkçe / İngilizce dil desteği (7 Ekim 2026)
 *
 * Uygulamanın kaynak dili Türkçe. İngilizce seçildiğinde ekrandaki Türkçe metinler
 * (metin düğümleri + title/placeholder/aria-label/alt öznitelikleri), uyarı pencereleri,
 * tarayıcı bildirimleri, grafik tuvaline çizilen etiketler ve grafik tarih ekseni
 * (Lightweight Charts locale) bu sözlükle İngilizceye çevrilir. Türkçeye dönünce
 * orijinal metinler geri yüklenir. Uygulama kodu metinleri eskisi gibi Türkçe üretir —
 * bu katman yalnızca görüntüyü çevirir; sayfa yenilemeye gerek yoktur.
 *
 * Sözlük: tam eşleşme → kalıp ({0} değişken yerleri) → cümle içindeki bilinen ifadeler.
 */
(function () {
    'use strict';
    var LS_KEY = 'optipulselab_lang';
    var DICT = {
"— yfinance ücretsiz veri kaynağı olduğundan fiyatlar genelde birkaç dakika gecikmeli gelir (borsanın kendi anlık/ücretli veri akışıyla birebir aynı milisaniyede değildir). Sembol başlığının altındaki F/K, piyasa değeri ve temettü verimi gibi temel (fundamental) bilgiler için de aynı gecikme geçerlidir.": "— since yfinance is a free data source, prices usually arrive a few minutes delayed (not millisecond-identical to the exchange's own real-time/paid feed). The same delay applies to fundamentals such as P/E, market cap and dividend yield shown under the symbol header.",
"— yüksek kaldıraç likidasyon riskini artırır": "— high leverage increases liquidation risk",
", 2x2 çoklu grafik ızgarası,": ", a 2x2 multi-chart grid,",
", sektörel BIST100 ısı haritası, aynı sembolü karşılaştırmalı gösteren": ", a sector-based BIST100 heatmap, a side-by-side comparison of the same symbol with",
". Bakiye, pozisyonlar ve işlem geçmişi yalnızca bu tarayıcıda (localStorage) saklanır.": ". Balance, positions and trade history are stored only in this browser (localStorage).",
"\"Tanıtım Turu\"": "\"Product Tour\"",
"✓ FinteLig Yarışmacısı": "✓ FinteLig Competitor",
"☰ menüsündeki düğmeyle özellikleri gezen sunum turunu başlat": "Start the feature tour (also available from the ☰ menu)",
"1Ay": "1M",
"52 Hafta: --": "52 Week: --",
"Açık K/Z": "Open P/L",
"Açık pencereyi / tam ekranı kapat": "Close open window / full screen",
"Açık Pozisyon": "Open Positions",
"Açık Pozisyonlar (Spot)": "Open Positions (Spot)",
"Açık Pozisyonlar (VİOP)": "Open Positions (VIOP)",
"Aktif Alarmlar": "Active Alerts",
"Aktif Gösterge Alarmları": "Active Indicator Alerts",
"Aktif sembol: --": "Active symbol: --",
"AL": "BUY",
"AL (BUY)": "BUY",
"Alarmlar": "Alerts",
"Alım-Satım": "Trade",
"Alt Tetik — Kırılım SAT (₺)": "Lower Trigger — Breakdown SELL (₺)",
"Altına inince": "Falls below",
"amaçlı bir alım-satım terminalidir. Grafikler ve fiyat geçmişi gerçek yfinance verisine dayanır, ancak": "trading terminal for BIST stocks. Charts and price history are based on real yfinance data, but",
"Ana Grafik (Overlay)": "Main Chart (Overlay)",
"anlık/gerçek-zamanlı değildir": "is not real-time",
"Aşağıdaki pozisyon/emir listeleri seçili moda göre değişir — Normal Seans ve VİOP birbirine hiç karışmaz.": "The position/order lists below follow the selected mode — Normal Session and VIOP never mix.",
"ATR'ye göre Stop-Loss öner (×1.5)": "Suggest Stop-Loss from ATR (×1.5)",
"Ayarları Kopyala": "Copy Settings",
"Bakiye": "Balance",
"Bekleyen Emirler — OCO/Limit (Spot)": "Pending Orders — OCO/Limit (Spot)",
"Bekleyen Emirler — OCO/Limit (VİOP)": "Pending Orders — OCO/Limit (VIOP)",
"BIST100 Endeksi": "BIST100 Index",
"BIST100 Isı Haritasını aç": "Open BIST100 Heatmap",
"Borsa": "Exchange",
"Bu bir simülasyondur (sandbox / non-live). Gerçek emir gönderilmez.": "This is a simulation (sandbox / non-live). No real orders are sent.",
"Bu pencereyi aç/kapat": "Open/close this window",
"Bu Uygulama Nedir?": "What Is This App?",
"butonu, tüm özellikleri sırayla gezen kısa bir sunum başlatır — özellikle ilk kez kullanıyorsanız veya birine göstereceksek buradan başlamanızı öneririz. Klavye kısayolları için": "button starts a short presentation of all features — we recommend starting here if you're new or showing the app to someone. For keyboard shortcuts, press",
"Çizim Araçları": "Drawing Tools",
"Çizimi yapıştır": "Paste drawing",
"Çıkış Yap": "Log Out",
"Değişime Göre": "By Change",
"Düşüş": "Down",
"Ekle": "Add",
"EMA 21 (Turuncu)": "EMA 21 (Orange)",
"EMA 9 (Turkuaz)": "EMA 9 (Turquoise)",
"Emir gerçekleştiğinde pozisyona otomatik olarak bağlanır; fiyat Stop-Loss (veya Trailing Stop mesafesi) ya da Take-Profit seviyesine ulaştığında pozisyon kapatılır.": "Attached to the position automatically once the order fills; the position closes when price reaches the Stop-Loss (or Trailing Stop distance) or Take-Profit level.",
"En İyi İşlem": "Best Trade",
"En Kötü İşlem": "Worst Trade",
"Eşleşen gösterge bulunamadı.": "No matching indicator.",
"Farklı periyotlu RSI ekle:": "Add RSI with a different period:",
"FinteLig Girişi": "FinteLig Login",
"FinteLig yarışmacısıysan, başvuruda belirlediğin e-posta ve şifreyle giriş yap. Yarışmacı değilsen giriş yapmadan da platformu kullanabilirsin.": "If you're a FinteLig competitor, log in with the e-mail and password from your application. If you're not a competitor, you can use the platform without logging in.",
"Fiyat Alarmları penceresini aç": "Open the Price Alerts window",
"Fiyat EMA(20)'ye dokunma": "Price touches EMA(20)",
"Fiyat üst tetiği yukarı kırarsa AL, alt tetiği aşağı kırarsa açığa SAT emri gerçekleşir — hangisi önce olursa diğeri otomatik iptal edilir.": "If price breaks above the upper trigger a BUY fills; if it breaks below the lower trigger a short SELL fills — whichever happens first, the other is cancelled automatically.",
"Genel": "General",
"Gerçek zamanlıya yakın fiyat akışı (WebSocket), 8 grafik tipi ve 20'den fazla çizim aracı (sol dikey araç rayında — Çizgiler, Fibonacci, Gann, Elliott, Şekiller, Pozisyon), özelleştirilebilir teknik göstergeler, fiyat alarmları, Stop-Loss/Take-Profit ve OCO/Trailing Stop emirleri, VİOP'ta": "Near-real-time price stream (WebSocket), 8 chart types and 20+ drawing tools (in the left tool rail — Lines, Fibonacci, Gann, Elliott, Shapes, Position), customizable technical indicators, price alerts, Stop-Loss/Take-Profit and OCO/Trailing Stop orders, in VİOP a",
"Gereken Teminat (Marj)": "Required Margin",
"Geri Al": "Undo",
"Giriş Yap": "Log In",
"Giriş yapmadan devam et →": "Continue without logging in →",
"Gösterge Yok": "No Indicators",
"Göstergeler penceresini aç": "Open the Indicators window",
"Grafiğe eklenecek not": "Note to add to the chart",
"Hacim Histogramı": "Volume Histogram",
"Henüz alarm oluşturulmadı.": "No alerts created yet.",
"Henüz gösterge alarmı oluşturulmadı.": "No indicator alerts created yet.",
"hiçbir gerçek emir gönderilmez, gerçek bir borsa/aracı kurum bağlantısı yoktur": "no real orders are sent and there is no connection to a real exchange/broker",
"Hisse Başı Kazanç: --": "EPS: --",
"Hızlı Alım Satım": "Quick Trade",
"İlgili grafik sekmesine geç": "Switch to that chart tab",
"İptal": "Cancel",
"Isı Haritası": "Heatmap",
"İşlem Büyüklüğü (Notional)": "Trade Size (Notional)",
"İşlem Sayısı": "Trade Count",
"İzleme Listesi": "Watchlist",
"Kaldıraç": "Leverage",
"Karşılaştırma": "Comparison",
"Kaydet": "Save",
"Kazanma Oranı": "Win Rate",
"Keltner Kanalları": "Keltner Channels",
"Kısayollar": "Shortcuts",
"Kompakt Görünüm": "Compact View",
"Komut paletini aç (sembol ara / hızlı işlem)": "Open command palette (search symbol / quick action)",
"Kopyala": "Copy",
"Koyu / Açık temayı değiştir": "Toggle dark / light theme",
"Kullanıcı": "User",
"Kullanılan Marj": "Used Margin",
"Limit Fiyat (₺)": "Limit Price (₺)",
"Maks. Drawdown": "Max Drawdown",
"Manuel": "Manual",
"en fazla 5x kaldıraç/marj sistemi": "leverage/margin system of up to 5x",
"Marj Seviyesi": "Margin Level",
"Miktar (Adet)": "Quantity (Shares)",
"Mumlar": "Candles",
"Nabız:": "Breadth:",
"Nereden Başlamalı?": "Where to Start?",
"Normal Seans": "Normal Session",
"OCO Tetikleyicileri": "OCO Triggers",
"Onayla": "Confirm",
"Önceki / sonraki grafik sekmesi": "Previous / next chart tab",
"Önemli:": "Important:",
"OPLab şu anda yönetici tarafından geçici olarak devre dışı bırakıldı. Lütfen daha sonra tekrar deneyin.": "OPLab has been temporarily disabled by the administrator. Please try again later.",
"OptiPulseLab Demo Hesabı": "OptiPulseLab Demo Account",
"OptiPulseLab, BIST hisseleri üzerinde": "OptiPulseLab is a",
"Ort. Hacim: --": "Avg. Volume: --",
"Osilatör Paneli (Alt Grafik — birden fazla seçilebilir, sürükleyerek sıralanabilir)": "Oscillator Panel (Sub-chart — select several, drag to reorder)",
"Özet Detay": "Summary",
"Özkaynak": "Equity",
"Özkaynak (Portföy)": "Equity (Portfolio)",
"Özkaynak Eğrisi (canlı)": "Equity Curve (live)",
"Performans": "Performance",
"Piyasa": "Market",
"Piyasa Değeri: --": "Market Cap: --",
"Piyasa verileri yükleniyor…": "Loading market data…",
"Piyasa:": "Market:",
"Platform Geçici Olarak Kapalı": "Platform Temporarily Closed",
"Profil Ayarları — İsim": "Profile Settings — Name",
"Risk (bakiyenin %'si)": "Risk (% of balance)",
"Risk bazlı miktar hesapla": "Calculate risk-based quantity",
"RSI aşağı kesişim": "RSI crosses down",
"RSI yukarı kesişim": "RSI crosses up",
"Saat:": "Time:",
"Sabit Stop-Loss yerine Trailing Stop kullan": "Use Trailing Stop instead of fixed Stop-Loss",
"SAT": "SELL",
"Seçili çizimi kopyala": "Copy selected drawing",
"Seçili çizimi sil": "Delete selected drawing",
"Sektöre Göre": "By Sector",
"Sembol adının yanındaki küçük nokta, o an ekrandaki fiyatın gerçek yfinance akışından mı (yeşil, yanıp sönen) yoksa yerel simülasyondan mı (gri) geldiğini gösterir. Backend sunucusu çalışmıyorsa veya bir sembol için canlı veri geçici olarak alınamıyorsa, uygulama otomatik olarak gerçekçi bir simülasyona döner — bu bir hata değildir, kasıtlı bir tasarım kararıdır.": "The small dot next to the symbol name shows whether the price on screen comes from the real yfinance feed (green, blinking) or a local simulation (grey). If the backend is down or live data for a symbol is temporarily unavailable, the app automatically falls back to a realistic simulation — this is a deliberate design choice, not an error.",
"Sembol Ara": "Search Symbol",
"Sembol Bazında K/Z": "P/L by Symbol",
"Sembol seçin": "Select a symbol",
"Sembol seçin.": "Select a symbol.",
"Sharpe Oranı": "Sharpe Ratio",
"Sil": "Delete",
"SMA 20 (Mavi)": "SMA 20 (Blue)",
"SMA 200 (Kırmızı)": "SMA 200 (Red)",
"SMA 50 (Mor)": "SMA 50 (Purple)",
"Son çizimi geri al": "Undo last drawing",
"Son Emirler (Spot)": "Recent Orders (Spot)",
"Son Emirler (VİOP)": "Recent Orders (VIOP)",
"Stop-Loss / Take-Profit ekle": "Add Stop-Loss / Take-Profit",
"Stop-Loss fiyatı girin — miktar otomatik hesaplanacak.": "Enter a Stop-Loss price — quantity will be calculated automatically.",
"Strateji Tekrarı": "Strategy Replay",
"tam ekran grafik modu": "full-screen chart mode",
"Tam ekran grafik modunu aç/kapat": "Toggle full-screen chart mode",
"Tanıtım Turu": "Product Tour",
"Tarayıcı bildirimi ile de uyar": "Also notify via browser notification",
"Temel Özellikler": "Key Features",
"Temettü Verimi: --": "Dividend Yield: --",
"Temizle": "Clear",
"Tetiklenen Alarmlar": "Triggered Alerts",
"Toplam K/Z": "Total P/L",
"Toplam Varlık": "Total Assets",
"Trailing Stop Mesafesi (%)": "Trailing Stop Distance (%)",
"tuşuna basın.": ".",
"Üst Tetik — Kırılım AL (₺)": "Upper Trigger — Breakout BUY (₺)",
"Üstteki": "The",
"Uygula": "Apply",
"Üzerine çıkınca": "Rises above",
"Vazgeç": "Cancel",
"ve portföy performans takibi.": "and portfolio performance tracking.",
"Veri Kaynağı Notu": "Data Source Note",
"veya": "or",
"VİOP": "VIOP",
"WMA 20 (Pembe)": "WMA 20 (Pink)",
"Yapıştır": "Paste",
"Yardım": "Help",
"Yeni Alarm": "New Alert",
"Yeni Gösterge Alarmı": "New Indicator Alert",
"yeşil noktayla gösterilen veri GERÇEKTİR ama": "data shown with the green dot IS REAL but",
"Yönü AL olarak seç": "Set direction to BUY",
"Yönü SAT olarak seç": "Set direction to SELL",
"Yükseliş": "Up",
"Açık grafik sekmeleri": "Open chart tabs",
"Alım-satım paneli sekmeleri": "Trade panel tabs",
"BIST100 Isı Haritası": "BIST100 Heatmap",
"Çizim araçları": "Drawing tools",
"Emir Onayı": "Order Confirmation",
"Gösterge koşulu": "Indicator condition",
"Grafik Notu": "Chart Note",
"Hedef fiyat": "Target price",
"Hızlı kaldıraç seçimi": "Quick leverage selection",
"İkinci grafik zaman dilimi": "Second chart timeframe",
"Isı haritası gruplama": "Heatmap grouping",
"İşlem panelini aç/kapat": "Open/close trade panel",
"Kaldıraç seçimi": "Leverage selection",
"Karşılaştırma grafiği göstergeleri": "Comparison chart indicators",
"Karşılaştırma grafiği osilatörleri": "Comparison chart oscillators",
"Klavye Kısayolları": "Keyboard Shortcuts",
"Komut Paleti": "Command Palette",
"Koşul": "Condition",
"Oynatma Hızı": "Playback Speed",
"Piyasa Kayan Şeridi": "Market Ticker",
"Piyasa modu": "Market mode",
"Piyasa panelini aç/kapat": "Open/close market panel",
"Sembol": "Symbol",
"Sembol seç": "Select symbol",
"Strateji Tekrarı Kontrolleri": "Strategy Replay Controls",
"Tekrar konumu": "Replay position",
"Zaman dilimi": "Timeframe",
"Eşik (ör. 30)": "Threshold (e.g. 30)",
"Gösterge ara...": "Search indicator...",
"Hedef fiyat (₺)": "Target price (₺)",
"İsminizi girin...": "Enter your name...",
"Kayıtlı e-postan...": "Your registered e-mail...",
"ör. 4": "e.g. 4",
"Örn: Direnç bölgesi": "e.g. Resistance zone",
"örn. 1": "e.g. 1",
"örn. 2.5": "e.g. 2.5",
"Sembol ara veya bir komut yazın…": "Search a symbol or type a command…",
"Sembol veya şirket adı...": "Symbol or company name...",
"Sembol yaz (ör. AKBNK)...": "Type a symbol (e.g. AKBNK)...",
"Şifren...": "Your password...",
"Araç rayını daralt/genişlet": "Collapse/expand tool rail",
"Backend durumu kontrol ediliyor…": "Checking backend status…",
"BIST100 evreninde günlük açılışa göre yükselen/düşen sembol sayısı": "Number of BIST100 symbols up/down versus the daily open",
"Bu sembolü ana grafiğe yükselt": "Promote this symbol to the main chart",
"Bu sembolün gösterge ayarlarını kopyala": "Copy this symbol's indicator settings",
"Çizimleri temizle": "Clear drawings",
"Çoklu Grafik Düzeni (2x2 Izgara)": "Multi-Chart Layout (2x2 Grid)",
"Daha sık aralıklı, kompakt görünüm": "Denser, compact view",
"Diğer İşlemler": "More Actions",
"Dual-Chart (Aynı Sembol, İki Grafik)": "Dual-Chart (Same Symbol, Two Charts)",
"Fiyat Alarmları": "Price Alerts",
"Fiyat Ölçeği: Doğrusal / Logaritmik": "Price Scale: Linear / Logarithmic",
"Fiyat/SMA20/SMA50 hizasına göre her zaman diliminin trend yönü": "Trend direction of each timeframe based on Price/SMA20/SMA50 alignment",
"Gösterge alarmları yalnızca o an grafikte açık olan sembol için kontrol edilebilir — RSI/EMA hesabı geçmiş mum verisi gerektiriyor ve bu yalnızca aktif grafik sembolünde yükleniyor. Farklı bir sembolde alarm kurmak için önce o sembolü grafikte açın, sonra bu pencereyi tekrar açın.": "Indicator alerts can only be checked for the symbol currently open on the chart — RSI/EMA need historical candles, which are loaded only for the active chart symbol. To set an alert on another symbol, open that symbol on the chart first, then reopen this window.",
"Gösterge seç": "Select indicator",
"Göstergeler": "Indicators",
"Grafik Tipi": "Chart Type",
"Hızlı sembol ara": "Quick symbol search",
"İşlem Paneli": "Trade Panel",
"Kapat": "Close",
"Karşılaştırma sembolünü BIST100 Endeksi (XU100) yap": "Set comparison symbol to BIST100 Index (XU100)",
"Karşılaştırma sembolünü değiştirmek için tıklayın": "Click to change the comparison symbol",
"Kaynak: yfinance — genelde birkaç dakika gecikmeli, yatırım tavsiyesi değildir.": "Source: yfinance — usually a few minutes delayed, not investment advice.",
"Klavye Kısayolları (?)": "Keyboard Shortcuts (?)",
"Kopyalanan gösterge ayarlarını yapıştır": "Paste copied indicator settings",
"Koyu / Açık Tema (T)": "Dark / Light Theme (T)",
"OCO: iki tetikleyiciden hangisi önce gerçekleşirse o emir çalışır, diğeri otomatik iptal olur": "OCO: whichever trigger fires first executes; the other is cancelled automatically",
"Oynat/Durdur": "Play/Pause",
"Piyasa Paneli": "Market Panel",
"Profil": "Profile",
"Sembol listesinden ara ve seç": "Search and pick from the symbol list",
"Sesli Bildirimleri Aç/Kapat": "Toggle Sound Notifications",
"Simülasyon fiyatı": "Simulated price",
"Sinyal Anlatıcısı (AL/SAT sinyallerinin nedenini grafikte göster)": "Signal Explainer (show why BUY/SELL signals fired on the chart)",
"Strateji Tekrarı (Zaman Makinesi) — geçmişi bar bar izle": "Strategy Replay (Time Machine) — watch history bar by bar",
"Tam Ekran Grafik (Esc ile çık)": "Full-Screen Chart (Esc to exit)",
"Tekrar Modundan Çık": "Exit Replay Mode",
"Trailing Stop nasıl çalışır: Fiyat lehinize hareket ettikçe stop seviyesi otomatik olarak en iyi (en yüksek/en düşük) fiyat seviyenizden belirlediğiniz yüzde kadar geride takip eder. Stop seviyesi kâr yönünde ilerledikçe kilitlenir, asla geriye (zarar yönüne) gitmez — piyasadaki standart trailing-stop mantığıyla aynıdır.": "How Trailing Stop works: as price moves in your favour, the stop automatically follows your best (highest/lowest) price at the percentage distance you set. The stop locks in as it moves toward profit and never moves back toward a loss — the standard market trailing-stop logic.",
"Trend çizgisi çiz": "Draw trend line",
"Tüm işlem geçmişini (Spot + VİOP) markalı Excel (.xlsx) olarak indir": "Download full trade history (Spot + VIOP) as branded Excel (.xlsx)",
"Uygulama Tanıtım Turu": "App Product Tour",
"Vadeli İşlem ve Opsiyon Piyasası: kaldıraç ve açığa satış": "Futures & Options Market: leverage and short selling",
"Yardım / Hakkında": "Help / About",
"Yatay çizgi çiz": "Draw horizontal line",
"Dosya": "File",
"(güncel piyasa)": "(current market)",
"AÇIĞA SAT": "SELL SHORT",
"AÇILIŞ": "OPEN",
"Aktif": "Active",
"Aktif sembol:": "Active symbol:",
"Aktif sembol: (önce bir sembol açın)": "Active symbol: (open a symbol first)",
"alım": "buy",
"Alım": "Buy",
"Alım-satım şu anda yönetici tarafından geçici olarak durduruldu.": "Trading has been temporarily paused by the administrator.",
"alınacak": "it will be bought",
"Alt tetik, güncel fiyatın altında olmalı.": "The lower trigger must be below the current price.",
"altına indi": "fell below",
"ask · alış farkı": "ask · buy spread",
"ATR(14) henüz hesaplanamadı — grafikte bu sembol için yeterli geçmiş yok.": "ATR(14) can't be calculated yet — not enough history for this symbol on the chart.",
"Aylık": "Monthly",
"Bakiye bu risk / Stop-Loss kombinasyonu için yeterli değil.": "Balance is not enough for this risk / Stop-Loss combination.",
"Bakiyen kaybolmadı — bu cihazda henüz FinteLig girişi yapmadın. Giriş yapınca gerçek demo bakiyen (diğer cihazlarınla senkronize) geri gelir.": "Your balance isn't lost — you haven't logged in to FinteLig on this device yet. Log in and your real demo balance (synced with your other devices) comes back.",
"bid · satış farkı": "bid · sell spread",
"BIST100 Isı Haritasını Aç": "Open BIST100 Heatmap",
"Bu yarışma haftasında VİOP işlemleri kapalı — yalnızca pay piyasasında işlem yapabilirsin.": "VIOP trading is closed this competition week — you can only trade on the equity market.",
"Diğer": "Other",
"Dışa aktarılacak işlem geçmişi yok.": "No trade history to export.",
"En az bir tetikleyici (üst veya alt) girin.": "Enter at least one trigger (upper or lower).",
"Excel hazırlanıyor...": "Preparing Excel...",
"Excel oluşturulamadı, CSV olarak indiriliyor...": "Couldn't create Excel, downloading as CSV...",
"ExcelJS kütüphanesi yüklenemedi (CDN engelli/offline olabilir).": "ExcelJS library failed to load (CDN blocked or offline).",
"Fiyat (₺)": "Price (₺)",
"Fiyat ₺": "Price ₺",
"Fiyat Alarmları Panelini Aç": "Open Price Alerts Panel",
"Fiyat bilgisi alınamadı.": "Couldn't get the price.",
"Fiyat EMA(20)'ye dokununca": "Price touches EMA(20)",
"Fiyat okunamadı.": "Couldn't read the price.",
"Geçerli bir miktar girin.": "Enter a valid quantity.",
"Geçersiz miktar/fiyat": "Invalid quantity/price",
"Gereken Teminat": "Required Margin",
"giriş fiyatının altında": "below the entry price",
"giriş fiyatının üzerinde": "above the entry price",
"Giriş yap": "Log in",
"Görünüm": "View",
"Göstergeler Panelini Aç": "Open Indicators Panel",
"Grafik": "Chart",
"Güncel fiyat henüz yüklenmedi — birkaç saniye sonra tekrar dene.": "Current price hasn't loaded yet — try again in a few seconds.",
"Günlük": "Daily",
"Henüz kapatılmış işlem yok.": "No closed trades yet.",
"Hızlı İşlemler": "Quick Actions",
"ℹ️ Piyasa şu anda kapalı — gireceğiniz Piyasa/Limit emri sıraya alınır, gereken teminat şimdi bakiyenizden kilitlenir, piyasa açılınca (hafta içi 09:55–18:00 TRT) otomatik gerçekleştirilir.": "ℹ️ The market is closed — any Market/Limit order you enter is queued, the required margin is locked from your balance now, and it executes automatically when the market opens (weekdays 09:55–18:00 TRT).",
"iptal edildi": "cancelled",
"İşlem": "Trade",
"İşlem açmak için önce FinteLig girişi yapmalısın (profil panelinden).": "To open a trade you must log in to FinteLig first (from the profile panel).",
"İşlem Geçmişi": "Trade History",
"İşlem Panelini Aç/Kapat": "Open/Close Trade Panel",
"KAPANIŞ": "CLOSE",
"Klavye Kısayollarını Göster": "Show Keyboard Shortcuts",
"Komisyon (₺)": "Commission (₺)",
"Kompakt Görünümü Aç/Kapat": "Toggle Compact View",
"Limit emri": "Limit order",
"Limit Emri Kur": "Place Limit Order",
"Logo görseli yüklenemedi:": "Logo image failed to load:",
"Normal Görünüm": "Normal View",
"OCO emri": "OCO order",
"OCO EMRİ OLUŞTUR": "CREATE OCO ORDER",
"Onayla · AL": "Confirm · BUY",
"Onayla · SAT": "Confirm · SELL",
"Önce bir sembol seçin.": "Select a symbol first.",
"Önerilen Stop-Loss geçersiz (ATR mesafesi fiyattan büyük) — manuel girin.": "Suggested Stop-Loss is invalid (ATR distance exceeds price) — enter it manually.",
"OptiPulseLab — Fiyat Alarmı": "OptiPulseLab — Price Alert",
"OptiPulseLab — Gösterge Alarmı": "OptiPulseLab — Indicator Alert",
"Örn:": "e.g.",
"Piyasa kapalı — emriniz sıraya alınıp açılışta otomatik gerçekleştirilecek.": "Market closed — your order is queued and will execute automatically at the open.",
"Piyasa şu anda kapalı — BIST seans saatleri: hafta içi 09:55–18:00 (TRT). Emir gönderilemez.": "The market is closed — BIST session hours: weekdays 09:55–18:00 (TRT). Orders can't be sent.",
"Portföy sıfırlandı:": "Portfolio reset:",
"Saat": "Time",
"SAT (SELL)": "SELL",
"satılacak": "it will be sold",
"satım": "sell",
"Satım": "Sell",
"Semboller": "Symbols",
"Sesli Bildirimleri Aç": "Turn On Sound Notifications",
"Sesli Bildirimleri Kapat": "Turn Off Sound Notifications",
"Şimdi Kilitlenecek Teminat": "Margin Locked Now",
"Sıradaki piyasa emri": "Queued market order",
"Sıraya Al": "Queue",
"Sonuç bulunamadı": "No results",
"Stop-Loss fiyatı giriş fiyatından farklı olmalı.": "Stop-Loss price must differ from the entry price.",
"Tanıtım Turunu Başlat": "Start Product Tour",
"Tarih": "Date",
"Tema Değiştir (Koyu / Açık)": "Toggle Theme (Dark / Light)",
"Tetiklendi": "Triggered",
"Tip": "Type",
"Üst tetik, güncel fiyatın üzerinde olmalı.": "The upper trigger must be above the current price.",
"üzerine çıktı": "rose above",
"Veri toplanıyor...": "Collecting data...",
"Veri yükleniyor...": "Loading data...",
"Yıllık": "Yearly",
"yönetici tarafından iptal edildi": "cancelled by the administrator",
"Açık pozisyon yok": "No open positions",
"Adet": "Qty",
"Bekleyen emir yok": "No pending orders",
"Canlı Fiyat": "Live Price",
"Emir geçmişi yok": "No order history",
"Eşleşen sembol bulunamadı.": "No matching symbol.",
"İzleme listeniz boş. Yukarıdaki \"Sembol Ara\" kutusuyla hisse arayıp ekleyebilirsiniz.": "Your watchlist is empty. Use the \"Search Symbol\" box above to find and add stocks.",
"Limit Fiyatı": "Limit Price",
"Nominal Değer": "Notional Value",
"Piyasa açılınca gerçekleşir": "Executes when the market opens",
"Son Fiyat:": "Last Price:",
"Yaklaşık Fiyat": "Approx. Price",
"Yön": "Side",
"Yön:": "Side:",
"Asgari tutma süresi dolmadı": "Minimum holding time not reached",
"Ayarlar": "Settings",
"Ayarlar (çizime çift tıklayarak da açılır)": "Settings (also opens by double-clicking the drawing)",
"Bu çizgiden fiyat alarmı kur": "Set a price alert from this line",
"Büyüt": "Enlarge",
"Fiyat/SMA20/SMA50 hizası": "Price/SMA20/SMA50 alignment",
"Geri Al (Ctrl+Z)": "Undo (Ctrl+Z)",
"Kaldır": "Remove",
"Kilitle / kilidi aç": "Lock / unlock",
"Küçült": "Shrink",
"Paneli kapat": "Close panel",
"Renk": "Colour",
"Sekmeyi kapat": "Close tab",
"Seviyeyi sil": "Delete level",
"Seç": "Select",
"Sürükleyerek sırala": "Drag to reorder",
"Turu Kapat (Esc)": "Close Tour (Esc)",
"Tümünü Temizle": "Clear All",
"Yinele (Ctrl+Y)": "Redo (Ctrl+Y)",
"Zaten izleme listenizde": "Already in your watchlist",
"Çizim Listesi": "Drawing List",
"Çizimi sil (Delete tuşu)": "Delete drawing (Delete key)",
"Çizimi çoğalt": "Duplicate drawing",
"Çizimleri Gizle/Göster": "Hide/Show Drawings",
"Çizimleri Kilitle": "Lock Drawings",
"İzleme listesinden çıkar": "Remove from watchlist",
"— kilitli teminat (₺{0}) bakiyenize iade edildi.": "— locked margin (₺{0}) has been returned to your balance.",
"· Adet:": "· Qty:",
"· Güncel:": "· Current:",
"· Ort. Fiyat:": "· Avg. Price:",
"({0} pozisyonda Stop-Loss yok — bunlar için yatırılan teminat riskte kabul edildi)": "({0} positions have no Stop-Loss — their full margin is counted as at risk)",
"[{0}] {1} emri gerçekleşti: {2} adet {3} @ ₺{4}": "[{0}] {1} order filled: {2} × {3} @ ₺{4}",
"[{0}] İşleminiz sıraya alındı — piyasa açıldığında {1} adet {2} {3} emriniz otomatik gerçekleştirilecek. Gereken teminat (₺{4}) şimdiden bakiyenizden kilitlendi.": "[{0}] Your order is queued — your {3} order for {1} × {2} will execute automatically when the market opens. The required margin (₺{4}) has already been locked from your balance.",
"[{0}] Limit emir gerçekleşti: {1} {2} @ ₺{3} (limit ₺{4}).": "[{0}] Limit order filled: {1} {2} @ ₺{3} (limit ₺{4}).",
"[{0}] Limit emir kuruldu: {1} adet {2} — fiyat ₺{3} olunca {4}. Gereken teminat (₺{5}) şimdiden kilitlendi.": "[{0}] Limit order placed: {1} × {2} — when price reaches ₺{3}, {4}. The required margin (₺{5}) has already been locked.",
"[{0}] OCO emri oluşturuldu: {1} · {2}{3}{4}": "[{0}] OCO order created: {1} · {2}{3}{4}",
"[{0}] OCO tetiklendi: {1} {2} @ ₺{3} — diğer tetikleyici iptal edildi.": "[{0}] OCO triggered: {1} {2} @ ₺{3} — the other trigger was cancelled.",
"[{0}] Piyasa açıldı — sıradaki emriniz gerçekleşti: {1} {2} @ ₺{3}.": "[{0}] Market opened — your queued order filled: {1} {2} @ ₺{3}.",
"{0} · Piyasa (Sırada) {1}": "{0} · Market (Queued) {1}",
"{0} ({1}x, kom. {2})": "{0} ({1}x, comm. {2})",
"{0} (kom. {1})": "{0} (comm. {1})",
"{0} ₺{1} seviyesinin {2}. Güncel fiyat: ₺{3}": "{0} {2} ₺{1}. Current price: ₺{3}",
"{0} adet — marj sınırı nedeniyle düşürüldü (Stop-Loss çok yakın olabilir).": "{0} shares — reduced due to the margin limit (Stop-Loss may be too close).",
"{0} adet — risk: {1} (bakiyenin %{2})": "{0} shares — risk: {1} ({2}% of balance)",
"{0} adet {1} hissesini {2} piyasasında ₺{3} fiyattan {4} istediğinize emin misiniz?": "Are you sure you want to {4} {0} shares of {1} on the {2} market at ₺{3}?",
"{0} adet {1} için {2} piyasasında ₺{3} limit fiyatından {4} istediğinize emin misiniz? (fiyat bu seviyeye ulaşınca gerçekleşecek)": "Are you sure you want to {4} {0} × {1} on the {2} market at a limit price of ₺{3}? (it will execute when price reaches this level)",
"{0} için kapatma emrin zaten sırada — piyasa açılınca gerçekleşecek.": "A close order for {0} is already queued — it will execute when the market opens.",
"{0} için sıradaki kapatma emri düştü — pozisyon zaten kapalı.": "The queued close order for {0} was dropped — the position is already closed.",
"{0} izleme listesinden çıkarıldı.": "{0} removed from watchlist.",
"{0} izleme listesine eklendi.": "{0} added to watchlist.",
"{0} kaldırıldı.": "{0} removed.",
"{0} pozisyonu kapatıldı.": "{0} position closed.",
"{0}sn": "{0}s",
"{3} adet": "{3} shares",
"{4} adet": "{4} shares",
"{7} adet": "{7} shares",
"⏳ {0} pozisyonu en az {1} saniye açık kalmalı — {2} saniye daha bekleyin.": "⏳ The {0} position must stay open at least {1} seconds — wait {2} more seconds.",
"⚠️ {0} marj çağrısı — kaldıraçlı pozisyon zarar sınırını aştığı için ₺{1} seviyesinden otomatik likide edildi.": "⚠️ {0} margin call — the leveraged position exceeded its loss limit and was auto-liquidated at ₺{1}.",
"🎯 {0} Take-Profit tetiklendi — pozisyon ₺{1} seviyesinden kapatıldı.": "🎯 {0} Take-Profit triggered — position closed at ₺{1}.",
"📉 {0} Trailing Stop tetiklendi — pozisyon ₺{1} seviyesinden kapatıldı.": "📉 {0} Trailing Stop triggered — position closed at ₺{1}.",
"🔔 {0} — {1} tetiklendi ({2})": "🔔 {0} — {1} triggered ({2})",
"🔔 {0} hedef fiyatı ₺{1} seviyesinin {2} (şu an ₺{3})": "🔔 {0} {2} the target price ₺{1} (now ₺{3})",
"🛑 {0} Stop-Loss tetiklendi — pozisyon ₺{1} seviyesinden kapatıldı.": "🛑 {0} Stop-Loss triggered — position closed at ₺{1}.",
"₺{0} (açılışta güncellenecek)": "₺{0} (updated at the open)",
"Alt {3}": "Lower {3}",
"Arama Sonuçları ({0})": "Search Results ({0})",
"ATR(14)×{0} ≈ ₺{1} mesafeyle önerilen Stop-Loss: ₺{2}": "Suggested Stop-Loss at ATR(14)×{0} ≈ ₺{1} distance: ₺{2}",
"Bu işlemde bakiyenizin yaklaşık %{0}'sini ({1}) riske ediyorsunuz.": "You are risking about {0}% of your balance ({1}) on this trade.",
"Emir büyüklüğü gerçekçi bir üst sınırla (₺{0}) sınırlandırıldı.": "Order size was capped at a realistic upper limit (₺{0}).",
"Geçerli bir kaldıraç girin ({0}-{1}x arası).": "Enter a valid leverage ({0}-{1}x).",
"Gerçekleşme Fiyatı{0}": "Execution Price{0}",
"ℹ️ Kaldıracınız bu pozisyon büyüklüğü için {0}x ile sınırlandırıldı (kademeli kaldıraç kuralı).": "ℹ️ Your leverage was capped at {0}x for this position size (tiered leverage rule).",
"İşlem geçmişi CSV olarak indirildi ({0} kayıt).": "Trade history downloaded as CSV ({0} records).",
"İşlem geçmişi Excel olarak indirildi ({0} kayıt).": "Trade history downloaded as Excel ({0} records).",
"Kaldıraç {0}x olarak ayarlandı.": "Leverage set to {0}x.",
"Limit emir tetiklendi ama gerçekleşemedi: {0}": "Limit order triggered but couldn't fill: {0}",
"Normal seansta açığa satış yapılamaz — {0} için pozisyonunuz yok. Açığa satış/kaldıraç için yukarıdan VİOP'a geçin.": "Short selling isn't allowed in the normal session — you have no {0} position. Switch to VIOP above for short selling/leverage.",
"Normal seansta yalnızca elinizdeki kadar satabilirsiniz (mevcut: {0} adet). Daha fazlası açığa satış sayılır — VİOP'a geçin.": "In the normal session you can only sell what you hold (available: {0} shares). More counts as short selling — switch to VIOP.",
"Not: {0} şu an {1}x kaldıraçla açık — bu ekleme {2}x ile yapılacak, pozisyonun ortalama kaldıracı {3}x olacak.": "Note: {0} is currently open at {1}x leverage — this addition uses {2}x, so the position's average leverage will be {3}x.",
"OCO tetiklendi ama emir başarısız: {0}": "OCO triggered but the order failed: {0}",
"Ort. ₺{8}": "Avg. ₺{8}",
"Piyasa kapalı — {0} pozisyonunu kapatma emrin sıraya alındı. Piyasa açılınca (hafta içi 09:55) o anki fiyattan gerçekleşecek; istersen Bekleyen Emirler'den iptal edebilirsin.": "Market closed — your order to close the {0} position is queued. It will execute at the then-current price when the market opens (weekdays 09:55); you can cancel it from Pending Orders.",
"Piyasa şu anda kapalı — {0} adet {1} için {2} piyasasında {3} emriniz SIRAYA alınacak, gereken teminat şimdi kilitlenecek ve piyasa açılır açılmaz o anki güncel fiyattan otomatik gerçekleştirilecek. Onaylıyor musunuz?": "The market is closed — your {3} order for {0} × {1} on the {2} market will be QUEUED, the required margin will be locked now, and it will execute automatically at the current price as soon as the market opens. Do you confirm?",
"Sıradaki piyasa emri gerçekleşemedi: {0}": "Queued market order couldn't fill: {0}",
"Stop-Loss fiyatı {0} olmalı.": "Stop-Loss price must be {0}.",
"Take-Profit fiyatı {0} olmalı.": "Take-Profit price must be {0}.",
"Toplam açık risk özkaynağın %{0}'i ({1}) — önerilen sınır %{2}.{3}": "Total open risk is {0}% of equity ({1}) — recommended limit {2}%.{3}",
"Trailing Stop yüzdesi en az %{0} olmalı (çok küçük bir yüzde, gürültüyle anında tetiklenir).": "Trailing Stop must be at least {0}% (a tiny percentage would trigger instantly on noise).",
"Üst {2}": "Upper {2}",
"Emrin büyüklüğü ({0}) gerçekçi olmayan bir seviyede — tek bir emir {1}'yi aşamaz.": "Order size ({0}) is unrealistic — a single order can't exceed {1}.",
"Yetersiz demo bakiye (gereken teminat: {0}).": "Insufficient demo balance (required margin: {0}).",
"Yetersiz demo bakiye (yaklaşık gereken teminat: {0}).": "Insufficient demo balance (approx. required margin: {0}).",
"Bakiyeniz yönetici tarafından güncellendi: {0}": "Your balance was updated by the administrator: {0}",
"Portföy sıfırlandı: {0}": "Portfolio reset: {0}",
"RSI {0}'un altına inince": "RSI falls below {0}",
"RSI {0}'un üzerine çıkınca": "RSI rises above {0}",
"{0} yönetici tarafından iptal edildi{1}": "{0} cancelled by the administrator{1}",
"{0} iptal edildi{1}": "{0} cancelled{1}",
"Örn: {0}": "e.g. {0}",
"Aktif sembol: {0}": "Active symbol: {0}",
"[{0}] OCO emri oluşturuldu: {1} · üst ₺{2} / alt ₺{3}": "[{0}] OCO order created: {1} · upper ₺{2} / lower ₺{3}",
"[{0}] OCO emri oluşturuldu: {1} · üst ₺{2}": "[{0}] OCO order created: {1} · upper ₺{2}",
"[{0}] OCO emri oluşturuldu: {1} · alt ₺{2}": "[{0}] OCO order created: {1} · lower ₺{2}",
"⚙ Ayarlar": "⚙ Settings",
"⧉ Çoğalt": "⧉ Duplicate",
"🔔 Alarm": "🔔 Alert",
"🔕 Alarmı kaldır": "🔕 Remove alert",
"🔕 Çizim alarmı kaldırıldı.": "🔕 Drawing alert removed.",
"🗑 Sil": "🗑 Delete",
"4 Saatlik": "4 Hour",
"52 Hafta:": "52 Week:",
"AB=CD noktası": "AB=CD point",
"ABCD Deseni (oranlı)": "ABCD Pattern (with ratios)",
"Adım Çizgisi": "Step Line",
"Alan": "Area",
"Alarm kur": "Set alert",
"Alarm kurulamadı.": "Couldn't set the alert.",
"Alarm şu çizimlerde kurulabilir: Yatay Çizgi, Yatay Işın, Trend Çizgisi, Işın, Genişletilmiş Çizgi.": "Alerts can be set on: Horizontal Line, Horizontal Ray, Trend Line, Ray, Extended Line.",
"Alarmı kaldır": "Remove alert",
"Altın Tema": "Gold Theme",
"Araç rayını daralt": "Collapse tool rail",
"Araç rayını genişlet": "Expand tool rail",
"aşağı kesti": "crossed below",
"Ayarlar için tıkla": "Click for settings",
"Ayarlar…": "Settings…",
"Ayrıca:": "Also:",
"Bu çizgi son mumun hizasına ulaşmıyor. Alarm için çizgiyi bugüne kadar uzat ya da Işın/Genişletilmiş Çizgi kullan.": "This line doesn't reach the last candle. Extend it to today for an alert, or use a Ray/Extended Line.",
"Bu çizim kilitli — silmek için önce kilidini aç.": "This drawing is locked — unlock it before deleting.",
"Bu göstergenin ayarlanabilir bir değeri yok; gizleyebilir ya da kaldırabilirsin.": "This indicator has no adjustable value; you can hide or remove it.",
"Bu sembolde henüz çizim yok. Soldaki araçlardan birini (ör. Fibonacci, Trend Çizgisi) seçip grafiğe çiz.": "No drawings on this symbol yet. Pick a tool on the left (e.g. Fibonacci, Trend Line) and draw on the chart.",
"Bu seviye zaten var.": "This level already exists.",
"Çapraz Çizgi": "Cross Line",
"Çizgi": "Line",
"Çizgi stili": "Line style",
"Çizgiler": "Lines",
"Çizim": "Drawing",
"Çizim Ayarları": "Drawing Settings",
"Çizim uçlarının mum fiyatlarına yapışması. Tıkla: Kapalı → Zayıf → Güçlü": "Snap drawing ends to candle prices. Click: Off → Weak → Strong",
"Çizimler": "Drawings",
"Çizmek için grafikte parmağını basılı tutup sürükle. Bitince araç imlece döner.": "To draw, press and drag on the chart. The tool returns to the cursor when done.",
"Çok kalın": "Very thick",
"Çoklu Zaman Dilimi:": "Multi-Timeframe:",
"Desenler": "Patterns",
"Dikdörtgen": "Rectangle",
"Dikey Çizgi": "Vertical Line",
"Dolgu": "Fill",
"Dolgu bantları": "Fill bands",
"Dolgu saydamlığı": "Fill opacity",
"DÜŞÜŞ": "DOWN",
"Düşüş Ağırlıklı": "Mostly Down",
"Düz": "Solid",
"Elips": "Ellipse",
"Elliott Dalgası (Manuel)": "Elliott Wave (Manual)",
"Etiket": "Label",
"Etiket konumu": "Label position",
"Fark:": "Difference:",
"Fibonacci Çemberleri": "Fibonacci Circles",
"Fibonacci Geri Çekilme": "Fibonacci Retracement",
"Fibonacci Kanalı": "Fibonacci Channel",
"Fibonacci Uzantı": "Fibonacci Extension",
"Fibonacci Yayları": "Fibonacci Arcs",
"Fibonacci Yelpazesi": "Fibonacci Fan",
"Fibonacci Zaman Bölgesi": "Fibonacci Time Zones",
"Fiyat henüz yüklenmedi, birazdan tekrar dene.": "Price hasn't loaded yet, try again shortly.",
"Fırça": "Brush",
"Gann Karesi (Sabit)": "Gann Square (Fixed)",
"Gann Kutusu": "Gann Box",
"Gann Yelpazesi": "Gann Fan",
"Gelişmiş Araçlar": "Advanced Tools",
"Genişletilmiş Çizgi": "Extended Line",
"Geri alınacak çizim işlemi yok.": "Nothing to undo.",
"Gizle": "Hide",
"Göster": "Show",
"Gösterge": "Indicator",
"Güçlü": "Strong",
"Güçlü Düşüş Uyumu": "Strong Bearish Alignment",
"Güçlü Yükseliş Uyumu": "Strong Bullish Alignment",
"Haftalık": "Weekly",
"Hedef": "Target",
"Hedef ₺": "Target ₺",
"Hisse Başı Kazanç:": "EPS:",
"İçi Boş Mumlar": "Hollow Candles",
"İmleç": "Cursor",
"İnce": "Thin",
"Işın": "Ray",
"Izgara": "Grid",
"Kalın": "Thick",
"Kalınlık": "Thickness",
"Kanal genişliğini fareyle ayarla, tıklayarak sabitle.": "Adjust the channel width with the mouse, click to fix it.",
"Kapalı": "Off",
"Karışık / Net Değil": "Mixed / Unclear",
"Kesikli": "Dashed",
"Kilidi aç": "Unlock",
"Kilitle": "Lock",
"Kilitle (taşınamaz/silinemez)": "Lock (can't be moved/deleted)",
"Kısa Pozisyon": "Short Position",
"Köşegenler": "Diagonals",
"Metin": "Text",
"Mıknatıs:": "Magnet:",
"Noktalı": "Dotted",
"Not & Ok": "Note & Arrow",
"Not eklemek için grafikte bir noktaya dokun.": "Tap a point on the chart to add a note.",
"NÖTR": "NEUTRAL",
"Ok": "Arrow",
"Ölçüm Aracı": "Measure Tool",
"OptiPulseLab — Çizgi Alarmı": "OptiPulseLab — Line Alert",
"Oran": "Ratio",
"Oranlar": "Ratios",
"Ort. Hacim:": "Avg. Volume:",
"Orta çizgi": "Middle line",
"Osilatör Paneli": "Oscillator Panel",
"Özel": "Custom",
"Paralel Kanal": "Parallel Channel",
"Periyot": "Period",
"Pozisyon": "Position",
"Projeksiyon (doğrusal)": "Projection (linear)",
"Renk paleti": "Colour palette",
"Sağa": "Right",
"Sağda": "On the right",
"Şekiller": "Shapes",
"Seviye ekle": "Add level",
"Seviyeler": "Levels",
"Sıfırla": "Reset",
"Sola": "Left",
"Solda": "On the left",
"Son Kapanış": "Last Close",
"Standart sapma": "Standard deviation",
"Sütunlar": "Columns",
"Tahmin": "Forecast",
"Tam ekrandan çık": "Exit full screen",
"Tam Ekrandan Çık (Esc)": "Exit Full Screen (Esc)",
"Tamam": "OK",
"Tekrar modu için yeterli geçmiş veri yok.": "Not enough history for replay mode.",
"Tekrar tamamlandı — güncel tarihe ulaşıldı.": "Replay finished — reached the current date.",
"Temel Çizgi": "Baseline",
"Temettü Verimi:": "Dividend Yield:",
"Trend Bazlı Fibonacci Zamanı": "Trend-Based Fibonacci Time",
"Trend Çizgisi": "Trend Line",
"Trend Projeksiyonu (Doğrusal — yatırım tavsiyesi değildir)": "Trend Projection (Linear — not investment advice)",
"Tüm Göstergeler / Ayarlar…": "All Indicators / Settings…",
"Tümünü göster": "Show all",
"Tümünü sil": "Delete all",
"Üçgen": "Triangle",
"Uzat": "Extend",
"Uzun Pozisyon": "Long Position",
"Varsayılan": "Default",
"Varsayılan yap": "Set as default",
"Yatay Çizgi": "Horizontal Line",
"Yatay Işın": "Horizontal Ray",
"Yelpaze": "Fan",
"Yetersiz Veri": "Insufficient Data",
"Yinelenecek çizim işlemi yok.": "Nothing to redo.",
"yukarı kesti": "crossed above",
"Yükleniyor…": "Loading…",
"YÜKSELİŞ": "UP",
"Yükseliş Ağırlıklı": "Mostly Up",
"Zaman ışınları": "Time rays",
"Zayıf": "Weak",
"Giriş ₺": "Entry ₺",
"\"{0}\" tanınan bir sembol değil.": "\"{0}\" is not a recognised symbol.",
"{0} için gerçek veri bağlantısı kuruldu — grafik güncellendi.": "Real data connected for {0} — chart updated.",
"{0} seçildi": "{0} selected",
"5 günlük ortalama (₺{0}) 20 günlük ortalamayı (₺{1}) aşağı kesti → SAT sinyali (Optipulse motoru mantığı: SMA5/SMA20 kesişimi).": "The 5-day average (₺{0}) crossed below the 20-day average (₺{1}) → SELL signal (Optipulse engine logic: SMA5/SMA20 crossover).",
"5 günlük ortalama (₺{0}) 20 günlük ortalamayı (₺{1}) yukarı kesti → AL sinyali (Optipulse motoru mantığı: SMA5/SMA20 kesişimi).": "The 5-day average (₺{0}) crossed above the 20-day average (₺{1}) → BUY signal (Optipulse engine logic: SMA5/SMA20 crossover).",
"Fiyat alt Bollinger bandının (₺{0}) altına sarkıp tekrar üzerine çıktı → AL sinyali (Bollinger Bantları mantığı: ortalamaya-dönüş).": "Price dipped below the lower Bollinger band (₺{0}) and closed back above → BUY signal (Bollinger Bands logic: mean reversion).",
"Fiyat üst Bollinger bandının (₺{0}) üzerine taşıp tekrar altına indi → SAT sinyali (Bollinger Bantları mantığı: ortalamaya-dönüş).": "Price pushed above the upper Bollinger band (₺{0}) and fell back below → SELL signal (Bollinger Bands logic: mean reversion).",
"RSI, 30 seviyesinin altından yukarı çıktı ({0}) ve MACD histogramı pozitife döndü → AL sinyali (Backtrader motoru mantığı: RSI+MACD).": "RSI rose back above 30 ({0}) and the MACD histogram turned positive → BUY signal (Backtrader engine logic: RSI+MACD).",
"RSI, 70 seviyesinin üstünden aşağı indi ({0}) ve MACD histogramı negatife döndü → SAT sinyali (Backtrader motoru mantığı: RSI+MACD).": "RSI fell back below 70 ({0}) and the MACD histogram turned negative → SELL signal (Backtrader engine logic: RSI+MACD).",
"{0}: fiyat (₺{1}) alarm kurduğun çizgiyi {2} — {3}, çizgi seviyesi ₺{4}.": "{0}: price (₺{1}) {2} your alert line — {3}, line level ₺{4}.",
"🔔 Alarm kuruldu: fiyat bu çizgiyi kestiğinde uyarılacaksın (çizgi şu an ₺{0}). Grafikte {1} açıkken kontrol edilir.": "🔔 Alert set: you'll be notified when price crosses this line (line is now at ₺{0}). It's checked while {1} is open on the chart.",
"🔔 Alarm kuruldu: {0} — Alarmlar panelinde de görünür.": "🔔 Alert set: {0} — also shown in the Alerts panel.",
"Göreceli Güç (son {0} gün): {1}": "Relative Strength (last {0} days): {1}",
"Göreceli Güç (son {0} gün):": "Relative Strength (last {0} days):",
"{0} grafiği yükleniyor…": "Loading {0} chart…",
"{0} — Ayarlar": "{0} — Settings",
"{0} — Karşılaştırma": "{0} — Comparison",
"🧲 Mıknatıs: {0} — çizim ucu her zaman en yakın açılış/kapanış/tepe/dip fiyatına yapışır.": "🧲 Magnet: {0} — drawing ends always snap to the nearest open/close/high/low.",
"🧲 Mıknatıs: {0} — çizim ucu yakındaki mumun açılış/kapanış/tepe/dip fiyatına yapışır.": "🧲 Magnet: {0} — drawing ends snap to a nearby candle's open/close/high/low.",
"🧲 Mıknatıs: {0} — çizim ucu serbest. (Çizerken Ctrl basılı tutarak geçici açabilirsin.)": "🧲 Magnet: {0} — drawing ends are free. (Hold Ctrl while drawing to enable it temporarily.)",
"Mıknatıs: {0} (tıkla: değiştir)": "Magnet: {0} (click: change)",
"52 Hafta: {0}": "52 Week: {0}",
"Piyasa Değeri: ₺{0}": "Market Cap: ₺{0}",
"Temettü Verimi: {0}": "Dividend Yield: {0}",
"Ort. Hacim: {0}": "Avg. Volume: {0}",
"Hisse Başı Kazanç: {0}": "EPS: {0}",
"F/K: {0}": "P/E: {0}",
"F/K: --": "P/E: --",
"⚠ Bu cihaz şu an diğer cihazlarınla senkronize DEĞİL (sunucuya bağlanılamıyor) — burada yaptığın işlemler diğer cihazlarına/admin paneline geç yansıyabilir. İnternetini kontrol edip sayfayı yenilemeyi dene.": "⚠ This device is NOT in sync with your other devices right now (can't reach the server) — trades made here may reach your other devices/the admin panel late. Check your internet and try refreshing the page.",
"⚠ Bu hesap yarışmacı değil — işlemler sıralamaya gitmez": "⚠ This account isn't a competitor — trades don't count toward the leaderboard",
"⚠ Giriş yapmadın — işlemler sıralamaya gitmez": "⚠ You're not logged in — trades don't count toward the leaderboard",
"⚠ Portföy senkronizasyonu sunucu tarafından reddedildi (güvenlik kuralları) — bu cihazdaki işlemler diğer cihazlarına yansımayabilir. Lütfen yöneticiye haber ver.": "⚠ Portfolio sync was rejected by the server (security rules) — trades on this device may not reach your other devices. Please tell the administrator.",
"⚠ Portföyün yarışma sıralamasına gönderilemiyor (sunucu reddetti). Lütfen yarışma görevlisine haber ver.": "⚠ Your portfolio can't be sent to the leaderboard (server rejected it). Please tell a competition official.",
"Ağ bağlantısı hatası. İnternet bağlantını kontrol et.": "Network error. Check your internet connection.",
"Alım-satım şu anda yönetici tarafından geçici olarak durduruldu (kural 13.3). Portföyün korunuyor.": "Trading has been temporarily paused by the administrator (rule 13.3). Your portfolio is safe.",
"Başvurun henüz onaylanmadı — onaylanınca e-postayla haber vereceğiz. Şimdilik misafir olarak gezinebilirsin.": "Your application hasn't been approved yet — we'll e-mail you once it is. For now you can browse as a guest.",
"Bu cihazda yapılan son işlem başka bir cihazdaki daha güncel bir işlemle çakıştı ve geri alındı. Güncel portföyün yüklendi.": "The last trade on this device conflicted with a newer trade on another device and was rolled back. Your current portfolio has been loaded.",
"Bu e-postayla onaylı bir FinTeLig başvurusu yok. Misafir olarak gezinebilirsin.": "There is no approved FinTeLig application for this e-mail. You can browse as a guest.",
"Bu hesap devre dışı bırakılmış.": "This account has been disabled.",
"Bu hesap şu anki yarışmanın onaylı yarışmacısı değil — işlemlerin sıralamaya yansımaz. Başvurduğun e-postayla giriş yaptığından emin ol; sorun sürerse görevliye başvur.": "This account isn't an approved competitor in the current competition — your trades won't count toward the leaderboard. Make sure you logged in with the e-mail you applied with; if the problem persists, contact an official.",
"Bugün resmî tatil — Borsa İstanbul kapalı, işlem yapılamaz (kural 7.3). Portföyün bir sonraki işlem gününe devam eder.": "Today is a public holiday — Borsa Istanbul is closed and trading isn't possible (rule 7.3). Your portfolio carries over to the next trading day.",
"Çok fazla hatalı deneme yapıldı. Lütfen biraz sonra tekrar dene.": "Too many failed attempts. Please try again a bit later.",
"Doğrulanıyor...": "Verifying...",
"E-posta ve şifreni gir.": "Enter your e-mail and password.",
"E-posta veya şifre hatalı.": "Wrong e-mail or password.",
"FinteLig yarışması sürüyor: işlem yapmak için sağ üstten yarışmacı hesabınla (başvurduğun e-posta + şifre) GİRİŞ YAP. Giriş yapmadan yapılan işlemler sıralamaya ve yayına yansımaz.": "The FinteLig competition is live: to trade, LOG IN at the top right with your competitor account (the e-mail + password you applied with). Trades made without logging in don't count toward the leaderboard or broadcast.",
"Fiyatlar yükleniyor — sıralama birazdan güncellenecek": "Prices loading — leaderboard will update shortly",
"Geçersiz e-posta adresi.": "Invalid e-mail address.",
"Giriş başarısız. E-posta/şifreni kontrol edip tekrar dene.": "Login failed. Check your e-mail/password and try again.",
"Giriş şu anda kullanılamıyor (bağlantı yok).": "Login is unavailable right now (no connection).",
"Giriş yapılıyor...": "Logging in...",
"Hesabın yarışma yönetimi incelemesi nedeniyle geçici olarak işleme kapatıldı (kural 12.3). İnceleme bitince otomatik açılır.": "Your account is temporarily closed to trading due to a competition review (rule 12.3). It reopens automatically when the review ends.",
"Hesabına giriş yapıldı ama bu e-postayla onaylı bir FinteLig başvurusu yok (ya henüz onaylanmadı ya da hiç başvuru yapılmadı).": "You're logged in, but there is no approved FinteLig application for this e-mail (either not yet approved or never applied).",
"Hesabının portföyü yüklendi.": "Your account's portfolio has been loaded.",
"İşlem yapma hakkı yalnızca bu haftanın onaylı yarışmacılarına açık. Yarışma haftan başladığında işlemlerin otomatik açılır.": "Trading is open only to this week's approved competitors. Trading opens automatically when your competition week starts.",
"Portföyün buluttan yüklendi.": "Your portfolio was loaded from the cloud.",
"Portföyün diğer cihazından güncellendi.": "Your portfolio was updated from your other device.",
"Portföyün güncellendi.": "Your portfolio was updated.",
"Sayfa yenileniyor...": "Reloading page...",
"Sıralamaya bağlanıyor…": "Connecting to leaderboard…",
"Sıralamaya gönderiliyor…": "Sending to leaderboard…",
"Yarışma haftan sona erdi — bu hesap artık geçmiş yarışmacı statüsünde, canlı senkron/izlemeye dahil değil.": "Your competition week has ended — this account is now a past competitor and is no longer included in live sync/monitoring.",
"Yarışma sona erdi. Şu an yalnızca eşitlik bozma ek süresindeki yarışmacılar işlem yapabilir (kural 9.11).": "The competition has ended. Only competitors in the tie-break extra time can trade now (rule 9.11).",
"Yarışma şu anda aktif değil — işlemler yarışma başladığında açılır.": "The competition isn't active right now — trading opens when the competition starts.",
"bağlantı": "connection",
"✓ Giriş başarılı — {0} · Kural ihlali kesintisi: ₺{1} (sıralamada portföy değerinden düşülür)": "✓ Login successful — {0} · Rule-violation deduction: ₺{1} (deducted from portfolio value in the ranking)",
"✓ Giriş başarılı — {0}": "✓ Login successful — {0}",
"✓ Hoşgeldin, {0}!": "✓ Welcome, {0}!",
"✓ Sıralamaya gönderildi · {0} · ₺{1}": "✓ Sent to leaderboard · {0} · ₺{1}",
"⚠ Sıralamaya gönderilemedi ({0}) — tekrar denenecek": "⚠ Couldn't send to leaderboard ({0}) — will retry",
"Bu hesabın yarışma haftası sona erdi. Misafir olarak gezinebilirsin; yeni haftaya katılmak için {0} adresinden başvur.": "This account's competition week has ended. You can browse as a guest; to join a new week, apply at {0}.",
"Bu e-posta ile FinTeLig kaydı bulunamadı. Misafir olarak gezinebilirsin; yarışmaya katılmak için {0} adresinden kayıt ol.": "No FinTeLig registration found for this e-mail. You can browse as a guest; to join the competition, register at {0}.",
"Başvurun onaylı — yarışma haftan: Hafta {0} ({1}). OPLab portföyün o hafta başladığında açılır.": "Your application is approved — your competition week: Week {0} ({1}). Your OPLab portfolio opens when that week starts.",
"Başvurun onaylı — yarışma haftan: Hafta {0}. OPLab portföyün o hafta başladığında açılır.": "Your application is approved — your competition week: Week {0}. Your OPLab portfolio opens when that week starts.",
"Yarışmadan diskalifiye edildin ({0}). İşlem yapamazsın (kural 21).": "You have been disqualified from the competition ({0}). You can't trade (rule 21).",
"Yarışmadan diskalifiye edildin. İşlem yapamazsın (kural 21).": "You have been disqualified from the competition. You can't trade (rule 21).",
"Yarışma başladıktan sonraki {0} dakika içinde katılmadığın için bu haftanın yarışmasına alınmadın (kural 15.3). Bir hata olduğunu düşünüyorsan görevliye başvur.": "You weren't admitted to this week's competition because you didn't join within {0} minutes of the start (rule 15.3). If you think this is a mistake, contact an official.",
"Kural ihlali nedeniyle {0}'e kadar işlem kısıtlaması uygulanıyor (kural 21.2).": "Due to a rule violation, trading is restricted until {0} (rule 21.2).",
"Kural ihlali nedeniyle {0}'a kadar işlem kısıtlaması uygulanıyor (kural 21.2).": "Due to a rule violation, trading is restricted until {0} (rule 21.2).",
"Hafta sonu — işlemler bir sonraki işlem günü {0}'da açılır (kural 7.2).": "Weekend — trading opens at {0} on the next trading day (rule 7.2).",
"Bugün yarışma haftanın işlem günü değil (Hafta {0}: {1}).": "Today isn't a trading day of your competition week (Week {0}: {1}).",
"Yarışma seansı dışında — işlemler yalnızca {0} arasında yapılabilir (kural 7.2).": "Outside the competition session — trading is only allowed between {0} (rule 7.2).",
"FinteLig duyurusu: {0}": "FinteLig announcement: {0}",
"\"Ctrl+K\" veya \"/\" ile her yerden açılır — tek bir kutuda hem BIST100 sembol arayabilir hem de tema/ses/kompakt görünüm değiştirme, panel açma, reset gibi hızlı işlemleri çalıştırabilirsiniz. Ok tuşlarıyla gezinip Enter ile seçin.": "Opens anywhere with \"Ctrl+K\" or \"/\" — in one box you can search BIST100 symbols and run quick actions like switching theme/sound/compact view, opening panels or resetting. Navigate with the arrow keys and press Enter to select.",
"\"OCO\" sekmesinde üst ve alt tetikleyici fiyat girerek bekleyen bir emir çifti oluşturabilirsiniz — biri gerçekleşince diğeri otomatik iptal olur. SL/TP alanında ise sabit bir stop yerine fiyatı lehte takip eden \"Trailing Stop\" seçilebiliyor.": "In the \"OCO\" tab you can create a pending order pair by entering upper and lower trigger prices — when one fills, the other is cancelled automatically. In the SL/TP area you can choose a \"Trailing Stop\" that follows price in your favour instead of a fixed stop.",
"\"Performans\" sekmesinde toplam K/Z, kazanma oranı, profit factor, Sharpe Oranı, Maks. Drawdown ve canlı özkaynak eğrisiyle performansınızı tek ekrandan takip edebilirsiniz — Sharpe ve Maks. Drawdown da gerçek kapanmış işlem geçmişinizden hesaplanır, sabit bir değer değildir.": "In the \"Performance\" tab you can track total P/L, win rate, profit factor, Sharpe Ratio, Max Drawdown and a live equity curve on one screen — Sharpe and Max Drawdown are calculated from your real closed-trade history, not fixed values.",
"2x2 Çoklu Grafik Izgarası": "2x2 Multi-Chart Grid",
"5 Dakika, 15 Dakika, 30 Dakika, 1 Saat, 2 Saat ve 4 Saatlik görünümler artık sadece o günün gerçek açılış/kapanışına sadık kalan bir tahmin değil — Yahoo Finance'ten GERÇEK gün-içi veriyle besleniyor (Yahoo'nun izin verdiği pencere kadar geriye; o pencerenin dışındaki eski tarihler için sentetik türetime düşülüyor, davranış hiçbir zaman bozulmuyor). Günlük ve Haftalık zaten tamamen gerçek geçmiş veriden; şimdi eklenen Aylık (1Ay) görünüm de aynı gerçek günlük veriden türetiliyor.": "The 5-minute, 15-minute, 30-minute, 1-hour, 2-hour and 4-hour views are no longer just an estimate faithful to the day's real open/close — they're fed with REAL intraday data from Yahoo Finance (as far back as Yahoo allows; older dates outside that window fall back to synthetic derivation, so it never breaks). Daily and Weekly already use fully real history; the new Monthly (1M) view is derived from the same real daily data.",
"Açılan bu şeritle geçmiş fiyat hareketini bar bar, oynat/durdur ve 1x/2x/5x hız seçenekleriyle yeniden izleyebilir, kaydırıcıyı sürükleyerek istediğiniz ana atlayabilirsiniz. Sinyal Anlatıcısı otomatik olarak birlikte açılır, böylece geçmişte hangi noktada neden AL/SAT sinyali verildiğini adım adım görebilirsiniz. Yeni veri çekmez — zaten yüklü olan geçmişi yeniden canlandırır.": "With this bar you can replay past price action bar by bar, with play/pause and 1x/2x/5x speeds, and drag the slider to jump to any moment. The Signal Explainer opens alongside, so you can see step by step where and why BUY/SELL signals fired. It doesn't fetch new data — it replays the history already loaded.",
"Açılan pencerede tüm BIST100 sembollerinin günlük performansını renk yoğunluğuna göre tek bakışta görebilirsiniz; bir kareye tıklayarak o sembole geçebilirsiniz. Üstteki \"Sektöre Göre\" düğmesiyle hisseleri gerçek sektörlerine (Bankacılık, Enerji, Ulaştırma vb.) göre gruplanmış olarak da görüntüleyebilirsiniz.": "In this window you can see the daily performance of all BIST100 symbols at a glance by colour intensity; click a tile to switch to that symbol. With the \"By Sector\" button at the top you can also group stocks by their real sectors (Banking, Energy, Transportation, etc.).",
"Açılan pencerede tüm kısayolları görebilirsiniz: B/S ile alım-satım yönü, 1-9 ile grafik sekmeleri, F ile tam ekran, T ile tema, ? ile bu pencere... Elinizi klavyeden kaldırmadan uygulamayı kullanabilirsiniz.": "This window lists all shortcuts: B/S for trade side, 1-9 for chart tabs, F for full screen, T for theme, ? for this window... You can use the app without leaving the keyboard.",
"Açılan pencereden bir sembol için hedef fiyat belirleyebilirsiniz — fiyat o seviyeye ulaştığında uygulama içinde (isterseniz tarayıcı bildirimi olarak da) haberdar olursunuz.": "In this window you can set a target price for a symbol — when price reaches that level you're notified in the app (and optionally by browser notification).",
"Ana (tam özellikli, çizim araçlı) grafiğin yanında ikinci, sade bir \"karşılaştırma\" paneli açılıyor — kendi bağımsız zaman dilimi (1H/4H/1D/1W) ve SMA20/EMA9 göstergeleriyle. İkisi de aynı sembolü, farklı açılardan gösteriyor.": "Next to the main (full-featured, with drawing tools) chart, a second simple \"comparison\" panel opens — with its own timeframe (1H/4H/1D/1W) and SMA20/EMA9 indicators. Both show the same symbol from different angles.",
"Bitir": "Finish",
"Bu pencerede uygulamanın demo/simülasyon olduğunun açıklaması, temel özellik özeti ve veri kaynağı/gecikme notu yer alıyor — biri \"bu gerçek mi?\" diye sorarsa göstereceğiniz yer burası.": "This window explains that the app is a demo/simulation, summarises key features and has the data source/delay note — the place to show when someone asks \"is this real?\".",
"Bu şerit, aktif hissenin 4 Saatlik, Günlük ve Haftalık zaman dilimlerindeki trend yönünü (fiyat > SMA20 > SMA50 ise yükseliş, tersi düşüş, aksi nötr) özetler ve sağda \"GÜÇLÜ YÜKSELİŞ UYUMU\" gibi genel bir sonuç rozetiyle birleştirir — üçü de aynı yöndeyse güçlü bir uyum, aksi halde \"KARIŞIK / NET DEĞİL\" olduğunu gösterir. Rozetler ana çözünürlük seçicinin de kullandığı AYNI gerçek veriden türetiliyor.": "This bar summarises the trend of the active stock on the 4-Hour, Daily and Weekly timeframes (price > SMA20 > SMA50 is up, the reverse is down, otherwise neutral) and combines them into an overall badge on the right such as \"STRONG BULLISH ALIGNMENT\" — strong alignment if all three agree, otherwise \"MIXED / UNCLEAR\". The badges come from the SAME real data used by the main resolution selector.",
"Canlı Veri Göstergesi (Yeşil Nokta)": "Live Data Indicator (Green Dot)",
"Çizim Araçları (Sol Dikey Ray)": "Drawing Tools (Left Vertical Rail)",
"Çizim araçları artık ekranın en soluna sabitlenmiş dikey bir rayda — Çizgiler, Fibonacci, Gelişmiş (Gann/Elliott), Şekiller, Not & Ok, Ölçüm, Pozisyon, Desenler (ABCD) ve Tahmin (Trend Projeksiyonu) kategorileriyle, 20'den fazla araç. Bir ikona basınca o grubun tüm seçenekleri hemen açılır. Çizimleri ve gösterge ayarlarını Ctrl+C / Ctrl+V ile kopyalayıp yapıştırabilir, rayı kenardaki okla daraltabilirsiniz.": "Drawing tools now live in a vertical rail pinned to the far left — 20+ tools in Lines, Fibonacci, Advanced (Gann/Elliott), Shapes, Note & Arrow, Measure, Position, Patterns (ABCD) and Forecast (Trend Projection). Tap an icon to open all options in that group. You can copy/paste drawings and indicator settings with Ctrl+C / Ctrl+V and collapse the rail with the arrow on its edge.",
"Çoklu Grafik Sekmeleri": "Multiple Chart Tabs",
"Çoklu Osilatör Paneli (Sürükle-Sırala)": "Multiple Oscillator Panels (Drag to Reorder)",
"Çoklu Zaman Dilimi Uyum Paneli": "Multi-Timeframe Alignment Panel",
"Dual-Chart: Aynı Sembol, İki Grafik": "Dual-Chart: Same Symbol, Two Charts",
"Eklenen 26 yeniliğe hızlı bir bakış atalım — sunum yaparken kullanabileceğiniz canlı bir tur. Her adımda ilgili panel gerçekten açılacak. Devam etmek için \"İleri\"ye basın, istediğiniz an \"Turu Kapat\" ile çıkabilirsiniz.": "Let's take a quick look at the 26 new features — a live tour you can use when presenting. At each step the related panel really opens. Press \"Next\" to continue; you can exit any time with \"Close Tour\".",
"VİOP modunda hazır 1x/2x/3x/5x düğmeleri ya da 1-5x arası manuel girişle kaldıraç seçebilirsiniz (yarışma kuralı: en fazla 5x) — pozisyon açarken bakiyenizden sadece gereken marj (teminat) kilitlenir. Yüksek kaldıraçta zarar marjın belirli bir oranını aşarsa pozisyon otomatik kapanır (marj çağrısı simülasyonu).": "In VİOP mode you can choose leverage with preset 1x/2x/3x/5x buttons or manual entry from 1-5x (competition rule: at most 5x) — only the required margin is locked from your balance when you open a position. At high leverage, if the loss exceeds a set share of the margin, the position closes automatically (margin call simulation).",
"Gelişmiş Emirler: OCO / Trailing Stop": "Advanced Orders: OCO / Trailing Stop",
"Genişletilmiş Zaman Dilimi Seçenekleri": "Extended Timeframe Options",
"Geri": "Back",
"Göstergeler Artık Kenar Çubuğunda Değil": "Indicators Are No Longer in the Sidebar",
"Göstergeler eskiden sol paneldeydi; şimdi az önce açılan bu pencerede, kaldırılabilir \"chip\" etiketleriyle yönetiliyor. Set genişledi: SMA/EMA/Bollinger/VWAP'ın yanına Ichimoku Bulutu, Parabolic SAR, Pivot Noktaları, SuperTrend, CCI, Keltner ve Donchian Kanalları, MFI eklendi (sol raydaki \"Göstergeler\" flyout'undan da hızlıca açıp kapatabilirsiniz).": "Indicators used to be in the left panel; now they're managed in this window with removable \"chip\" labels. The set has grown: alongside SMA/EMA/Bollinger/VWAP we added Ichimoku Cloud, Parabolic SAR, Pivot Points, SuperTrend, CCI, Keltner and Donchian Channels and MFI (you can also toggle them quickly from the \"Indicators\" flyout in the left rail).",
"Grafiğin üstündeki sekme çubuğuna bakın — artık aynı anda birden fazla sembolü açık tutabilirsiniz (en fazla 8 sekme). Sekmeler arası geçiş için 1-9 rakam tuşlarını veya [ / ] kısayollarını kullanabilirsiniz.": "Look at the tab bar above the chart — you can now keep several symbols open at once (up to 8 tabs). Switch tabs with the 1-9 number keys or the [ / ] shortcuts.",
"Header artık genişlemiyor/taşmıyor. Sık kullanılmayan işlemler (Tanıtım Turu, Isı Haritası, Kısayollar, Yardım, Kompakt Görünüm, Reset) buradaki tek bir menüde toplandı. \"Kompakt Görünüm\" izleme listesini ve durum çubuğunu daha sık aralıklı gösterir.": "The header no longer overflows. Less frequent actions (Product Tour, Heatmap, Shortcuts, Help, Compact View, Reset) are collected in this single menu. \"Compact View\" shows the watchlist and status bar more densely.",
"İleri": "Next",
"İşlem Geçmişini CSV Olarak İndir": "Download Trade History as CSV",
"Kaldıraç / Marj Sistemi": "Leverage / Margin System",
"Koyu / Açık Tema": "Dark / Light Theme",
"OptiPulseLab Özellik Turu": "OptiPulseLab Feature Tour",
"Portföy Performans Analitiği": "Portfolio Performance Analytics",
"RSI, MACD, Stochastic, ADX gibi birden fazla osilatörü Göstergeler penceresinden işaretleyip AYNI ANDA, kendi ayrı panellerinde görebilirsiniz — ⋮⋮ tutamacından sürükleyerek sırayı değiştirebilir, alt kenarından yükseklik ayarlayabilir, × ile kapatabilirsiniz. Tercihiniz tarayıcınızda hatırlanır.": "You can tick several oscillators such as RSI, MACD, Stochastic and ADX in the Indicators window and see them AT THE SAME TIME in their own panels — drag the ⋮⋮ handle to reorder, drag the bottom edge to resize, close with ×. Your choice is remembered in your browser.",
"Sadeleşen Header + \"☰\" Menü": "Simplified Header + \"☰\" Menu",
"Sadeleştirilmiş İzleme Listesi": "Simplified Watchlist",
"Sağ paneldeki \"Son Emirler\" bölümünün yanındaki CSV düğmesiyle tüm işlem geçmişinizi Excel uyumlu (Türkçe karakter destekli) bir dosya olarak dışa aktarabilirsiniz.": "With the CSV button next to \"Recent Orders\" in the right panel you can export your full trade history as an Excel-compatible file (with Turkish character support).",
"Sağ üstteki tema düğmesi veya \"T\" kısayoluyla koyu ve açık tema arasında anında geçiş yapabilirsiniz; tercihiniz tarayıcınızda hatırlanır.": "Switch instantly between dark and light themes with the theme button at the top right or the \"T\" shortcut; your choice is remembered in your browser.",
"Sağdaki emir panelinde şimdi açılan alanlara bakın — emir girerken ya da açık bir pozisyonda sonradan Stop-Loss / Take-Profit seviyeleri belirleyebilirsiniz. Fiyat o seviyeye ulaştığında pozisyon otomatik kapanır.": "Look at the fields that just opened in the order panel on the right — you can set Stop-Loss / Take-Profit levels when placing an order or later on an open position. When price reaches that level, the position closes automatically.",
"Sekmelerin yanı sıra artık dört sembolü aynı anda küçük ızgara halinde de izleyebilirsiniz — her hücrenin sembolünü ayrı ayrı değiştirebilir, isteğe bağlı SMA20/EMA9 göstergelerini açabilir, sağ üstteki ⤢ ile bir hücreyi tek tıkla ana (tam özellikli) grafiğe büyütebilirsiniz.": "Besides tabs, you can now watch four symbols at once in a small grid — change each cell's symbol, turn on optional SMA20/EMA9 indicators, and promote a cell to the main (full-featured) chart with one click on the ⤢ at its top right.",
"Sembol adının yanındaki küçük noktaya bakın — yanıp sönen YEŞİL nokta, bu sembol için gerçek zamanlı (WebSocket) canlı veri akışının aktif olduğu anlamına gelir; soluk GRİ nokta ise o an yerel simülasyon fiyatı gösterildiğini belirtir. Üzerine gelince (hover) hangi durumda olduğu yazıyla da görünür.": "Look at the small dot next to the symbol name — a blinking GREEN dot means the real-time (WebSocket) live data stream is active for this symbol; a faded GREY dot means a local simulated price is shown. Hover over it to see the status in words.",
"Sembol başlığının hemen altında F/K oranı, piyasa değeri, temettü verimi, 52 haftalık en düşük/en yüksek fiyat aralığı, ortalama işlem hacmi, beta (piyasaya göre oynaklık) ve hisse başına kazanç görünüyor — hepsi yfinance'ten gerçek veri, ama genelde birkaç dakika gecikmeli ve yatırım tavsiyesi değildir.": "Right under the symbol header you see the P/E ratio, market cap, dividend yield, 52-week low/high range, average volume, beta (volatility relative to the market) and earnings per share — all real data from yfinance, but usually a few minutes delayed and not investment advice.",
"Şimdi açılan bu düğmeyle grafik üzerinde AL/SAT ok işaretleri beliriyor. Bir işarete tıklarsanız, motorun (SMA5/SMA20 kesişimi, RSI+MACD kombinasyonu ya da Bollinger Bantları ortalamaya-dönüş mantığı) o sinyali NEDEN verdiğini açıklayan bir balon açılır. Gerçek bir emir veya backtest değildir — sadece motor mantığının görsel anlatımıdır.": "With this button, BUY/SELL arrow markers appear on the chart. Click a marker to open a bubble explaining WHY the engine (SMA5/SMA20 crossover, RSI+MACD combination or Bollinger Bands mean-reversion logic) gave that signal. It's not a real order or backtest — just a visual explanation of the engine logic.",
"Sinyal Anlatıcısı": "Signal Explainer",
"Şirket Temel Verileri": "Company Fundamentals",
"Sol taraftaki izleme listesine bakın — daha sade bir tasarıma kavuştu, arama kutusuyla semboller arasında hızlıca gezinebilir, her satırdaki küçük grafikle (sparkline) son fiyat hareketini görebilirsiniz.": "Look at the watchlist on the left — it has a cleaner design, you can move between symbols quickly with the search box and see recent price action in each row's small chart (sparkline).",
"Strateji Tekrarı (Zaman Makinesi)": "Strategy Replay (Time Machine)",
"Tam Ekran Grafik Modu + Hızlı Sembol Değiştirme": "Full-Screen Chart Mode + Quick Symbol Switching",
"Tam şu anda gördüğünüz gibi — header, izleme listesi ve işlem paneli gizlenip grafik tüm ekranı kaplıyor. Kenar çubuğu olmadan da sembol değiştirebilirsiniz: sembol adının yanındaki ▾ butonuna basıp TÜM BIST100 içinde arayıp doğrudan istediğiniz hisseye atlayabilir, ya da klavyeden ↑/↓ (veya ←/→) ile izleme listenizdeki bir önceki/sonraki sembole anında geçebilirsiniz. \"Esc\" ile normal görünüme dönebilirsiniz (turdan sonra otomatik geri dönecek).": "Exactly as you see now — the header, watchlist and trade panel are hidden and the chart fills the screen. You can still switch symbols without the sidebar: press the ▾ button next to the symbol name to search ALL of BIST100 and jump straight to a stock, or use ↑/↓ (or ←/→) to move to the previous/next symbol in your watchlist. Press \"Esc\" to return to normal view (it returns automatically after the tour).",
"Tur Tamamlandı": "Tour Complete",
"Turu Atla": "Skip Tour",
"Bankacılık": "Banking",
"Cam": "Glass",
"Çimento": "Cement",
"Dayanıklı Tüketim": "Consumer Durables",
"Enerji (Üretim/Dağıtım)": "Energy (Generation/Distribution)",
"Finansal Hizmetler": "Financial Services",
"Gayrimenkul Yatırım Ortaklığı": "Real Estate Investment Trust",
"Gıda, İçecek": "Food & Beverage",
"Holding ve Yatırım": "Holding & Investment",
"İlaç ve Sağlık": "Pharma & Health",
"İnşaat": "Construction",
"Kağıt": "Paper",
"Kimya, Petrokimya": "Chemicals & Petrochemicals",
"Madencilik": "Mining",
"Metal Ana Sanayii": "Basic Metals",
"Otomotiv": "Automotive",
"Perakende Ticaret": "Retail",
"Savunma Sanayii": "Defence Industry",
"Sigorta": "Insurance",
"Teknoloji": "Technology",
"Tekstil": "Textiles",
"Telekomünikasyon": "Telecommunications",
"Ulaştırma": "Transportation",
"demo/simülasyon": "demo/simulation",
"Donchian Kanalları": "Donchian Channels",
"üst ₺{0}": "upper ₺{0}",
"alt ₺{0}": "lower ₺{0}",
"Backend çalışıyor. Şu an gösterilen fiyatlar yerel simülasyon — canlı veri akışı henüz bağlanmadı veya bu sembol için kullanılamıyor. (Bağlandığında da yfinance verisi genelde birkaç dakika gecikmeli olur.)": "Backend is running. Prices shown now are a local simulation — the live data stream isn't connected yet or isn't available for this symbol. (Even when connected, yfinance data is usually a few minutes delayed.)",
"Backend sunucusuna ulaşılamıyor — fiyatlar tamamen yerel simülasyondan geliyor.": "Can't reach the backend server — prices come entirely from the local simulation.",
"Gerçek yfinance verisi akıyor (genelde birkaç dakika gecikmeli)": "Real yfinance data streaming (usually a few minutes delayed)",
"{0} için gerçek yfinance verisi akıyor (genelde birkaç dakika gecikmeli — anlık/ücretli borsa verisi değildir); son güncelleme {1}sn önce.": "Real yfinance data streaming for {0} (usually a few minutes delayed — not real-time/paid exchange data); last update {1}s ago.",
"{0} için gerçek yfinance verisi akıyor (genelde birkaç dakika gecikmeli — anlık/ücretli borsa verisi değildir).": "Real yfinance data streaming for {0} (usually a few minutes delayed — not real-time/paid exchange data).",
"Yerel simülasyon fiyatı": "Local simulated price",
"🔒 Çizim kilitlendi — taşınamaz ve silinemez.": "🔒 Drawing locked — it can't be moved or deleted.",
"🔓 Çizimin kilidi açıldı.": "🔓 Drawing unlocked.",
"Emin misin? Tekrar bas": "Sure? Press again",
"Kaydedildi ✓": "Saved ✓",
"Kopyalandı ✓": "Copied ✓",
"Yapıştırıldı ✓": "Pasted ✓",
"Kopyalanan ayarları yapıştır ({0} sembolünden)": "Paste copied settings (from {0})",
"Tekrar modundayken sinyal anlatıcısı zaten açık.": "The signal explainer is already on in replay mode.",
"Bir sembol seçin.": "Select a symbol.",
"Geçerli bir hedef fiyat girin.": "Enter a valid target price.",
"güncel fiyatın altında": "below the current price",
"güncel fiyatın üzerinde": "above the current price",
"Önce grafikte bir sembol açın.": "Open a symbol on the chart first.",
"RSI eşiği için 1-99 arası bir değer girin.": "Enter a value between 1 and 99 for the RSI threshold.",
"Tarayıcı bildirimlerine izin verilmedi.": "Browser notifications were not allowed.",
"{0} için SL/TP güncellendi.": "SL/TP updated for {0}.",
"{0} için SL/TP temizlendi.": "SL/TP cleared for {0}.",
"Alarm oluşturuldu: {0} {1} ₺{2}": "Alert created: {0} {1} ₺{2}",
"Gösterge alarmı oluşturuldu: {0} — {1}": "Indicator alert created: {0} — {1}",
"Yarışma kuralları:": "Competition rules:",
"günde en fazla 20 emir · tek hisseye portföyün en fazla %30'u · VİOP'ta en fazla 5x kaldıraç.": "at most 20 orders per day · at most 30% of the portfolio in a single stock · at most 5x leverage in VİOP.",
"Emirler anında gerçekleşir; veriler 15 dk gecikmeli olduğundan işlem fiyatı yaklaşık 15 dk içinde emir saatindeki gerçek fiyata göre netleşir (≈).": "Orders fill instantly; because data is delayed 15 min, the fill price is settled to the real price at the order time within about 15 min (≈).",
"Bugünkü emir hakkın: {0}/{1}": "Orders left today: {0}/{1}",
"Günlük işlem limitine ulaştın ({0} emir). Yarın tekrar işlem açabilirsin; açık pozisyonlarını kapatabilirsin.": "You have reached the daily trading limit ({0} orders). You can open new trades tomorrow; you can still close your open positions.",
"Tek bir hisseye portföyünün en fazla %{0}'unu ayırabilirsin ({1}). {2} için kalan hakkın: {3}": "You can allocate at most {0}% of your portfolio to a single stock ({1}). Remaining allowance for {2}: {3}",
"Kesin fiyat, veri yetişince (yaklaşık 15 dk) emir saatindeki gerçek fiyata göre netleşir.": "The final price is settled to the real price at the order time once data catches up (about 15 min).",
"Yarışma kuralları güncellendi: VİOP kaldıracı en fazla {0}x. Önceki işlemlerin {1}x'e göre yeniden hesaplandı (özkaynak etkisi {2}).": "Competition rules updated: VİOP leverage is at most {0}x. Your previous trades were recalculated at {1}x (equity effect {2}).",
"{0} işlemin fiyatı gerçek saatteki fiyata göre netleşti (özkaynak etkisi {1}).": "The price of {0} trade(s) was settled to the real price at the time (equity effect {1}).",
"{0} teminat.": "{0} margin."
};
    var KEEP = ["Agesa Hayat ve Emeklilik", "Akbank", "Akfen GYO", "Aksa Enerji", "Akçansa Çimento", "Alarko Holding", "Albaraka Türk", "Alfa Solar Enerji", "Anadolu Efes", "Arçelik", "Aselsan", "Astor Enerji", "BIST Stock", "Bera Holding", "Borusan Mannesmann", "Borusan Yatırım Pazarlama", "Bursa Çimento", "BİM Mağazalar", "Coca-Cola İçecek", "Cw Enerji Mühendislik", "Doğan Şirketler Grubu", "Doğuş Otomotiv Servis", "Eczacıbaşı Yatırım", "Eczacıbaşı İlaç", "Ege Endüstri", "Emlak Konut GYO", "Enerjisa Enerji", "Enka İnşaat", "Ereğli Demir Çelik", "Europap Tezol Kağıt", "Europower Enerji", "Ford Otomotiv Sanayi", "GSD Holding", "Galata Wind Enerji", "Garanti Bankası", "Gen İlaç ve Sağlık", "Girişim Elektrik Sanayi", "Global Yatırım Holding", "Gübre Fabrikaları", "Halk Bankası", "Hektaş", "Kardemir (D)", "Kardemir Karabük", "Kimteks Poliüretan", "Kocaer Çelik", "Kontrolmatik Teknoloji", "Konya Çimento", "Kordsa Teknik Tekstil", "Koza Altın İşletmeleri", "Koza Anadolu Metal", "Koç Holding", "Mavi Giyim", "Mia Teknoloji", "Migros Ticaret", "Odaş Elektrik", "Otokar Otomotiv", "Oyak Çimento", "Pasifik GYO", "Pegasus Hava Taşımacılığı", "Penta Teknoloji", "Petkim Petrokimya", "Qua Granite Hayal Yapı", "SDT Uzay ve Savunma", "Sabancı Holding", "Sasa Polyester", "Say Yenilenebilir Enerji", "Smart Güneş Enerjisi", "TAV Havalimanları", "Tab Gıda Sanayi", "Tekfen Holding", "Tofaş Türk Otomobil Fabrikası", "Turkcell", "Tüpraş", "Türk Hava Yolları", "Türk Telekom", "Türk Traktör", "Türkiye Sigorta", "Vakıflar Bankası", "Vestel Beyaz Eşya", "Vestel Elektronik", "Yapı ve Kredi Bankası", "Yayla Agro Gıda", "Yeo Teknoloji", "Zorlu Enerji", "Çan2 Termik", "Çemtaş Çelik Makina", "Çimsa Çimento", "Ülker Bisküvi", "İpek Doğal Enerji", "İskenderun Demir Çelik", "İzmir Demir Çelik", "İş Bankası (C)", "İş GYO", "İş Yatırım Menkul Değerler", "Şekerbank", "Şişecam", "Şok Marketler"];

    var lang = 'tr';
    try { if (localStorage.getItem(LS_KEY) === 'en') lang = 'en'; } catch (e) { /* private mode */ }

    var LETTERS = /[A-Za-zÇĞİÖŞÜçğıöşü]/;
    var IS_WORDCH = /[\p{L}\p{N}]/u;
    var keepSet = Object.create(null);
    KEEP.forEach(function (k) { keepSet[k] = 1; });

    // --- kalıplar ({n} → yakalama grubu) ---
    var PATS = [];
    var plain = [];
    function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    Object.keys(DICT).forEach(function (k) {
        if (/\{\d+\}/.test(k)) {
            var order = [];
            var src = '^' + k.split(/(\{\d+\})/).map(function (part) {
                var m = /^\{(\d+)\}$/.exec(part);
                if (m) { order.push(+m[1]); return '([\\s\\S]+?)'; }
                return esc(part);
            }).join('') + '$';
            try { PATS.push({ re: new RegExp(src), en: DICT[k], order: order, w: k.replace(/\{\d+\}/g, '').length }); } catch (e) { /* atla */ }
        } else if (k.length >= 4 && LETTERS.test(k)) {
            plain.push(k);
        }
    });
    PATS.sort(function (a, b) { return b.w - a.w; });
    plain.sort(function (a, b) { return b.length - a.length; });
    var KEEPRE = null;
    try { KEEPRE = KEEP.length ? new RegExp(KEEP.slice().sort(function (a, b) { return b.length - a.length; }).map(esc).join('|'), 'g') : null; } catch (e) { KEEPRE = null; }
    var SUBRE = null;
    try { SUBRE = plain.length ? new RegExp(plain.map(esc).join('|'), 'g') : null; } catch (e) { SUBRE = null; }

    var cache = new Map();
    function trCore(norm, depth) {
        if (keepSet[norm]) return norm;
        if (Object.prototype.hasOwnProperty.call(DICT, norm)) return DICT[norm];
        for (var i = 0; i < PATS.length; i++) {
            var p = PATS[i], m = p.re.exec(norm);
            if (!m) continue;
            var vals = {};
            p.order.forEach(function (n, j) { vals[n] = m[j + 1]; });
            return p.en.replace(/\{(\d+)\}/g, function (_, n) {
                var v = vals[n];
                if (v === undefined) return '';
                return depth < 2 ? trCore(v.trim(), depth + 1).replace(/^/, v.match(/^\s*/)[0]) + v.match(/\s*$/)[0] : v;
            });
        }
        if (SUBRE && /[ÇĞİÖŞÜçğıöşü]/.test(norm)) {
            // şirket adları olduğu gibi kalsın (ör. "Akçansa Çimento" → "Çimento" sektör çevirisine takılmasın)
            var kept = [];
            var masked = KEEPRE ? norm.replace(KEEPRE, function (mm) { kept.push(mm); return '\u0000' + (kept.length - 1) + '\u0000'; }) : norm;
            var out = masked.replace(SUBRE, function (mm, off, str) {
                if (IS_WORDCH.test(mm.charAt(0)) && off > 0 && IS_WORDCH.test(str.charAt(off - 1))) return mm;
                var end = off + mm.length;
                if (IS_WORDCH.test(mm.charAt(mm.length - 1)) && end < str.length && IS_WORDCH.test(str.charAt(end))) return mm;
                return DICT[mm];
            });
            return kept.length ? out.replace(/\u0000(\d+)\u0000/g, function (_, i) { return kept[+i]; }) : out;
        }
        return norm;
    }
    function tr(text) {
        if (lang !== 'en' || text == null) return text;
        text = String(text);
        if (!LETTERS.test(text)) return text;
        var c = cache.get(text);
        if (c !== undefined) return c;
        var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
        var norm = m[2].replace(/\s+/g, ' ');
        var res = trCore(norm, 0);
        res = (res === norm) ? text : (m[1] + res + m[3]);
        if (cache.size > 6000) cache.clear();
        cache.set(text, res);
        return res;
    }

    // --- DOM ---
    var ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
    var textRec = new WeakMap();   // Text → {o: orijinal, a: uygulanan}
    var attrRec = new WeakMap();   // Element → {attr: {o, a}}
    function skipEl(el) {
        for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
            var t = e.tagName;
            if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'CODE') return true;
            if (e.isContentEditable || e.getAttribute('translate') === 'no' || (e.classList && e.classList.contains('notranslate'))) return true;
            // hisse logosu baş harfleri (ör. ALARK → "AL") "AL/BUY" diye çevrilmesin
            if (typeof e.className === 'string' && /(^|\s)([\w-]*-logo(-[\w-]+)?|[\w-]*avatar[\w-]*)(\s|$)/i.test(e.className)) return true;
        }
        return false;
    }
    function doText(node) {
        var v = node.nodeValue;
        if (!v || !LETTERS.test(v)) return;
        var r = textRec.get(node);
        if (r && v === r.a) return;
        if (node.parentElement && skipEl(node.parentElement)) return;
        var t = tr(v);
        if (t !== v) { textRec.set(node, { o: v, a: t }); node.nodeValue = t; }
        else if (r) textRec.delete(node);
    }
    function doAttr(el, name) {
        var v = el.getAttribute(name);
        if (!v || !LETTERS.test(v)) return;
        var map = attrRec.get(el);
        if (map && map[name] && map[name].a === v) return;
        var t = tr(v);
        if (t !== v) {
            if (!map) { map = {}; attrRec.set(el, map); }
            map[name] = { o: v, a: t };
            el.setAttribute(name, t);
        }
    }
    function doEl(el) {
        if (el.nodeType !== 1 || skipEl(el)) return;
        ATTRS.forEach(function (a) { if (el.hasAttribute(a)) doAttr(el, a); });
        var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        var n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) doText(n);
            else ATTRS.forEach(function (a) { if (n.hasAttribute(a)) doAttr(n, a); });
        }
    }
    function restoreAll() {
        var w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        var n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) {
                var r = textRec.get(n);
                if (r) { if (n.nodeValue === r.a) n.nodeValue = r.o; textRec.delete(n); }
            } else {
                var map = attrRec.get(n);
                if (map) {
                    Object.keys(map).forEach(function (a) { if (n.getAttribute(a) === map[a].a) n.setAttribute(a, map[a].o); });
                    attrRec.delete(n);
                }
            }
        }
    }
    var mo = null;
    function onMut(list) {
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m.type === 'characterData') doText(m.target);
            else if (m.type === 'attributes') { if (!skipEl(m.target)) doAttr(m.target, m.attributeName); }
            else for (var j = 0; j < m.addedNodes.length; j++) {
                var a = m.addedNodes[j];
                if (a.nodeType === 3) doText(a); else if (a.nodeType === 1) doEl(a);
            }
        }
    }
    function startObs() {
        if (mo || !window.MutationObserver) return;
        mo = new MutationObserver(onMut);
        mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    function stopObs() { if (mo) { mo.disconnect(); mo = null; } }

    // --- başlık ---
    var origTitle = document.title;

    // --- uyarı pencereleri / bildirimler ---
    ['alert', 'confirm', 'prompt'].forEach(function (fn) {
        var orig = window[fn];
        if (typeof orig !== 'function') return;
        window[fn] = function (msg) {
            var args = Array.prototype.slice.call(arguments);
            if (args.length) args[0] = tr(args[0]);
            return orig.apply(window, args);
        };
    });
    if (typeof window.Notification === 'function') {
        try {
            var ON = window.Notification;
            var NN = function (title, opts) {
                var o = opts ? Object.assign({}, opts) : opts;
                if (o && o.body) o.body = tr(o.body);
                return new ON(tr(title), o);
            };
            Object.setPrototypeOf(NN, ON);
            NN.prototype = ON.prototype;
            window.Notification = NN;
        } catch (e) { /* bildirim desteği yok */ }
    }

    // --- grafik tuvali etiketleri ---
    try {
        var C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
        if (C2D) ['fillText', 'strokeText', 'measureText'].forEach(function (fn) {
            var orig = C2D[fn];
            C2D[fn] = function (text) {
                if (lang === 'en' && typeof text === 'string' && LETTERS.test(text)) {
                    var args = Array.prototype.slice.call(arguments); args[0] = tr(text);
                    return orig.apply(this, args);
                }
                return orig.apply(this, arguments);
            };
        });
    } catch (e) { /* yok say */ }

    // --- Lightweight Charts tarih ekseni dili ---
    var charts = [];
    function chartLocale() { return lang === 'en' ? 'en-US' : 'tr-TR'; }
    function hookCharts() {
        var LC = window.LightweightCharts;
        if (!LC || LC.__oplabI18n || typeof LC.createChart !== 'function') return;
        var orig = LC.createChart;
        var wrapped = function (container, options) {
            var o = Object.assign({}, options || {});
            o.localization = Object.assign({ locale: chartLocale() }, o.localization || {});
            var ch = orig.call(this, container, o);
            try { charts.push(typeof WeakRef === 'function' ? new WeakRef(ch) : { deref: function () { return ch; } }); } catch (e) { /* yok say */ }
            return ch;
        };
        try {
            // Paket nesnesi dondurulmuş olabilir — yeni bir nesneyle değiştir
            var copy = Object.assign({}, LC, { createChart: wrapped, __oplabI18n: true });
            window.LightweightCharts = copy;
        } catch (e) { /* yok say */ }
    }
    hookCharts();
    function applyChartLocale() {
        charts = charts.filter(function (r) {
            var ch = r.deref();
            if (!ch) return false;
            try { ch.applyOptions({ localization: { locale: chartLocale() } }); return true; } catch (e) { return false; }
        });
    }

    // --- dil düğmesi ---
    function injectSwitch() {
        if (document.getElementById('oplab-lang-switch')) return;
        var host = document.querySelector('.header-actions');
        if (!host) return;
        var wrap = document.createElement('div');
        wrap.id = 'oplab-lang-switch';
        wrap.className = 'lang-switch notranslate';
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'Dil / Language');
        wrap.innerHTML = '<button type="button" data-lang="tr" title="Türkçe">TR</button><button type="button" data-lang="en" title="English">EN</button>';
        wrap.addEventListener('click', function (e) {
            var b = e.target.closest('[data-lang]');
            if (b) setLang(b.getAttribute('data-lang'));
        });
        var before = document.getElementById('btn-mute-toggle');
        host.insertBefore(wrap, before && before.parentElement === host ? before : host.firstChild);
        syncSwitch();
        if (!document.getElementById('oplab-lang-style')) {
            var st = document.createElement('style');
            st.id = 'oplab-lang-style';
            st.textContent =
                '.lang-switch{display:inline-flex;align-items:center;border:1px solid var(--gold-border,rgba(212,175,55,.35));border-radius:8px;overflow:hidden;flex-shrink:0;height:32px}' +
                '.lang-switch button{background:transparent;border:0;color:var(--text-secondary,#A8A8A8);font:600 11.5px/1 var(--font-sans,system-ui,sans-serif);letter-spacing:.04em;padding:0 9px;height:100%;cursor:pointer}' +
                '.lang-switch button.active{background:var(--gold,#D4AF37);color:var(--text-dark,#111)}' +
                '.lang-switch button:not(.active):hover{color:var(--gold,#D4AF37)}' +
                '@media (max-width:640px){.lang-switch button.active{display:none}.lang-switch button{padding:0 8px}}';
            document.head.appendChild(st);
        }
    }
    function syncSwitch() {
        var w = document.getElementById('oplab-lang-switch');
        if (!w) return;
        w.querySelectorAll('[data-lang]').forEach(function (b) {
            var on = b.getAttribute('data-lang') === lang;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function apply() {
        document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'tr');
        if (lang === 'en') {
            cache.clear();
            document.title = tr(origTitle);
            doEl(document.body);
            startObs();
        } else {
            stopObs();
            restoreAll();
            document.title = origTitle;
        }
        applyChartLocale();
        syncSwitch();
        try { window.dispatchEvent(new CustomEvent('oplab:lang', { detail: { lang: lang } })); } catch (e) { /* yok say */ }
    }
    function setLang(l) {
        l = l === 'en' ? 'en' : 'tr';
        if (l === lang) return;
        lang = l;
        try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* private mode */ }
        apply();
    }

    window.OPLabI18n = { t: tr, getLang: function () { return lang; }, setLang: setLang, _dict: DICT };

    function boot() {
        hookCharts();
        injectSwitch();
        if (lang === 'en') apply(); else { document.documentElement.setAttribute('lang', 'tr'); syncSwitch(); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
