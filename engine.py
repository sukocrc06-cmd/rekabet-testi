# (23 Temmuz 2026, on üçüncü oturum — "motoru güçlendirme" temizliği)
#
# Bu dosya önceden StrategyEngine sınıfını barındırıyordu (SMA5/SMA20 ve
# RSI+MACD sinyal üretimi + backtest muhasebe döngüsü) — main.py'deki
# /api/v1/backtest/run, /api/v1/backtest/status/{task_id} ve
# /api/v1/backtest/export uç noktaları tarafından çağrılıyordu.
#
# Bu üç uç nokta da (ve onları çağıran TEK frontend kod yolu — app.js'in
# eski Canvas backtest pipeline'ı, dataController.js'in runPipeline'ı
# üzerinden) bu oturumda "motoru güçlendirme" temizliği kapsamında
# kaldırıldı: hiçbiri artık kullanıcı arayüzünden ulaşılabilir değildi
# (tetikleyici düğme index.html'den çoktan kaldırılmıştı) ve export
# uç noktasındaki PDF raporu ayrıca büyük ölçüde SABİT/UYDURMA değerler
# içeriyordu (bkz. main.py'deki ilgili temizlik yorumu).
#
# Bu dosya artık main.py tarafından import edilmiyor. Sinyal Anlatıcısı
# (tradingChart.js → computeSignalMarkers) ve Performans sekmesindeki
# gerçek Sharpe/Drawdown hesaplaması gibi CANLI motor özellikleri tamamen
# frontend'de (istemci tarafında) çalışır, bu backend dosyasına bağımlı
# değildir.
