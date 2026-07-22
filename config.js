/* ════════════════════════════════════════════════════════════════════
   OptiPulseLab — Backend Bağlantı Ayarı (Tek Nokta)
   (18 Temmuz 2026, onuncu oturum, beşinci tur)

   Bu proje şu ana kadar backend'in (main.py) HER ZAMAN kullanıcının kendi
   bilgisayarında 127.0.0.1:8000'de çalıştığını varsayıyordu — canlı
   Vercel sitesini kullanıcının kendisi DIŞINDA biri açtığında, o kişinin
   tarayıcısı kendi bilgisayarındaki (var olmayan) bir backend'e bağlanmaya
   çalışıyor, yani gerçek veri/canlı akış hiç çalışmıyordu.

   Backend zaten bulut dağıtımına hazır durumda (bkz. README_DEPLOY.md —
   dinamik PORT bağlama, durum tutmayan/stateless mantık). Bu dosya,
   önceden app.js/dataController.js/tradingChart.js/tradingEngine.js
   içine TEKRAR TEKRAR yazılmış olan "http://127.0.0.1:8000" adresini TEK
   bir yere topluyor — backend'i Render/Railway gibi bir platforma
   taşıdıktan sonra, tüm uygulamayı güncellemek için sadece bu dosyadaki
   iki değeri değiştirmeniz yeterli.

   ÖRNEK (backend'i https://optipulselab-backend.onrender.com adresine
   taşıdıktan sonra):
     BACKEND_HTTP: 'https://optipulselab-backend.onrender.com',
     BACKEND_WS:   'wss://optipulselab-backend.onrender.com',
   (Not: HTTPS'e bulut backend genelde wss:// — güvenli WebSocket —
   gerektirir, ws:// değil.)
   ════════════════════════════════════════════════════════════════════ */
(function () {
    // (22 Temmuz 2026, on ikinci oturum, dördüncü tur) Backend Render.com'a
    // taşındı (https://rekabet-testi.onrender.com) — artık sadece
    // kullanıcının kendi bilgisayarında değil, İNTERNETTEN erişilebilen
    // her bilgisayarda (hoca dahil) gerçek veri/canlı akış çalışıyor.
    // ÖNEMLİ: Render'ın ücretsiz katmanı 15 dakika boşta kalınca uyuyor,
    // ilk istekte ~1 dakika uyanma süresi olabiliyor — bir sunumdan hemen
    // önce siteyi bir kez açıp "ısıtmak" bu gecikmeyi önler.
    // (22 Temmuz 2026, on ikinci oturum, altıncı tur — "hisse logoları")
    // İlk denemede Clearbit'in ücretsiz logo servisi kullanılmıştı, ama
    // Clearbit bu servisi 8 Aralık 2025'te TAMAMEN kapattı — bu yüzden
    // hiçbir logo yüklenmiyor, hepsi renkli baş harf rozetine düşüyordu.
    // Yerine Logo.dev'e geçildi (Clearbit'in kendi önerdiği resmi yerine
    // geçen servis) — kullanıcının kendi hesabından aldığı, "Publishable
    // key" (yayınlanabilir, herkese açık kullanım için tasarlanmış, GİZLİ
    // TUTULMASI GEREKMEYEN bir anahtar — Logo.dev'in kendi panelinde
    // "Safe to share publicly" olarak işaretli). Logo.dev'in "Secret key"i
    // KESİNLİKLE buraya veya herhangi bir frontend dosyasına yazılmamalı.
    window.OPTIPULSE_CONFIG = {
        BACKEND_HTTP: 'https://rekabet-testi.onrender.com',
        BACKEND_WS: 'wss://rekabet-testi.onrender.com',
        LOGO_DEV_TOKEN: 'pk_WSsW7uNMSGWLW7W6gsrQcg'
    };

    // Chrome'un Local Network Access (LNA) politikası, hedef adres GERÇEKTEN
    // loopback (127.0.0.1 / localhost) olduğunda fetch'e targetAddressSpace:
    // 'loopback' seçeneğinin eklenmesini gerektiriyor (16 Temmuz 2026'da bu
    // projede bulunup düzeltilen kritik bir hatanın kök nedeniydi — bkz. proje
    // dokümanındaki "ENGINE:OFFLINE" bölümü). Backend buluta taşınıp gerçek bir
    // HTTPS adresine geçildiğinde bu seçeneğin hâlâ 'loopback' olarak
    // gönderilmesi AYNI SINIFTAN yeni bir hataya yol açar (adres alanı
    // uyuşmazlığı, fetch sessizce/anında reddedilir). Bunu bir daha
    // yaşamamak için targetAddressSpace artık burada, adres GERÇEKTEN
    // loopback olup olmadığına bakılarak otomatik ekleniyor/eklenmiyor —
    // hiçbir çağrı noktasında elle 'loopback' yazılmıyor.
    function isLoopback() {
        return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(window.OPTIPULSE_CONFIG.BACKEND_HTTP);
    }
    window.optipulseFetchOpts = function (extra) {
        const opts = Object.assign({}, extra || {});
        if (isLoopback()) opts.targetAddressSpace = 'loopback';
        return opts;
    };
})();
