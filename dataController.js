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

    /* Stock universe with realistic BIST parameters (TRY-denominated).
     * basePrice values are approximate real BIST100 closing prices gathered
     * via web research in July 2026 (Midas/Fintables/TradingView/Investing.com,
     * cross-checked across sources) — this is what anchors the demo's
     * simulated live price walk, so it needs to actually resemble reality
     * instead of drifting to an arbitrary/hash-based number (see the 17
     * Temmuz 2026 altıncı oturum project note for the bug this fixes: BIST100
     * symbols outside a tiny 5-stock hardcoded list were falling back to a
     * flat ₺100 seed, e.g. AEFES showing ₺108 instead of its real ~₺20).
     * These are still simulation seeds, not a live feed — treat as ballpark,
     * not tick-accurate, and expect them to go stale over time.
     *
     * (19 Temmuz 2026, on birinci oturum — aylık fiyat tazeleme rutini)
     * 72 sembolün basePrice'ı Midas/Google Finance/TradingView'dan 19 Temmuz
     * 2026'da toplanan taze verilerle güncellendi (bkz. proje dokümanındaki
     * bist100-price-anchors-2026-07-19.md). Kalan 25 sembol (AGESA, AKCNS,
     * AKFGY, ALBRK, BUCIM, CEMTS, ECZYT, GLYHO, GSDHO, GWIND, IPEKE, ISDMR,
     * ISGYO, IZMDC, KARDMD, KMPUR, KORDS, KOZAA, KOZAL, PENTA, SAYAS, SDTTR,
     * TEZOL, VESBE, YYLGD) bu araştırma turunda kapsanmadı, eski değerleriyle
     * bırakıldı — tahmin/uydurma değer yazılmadı (bkz. altıncı oturumdaki
     * "gerçek vs kozmetik" ilkesi). AKSEN (+%15.1) eşiğin hemen üzerinde
     * ama iki bağımsız kaynakça (Midas + Google Finance) doğrulandığı için
     * uygulandı. */
    const STOCK_PROFILES = {
        AEFES: { name: 'Anadolu Efes', sector: 'Gıda, İçecek',  basePrice: 20.80, volatility: 0.026, drift: 0.0005, avgVolume: 42120000 },
        AGESA: { name: 'Agesa Hayat ve Emeklilik', sector: 'Sigorta', basePrice: 240.2, volatility: 0.018, drift: 0.0008, avgVolume: 1159499 },
        AKBNK: { name: 'Akbank', sector: 'Bankacılık',  basePrice: 66.50, volatility: 0.021, drift: 0.0008, avgVolume: 16362000 },
        AKCNS: { name: 'Akçansa Çimento', sector: 'Çimento', basePrice: 238.05, volatility: 0.015, drift: 0.0005, avgVolume: 1616999 },
        AKFGY: { name: 'Akfen GYO', sector: 'Gayrimenkul Yatırım Ortaklığı', basePrice: 2.78, volatility: 0.036, drift: 0.0007, avgVolume: 121500000 },
        AKSEN: { name: 'Aksa Enerji', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 106.00, volatility: 0.018, drift: 0.0007, avgVolume: 5820000 },
        ALARK: { name: 'Alarko Holding', sector: 'Holding ve Yatırım',  basePrice: 104.60, volatility: 0.023, drift: 0.0006, avgVolume: 6378000 },
        ALBRK: { name: 'Albaraka Türk', sector: 'Bankacılık', basePrice: 8.13, volatility: 0.03, drift: 0.0007, avgVolume: 110160000 },
        ALFAS: { name: 'Alfa Solar Enerji', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 44.96, volatility: 0.029, drift: 0.0008, avgVolume: 24282000 },
        ARCLK: { name: 'Arçelik', sector: 'Dayanıklı Tüketim',  basePrice: 97.60, volatility: 0.017, drift: 0.0008, avgVolume: 4470000 },
        ASELS: { name: 'Aselsan', sector: 'Savunma Sanayii',  basePrice: 351.50, volatility: 0.017, drift: 0.0007, avgVolume: 1899000 },
        ASTOR: { name: 'Astor Enerji', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 286.50, volatility: 0.016, drift: 0.0006, avgVolume: 2059500 },
        BERA: { name: 'Bera Holding', sector: 'Holding ve Yatırım',  basePrice: 14.87, volatility: 0.022, drift: 0.0003, avgVolume: 59490000 },
        BIMAS: { name: 'BİM Mağazalar', sector: 'Perakende Ticaret',  basePrice: 386.00, volatility: 0.017, drift: 0.0007, avgVolume: 936000 },
        BRSAN: { name: 'Borusan Mannesmann', sector: 'Metal Ana Sanayii',  basePrice: 549.50, volatility: 0.015, drift: 0.0005, avgVolume: 1355999 },
        BRYAT: { name: 'Borusan Yatırım Pazarlama', sector: 'Holding ve Yatırım',  basePrice: 1810.00, volatility: 0.015, drift: 0.0005, avgVolume: 269000 },
        BUCIM: { name: 'Bursa Çimento', sector: 'Çimento', basePrice: 5.87, volatility: 0.034, drift: 0.0005, avgVolume: 67320000 },
        CANTE: { name: 'Çan2 Termik', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 1.28, volatility: 0.035, drift: 0.0006, avgVolume: 85770000 },
        CCOLA: { name: 'Coca-Cola İçecek', sector: 'Gıda, İçecek',  basePrice: 87.55, volatility: 0.02, drift: 0.0003, avgVolume: 7464000 },
        CEMTS: { name: 'Çemtaş Çelik Makina', sector: 'Metal Ana Sanayii', basePrice: 9.38, volatility: 0.028, drift: 0.0005, avgVolume: 69300000 },
        CIMSA: { name: 'Çimsa Çimento', sector: 'Çimento',  basePrice: 48.86, volatility: 0.025, drift: 0.0008, avgVolume: 12329999 },
        CWENE: { name: 'Cw Enerji Mühendislik', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 39.92, volatility: 0.02, drift: 0.0007, avgVolume: 20160000 },
        DOAS: { name: 'Doğuş Otomotiv Servis', sector: 'Otomotiv',  basePrice: 185.00, volatility: 0.021, drift: 0.0004, avgVolume: 7230000 },
        DOHOL: { name: 'Doğan Şirketler Grubu', sector: 'Holding ve Yatırım',  basePrice: 21.30, volatility: 0.024, drift: 0.0005, avgVolume: 55530000 },
        ECILC: { name: 'Eczacıbaşı İlaç', sector: 'İlaç ve Sağlık',  basePrice: 73.50, volatility: 0.018, drift: 0.0007, avgVolume: 16595999 },
        ECZYT: { name: 'Eczacıbaşı Yatırım', sector: 'Holding ve Yatırım', basePrice: 349.75, volatility: 0.016, drift: 0.0006, avgVolume: 1318500 },
        EGEEN: { name: 'Ege Endüstri', sector: 'Otomotiv',  basePrice: 5545.00, volatility: 0.015, drift: 0.0005, avgVolume: 209000 },
        EKGYO: { name: 'Emlak Konut GYO', sector: 'Gayrimenkul Yatırım Ortaklığı',  basePrice: 20.38, volatility: 0.023, drift: 0.0008, avgVolume: 42435000 },
        ENJSA: { name: 'Enerjisa Enerji', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 102.50, volatility: 0.023, drift: 0.0006, avgVolume: 5994000 },
        ENKAI: { name: 'Enka İnşaat', sector: 'İnşaat',  basePrice: 90.70, volatility: 0.018, drift: 0.0003, avgVolume: 3660000 },
        EREGL: { name: 'Ereğli Demir Çelik', sector: 'Metal Ana Sanayii',  basePrice: 42.34, volatility: 0.027, drift: 0.0004, avgVolume: 25146000 },
        EUPWR: { name: 'Europower Enerji', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 87.30, volatility: 0.019, drift: 0.0004, avgVolume: 6258000 },
        FROTO: { name: 'Ford Otomotiv Sanayi', sector: 'Otomotiv',  basePrice: 83.60, volatility: 0.022, drift: 0.0007, avgVolume: 8004000 },
        GARAN: { name: 'Garanti Bankası', sector: 'Bankacılık',  basePrice: 126.80, volatility: 0.021, drift: 0.0004, avgVolume: 4206000 },
        GENIL: { name: 'Gen İlaç ve Sağlık', sector: 'İlaç ve Sağlık',  basePrice: 9.24, volatility: 0.033, drift: 0.0004, avgVolume: 96030000 },
        GESAN: { name: 'Girişim Elektrik Sanayi', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 80.30, volatility: 0.018, drift: 0.0003, avgVolume: 4956000 },
        GLYHO: { name: 'Global Yatırım Holding', sector: 'Holding ve Yatırım', basePrice: 18.73, volatility: 0.027, drift: 0.0006, avgVolume: 42615000 },
        GSDHO: { name: 'GSD Holding', sector: 'Holding ve Yatırım', basePrice: 6.04, volatility: 0.033, drift: 0.0004, avgVolume: 117270000 },
        GUBRF: { name: 'Gübre Fabrikaları', sector: 'Kimya, Petrokimya',  basePrice: 413.00, volatility: 0.015, drift: 0.0005, avgVolume: 1296000 },
        GWIND: { name: 'Galata Wind Enerji', sector: 'Enerji (Üretim/Dağıtım)', basePrice: 26.1, volatility: 0.027, drift: 0.0008, avgVolume: 29115000 },
        HALKB: { name: 'Halk Bankası', sector: 'Bankacılık',  basePrice: 38.22, volatility: 0.024, drift: 0.0003, avgVolume: 20772000 },
        HEKTS: { name: 'Hektaş', sector: 'Kimya, Petrokimya',  basePrice: 3.03, volatility: 0.031, drift: 0.0008, avgVolume: 112770000 },
        IPEKE: { name: 'İpek Doğal Enerji', sector: 'Madencilik', basePrice: 91.9, volatility: 0.016, drift: 0.0003, avgVolume: 4896000 },
        ISCTR: { name: 'İş Bankası (C)', sector: 'Bankacılık',  basePrice: 13.68, volatility: 0.029, drift: 0.0008, avgVolume: 61155000 },
        ISDMR: { name: 'İskenderun Demir Çelik', sector: 'Metal Ana Sanayii', basePrice: 56.7, volatility: 0.023, drift: 0.0008, avgVolume: 23454000 },
        ISGYO: { name: 'İş GYO', sector: 'Gayrimenkul Yatırım Ortaklığı', basePrice: 20.26, volatility: 0.025, drift: 0.0008, avgVolume: 60975000 },
        ISMEN: { name: 'İş Yatırım Menkul Değerler', sector: 'Finansal Hizmetler',  basePrice: 36.60, volatility: 0.02, drift: 0.0005, avgVolume: 16199999 },
        IZMDC: { name: 'İzmir Demir Çelik', sector: 'Metal Ana Sanayii', basePrice: 11.13, volatility: 0.025, drift: 0.0006, avgVolume: 62775000 },
        KARDMD: { name: 'Kardemir (D)', sector: 'Metal Ana Sanayii', basePrice: 40.86, volatility: 0.025, drift: 0.0006, avgVolume: 15390000 },
        KCAER: { name: 'Kocaer Çelik', sector: 'Metal Ana Sanayii',  basePrice: 13.60, volatility: 0.028, drift: 0.0007, avgVolume: 61110000 },
        KCHOL: { name: 'Koç Holding', sector: 'Holding ve Yatırım',  basePrice: 197.00, volatility: 0.021, drift: 0.0006, avgVolume: 7134000 },
        KMPUR: { name: 'Kimteks Poliüretan', sector: 'Kimya, Petrokimya', basePrice: 21.2, volatility: 0.029, drift: 0.0006, avgVolume: 62055000 },
        KONTR: { name: 'Kontrolmatik Teknoloji', sector: 'Teknoloji',  basePrice: 5.31, volatility: 0.034, drift: 0.0005, avgVolume: 54720000 },
        KONYA: { name: 'Konya Çimento', sector: 'Çimento',  basePrice: 3800.00, volatility: 0.015, drift: 0.0005, avgVolume: 186500 },
        KORDS: { name: 'Kordsa Teknik Tekstil', sector: 'Tekstil', basePrice: 79.9, volatility: 0.021, drift: 0.0006, avgVolume: 13626000 },
        KOZAA: { name: 'Koza Anadolu Metal', sector: 'Madencilik', basePrice: 119.7, volatility: 0.022, drift: 0.0005, avgVolume: 6803999 },
        KOZAL: { name: 'Koza Altın İşletmeleri', sector: 'Madencilik', basePrice: 50.25, volatility: 0.017, drift: 0.0004, avgVolume: 20610000 },
        KRDMD: { name: 'Kardemir Karabük', sector: 'Metal Ana Sanayii',  basePrice: 42.76, volatility: 0.02, drift: 0.0007, avgVolume: 16920000 },
        MAVI: { name: 'Mavi Giyim', sector: 'Tekstil',  basePrice: 41.02, volatility: 0.021, drift: 0.0004, avgVolume: 23598000 },
        MGROS: { name: 'Migros Ticaret', sector: 'Perakende Ticaret',  basePrice: 635.50, volatility: 0.015, drift: 0.0005, avgVolume: 253000 },
        MIATK: { name: 'Mia Teknoloji', sector: 'Teknoloji',  basePrice: 33.18, volatility: 0.024, drift: 0.0005, avgVolume: 21672000 },
        ODAS: { name: 'Odaş Elektrik', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 8.47, volatility: 0.033, drift: 0.0004, avgVolume: 66150000 },
        OTKAR: { name: 'Otokar Otomotiv', sector: 'Otomotiv',  basePrice: 328.25, volatility: 0.014, drift: 0.0004, avgVolume: 1462500 },
        OYAKC: { name: 'Oyak Çimento', sector: 'Çimento',  basePrice: 20.20, volatility: 0.025, drift: 0.0006, avgVolume: 27675000 },
        PENTA: { name: 'Penta Teknoloji', sector: 'Teknoloji', basePrice: 13.47, volatility: 0.026, drift: 0.0007, avgVolume: 48869999 },
        PETKM: { name: 'Petkim Petrokimya', sector: 'Kimya, Petrokimya',  basePrice: 20.94, volatility: 0.025, drift: 0.0004, avgVolume: 44325000 },
        PGSUS: { name: 'Pegasus Hava Taşımacılığı', sector: 'Ulaştırma',  basePrice: 166.50, volatility: 0.018, drift: 0.0003, avgVolume: 4332000 },
        PSGYO: { name: 'Pasifik GYO', sector: 'Gayrimenkul Yatırım Ortaklığı',  basePrice: 3.29, volatility: 0.032, drift: 0.0003, avgVolume: 108180000 },
        QUAGR: { name: 'Qua Granite Hayal Yapı', sector: 'İnşaat',  basePrice: 3.41, volatility: 0.026, drift: 0.0003, avgVolume: 106560000 },
        SAHOL: { name: 'Sabancı Holding', sector: 'Holding ve Yatırım',  basePrice: 88.40, volatility: 0.023, drift: 0.0006, avgVolume: 5850000 },
        SASA: { name: 'Sasa Polyester', sector: 'Kimya, Petrokimya',  basePrice: 2.43, volatility: 0.034, drift: 0.0005, avgVolume: 68040000 },
        SAYAS: { name: 'Say Yenilenebilir Enerji', sector: 'Enerji (Üretim/Dağıtım)', basePrice: 45.32, volatility: 0.025, drift: 0.0004, avgVolume: 15930000 },
        SDTTR: { name: 'SDT Uzay ve Savunma', sector: 'Savunma Sanayii', basePrice: 264.5, volatility: 0.018, drift: 0.0008, avgVolume: 1861500 },
        SISE: { name: 'Şişecam', sector: 'Cam',  basePrice: 44.20, volatility: 0.028, drift: 0.0005, avgVolume: 22464000 },
        SKBNK: { name: 'Şekerbank', sector: 'Bankacılık',  basePrice: 19.63, volatility: 0.027, drift: 0.0008, avgVolume: 48915000 },
        SMRTG: { name: 'Smart Güneş Enerjisi', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 11.67, volatility: 0.027, drift: 0.0004, avgVolume: 46214999 },
        SOKM: { name: 'Şok Marketler', sector: 'Perakende Ticaret',  basePrice: 51.60, volatility: 0.024, drift: 0.0005, avgVolume: 21132000 },
        TABGD: { name: 'Tab Gıda Sanayi', sector: 'Gıda, İçecek',  basePrice: 231.30, volatility: 0.013, drift: 0.0003, avgVolume: 1311000 },
        TAVHL: { name: 'TAV Havalimanları', sector: 'Ulaştırma',  basePrice: 265.50, volatility: 0.018, drift: 0.0008, avgVolume: 1399500 },
        TCELL: { name: 'Turkcell', sector: 'Telekomünikasyon',  basePrice: 108.50, volatility: 0.022, drift: 0.0003, avgVolume: 6611999 },
        TEZOL: { name: 'Europap Tezol Kağıt', sector: 'Kağıt', basePrice: 15.85, volatility: 0.028, drift: 0.0005, avgVolume: 43110000 },
        THYAO: { name: 'Türk Hava Yolları', sector: 'Ulaştırma',  basePrice: 329.50, volatility: 0.018, drift: 0.0008, avgVolume: 1408500 },
        TKFEN: { name: 'Tekfen Holding', sector: 'Holding ve Yatırım',  basePrice: 145.00, volatility: 0.016, drift: 0.0007, avgVolume: 5856000 },
        TOASO: { name: 'Tofaş Türk Otomobil Fabrikası', sector: 'Otomotiv',  basePrice: 307.75, volatility: 0.013, drift: 0.0003, avgVolume: 2055000 },
        TSKB: { name: 'TSKB', sector: 'Bankacılık',  basePrice: 11.88, volatility: 0.028, drift: 0.0005, avgVolume: 53910000 },
        TTKOM: { name: 'Türk Telekom', sector: 'Telekomünikasyon',  basePrice: 58.15, volatility: 0.017, drift: 0.0006, avgVolume: 10962000 },
        TTRAK: { name: 'Türk Traktör', sector: 'Otomotiv',  basePrice: 437.50, volatility: 0.013, drift: 0.0003, avgVolume: 1949999 },
        TUPRS: { name: 'Tüpraş', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 289.25, volatility: 0.013, drift: 0.0003, avgVolume: 1355999 },
        TURSG: { name: 'Türkiye Sigorta', sector: 'Sigorta',  basePrice: 6.56, volatility: 0.035, drift: 0.0006, avgVolume: 112050000 },
        ULKER: { name: 'Ülker Bisküvi', sector: 'Gıda, İçecek',  basePrice: 97.95, volatility: 0.017, drift: 0.0006, avgVolume: 4181999 },
        VAKBN: { name: 'Vakıflar Bankası', sector: 'Bankacılık',  basePrice: 31.00, volatility: 0.02, drift: 0.0007, avgVolume: 21960000 },
        VESBE: { name: 'Vestel Beyaz Eşya', sector: 'Dayanıklı Tüketim', basePrice: 6.33, volatility: 0.033, drift: 0.0004, avgVolume: 77670000 },
        VESTL: { name: 'Vestel Elektronik', sector: 'Dayanıklı Tüketim',  basePrice: 24.80, volatility: 0.028, drift: 0.0005, avgVolume: 28260000 },
        YEOTK: { name: 'Yeo Teknoloji', sector: 'Teknoloji',  basePrice: 91.80, volatility: 0.018, drift: 0.0003, avgVolume: 5676000 },
        YKBNK: { name: 'Yapı ve Kredi Bankası', sector: 'Bankacılık',  basePrice: 33.22, volatility: 0.023, drift: 0.0008, avgVolume: 11034000 },
        YYLGD: { name: 'Yayla Agro Gıda', sector: 'Gıda, İçecek', basePrice: 11.4, volatility: 0.023, drift: 0.0006, avgVolume: 30284999 },
        ZOREN: { name: 'Zorlu Enerji', sector: 'Enerji (Üretim/Dağıtım)',  basePrice: 2.66, volatility: 0.028, drift: 0.0005, avgVolume: 71820000 }
    };

    /* ──────────────── BIST 100 Symbol Universe (shared watchlist / selector data) ──────────────── */
    const BIST100 = [
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

    /* ──────────────── BIST Market Hours (shared single source of truth) ────────────────
     * BIST equity session: Mon–Fri, 09:55–18:00 TRT (Europe/Istanbul). Used both by the
     * header MARKET status badge (app.js) and by the live price-tick engine
     * (tradingEngine.js) so simulated prices never move while the market is closed. */
    function isMarketOpenNow() {
        const now = new Date();
        const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', weekday: 'short' });
        const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', hour: 'numeric', hour12: false });
        const minFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', minute: 'numeric' });

        const weekday = dayFormatter.format(now);
        const hour = parseInt(hourFormatter.format(now), 10);
        const minute = parseInt(minFormatter.format(now), 10);

        const timeInMinutes = hour * 60 + minute;
        const openTime = 9 * 60 + 55;  // 09:55 TRT
        const closeTime = 18 * 60;     // 18:00 TRT

        const isWeekend = weekday === 'Sat' || weekday === 'Sun';
        const isTradingHours = timeInMinutes >= openTime && timeInMinutes < closeTime;

        return !isWeekend && isTradingHours;
    }

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
    function normalizeTicker(ticker) {
        if (!ticker) return '';
        ticker = ticker.toUpperCase().trim();
        if (!ticker.endsWith('.IS') && ticker !== 'XU100' && ticker !== 'XU100.IS') {
            return ticker + '.IS';
        }
        return ticker;
    }

    function generateOHLCV(ticker, days = TRADING_DAYS) {
        const cleanTicker = ticker.replace('.IS', '');
        let profile = STOCK_PROFILES[cleanTicker];
        if (!profile) {
            profile = {
                name: cleanTicker,
                sector: 'BIST Stock',
                basePrice: 100.0,
                volatility: 0.02,
                drift: 0.0005,
                avgVolume: 10_000_000
            };
        }

        // Seed by ticker hash so each stock is reproducible but distinct
        const seed = Array.from(cleanTicker).reduce((s, c) => s * 31 + c.charCodeAt(0), 0);
        const rng = mulberry32(seed);

        const candles = [];
        let prevClose = profile.basePrice;
        // Anchor day 0 to 2026-06-01 using UTC field math (Date.UTC), not a
        // local-time Date — this keeps candle timestamps 100% independent of
        // whatever timezone this code happens to run in (sandbox vs. the
        // user's own machine), which matters now that `date` is a unix-second
        // timestamp consumed directly by Lightweight Charts' UTC-based axis
        // formatting (see synthesizeIntradayCandles()'s comment for the full
        // "treat UTC fields as TRT wall-clock" convention this app uses).
        const startMs = Date.UTC(2026, 5, 1); // 2026-06-01T00:00:00Z

        for (let i = 0; i < days; i++) {
            const dayMs = startMs + i * 86400000;
            const dow = new Date(dayMs).getUTCDay();
            // Skip weekends
            if (dow === 0 || dow === 6) {
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
                date: Math.floor(dayMs / 1000), // unix seconds (UTC midnight of this trading day)
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

    /* ──────────────── 1b. Timeframe Resolution Engine ────────────────
     * Everything in this app is DAILY-bar data (real fetched OHLCV or the
     * synthetic generator above) — there is no real intraday feed. To make
     * the TradingView-style "15m / 1H / 4H / 1D / 1W" resolution selector on
     * the chart genuinely functional rather than a decorative dead button,
     * each daily bar is deterministically exploded into sub-bars (intraday)
     * or grouped with its trading-week neighbors (weekly). Deterministic =
     * seeded per-bar, so switching resolutions back and forth always
     * reproduces the same synthetic shape instead of jittering randomly.
     *
     * Convention: every candle's `date` field across this whole app is a
     * unix-second timestamp whose UTC calendar/clock fields are meant to be
     * read AS IF they were TRT (Europe/Istanbul, UTC+3) wall-clock fields —
     * e.g. a bar tagged 07:00 UTC represents "10:00 TRT", the BIST session
     * open. This is a deliberate simplification (real UTC offset is never
     * applied) so Lightweight Charts' UTC-based axis formatting and this
     * module's own display formatting always agree without needing timezone
     * conversion anywhere. */

    const BIST_SESSION_START_UTC_SECONDS = 7 * 3600;  // "10:00 TRT" -> 07:00 on the UTC-labeled clock
    const BIST_SESSION_MINUTES = 480;                  // "10:00-18:00 TRT" 8-hour session

    /**
     * Explode each daily candle into N deterministic intraday sub-bars that
     * respect the parent bar's open/high/low/close exactly (first sub-bar's
     * open == daily open, last sub-bar's close == daily close, and the
     * min/max across all sub-bars reproduces the daily low/high).
     * @param {Array} dailyCandles — daily candles as produced by generateOHLCV
     *   or the /api/v1/ohlcv backend parser (each needs date/open/high/low/close/volume)
     * @param {number} resolutionMinutes — e.g. 15, 60, 240
     * @returns {Array} intraday candles, same shape, many more of them
     */
    function synthesizeIntradayCandles(dailyCandles, resolutionMinutes) {
        if (!Array.isArray(dailyCandles) || !dailyCandles.length) return [];
        const barsPerDay = Math.max(1, Math.round(BIST_SESSION_MINUTES / resolutionMinutes));
        const secondsPerBar = (BIST_SESSION_MINUTES * 60) / barsPerDay;
        const out = [];

        dailyCandles.forEach(day => {
            const { date, open, high, low, close } = day;
            const volume = day.volume || 0;
            const dayStart = date + BIST_SESSION_START_UTC_SECONDS;
            const range = Math.max(high - low, 0.01);

            // Deterministic per-day seed (no external ticker param needed —
            // the bar's own values already make it unique).
            const seed = Math.abs(Math.round(date * 2654435761 + open * 977 + close * 613)) % 2147483647;
            const rng = mulberry32(seed || 1);

            // Brownian-bridge control points: points[0]=open ... points[n]=close,
            // with noise tapering to 0 at both ends so the bridge lands exactly
            // on the daily open/close.
            const points = [open];
            for (let i = 1; i < barsPerDay; i++) {
                const t = i / barsPerDay;
                const drift = open + (close - open) * t;
                const noise = (rng() - 0.5) * range * 0.7 * Math.sin(Math.PI * t);
                points.push(drift + noise);
            }
            points.push(close);
            for (let i = 0; i <= barsPerDay; i++) {
                points[i] = Math.min(high, Math.max(low, points[i]));
            }
            points[0] = open;
            points[barsPerDay] = close;

            // Force the daily low/high to actually appear somewhere in the
            // interior of the path, so the sub-bars reconstruct the exact
            // daily range instead of just approximating it.
            if (barsPerDay >= 3) {
                const lowIdx = 1 + Math.floor(rng() * (barsPerDay - 1));
                let highIdx = 1 + Math.floor(rng() * (barsPerDay - 1));
                if (highIdx === lowIdx) highIdx = (lowIdx % (barsPerDay - 1)) + 1;
                points[lowIdx] = low;
                points[highIdx] = high;
            }

            const volPerBar = volume / barsPerDay;
            for (let i = 0; i < barsPerDay; i++) {
                const o = points[i], c = points[i + 1];
                const wick = range * 0.05 * rng();
                const hi = Math.min(high, Math.max(o, c) + wick);
                const lo = Math.max(low, Math.min(o, c) - wick);
                out.push({
                    date: Math.round(dayStart + i * secondsPerBar),
                    open: +o.toFixed(2),
                    high: +hi.toFixed(2),
                    low: +lo.toFixed(2),
                    close: +c.toFixed(2),
                    volume: Math.round(volPerBar * (0.6 + rng() * 0.8))
                });
            }
        });

        return out;
    }

    /**
     * Aggregate daily candles into one bar per trading week (Mon-anchored),
     * OHLC-rolled up (open=first day's open, close=last day's close,
     * high/low = week's extremes, volume = week's sum).
     * @param {Array} dailyCandles
     * @returns {Array} weekly candles, same shape as daily
     */
    function aggregateWeeklyCandles(dailyCandles) {
        if (!Array.isArray(dailyCandles) || !dailyCandles.length) return [];
        const weeks = new Map();

        dailyCandles.forEach(c => {
            const d = new Date(c.date * 1000);
            const dow = d.getUTCDay(); // 0=Sun..6=Sat
            const diffToMonday = dow === 0 ? -6 : 1 - dow;
            const mondayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday);
            const key = Math.floor(mondayMs / 1000);
            if (!weeks.has(key)) weeks.set(key, []);
            weeks.get(key).push(c);
        });

        return Array.from(weeks.keys()).sort((a, b) => a - b).map(key => {
            const bucket = weeks.get(key);
            return {
                date: key,
                open: bucket[0].open,
                high: Math.max(...bucket.map(c => c.high)),
                low: Math.min(...bucket.map(c => c.low)),
                close: bucket[bucket.length - 1].close,
                volume: bucket.reduce((s, c) => s + (c.volume || 0), 0)
            };
        });
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
     * Compute Weighted Moving Average — like SMA but recent bars count more
     * (weight i+1 for the i-th bar in the window, so the most recent bar in
     * a period-N window has weight N). Added onuncu oturum (18 Temmuz 2026)
     * to diversify the overlay indicator list alongside SMA/EMA.
     * @param {number[]} closes
     * @param {number}   period
     * @returns {(number|null)[]}
     */
    function computeWMA(closes, period) {
        const wma = [];
        const denom = (period * (period + 1)) / 2;
        for (let i = 0; i < closes.length; i++) {
            if (i < period - 1) { wma.push(null); continue; }
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += closes[i - period + 1 + j] * (j + 1);
            }
            wma.push(+(sum / denom).toFixed(4));
        }
        return wma;
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
     * Compute MACD (Moving Average Convergence Divergence).
     * @returns {{macdLine:(number|null)[], signalLine:(number|null)[], histogram:(number|null)[]}}
     */
    function computeMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const emaFast = computeEMA(closes, fastPeriod);
        const emaSlow = computeEMA(closes, slowPeriod);
        const macdLine = closes.map((_, i) => {
            if (emaFast[i] === null || emaSlow[i] === null) return null;
            return +(emaFast[i] - emaSlow[i]).toFixed(4);
        });

        const firstValidIdx = macdLine.findIndex(v => v !== null);
        const signalLine = new Array(macdLine.length).fill(null);
        const histogram = new Array(macdLine.length).fill(null);

        if (firstValidIdx !== -1) {
            const validMacd = macdLine.slice(firstValidIdx);
            const emaOfMacd = computeEMA(validMacd, signalPeriod);
            for (let i = 0; i < emaOfMacd.length; i++) {
                if (emaOfMacd[i] !== null) {
                    signalLine[firstValidIdx + i] = emaOfMacd[i];
                    histogram[firstValidIdx + i] = +(validMacd[i] - emaOfMacd[i]).toFixed(4);
                }
            }
        }
        return { macdLine, signalLine, histogram };
    }

    /**
     * Compute Stochastic Oscillator (%K, %D).
     * @returns {{k:(number|null)[], d:(number|null)[]}}
     */
    function computeStochastic(candles, kPeriod = 14, dPeriod = 3) {
        const kValues = [];
        for (let i = 0; i < candles.length; i++) {
            if (i < kPeriod - 1) { kValues.push(null); continue; }
            let lowestLow = Infinity, highestHigh = -Infinity;
            for (let j = i - kPeriod + 1; j <= i; j++) {
                if (candles[j].low < lowestLow) lowestLow = candles[j].low;
                if (candles[j].high > highestHigh) highestHigh = candles[j].high;
            }
            const range = (highestHigh - lowestLow) || 1;
            kValues.push(+(((candles[i].close - lowestLow) / range) * 100).toFixed(2));
        }
        const dValues = [];
        for (let i = 0; i < kValues.length; i++) {
            if (kValues[i] === null) { dValues.push(null); continue; }
            let sum = 0, cnt = 0;
            for (let j = Math.max(0, i - dPeriod + 1); j <= i; j++) {
                if (kValues[j] !== null) { sum += kValues[j]; cnt++; }
            }
            dValues.push(cnt > 0 ? +(sum / cnt).toFixed(2) : null);
        }
        return { k: kValues, d: dValues };
    }

    /**
     * Compute Williams %R — momentum oscillator ranging -100..0, conceptually
     * a mirrored/rescaled Stochastic %K (%R = -100 * (highestHigh - close) /
     * (highestHigh - lowestLow) over the window). Added onuncu oturum (18
     * Temmuz 2026) to diversify the oscillator panel list alongside RSI/
     * MACD/Stochastic. -80 and below is conventionally "oversold", -20 and
     * above "overbought" (mirrors RSI's 30/70 but on Williams %R's own scale).
     * @param {Array} candles
     * @param {number} period
     * @returns {(number|null)[]}
     */
    function computeWilliamsR(candles, period = 14) {
        const willr = [];
        for (let i = 0; i < candles.length; i++) {
            if (i < period - 1) { willr.push(null); continue; }
            let highestHigh = -Infinity, lowestLow = Infinity;
            for (let j = i - period + 1; j <= i; j++) {
                if (candles[j].high > highestHigh) highestHigh = candles[j].high;
                if (candles[j].low < lowestLow) lowestLow = candles[j].low;
            }
            const range = highestHigh - lowestLow;
            const value = range === 0 ? 0 : ((highestHigh - candles[i].close) / range) * -100;
            willr.push(+value.toFixed(2));
        }
        return willr;
    }

    /**
     * Compute Ichimoku Kinko Hyo (Ichimoku Cloud).
     *
     * Tenkan-sen ve Kijun-sen mevcut barlarda hesaplanır. Senkou Span A/B ve
     * Chikou Span, standart formüle göre gerçek verilerden hesaplanır ve
     * `displacement` kadar kaydırılır — ancak son gerçek mum çubuğunun
     * ötesine sahte/gelecek zaman damgalı barlar EKLENMEZ (bu projede veri
     * uydurmama ilkesi gereği). Bu yüzden bulut, en güncel `displacement`
     * bar için henüz "ileri" çizilmez; Chikou de son `displacement` barda
     * boş kalır. Bu dürüst bir basitleştirmedir, hata değildir.
     */
    function computeIchimoku(candles, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52, displacement = 26) {
        const len = candles.length;
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        function midpoint(period, i) {
            if (i < period - 1) return null;
            let hh = -Infinity, ll = Infinity;
            for (let j = i - period + 1; j <= i; j++) {
                if (highs[j] > hh) hh = highs[j];
                if (lows[j] < ll) ll = lows[j];
            }
            return (hh + ll) / 2;
        }

        const tenkan = new Array(len).fill(null);
        const kijun = new Array(len).fill(null);
        const senkouARaw = new Array(len).fill(null);
        const senkouBRaw = new Array(len).fill(null);
        const chikou = new Array(len).fill(null);

        for (let i = 0; i < len; i++) {
            tenkan[i] = midpoint(tenkanPeriod, i);
            kijun[i] = midpoint(kijunPeriod, i);
            if (tenkan[i] !== null && kijun[i] !== null) {
                senkouARaw[i] = (tenkan[i] + kijun[i]) / 2;
            }
            senkouBRaw[i] = midpoint(senkouBPeriod, i);
        }

        // Senkou Span A/B: displacement kadar ileri kaydırılır (yalnızca gerçek bar aralığında).
        const senkouA = new Array(len).fill(null);
        const senkouB = new Array(len).fill(null);
        for (let i = 0; i < len; i++) {
            const srcIdx = i - displacement;
            if (srcIdx >= 0) {
                senkouA[i] = senkouARaw[srcIdx];
                senkouB[i] = senkouBRaw[srcIdx];
            }
        }

        // Chikou Span: kapanış fiyatı displacement kadar geriye kaydırılır.
        for (let i = 0; i < len; i++) {
            const dstIdx = i - displacement;
            if (dstIdx >= 0) {
                chikou[dstIdx] = closes[i];
            }
        }

        return {
            tenkan: tenkan.map(v => v === null ? null : +v.toFixed(4)),
            kijun: kijun.map(v => v === null ? null : +v.toFixed(4)),
            senkouA: senkouA.map(v => v === null ? null : +v.toFixed(4)),
            senkouB: senkouB.map(v => v === null ? null : +v.toFixed(4)),
            chikou: chikou.map(v => v === null ? null : +v.toFixed(4))
        };
    }

    /**
     * Compute Parabolic SAR (Stop and Reverse) — Wilder'in standart algoritması.
     * Görselleştirme: nokta işaretleyici yerine ince noktalı çizgi olarak
     * gösterilecektir (bkz. tradingChart.js) — bu dürüst bir basitleştirmedir.
     */
    function computeParabolicSAR(candles, step = 0.02, maxStep = 0.2) {
        const len = candles.length;
        const sar = new Array(len).fill(null);
        if (len < 2) return sar;

        let isUptrend = candles[1].close >= candles[0].close;
        let af = step;
        let ep = isUptrend ? candles[0].high : candles[0].low;
        let sarValue = isUptrend ? candles[0].low : candles[0].high;

        sar[0] = +sarValue.toFixed(4);

        for (let i = 1; i < len; i++) {
            let nextSar = sarValue + af * (ep - sarValue);

            if (isUptrend) {
                // SAR, önceki iki barın en düşüğünü aşamaz.
                const prevLow1 = candles[i - 1].low;
                const prevLow2 = i >= 2 ? candles[i - 2].low : prevLow1;
                nextSar = Math.min(nextSar, prevLow1, prevLow2);

                if (candles[i].low < nextSar) {
                    // Trend dönüşü: yükselişten düşüşe.
                    isUptrend = false;
                    nextSar = ep;
                    ep = candles[i].low;
                    af = step;
                } else {
                    if (candles[i].high > ep) { ep = candles[i].high; af = Math.min(af + step, maxStep); }
                }
            } else {
                const prevHigh1 = candles[i - 1].high;
                const prevHigh2 = i >= 2 ? candles[i - 2].high : prevHigh1;
                nextSar = Math.max(nextSar, prevHigh1, prevHigh2);

                if (candles[i].high > nextSar) {
                    // Trend dönüşü: düşüşten yükselişe.
                    isUptrend = true;
                    nextSar = ep;
                    ep = candles[i].high;
                    af = step;
                } else {
                    if (candles[i].low < ep) { ep = candles[i].low; af = Math.min(af + step, maxStep); }
                }
            }

            sarValue = nextSar;
            sar[i] = +sarValue.toFixed(4);
        }

        return sar;
    }

    /**
     * Compute classical (floor-trader) Pivot Points from the most recently
     * COMPLETED candle (henüz oluşmakta olan son bar hariç). Bunlar bir
     * zaman serisi değil, yatay destek/direnç seviyeleridir — grafik
     * üzerinde createPriceLine() ile statik çizgiler olarak gösterilir
     * (RSI'nin 70/30 referans çizgileriyle aynı desen).
     */
    function computePivotPoints(candles) {
        if (!candles || candles.length < 2) return null;
        const ref = candles[candles.length - 2]; // son tamamlanmış bar
        const { high, low, close } = ref;
        const p = (high + low + close) / 3;
        const r1 = 2 * p - low;
        const s1 = 2 * p - high;
        const r2 = p + (high - low);
        const s2 = p - (high - low);
        const r3 = high + 2 * (p - low);
        const s3 = low - 2 * (high - p);

        const round4 = v => +v.toFixed(4);
        return {
            p: round4(p),
            r1: round4(r1), r2: round4(r2), r3: round4(r3),
            s1: round4(s1), s2: round4(s2), s3: round4(s3)
        };
    }

    /**
     * Compute SuperTrend (ATR tabanlı trend-takip göstergesi).
     *
     * İki ayrı seri döndürülür — `up` (yükseliş trendindeyken dolu, düşüş
     * trendindeyken null) ve `down` (tam tersi). Bu, tek bir çizgiyi trend
     * yönüne göre iki renkli göstermenin (gerçek TradingView'daki gibi
     * yeşil/kırmızı segmentler) Lightweight Charts'ta nokta-bazlı renk API'si
     * olmadan yapılabilecek dürüst/doğru yolu — her iki seri de candleSeries
     * üzerinde AYNI çizginin farklı segmentleri, sahte/ekstra veri değil.
     */
    function computeSuperTrend(candles, period = 10, multiplier = 3) {
        const len = candles.length;
        const atr = computeATR(candles, period);
        const up = new Array(len).fill(null);
        const down = new Array(len).fill(null);
        if (len < period + 1) return { up, down };

        let finalUpper = null, finalLower = null, trendUp = true;

        for (let i = 0; i < len; i++) {
            if (atr[i] === null || atr[i] === undefined) continue;
            const mid = (candles[i].high + candles[i].low) / 2;
            const basicUpper = mid + multiplier * atr[i];
            const basicLower = mid - multiplier * atr[i];

            if (finalUpper === null) {
                finalUpper = basicUpper;
                finalLower = basicLower;
            } else {
                const prevClose = candles[i - 1].close;
                finalUpper = (basicUpper < finalUpper || prevClose > finalUpper) ? basicUpper : finalUpper;
                finalLower = (basicLower > finalLower || prevClose < finalLower) ? basicLower : finalLower;
            }

            const close = candles[i].close;
            if (trendUp) {
                if (close < finalLower) trendUp = false;
            } else {
                if (close > finalUpper) trendUp = true;
            }

            const value = trendUp ? finalLower : finalUpper;
            if (trendUp) up[i] = +value.toFixed(4); else down[i] = +value.toFixed(4);
        }

        return { up, down };
    }

    /**
     * Compute Commodity Channel Index (CCI).
     */
    function computeCCI(candles, period = 20) {
        const len = candles.length;
        const cci = new Array(len).fill(null);
        const typical = candles.map(c => (c.high + c.low + c.close) / 3);

        for (let i = period - 1; i < len; i++) {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += typical[j];
            const mean = sum / period;
            let meanDev = 0;
            for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(typical[j] - mean);
            meanDev /= period;
            cci[i] = meanDev === 0 ? 0 : +((typical[i] - mean) / (0.015 * meanDev)).toFixed(2);
        }
        return cci;
    }

    /**
     * Compute Keltner Channels (EMA orta çizgi + ATR tabanlı üst/alt bant).
     */
    function computeKeltnerChannels(candles, period = 20, atrPeriod = 10, multiplier = 2) {
        const closes = candles.map(c => c.close);
        const middle = computeEMA(closes, period);
        const atr = computeATR(candles, atrPeriod);
        const len = candles.length;
        const upper = new Array(len).fill(null);
        const lower = new Array(len).fill(null);

        for (let i = 0; i < len; i++) {
            if (middle[i] === null || middle[i] === undefined || atr[i] === null || atr[i] === undefined) continue;
            upper[i] = +(middle[i] + multiplier * atr[i]).toFixed(4);
            lower[i] = +(middle[i] - multiplier * atr[i]).toFixed(4);
        }
        return { middle, upper, lower };
    }

    /**
     * Compute Donchian Channels (belirli periyottaki en yüksek/en düşük).
     */
    function computeDonchianChannels(candles, period = 20) {
        const len = candles.length;
        const upper = new Array(len).fill(null);
        const lower = new Array(len).fill(null);
        const middle = new Array(len).fill(null);

        for (let i = period - 1; i < len; i++) {
            let hh = -Infinity, ll = Infinity;
            for (let j = i - period + 1; j <= i; j++) {
                if (candles[j].high > hh) hh = candles[j].high;
                if (candles[j].low < ll) ll = candles[j].low;
            }
            upper[i] = +hh.toFixed(4);
            lower[i] = +ll.toFixed(4);
            middle[i] = +((hh + ll) / 2).toFixed(4);
        }
        return { upper, lower, middle };
    }

    /**
     * Compute Money Flow Index (hacim ağırlıklı RSI benzeri osilatör).
     */
    function computeMFI(candles, period = 14) {
        const len = candles.length;
        const mfi = new Array(len).fill(null);
        const typical = candles.map(c => (c.high + c.low + c.close) / 3);
        const rawFlow = candles.map((c, i) => typical[i] * (c.volume || 0));

        for (let i = period; i < len; i++) {
            let posFlow = 0, negFlow = 0;
            for (let j = i - period + 1; j <= i; j++) {
                if (typical[j] > typical[j - 1]) posFlow += rawFlow[j];
                else if (typical[j] < typical[j - 1]) negFlow += rawFlow[j];
            }
            if (negFlow === 0) {
                mfi[i] = 100;
            } else {
                const moneyRatio = posFlow / negFlow;
                mfi[i] = +(100 - (100 / (1 + moneyRatio))).toFixed(2);
            }
        }
        return mfi;
    }

    /**
     * Compute Average True Range (Wilder's smoothing).
     */
    function computeATR(candles, period = 14) {
        const len = candles.length;
        const atr = new Array(len).fill(null);
        if (len <= period) return atr;

        const tr = new Array(len).fill(0);
        for (let i = 0; i < len; i++) {
            if (i === 0) { tr[i] = candles[i].high - candles[i].low; continue; }
            const highLow = candles[i].high - candles[i].low;
            const highClose = Math.abs(candles[i].high - candles[i - 1].close);
            const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
            tr[i] = Math.max(highLow, highClose, lowClose);
        }

        let sum = 0;
        for (let i = 0; i < period; i++) sum += tr[i];
        let prevAtr = sum / period;
        atr[period - 1] = +prevAtr.toFixed(4);

        for (let i = period; i < len; i++) {
            prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
            atr[i] = +prevAtr.toFixed(4);
        }
        return atr;
    }

    /**
     * Compute ADX (Average Directional Index) with Wilder smoothing.
     */
    function computeADX(candles, period = 14) {
        const len = candles.length;
        const adx = new Array(len).fill(null);
        if (len <= period * 2) return adx;

        const plusDM = new Array(len).fill(0);
        const minusDM = new Array(len).fill(0);
        const tr = new Array(len).fill(0);

        for (let i = 1; i < len; i++) {
            const upMove = candles[i].high - candles[i - 1].high;
            const downMove = candles[i - 1].low - candles[i].low;
            plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
            minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
            const highLow = candles[i].high - candles[i].low;
            const highClose = Math.abs(candles[i].high - candles[i - 1].close);
            const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
            tr[i] = Math.max(highLow, highClose, lowClose);
        }

        let smoothTR = 0, smoothPlusDM = 0, smoothMinusDM = 0;
        for (let i = 1; i <= period; i++) {
            smoothTR += tr[i];
            smoothPlusDM += plusDM[i];
            smoothMinusDM += minusDM[i];
        }

        const dxValues = [];
        for (let i = period; i < len; i++) {
            if (i > period) {
                smoothTR = smoothTR - (smoothTR / period) + tr[i];
                smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
                smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];
            }
            const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
            const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
            const diSum = plusDI + minusDI;
            const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
            dxValues.push(dx);
        }

        let adxVal = null;
        for (let i = 0; i < dxValues.length; i++) {
            const idx = period + i;
            if (i === period - 1) {
                let sum = 0;
                for (let j = 0; j < period; j++) sum += dxValues[j];
                adxVal = sum / period;
                adx[idx] = +adxVal.toFixed(2);
            } else if (i >= period) {
                adxVal = (adxVal * (period - 1) + dxValues[i]) / period;
                adx[idx] = +adxVal.toFixed(2);
            }
        }
        return adx;
    }

    /**
     * Compute On-Balance Volume (cumulative).
     */
    function computeOBV(candles) {
        const len = candles.length;
        const obv = new Array(len).fill(0);
        for (let i = 1; i < len; i++) {
            if (candles[i].close > candles[i - 1].close) obv[i] = obv[i - 1] + candles[i].volume;
            else if (candles[i].close < candles[i - 1].close) obv[i] = obv[i - 1] - candles[i].volume;
            else obv[i] = obv[i - 1];
        }
        return obv;
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

            const isThyao = ticker === 'THYAO' || !['ASELS', 'BIMAS', 'TUPRS', 'AKBNK'].includes(ticker);
            if (isThyao) {
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
     *   vwap: number[],
     *   ichimoku: {tenkan, kijun, senkouA, senkouB, chikou},
     *   psar: (number|null)[],
     *   pivotPoints: {p, r1, r2, r3, s1, s2, s3}|null
     * }}
     */
    function calculateIndicators(candles) {
        const closes = candles.map(c => c.close);

        // --- Simple Moving Averages ---
        const sma20  = computeSMA(closes, 20);
        const sma50  = computeSMA(closes, 50);
        const sma200 = computeSMA(closes, 200);

        // --- Exponential Moving Averages ---
        const ema9  = computeEMA(closes, 9);
        const ema21 = computeEMA(closes, 21);

        // --- Weighted Moving Average (onuncu oturum — indikatör çeşitlendirme) ---
        const wma20 = computeWMA(closes, 20);

        // --- Oscillators ---
        const rsi14 = computeRSI(closes, 14);
        const macd = computeMACD(closes, 12, 26, 9);
        const stochastic = computeStochastic(candles, 14, 3);
        const atr14 = computeATR(candles, 14);
        const adx14 = computeADX(candles, 14);
        const obv = computeOBV(candles);
        const willr14 = computeWilliamsR(candles, 14);

        // --- Ichimoku Cloud / Parabolic SAR / Pivot Points (üçüncü tur — indikatör çeşitlendirme) ---
        const ichimoku = computeIchimoku(candles);
        const psar = computeParabolicSAR(candles);
        const pivotPoints = computePivotPoints(candles);

        // --- SuperTrend / CCI / Keltner / Donchian / MFI (dördüncü tur — indikatör çeşitlendirme) ---
        const supertrend = computeSuperTrend(candles);
        const cci20 = computeCCI(candles, 20);
        const keltner = computeKeltnerChannels(candles);
        const donchian = computeDonchianChannels(candles);
        const mfi14 = computeMFI(candles, 14);

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

        return {
            sma20, sma50, sma200, ema9, ema21, wma20,
            bollingerUpper, bollingerMiddle, bollingerLower, vwap,
            rsi14, macd, stochastic, atr14, adx14, obv, willr14,
            ichimoku, psar, pivotPoints,
            supertrend, cci20, keltner, donchian, mfi14
        };
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
        try {
            const cleanTicker = ticker.replace('.IS', '');
            let profile = STOCK_PROFILES[cleanTicker];
            if (!profile) {
                profile = {
                    name: cleanTicker,
                    sector: 'BIST Stock',
                    basePrice: 100.0,
                    volatility: 0.02,
                    drift: 0.0005,
                    avgVolume: 10_000_000
                };
            }
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
        } catch (error) {
            console.warn(`[dataController] runPipeline caught error for ${ticker}: ${error.message}`);
            return {
                ticker,
                engine,
                profile: { name: ticker, sector: 'Unknown', basePrice: 100.0 },
                candles: [],
                trades: [],
                equityCurve: [initialCapital],
                metrics: {
                    netProfitPct: 0,
                    netProfit: 0,
                    maxDrawdownPct: 0,
                    sharpeRatio: 0,
                    winRate: 0,
                    wins: 0,
                    losses: 0,
                    totalTrades: 0,
                    profitFactor: 0,
                    drawdownCurve: [0],
                    maxMae: 0
                },
                svg: { equityLine: '', equityArea: '', drawdownLine: '', drawdownArea: '', candlestick: '' },
                summary: { lastPrice: 0, totalVolume: 0, peakEquity: initialCapital, currentEquity: initialCapital }
            };
        }
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
            // targetAddressSpace: 'loopback' explicitly declares 127.0.0.1 as a
            // loopback-address request per Chrome's Local Network Access (LNA)
            // policy, so Chrome can correctly trigger its permission flow instead
            // of just failing. NOTE: 127.0.0.1 is specifically 'loopback', NOT
            // 'local' (Chrome distinguishes the two — using the wrong value makes
            // Chrome block the request outright with a CORS address-space-mismatch
            // error before it ever reaches the network).
            fetch(`${window.OPTIPULSE_CONFIG.BACKEND_HTTP}/api/v1/backtest/status/${taskId}`, window.optipulseFetchOpts())
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
            
            fetch(`${window.OPTIPULSE_CONFIG.BACKEND_HTTP}/api/v1/ohlcv/${ticker}`, window.optipulseFetchOpts())
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
        BIST100,
        TRADING_DAYS,
        isMarketOpenNow,

        // Data generation
        generateOHLCV,
        generateAllOHLCV,
        synthesizeIntradayCandles,
        aggregateWeeklyCandles,

        // Strategy
        runStrategy,
        computeSMA,
        computeEMA,
        computeWMA,
        computeRSI,
        computeMACD,
        computeStochastic,
        computeATR,
        computeADX,
        computeOBV,
        computeWilliamsR,
        computeIchimoku,
        computeParabolicSAR,
        computePivotPoints,
        computeSuperTrend,
        computeCCI,
        computeKeltnerChannels,
        computeDonchianChannels,
        computeMFI,
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
        stopOhlcvPolling,
        normalizeTicker
    });
})();

/* Expose globally for non-module script consumption */
window.DataController = DataController;
