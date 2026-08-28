from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from typing import List
import yfinance as yf
import os
import re
import requests
import time
import logging

# (22 Temmuz 2026, on ikinci oturum — "gürültülü/ölü kodu temizle") yfinance,
# bir sembol için veri bulunamadığında ("possibly delisted; no timezone
# found" gibi) kendi iç logger'ı üzerinden doğrudan konsola/terminale
# basıyor — bu bizim kodumuzdan gelmiyor, kütüphanenin kendi davranışı.
# `/api/v1/quotes` toplu isteğinde onlarca sembol aynı anda denendiği için
# bu satırlar art arda tekrarlanıp gerçek hataları (rate-limit vb.) görmeyi
# zorlaştırıyordu. yfinance'in logger seviyesini yükselterek bu tekrarlı
# iç mesajları susturuyoruz; bunun yerine `/api/v1/quotes` kendi TEK
# özet satırını basıyor (bkz. aşağıdaki get_quotes) — böylece hangi
# sembollerin veri döndürmediği hâlâ görünür kalıyor, sadece gürültü değil.
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

# (23 Temmuz 2026, on üçüncü oturum — "motoru güçlendirme" temizliği)
# Burada önceden `from fpdf import FPDF` ve `from engine import StrategyEngine`
# vardı — ikisi de yalnızca aşağıda kaldırılan /api/v1/backtest/* uç
# noktaları tarafından kullanılıyordu ve frontend'den hiçbir şekilde
# ulaşılamıyorlardı (grep ile doğrulandı: dataController.js/app.js'te bu
# uç noktalara yapılan TEK çağrı da aynı temizlikte kaldırıldı). engine.py
# dosyasındaki StrategyEngine sınıfı da aynı sebeple tamamen kaldırıldı.
import asyncio
import random

# (28 Ağustos 2026 — Yahoo Finance engellemesi KÖK NEDEN düzeltmesi, dördüncü
# hız turu devamı; AYNI GÜN 8. tur sonunda GERİ ALINDI, bkz. not aşağıda)
# yfinance kaynağı (yfinance/_http.py) incelendiğinde ÇOK ÖNEMLİ bir şey
# bulundu: yfinance'e HİÇ session verilmezse, kendi new_session()'ı
# curl_cffi kütüphanesini (zaten yfinance'in kendi zorunlu bağımlılığı)
# kullanarak Chrome'un TAM TLS/JA3 parmak izini taklit eden bir oturum
# kuruyor — bu, yfinance'in KENDİ dokümantasyonunda "Yahoo Finance may
# rate-limit or block this client" diye özellikle uyarılan, düz `requests`
# kütüphanesinin TAKLİT EDEMEDİĞİ bir korumadır. Bu yüzden `session=session`
# TÜM yf.Ticker()/yf.download() çağrılarından KALDIRILMIŞTI.
#
# GERİ ALMA NEDENİ (28 Ağustos, 8. tur — kullanıcının canlı konsol
# ekran görüntüleri): Bu değişiklikten SONRA site tüm veri uçlarında
# (ohlcv, ohlcv?interval=60m, quotes) "blocked by CORS policy" hatası
# vermeye başladı — ÖNEMLİ: durum kodu bile görünmüyordu (ne 500 ne
# 429), bu da yanıtın backend'in kendi try/except'inden bile GEÇEMEDEN,
# muhtemelen worker seviyesinde bir çökme/yeniden başlatmayla (curl_cffi,
# derlenmiş bir C uzantısı — Render'ın 512MB'lık ücretsiz katmanında
# bellek/uyumluluk sorunu çıkarmış olabilir) kesildiğine işaret ediyor.
# Yani bu "düzeltme" muhtemelen Yahoo engellemesini gerçekten azaltmış
# olsa bile, KARŞILIĞINDA çok daha ciddi bir kararlılık sorunu yarattı
# (temiz bir "500 + dostane Türkçe mesaj" yerine, HİÇBİR veri gelmemesi).
# Kullanıcının önceliği hız/kararlılık olduğu için bu deneysel değişiklik
# GERİ ALINDI — `session=session` tüm çağrılara YENİDEN eklendi. Yahoo
# engelleme sorunu hâlâ sürüyorsa (ki bağımsız olarak da devam edebilir),
# bunun çözümü artık istek sıklığını/boyutunu azaltmak (zaten yapıldı:
# period 2y, prewarm 3 sembol, 300sn history cache) olmalı — curl_cffi
# gibi Render'ın ücretsiz katmanında test edilmemiş, riskli bir bağımlılık
# yolu ile DEĞİL. `session` nesnesi zaten aşağıdaki kendi kendine "ısınma"
# pingi (_self_ping_loop) için de kullanılıyor.
session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
})

app = FastAPI()


class PrivateNetworkAccessMiddleware(BaseHTTPMiddleware):
    """
    Chrome's "Private Network Access" policy requires a public/HTTPS page
    (e.g. the Vercel-deployed frontend) that calls a local address like
    127.0.0.1 to receive an explicit opt-in header on the CORS preflight
    response, otherwise Chrome flags it in DevTools (and will eventually
    block it outright). This backend is meant to be reached from the public
    frontend running on the same machine, so we opt in here.
    """
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response


# Registered BEFORE CORSMiddleware so it wraps it (outer layer) and can still
# attach the header to CORSMiddleware's own auto-generated preflight (OPTIONS)
# responses.
app.add_middleware(PrivateNetworkAccessMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# (28 Ağustos 2026 — konsol "CORS policy" hataları kök neden düzeltmesi)
# Kullanıcı canlıda /api/v1/ohlcv ve /api/v1/quotes için tarayıcı konsolunda
# "blocked by CORS policy: No 'Access-Control-Allow-Origin' header" hataları
# gördü — durum kodu bile görünmüyordu. Yukarıdaki CORSMiddleware zaten
# allow_origins=["*"] ile doğru kurulu; bu uç noktaların kendi try/except'i
# de zaten bir JSONResponse döndürüyor (normalde CORS başlığı alır). AMA:
# Starlette'in middleware sırasında CORSMiddleware, ExceptionMiddleware'in
# (uç nokta kodunun) DIŞINDA/üstünde çalışır — eğer bir hata uç noktanın
# KENDİ try/except'inin bile öngöremediği bir yerden (ör. curl_cffi'nin C
# seviyesinde attığı, normal `except Exception` ile hiç örtüşmeyen bir hata
# sınıfı, ya da bir middleware'in kendi içinde oluşan bir hata) sızarsa,
# Starlette'in EN DIŞ katmanı (ServerErrorMiddleware) devreye girer — bu
# katman CORSMiddleware'in DIŞINDA olduğu için yanıtına CORS başlığı HİÇ
# EKLENEMEZ. Tarayıcı da başlıksız bu yanıtı "CORS engeli" olarak gösterir
# (gerçek durum kodu/hata mesajı JS'e hiç sızmaz). Bu genel (catch-all)
# handler, ExceptionMiddleware seviyesinde (yani CORSMiddleware'in İÇİNDE)
# devreye girdiği için, kaçan HER hata artık normal CORS başlığı alan
# düzgün bir JSON yanıta dönüşüyor — ayrıca garanti olsun diye başlığı elle
# de ekliyoruz. Böylece tarayıcı en azından GERÇEK hatayı görebiliyor,
# yanıltıcı "CORS engeli" mesajı yerine.
@app.exception_handler(Exception)
async def _cors_safe_exception_handler(request: Request, exc: Exception):
    response = JSONResponse(
        status_code=500,
        content={"status": "error", "message": f"Beklenmeyen sunucu hatası: {str(exc)}"},
    )
    origin = request.headers.get("origin")
    response.headers["Access-Control-Allow-Origin"] = origin if origin else "*"
    response.headers["Vary"] = "Origin"
    return response

# (26 Temmuz 2026, on üçüncü oturum devamı — "hızlandırma: backend gzip
# sıkıştırma") Önceden yanıtlar (özellikle /api/v1/quotes'un toplu 97
# sembollük yanıtı ve /api/v1/ohlcv/{ticker}'in period="max" ile bazı
# semboller için binlerce satırlık geçmişi) hiç sıkıştırılmadan
# gönderiliyordu. GZipMiddleware, istemcinin Accept-Encoding: gzip
# gönderdiği ve yanıt gövdesi minimum_size'dan büyük olduğu durumlarda
# gövdeyi şeffaf şekilde sıkıştırır — istemci tarafında (tarayıcının
# fetch()'i) hiçbir kod değişikliği gerekmez, otomatik açılır. Özellikle
# mobil/yavaş bağlantıda sayfa yükleme ve sembol değiştirme belirgin
# şekilde hızlanır; işlevsel hiçbir davranış değişmiyor.
app.add_middleware(GZipMiddleware, minimum_size=500)

# (18 Temmuz 2026, dokuzuncu oturum — "yfinance hata/rate-limit dayanıklılığı")
# Yahoo Finance'in ücretsiz/resmi-olmayan API'si sık ve art arda isteklerde
# geçici olarak 429 (Too Many Requests) benzeri bir sınırlama uygulayabiliyor.
# Aynı sembol için kısa süre içinde (ör. kullanıcı sık sembol değiştirirken,
# birden fazla sekme açıkken, ya da watchlist toplu senkronizasyonu ile aynı
# anda bireysel bir istek geldiğinde) tekrar tekrar ağa gitmemek için basit
# bir in-memory TTL önbelleği kullanılıyor. Kalıcı/dağıtık bir cache değil —
# tek process içinde, süreç yeniden başlayınca sıfırlanır; bu demo/tek-
# kullanıcılı bir kurulum için yeterli.

# (27 Ağustos 2026 — "izleme listesi %0'da takılı kalıyor" incelemesi) Bu
# süre önceden 60sn'ydi. O anda canlı testte /api/v1/ohlcv/ASELS VE
# /api/v1/ohlcv/THYAO gibi bağımsız sembollerde art arda 500 hatası
# gözlemlendi (market-ticker gibi daha seyrek çağrılan uçlar ise sorunsuz
# çalışıyordu) — bu, Yahoo Finance'in Render'ın paylaşımlı IP'sini geçici
# olarak sınırladığını (rate-limit) gösteriyor. 60sn'lik TTL, günlük
# (1 gün aralıklı) mum verisi için gereğinden kısa: aynı sembol birkaç
# dakika içinde tekrar açılırsa/senkronize edilirse her seferinde yeniden
# Yahoo'ya gidiliyordu. 300sn'ye (5dk) çıkarmak, Yahoo'ya giden istek
# sıklığını azaltıp hem rate-limit'e daha az sık takılmayı hem de mevcut
# bir sınırlamanın kendini toparlaması için zaman kazanmayı sağlar —
# günlük mum verisi için 5 dakikalık bayatlık pratikte fark edilmez.
_HISTORY_CACHE_TTL_SEC = 300
_history_cache = {}  # key: (formatted_ticker, period, interval) -> (timestamp, DataFrame)


def _is_rate_limit_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in ("429", "too many requests", "rate limit", "rate-limited"))


# (22 Temmuz 2026, on ikinci oturum — "Yahoo Finance dayanıklılığı")
# `_is_rate_limit_error` daha önce sadece HATA MESAJINI sınıflandırmak için
# kullanılıyordu (kullanıcıya gösterilecek dostane metni seçmek için) — ama
# gerçek bir yeniden-deneme (retry) hiç yapılmıyordu: geçici bir 429 anında
# tüm istek başarısız oluyor ve kullanıcı "veri alınamadı" görüyordu, oysa
# birkaç saniye sonra genelde aynı istek başarılı olurdu. Bu sarmalayıcı,
# SADECE rate-limit olarak tanınan hatalarda, artan bir gecikmeyle (1.5s,
# 3.0s, ...) sınırlı sayıda tekrar deniyor. Gerçek hatalar (kötü sembol,
# "no data found", genel ağ kopması vb.) hiç yeniden denenmiyor — bunları
# tekrar denemek sadece aynı sonucu geç vermek olurdu; zaten çağıran taraf
# bu durumlarda kendi (fallback simülasyon / dostane hata mesajı) mantığını
# hemen devreye sokuyor.
def _yf_call_with_backoff(fn, retries: int = 1, base_delay: float = 1.5, label: str = ""):
    attempt = 0
    while True:
        try:
            return fn()
        except Exception as e:
            if attempt >= retries or not _is_rate_limit_error(e):
                raise
            delay = base_delay * (attempt + 1)
            print(f"[yf-backoff] {label or 'call'} rate-limited, {delay:.1f}s sonra tekrar denenecek (deneme {attempt + 1}/{retries})")
            time.sleep(delay)
            attempt += 1


# (22 Temmuz 2026, on ikinci oturum — "Yahoo Finance dayanıklılığı") Sadece
# FORMAT/şekil kontrolü — BIST100 üyelik listesi burada KASITLI olarak
# tekrarlanmıyor. O tam liste (97 sembol) yalnızca frontend'in
# dataController.js dosyasında tek doğruluk kaynağı (single source of
# truth) olarak yaşıyor; onu Python tarafında da ayrı bir listeye
# kopyalamak, iki listenin zamanla birbirinden sapması riskini
# doğururdu (biri güncellenir, diğeri unutulur). Bu fonksiyon yalnızca
# apaçık bozuk girdiyi (boş, noktalama/boşluk içeren, aşırı uzun) hızlı
# bir 400 ile eleyip yfinance'e hiç gitmeden reddediyor — asıl "bu sembol
# BIST100'de var mı" doğrulaması zaten yfinance'in kendi "no data found"
# yanıtından geliyor.
_TICKER_FORMAT_RE = re.compile(r"^[A-Z0-9]{2,10}$")


def _is_valid_ticker_format(ticker: str) -> bool:
    if not ticker:
        return False
    bare = ticker.upper().strip()
    if bare.endswith(".IS"):
        bare = bare[:-3]
    return bool(_TICKER_FORMAT_RE.match(bare))


def _friendly_fetch_error(exc: Exception) -> str:
    if _is_rate_limit_error(exc):
        return (
            "Veri sağlayıcıya (Yahoo Finance) şu anda çok sık istek gönderildi ve geçici bir "
            "sınırlamaya takıldık. Birkaç dakika sonra tekrar deneyin — bu arada arayüz "
            "otomatik olarak gerçekçi simülasyon fiyatlarını gösterecek."
        )
    return f"Data fetch timed out or failed: {str(exc)}"


def _cached_history(stock: "yf.Ticker", formatted: str, period: str, interval: str, timeout: int = 10):
    key = (formatted, period, interval)
    now = time.time()
    cached = _history_cache.get(key)
    if cached and (now - cached[0]) < _HISTORY_CACHE_TTL_SEC:
        return cached[1]
    df = _yf_call_with_backoff(
        lambda: stock.history(period=period, interval=interval, timeout=timeout),
        label=f"history({formatted})"
    )
    if df is not None and not df.empty:
        _history_cache[key] = (now, df)
    return df


class QuotesRequest(BaseModel):
    tickers: List[str]

# (23 Temmuz 2026, on üçüncü oturum — "motoru güçlendirme" temizliği)
# Burada önceden BacktestRequest/PDFRequest Pydantic modelleri ve PDFReport
# (FPDF tabanlı PDF rapor oluşturucu) sınıfı vardı — bkz. yukarıdaki import
# temizlik notu, hepsi kaldırılan /api/v1/backtest/* uç noktalarına özeldi.

@app.get("/")
async def get_index():
    with open("index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

# (22 Temmuz 2026, on ikinci oturum — "gürültülü/ölü kodu temizle") Burada
# önceden ~250 satırlık bir `analyze_stock_logic()` fonksiyonu ve onu çağıran
# `/run-analysis` uç noktası vardı. Frontend'de (`app.js`, `index.html`,
# `tradingChart.js`, `tradingEngine.js` dahil tüm dosyalarda) bu uç noktaya
# HİÇBİR çağrı bulunamadı (grep ile doğrulandı) — tamamen ölü kod olduğu
# için kaldırıldı. Kullanıcı bu temizliği bu oturumda ayrıca onayladı.


# (25 Ağustos 2026 — UptimeRobot keep-alive incelemesi) Bu uç nokta önceden
# sadece @app.get ile tanımlıydı — yani Starlette sadece GET metoduna izin
# veriyordu. UptimeRobot'un ücretsiz HTTP(s) monitörü varsayılan olarak HEAD
# isteği gönderiyor; bu da her kontrolde 405 "Method Not Allowed" ile
# sonuçlanıp monitörün "Down" görünmesine yol açıyordu (canlı testle
# doğrulandı: GET->200, HEAD/OPTIONS/POST->405). Kök neden Render'ın soğuk
# başlangıcı DEĞİLDİ — sadece izin verilen metot eksikliğiydi. GET ile
# birlikte HEAD'i de kabul edecek şekilde genişletildi.
@app.api_route("/api/v1/health", methods=["GET", "HEAD"])
async def health_check():
    return {"status": "ok"}

# (27 Ağustos 2026 — yarışma günü hız hazırlığı, üçüncü tur: "Render'ı hiç
# uyutma") Yukarıdaki UptimeRobot düzeltmesi (25 Ağustos) dış bir servise
# bağımlıydı — kullanıcının UptimeRobot hesabının fiilen aktif/doğru
# aralıkla çalışıp çalışmadığını buradan doğrulayamıyoruz. Bu, TAMAMEN
# kod-içi, hiçbir dış hesap/servis gerektirmeyen bir ikinci güvenlik ağı:
# backend, kendi genel (public) /api/v1/health adresine düzenli aralıklarla
# KENDİ KENDİNE bir HTTP isteği atıyor. Render'ın ücretsiz katmanı "gelen"
# HTTP isteği olup olmadığına bakarak uyku kararı veriyor — dışarıya çıkıp
# aynı genel adresten geri dönen bu istek de "gelen istek" olarak sayılıyor,
# yani servis kendi kendini uyanık tutmuş oluyor. 10 dakikalık aralık,
# Render'ın 15 dakikalık boşta-kalma eşiğinin güvenli biçimde altında.
# Sadece GERÇEK Render ortamında çalışır (Render, her instance'a otomatik
# RENDER=true ortam değişkeni atıyor) — yerel geliştirmede (python main.py
# ile 127.0.0.1'de çalıştırırken) bu döngü hiç başlamıyor, gereksiz yere
# kendi kendine istek atıp konsolu kirletmiyor. Tek bir pinglemenin
# başarısız olması (geçici ağ hatası vb.) sessizce yutulur — bu döngü asla
# ana uygulamayı çökertmemeli, sadece "varsa iyi, yoksa zararı yok" bir
# ek önlem.
_SELF_PING_URL = os.environ.get(
    "SELF_PING_URL", "https://rekabet-testi.onrender.com/api/v1/health"
)
_SELF_PING_INTERVAL_SEC = 600  # 10 dakika


async def _self_ping_loop():
    while True:
        await asyncio.sleep(_SELF_PING_INTERVAL_SEC)
        try:
            await asyncio.to_thread(session.get, _SELF_PING_URL, timeout=10)
        except Exception:
            pass  # sessiz — bu sadece Render'ı uyanık tutmak için, kritik değil


@app.on_event("startup")
async def _start_self_ping():
    if os.environ.get("RENDER"):
        asyncio.create_task(_self_ping_loop())


@app.get("/api/v1/list-stocks")
async def list_stocks():
    try:
        stocks = [
            {"symbol": "THYAO", "name": "Türk Hava Yolları"},
            {"symbol": "ASELS", "name": "ASELSAN"},
            {"symbol": "BIMAS", "name": "BİM Mağazalar"},
            {"symbol": "TUPRS", "name": "Tüpraş"},
            {"symbol": "AKBNK", "name": "Akbank"}
        ]
        return stocks
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": f"Failed to retrieve stock list: {str(e)}"}
        )

# (27 Ağustos 2026 — "mum grafiği TradingView'la aynı değil" kök neden
# düzeltmesi) ÖNCEDEN bu uç nokta SADECE günlük (period="max", interval="1d")
# veri döndürüyordu — 15dk/1sa/4sa gibi gün-içi zaman dilimleri frontend'de
# (dataController.js → synthesizeIntradayCandles) TAMAMEN rastgele/sentetik
# olarak üretiliyordu (sadece o günün GERÇEK açılış/kapanış/en yüksek/en
# düşük değerlerine sadık kalacak şekilde). Artık `interval` sorgu parametresi
# ile GERÇEK gün-içi veri de istenebiliyor — Yahoo Finance'in izin verdiği
# geriye dönük pencereyle sınırlı (15dk için ~60 gün, 60dk için ~730 gün;
# Yahoo'da 4sa yok, frontend 60dk barlarını 4'erli gruplayarak türetiyor).
# Bu pencerenin DIŞINDAKİ eski geçmiş için sentetik yöntem fallback olarak
# AYNEN kalıyor — burada hiçbir şey kaldırılmadı, sadece frontend'in
# tercih edebileceği YENİ, gerçek bir kaynak eklendi.
#
# (27 Ağustos 2026, dördüncü hız turu — "Yahoo Finance canlı engelleme"
# kök neden düzeltmesi) Canlı testle doğrulandı: /api/v1/ohlcv/ASELS VE
# /api/v1/ohlcv/THYAO şu anda 500 hatası veriyordu (Yahoo'nun Render'ın
# paylaşımlı IP'sini geçici engellemesi), oysa /api/v1/market-ticker gibi
# daha seyrek çağrılan uçlar sorunsuz çalışıyordu — yani sorun spesifik
# olarak "1d" isteklerinin period="max" ile HER SEFERİNDE (5dk önbellek
# süresi dolunca) sembolün KOTASYONDAN BUGÜNE TÜM geçmişini (bazı semboller
# için binlerce satır) çekmeye çalışmasıydı. Bu hem Yahoo'yu daha sık/ağır
# yoruyor (rate-limit'e daha kolay takılıyoruz) hem de başarılı olsa bile
# yavaş. Kullanıcı ESKİ/bayat veri göstermek yerine hız+güncellik istediği
# için (stale-cache fallback KASITLI OLARAK eklenmedi), period "max"'tan
# "2y"ye (son 2 yıl) düşürüldü — SMA200 gibi uzun vadeli göstergeler için
# hâlâ fazlasıyla yeterli, istek boyutu küçülüp hem Yahoo'yu daha az
# zorluyor hem başarılı yanıt çok daha hızlı dönüyor. 2 yıldan eski günlük
# geçmiş artık gerçek veriyle gelmiyor (kullanıcının bilinçli tercihi).
_OHLCV_INTERVAL_MAP = {
    "1d": ("2y", "1d"),
    "15m": ("60d", "15m"),
    "60m": ("730d", "60m"),
}


@app.get("/api/v1/ohlcv/{ticker}")
def get_data(ticker: str, interval: str = "1d"):
    if not _is_valid_ticker_format(ticker):
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": f"Geçersiz sembol formatı: '{ticker}'"}
        )
    if interval not in _OHLCV_INTERVAL_MAP:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": f"Geçersiz interval: '{interval}' (izin verilen: {list(_OHLCV_INTERVAL_MAP)})"}
        )
    period, yf_interval = _OHLCV_INTERVAL_MAP[interval]
    try:
        formatted = format_ticker(ticker)
        stock = yf.Ticker(formatted, session=session)
        # (19 Temmuz 2026, on ikinci oturum — "tam geçmiş erişimi") Günlük
        # (1d) için yfinance'in sunduğu TÜM geçmiş isteniyor (period="max" —
        # sembolün borsaya kotasyon tarihinden bugüne kadarki tüm günlük
        # barlar). Gün-içi (15m/60m) istekler yukarıdaki haritadaki Yahoo'nun
        # izin verdiği sabit pencereyle sınırlı — daha uzun bir period
        # istense bile Yahoo zaten sessizce kırpardı, biz doğrudan gerçek
        # sınırı istiyoruz ki gereksiz "boş" bir istek yapılmasın.
        hist = _cached_history(stock, formatted, period, yf_interval, timeout=15)
        if hist.empty:
            raise ValueError("No historical data found for this ticker")
        hist = hist.reset_index()
        # yfinance, GÜNLÜK barlarda index sütununu "Date", GÜN-İÇİ (intraday)
        # barlarda ise "Datetime" olarak adlandırıyor — frontend'in tek bir
        # ayrıştırma yolu kullanabilmesi için ikisini de "Date" adına
        # normalize ediyoruz.
        if "Datetime" in hist.columns and "Date" not in hist.columns:
            hist = hist.rename(columns={"Datetime": "Date"})
        data = hist.to_dict(orient="records")

        # Convert Timestamp values to string for serialization. Gün-içi
        # barlar tz-aware (borsa saat dilimine, Europe/Istanbul'a
        # yerelleştirilmiş) geliyor — frontend'in `new Date(...)` ile
        # tarayıcı yerel saatinden ETKİLENMEDEN doğru ayrıştırabilmesi için
        # AÇIKÇA UTC'ye çevirip ISO 8601 (+00:00 uzantılı) string olarak
        # yazıyoruz; günlük (tz-naive) barlarda davranış DEĞİŞMEDİ.
        for record in data:
            if "Date" in record:
                val = record["Date"]
                tzinfo = getattr(val, "tzinfo", None)
                if tzinfo is not None:
                    try:
                        # (27 Ağustos 2026) `str(...)` yerine kasıtlı olarak
                        # `isoformat()` kullanılıyor — ikisi de tarayıcıda
                        # doğru ayrıştırılıyor (test edildi) ama isoformat()
                        # her zaman "T" ayraçlı, katı ISO 8601 üretir
                        # ("2026-08-27T07:00:00+00:00"), tarayıcılar arası
                        # belirsizlik riskini tamamen ortadan kaldırır.
                        record["Date"] = val.tz_convert("UTC").isoformat()
                        continue
                    except Exception:
                        pass
                record["Date"] = str(val)

        return {"ticker": ticker, "interval": interval, "data": data}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": _friendly_fetch_error(e)}
        )

# (18 Temmuz 2026, onuncu oturum, beşinci tur — "şirket temel verileri")
# F/K (trailing P/E), piyasa değeri ve temettü verimi gibi temel/fundamental
# veriler yfinance'in .get_info()/.info sözlüğünden geliyor — bu, fiyat
# geçmişini çeken .history() çağrısından çok daha ağır/yavaş bir uç nokta
# (onlarca alanlı tam bir sözlük döndürüyor), bu yüzden AYRI ve daha UZUN
# bir TTL ile önbelleğe alınıyor (temel veriler gün içinde neredeyse hiç
# değişmez — F/K ve piyasa değeri fiyatla birlikte kısmen değişse de, saatlik
# tazeleme pratikte yeterli ve gereksiz Yahoo Finance yükünü önlüyor).
_FUNDAMENTALS_CACHE_TTL_SEC = 6 * 3600
_fundamentals_cache = {}  # formatted_ticker -> (timestamp, dict)


@app.get("/api/v1/fundamentals/{ticker}")
def get_fundamentals(ticker: str):
    if not _is_valid_ticker_format(ticker):
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": f"Geçersiz sembol formatı: '{ticker}'"}
        )
    try:
        formatted = format_ticker(ticker)
        now = time.time()
        cached = _fundamentals_cache.get(formatted)
        if cached and (now - cached[0]) < _FUNDAMENTALS_CACHE_TTL_SEC:
            return {"ticker": ticker, **cached[1], "cached": True}

        stock = yf.Ticker(formatted, session=session)
        info = {}
        try:
            # Newer yfinance versions expose get_info(); older ones only have
            # the .info property. Try both so this keeps working regardless
            # of which yfinance version the user's environment has installed.
            info = stock.get_info() if hasattr(stock, "get_info") else stock.info
        except Exception:
            info = {}

        # dividendYield in yfinance is typically a fraction (0.032 == 3.2%),
        # but this has varied across library versions/data revisions — the
        # frontend treats any value > 1 as "already a percent" defensively
        # rather than assuming one convention blindly.
        #
        # (22 Temmuz 2026, on ikinci oturum, beşinci tur — hocanın isteği
        # üzerine) F/K, piyasa değeri, temettü verimin yanına 4 alan daha
        # eklendi: 52 haftalık aralık (yatırımcının fiyatı tarihsel bağlama
        # oturtması için), ortalama hacim (likidite göstergesi), beta (piyasaya
        # göre oynaklık/risk göstergesi) ve hisse başına kazanç (kârlılık
        # göstergesi) — hepsi zaten çekilen aynı `info` sözlüğünden, EK bir
        # yfinance isteği gerektirmiyor.
        data = {
            "trailingPE": info.get("trailingPE"),
            "marketCap": info.get("marketCap"),
            "dividendYield": info.get("dividendYield"),
            "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
            "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
            "averageVolume": info.get("averageVolume"),
            "beta": info.get("beta"),
            "trailingEps": info.get("trailingEps"),
        }
        _fundamentals_cache[formatted] = (now, data)
        return {"ticker": ticker, **data, "cached": False}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": _friendly_fetch_error(e)}
        )

def format_ticker(ticker: str) -> str:
    ticker = ticker.upper()
    ticker_map = {
        "ASELSAN": "ASELS",
        "ASELS": "ASELS",
        "THYAO": "THYAO",
        "BIMAS": "BIMAS",
        "TUPRS": "TUPRS",
        "AKBNK": "AKBNK"
    }
    if ticker in ticker_map:
        ticker = ticker_map[ticker]
    if not ticker.endswith(".IS"):
        ticker = ticker + ".IS"
    return ticker


# (18 Temmuz 2026, dokuzuncu oturum — "tüm watchlist için periyodik gerçek
# fiyat senkronizasyonu") Canlı WebSocket akışı (bkz. /ws/live/{ticker})
# sadece o an ekranda seçili TEK sembol için çalışıyor; watchlist'teki diğer
# ~96 sembol her zaman client-side simülasyonda kalıyor. Bu endpoint,
# frontend'in periyodik olarak (tradingEngine.js → syncWatchlistPrices())
# TÜM watchlist'i tek bir toplu istekle gerçek son kapanış fiyatıyla
# senkronize etmesini sağlıyor. 97 sembolü tek tek yf.Ticker(...).fast_info
# ile çekmek yerine yf.download(...) ile TEK bir fonksiyon çağrısında toplu
# çekiyoruz — hem daha hızlı hem Yahoo Finance'i gereksiz yere yormuyor.
# Kısa süreli TTL önbellek (_QUOTE_CACHE_TTL_SEC), aynı sembol seti kısa
# aralıklarla tekrar istenirse (ör. birden fazla açık sekme) yeniden ağa
# gitmeyi önlüyor.
# (10 Ağustos 2026 — "gerçek fiyattan sürekli geride kalma" tespiti) Bu değer
# ÖNCEDEN 45sn'ydi — frontend'in kendi periyodik senkron aralığından
# (tradingEngine.js → WATCHLIST_SYNC_INTERVAL_MS = 40000ms) DAHA UZUNDU. Sonuç:
# `now - ts < TTL` koşulu yüzünden istemcinin ardışık pollarının YARISI kadarı
# önbellek İSABETİ oluyordu (bkz. kök neden: ts sadece gerçek bir ağ isteğinde
# güncelleniyor, isabetlerde değil) — bu da tek bir istemcinin bile gerçek
# fiyatı ~40sn yerine ortalama ~80sn gecikmeyle görmesine yol açıyordu. Önbellek
# artık istemci aralığından KISA (35sn) — çoklu-sekme senaryosunda hâlâ
# gereksiz ardışık ağ isteklerini önlüyor, ama artık tek bir istemcinin kendi
# düzenli pollamasını YAVAŞLATMIYOR.
# (17 Ağustos 2026 — "TradingView'de düşüş varken bizde yükseliş gösteriyor"
# kök neden düzeltmesi) Bu endpoint ÖNCEDEN sadece o anki son fiyatı
# döndürüyordu (period="1d") — frontend'in günlük %değişim göstergesi
# (tradingEngine.js'teki dayOpen) bu yüzden HİÇBİR GERÇEK "önceki gün
# kapanışı" verisine dayanmıyordu, sadece kendi iç simülasyon anahtarının
# (dataController.js'teki haftalar önce girilmiş sabit basePrice, ya da
# %6'lık bandı aştığında rastgele bir anda "yakalanan" bir fiyat) etrafında
# sürükleniyordu. Sonuç: haftalar geçtikçe bu iç referans gerçek önceki gün
# kapanışından uzaklaşıyor, hatta YÖNÜ bile ters çıkabiliyordu (TradingView
# günü düşüşle gösterirken bizim iç referansımız daha da bayat/düşük
# olduğu için biz yükselişle gösteriyorduk). Düzeltme: period="2d"ye
# çıkarılıp GERÇEK önceki gün kapanışı da (`prevClose`) ayrıca döndürülüyor
# — market-ticker endpoint'i (döviz/emtia/BIST100) zaten aynısını yapıyordu,
# burada da aynı desen uygulandı. Frontend artık dayOpen'ı bu gerçek veriyle
# HER senkron turunda (40sn'de bir) doğrudan güncelleyecek (bkz.
# tradingEngine.js → syncWatchlistPrices), böylece %değişim göstergesi
# TradingView ile aynı, gerçek referansı kullanacak.
# (27 Ağustos 2026 — rate-limit incelemesi notu) Bu değeri BİLEREK
# yükseltmedik: 10 Ağustos'taki düzeltme (yukarıdaki not) tam olarak bunun
# TERSİNİ hedefliyordu — TTL'nin istemci poll aralığından (40sn) KISA
# kalması gerekiyor, yoksa tek bir açık sekme bile gerçek fiyatın ~80sn+
# gerisine düşüyor (o zaman şikayet edilen "gerçek fiyattan geride kalma"
# hatası). Yahoo rate-limit riskini azaltmak için asıl kaldıraç aşağıdaki
# _HISTORY_CACHE_TTL_SEC (27 Ağustos'ta 60sn'den 300sn'ye çıkarıldı) —
# tek bir toplu yf.download çağrısı olduğu için (97 sembol TEK istek)
# quotes zaten Yahoo'yu ohlcv kadar yormuyor; asıl payı ohlcv/canlı-tick
# tarafı alıyor.
_QUOTE_CACHE_TTL_SEC = 35
_quote_cache = {"ts": 0.0, "tickers_key": None, "data": {}, "prevClose": {}}


@app.post("/api/v1/quotes")
def get_quotes(request: QuotesRequest):
    raw_tickers = [t.upper().strip() for t in request.tickers if t and t.strip()]
    raw_tickers = raw_tickers[:150]  # makul bir üst sınır (watchlist zaten ~97 sembol)
    tickers = [t for t in raw_tickers if _is_valid_ticker_format(t)]
    skipped = [t for t in raw_tickers if t not in tickers]
    if skipped:
        print(f"[quotes] Bozuk formatlı {len(skipped)} sembol toplu istekten atlandı: {skipped}")
    if not tickers:
        return {"quotes": {}, "prevClose": {}, "asOf": None}

    cache_key = ",".join(sorted(tickers))
    now = time.time()
    if _quote_cache["tickers_key"] == cache_key and (now - _quote_cache["ts"]) < _QUOTE_CACHE_TTL_SEC:
        return {"quotes": _quote_cache["data"], "prevClose": _quote_cache.get("prevClose", {}), "asOf": _quote_cache["ts"], "cached": True}

    formatted_map = {}
    for t in tickers:
        formatted_map[format_ticker(t)] = t

    quotes = {}
    prev_closes = {}
    try:
        raw = _yf_call_with_backoff(
            lambda: yf.download(
                tickers=list(formatted_map.keys()),
                period="2d",
                interval="1d",
                group_by="ticker",
                threads=True,
                progress=False,
                session=session,
            ),
            label="quotes toplu indirme"
        )
        # (10 Ağustos 2026 — "tek sembollük istek sessizce boş dönüyor" kök
        # neden düzeltmesi) Önceden burada "tek sembol isteniyorsa yf.download
        # düz (MultiIndex olmayan) sütunlar döner" varsayımıyla `len(formatted_map)
        # == 1` kontrolü yapılıyordu. Ama `group_by="ticker"` AÇIKÇA verildiğinde
        # yfinance, istek TEK bir sembol için bile olsa sütunları HER ZAMAN
        # (sembol, alan) şeklinde MultiIndex olarak döndürüyor — bu varsayım
        # yanlıştı. Sonuç: tek sembollük bir /api/v1/quotes isteğinde `raw["Close"]`
        # bir KeyError fırlatıyordu, bu da aşağıdaki `except: continue` tarafından
        # sessizce yutuluyor ve `quotes` boş dönüyordu (frontend'e hiçbir hata
        # sızmıyordu — sadece o sembol senkronize olmuyordu). Doğru kontrol,
        # sembol sayısını TAHMİN ETMEK değil, DataFrame'in gerçekten MultiIndex
        # olup olmadığına doğrudan bakmak: `raw.columns.nlevels > 1`.
        for formatted, original in formatted_map.items():
            try:
                close_series = raw[formatted]["Close"] if raw.columns.nlevels > 1 else raw["Close"]
                close_series = close_series.dropna()
                if len(close_series) > 0:
                    quotes[original] = round(float(close_series.iloc[-1]), 2)
                # (17 Ağustos 2026) period="2d" olduğu için normal şartlarda
                # burada 2 satır (dünkü + bugünkü kapanış) olur — sondan bir
                # önceki satır GERÇEK önceki gün kapanışı. Bazı nadir
                # durumlarda (ör. sembol yeni işlem görmeye başladıysa, ya da
                # hafta başı/tatil sonrası tek satır dönerse) sadece 1 satır
                # gelebilir — bu durumda prevClose'u boş bırakıyoruz, frontend
                # zaten prevClose yoksa eski (dayOpen'a dokunmama) davranışına
                # düşecek şekilde yazıldı.
                if len(close_series) >= 2:
                    prev_closes[original] = round(float(close_series.iloc[-2]), 2)
            except Exception:
                continue
        # yfinance kendi "possibly delisted" gürültüsünü artık bastırıyor
        # (bkz. dosya başındaki logging.getLogger("yfinance") ayarı) — bunun
        # yerine hangi sembollerin bu turda veri döndürmediğini TEK bir özet
        # satırda gösteriyoruz, böylece bilgi kaybolmuyor sadece sadeleşiyor.
        missing = [original for original in formatted_map.values() if original not in quotes]
        if missing:
            print(f"[quotes] {len(missing)}/{len(formatted_map)} sembol için veri dönmedi (muhtemelen geçici/delisted): {missing}")
    except Exception as e:
        print(f"[quotes] Batch download failed ({'rate-limited' if _is_rate_limit_error(e) else 'error'}): {e}")

    _quote_cache["ts"] = now
    _quote_cache["tickers_key"] = cache_key
    _quote_cache["data"] = quotes
    _quote_cache["prevClose"] = prev_closes
    return {"quotes": quotes, "prevClose": prev_closes, "asOf": now, "cached": False}


# (29 Temmuz 2026, on üçüncü oturum devamı — Madde 3 "Kayar menüden güncel
# €,$,altın,gümüş,BIST,brent vs. eklensin") Bu, /api/v1/quotes ve
# /api/v1/ohlcv'nin kullandığı _is_valid_ticker_format()/format_ticker()
# BORSA-BAZLI (yalnızca alfanumerik + otomatik ".IS" eki) akışından
# KASITLI olarak ayrı: döviz (USDTRY=X) ve emtia (GC=F, SI=F, BZ=F)
# sembolleri Yahoo Finance'te "=" karakteri içeriyor, format_ticker() bunlara
# yanlışlıkla ".IS" ekleyip bozardı, _is_valid_ticker_format() da "="
# içerdiği için zaten reddederdi. Semboller burada SABİT/SUNUCU TARAFINDA
# TANIMLI (kullanıcıdan gelen serbest metin DEĞİL) — bu yüzden ayrı, dar bir
# allowlist güvenli: enjeksiyon/format riski yok, çünkü hiçbir kullanıcı
# girdisi bu listeye ulaşmıyor.
_MARKET_TICKER_ITEMS = [
    {"symbol": "USDTRY=X", "label": "USD/TRY"},
    {"symbol": "EURTRY=X", "label": "EUR/TRY"},
    {"symbol": "GC=F", "label": "Altın (Ons/$)"},
    {"symbol": "SI=F", "label": "Gümüş (Ons/$)"},
    {"symbol": "BZ=F", "label": "Brent Petrol ($)"},
    {"symbol": "XU100.IS", "label": "BIST 100"},
]
_MARKET_TICKER_CACHE_TTL_SEC = 60
_market_ticker_cache = {"ts": 0.0, "data": []}


@app.get("/api/v1/market-ticker")
def get_market_ticker():
    now = time.time()
    if _market_ticker_cache["data"] and (now - _market_ticker_cache["ts"]) < _MARKET_TICKER_CACHE_TTL_SEC:
        return {"items": _market_ticker_cache["data"], "asOf": _market_ticker_cache["ts"], "cached": True}

    symbols = [it["symbol"] for it in _MARKET_TICKER_ITEMS]
    items_out = []
    try:
        raw = _yf_call_with_backoff(
            lambda: yf.download(
                tickers=symbols,
                period="5d",
                interval="1d",
                group_by="ticker",
                threads=True,
                progress=False,
                session=session,
            ),
            label="market-ticker toplu indirme"
        )
        single = len(symbols) == 1
        for it in _MARKET_TICKER_ITEMS:
            sym = it["symbol"]
            try:
                close_series = raw["Close"] if single else raw[sym]["Close"]
                close_series = close_series.dropna()
                if len(close_series) >= 2:
                    last = float(close_series.iloc[-1])
                    prev = float(close_series.iloc[-2])
                    change_pct = ((last - prev) / prev * 100) if prev else 0.0
                    items_out.append({
                        "symbol": sym, "label": it["label"],
                        "price": round(last, 4), "changePct": round(change_pct, 2)
                    })
                elif len(close_series) == 1:
                    items_out.append({
                        "symbol": sym, "label": it["label"],
                        "price": round(float(close_series.iloc[-1]), 4), "changePct": None
                    })
            except Exception:
                continue
        missing = [it["symbol"] for it in _MARKET_TICKER_ITEMS if it["symbol"] not in [o["symbol"] for o in items_out]]
        if missing:
            print(f"[market-ticker] {len(missing)}/{len(_MARKET_TICKER_ITEMS)} sembol için veri dönmedi: {missing}")
    except Exception as e:
        print(f"[market-ticker] Batch download failed ({'rate-limited' if _is_rate_limit_error(e) else 'error'}): {e}")

    _market_ticker_cache["ts"] = now
    _market_ticker_cache["data"] = items_out
    return {"items": items_out, "asOf": now, "cached": False}


# (23 Temmuz 2026, on üçüncü oturum — "motoru güçlendirme" temizliği)
# Burada önceden /api/v1/backtest/run ve /api/v1/backtest/status/{task_id}
# uç noktaları vardı — frontend'de (dataController.js/app.js dahil tüm
# dosyalarda) bu uç noktalara yapılan TEK çağrı da bu oturumda ölü kod
# olduğu için kaldırıldığından (bkz. dataController.js/app.js temizliği),
# bunlar da artık hiçbir yerden ulaşılamıyordu — tamamen kaldırıldı. Ayrıca
# get_status'un "task bulunamazsa" yolu SABİT/UYDURMA metrikler
# (total_profit: 15.5, win_rate: 65.0 vb.) döndürüyordu — bu da projenin
# "sahte veri yok" ilkesiyle çelişen bir bulguydu.

def _extract_fast_price(stock: "yf.Ticker"):
    """
    yfinance'in fast_info nesnesi sürüme göre hem attribute (.last_price)
    hem mapping (['lastPrice']) tarzı erişimi destekleyebiliyor, ve bazen
    hiçbirini (ağ hatası, sembol geçici olarak sağlanamıyor vb.) — bu yüzden
    birden fazla erişim yolunu sırayla, hepsi sessizce başarısız olabilecek
    şekilde deniyoruz. Hiçbiri çalışmazsa None döner (çağıran taraf bunu
    "bu turda gerçek fiyat yok" olarak yorumlayıp bir sonraki turu bekliyor).
    """
    try:
        fast = _yf_call_with_backoff(lambda: stock.fast_info, label="fast_info")
    except Exception:
        return None
    for accessor in (
        lambda f: f["lastPrice"],
        lambda f: f["last_price"],
        lambda f: f.last_price,
    ):
        try:
            val = accessor(fast)
            if val is not None:
                return float(val)
        except Exception:
            continue
    return None


# (9 Ağustos 2026 — KRİTİK düzeltme: WebSocket event-loop donma riski)
# Aşağıdaki iki sorun aynı kök nedene sahipti: /ws/live/{ticker} ucu
# senkron (bloklayan) yfinance/requests çağrılarını DOĞRUDAN asyncio
# event loop'u İÇİNDE, await'siz olarak çalıştırıyordu. Python'da senkron
# bir fonksiyon çağrısı event loop'u fiilen DURDURUR — o an aktif olan
# TÜM diğer WebSocket bağlantıları (ve hatta aynı worker'daki normal HTTP
# istekleri) o çağrı bitene kadar (ağ gecikmesi + olası backoff
# time.sleep()'i, saniyelerce sürebilir) donuyordu. Render gibi tek
# worker'lı ücretsiz bir planda bu, TEK BİR yavaş yfinance isteğinin
# yarışmadaki TÜM kullanıcıların canlı akışını aynı anda kilitleyebileceği
# anlamına geliyordu. Çözüm: senkron kısmı asyncio.to_thread() ile ayrı
# bir thread'e taşımak — event loop, o thread'in bitmesini "await" ederek
# BEKLERKEN aynı anda başka bağlantılara da hizmet vermeye devam edebiliyor.
def _fetch_real_price_sync(stock: "yf.Ticker", ticker: str):
    """SENKRON (bloklayan) fiyat çekme mantığı — asyncio.to_thread() ile
    ayrı bir thread'de çalıştırılmak üzere tasarlandı, event loop'ta
    DOĞRUDAN çağrılmamalı."""
    real_price = _extract_fast_price(stock)
    if real_price is None:
        # Yedek yol: son 1 günlük/1 dakikalık barın kapanışı.
        try:
            recent = _yf_call_with_backoff(
                lambda: stock.history(period="1d", interval="1m", timeout=8),
                label=f"live fallback history({ticker})"
            )
            if not recent.empty:
                real_price = float(recent["Close"].iloc[-1])
        except Exception as e:
            print(f"[WebSocket] fallback history fetch failed for {ticker}: {e}")
    return real_price


# (9 Ağustos 2026 — KRİTİK düzeltme: bağlantı sayısı sınırı) Her açık
# WebSocket bağlantısı, arka planda LIVE_POLL_INTERVAL_SEC'te bir yfinance'e
# istek atan sonsuz bir döngü demek. Sınırsız sayıda eşzamanlı bağlantıya
# izin vermek, tek bir Render worker'ının kaynaklarını (ve yfinance'e giden
# istek hacmini, rate-limit riskini artırarak) tüketebilir. Bu üst sınır
# kasıtlı olarak cömert tutuldu (bir yarışmada gerçekçi eşzamanlı kullanıcı
# sayısının çok üzerinde) — amaç normal kullanımı KISITLAMAK değil, bir
# hata/döngü/kötü niyetli istemcinin süreci tüketmesini ÖNLEMEK.
_MAX_CONCURRENT_LIVE_CONNECTIONS = 300
_active_live_connections = 0


@app.websocket("/ws/live/{ticker}")
async def websocket_endpoint(websocket: WebSocket, ticker: str):
    global _active_live_connections

    # (9 Ağustos 2026) Diğer tüm uç noktalarda (ör. /api/v1/ohlcv/{ticker})
    # zaten uygulanan _is_valid_ticker_format() doğrulaması bu WebSocket
    # ucunda EKSİKTİ — herhangi biri /ws/live/<rastgele-uzun-string> gibi
    # geçersiz bir sembolle bağlanıp gereksiz yere sonsuz bir yfinance
    # sorgulama döngüsü başlatabiliyordu. Artık diğer uçlarla tutarlı
    # şekilde erken reddediliyor.
    if not _is_valid_ticker_format(ticker):
        await websocket.close(code=1008, reason="Invalid ticker format")
        return

    if _active_live_connections >= _MAX_CONCURRENT_LIVE_CONNECTIONS:
        await websocket.close(code=1013, reason="Server busy, try again later")
        return

    await websocket.accept()
    _active_live_connections += 1
    # (17-18 Temmuz 2026, sekizinci oturum — "motor" geliştirmesi) Bu uç
    # önceden `random.uniform` ile TAMAMEN sahte/simüle tick üretiyordu ve
    # frontend tarafından hiç kullanılmıyordu. Artık geçmiş mumlardan sonra,
    # her LIVE_POLL_INTERVAL_SEC saniyede bir yfinance'ten GERÇEK güncel
    # fiyatı çekip push ediyor. yfinance ücretsiz API'si saniyelik tick-by-
    # tick veri sağlamıyor (sadece periyodik "son fiyat" anlık görüntüsü) —
    # bu yüzden "canlı" burada "periyodik olarak tazelenen gerçek fiyat"
    # anlamına geliyor. Frontend (tradingEngine.js → connectLiveFeed) bu
    # gerçek fiyatı kendi 2 saniyelik mikro-simülasyonuna bir "çıpa" olarak
    # besliyor — böylece hem akış görsel olarak akıcı kalıyor hem de
    # periyodik olarak gerçeğe demirleniyor. Aralık kısa tutulmuyor (1sn
    # değil, 12sn) çünkü amaç yfinance'i saniyede bir yormak değil, makul bir
    # kaynakla gerçek veriye düzenli aralıklarla "check-in" yapmak.
    LIVE_POLL_INTERVAL_SEC = 12
    try:
        formatted = format_ticker(ticker)
        stock = yf.Ticker(formatted, session=session)

        # (22 Temmuz 2026, on ikinci oturum, beşinci tur — "canlı veri
        # noktası 20-30 saniye gri kalıyor" sorunu) Bu uç önceden burada
        # KENDİ BAŞINA ayrı bir "3mo" geçmiş veri çekip bunu bir "history"
        # mesajı olarak gönderiyordu. Ancak frontend (tradingEngine.js →
        # openLiveSocket'in onmessage'ı) yalnızca "type":"tick" mesajlarını
        # işliyor — "history" mesajını hiç okumuyor (grafik zaten ayrı bir
        # REST isteğiyle, çok daha kapsamlı "period=max" veriyle çiziliyor).
        # Yani bu ikinci geçmiş veri çekimi TAMAMEN boşa gidiyordu, ama ilk
        # gerçek fiyat (tick) ancak bu bittikten sonra gönderilebiliyordu —
        # her sembol geçişinde gereksiz bir tam yfinance isteği kadar (Render
        # üzerinde birkaç saniye) fazladan gecikme ekliyordu. Kaldırıldı;
        # artık bağlantı kurulur kurulmaz doğrudan gerçek fiyata geçiliyor.
        async def fetch_and_send_tick() -> bool:
            """Bir gerçek fiyat çekip varsa 'tick' olarak gönderir; başarılıysa
            True döner (çağıran taraf bunu sadece loglama/tanı amaçlı kullanır,
            akışı etkilemez).
            (9 Ağustos 2026) Senkron/bloklayan kısım artık asyncio.to_thread()
            ile ayrı bir thread'de çalışıyor — bkz. _fetch_real_price_sync()
            üzerindeki kök neden açıklaması. Bu await, event loop'u
            BLOKLAMAZ; thread çalışırken loop başka bağlantılara/isteklere
            hizmet vermeye devam edebilir."""
            real_price = await asyncio.to_thread(_fetch_real_price_sync, stock, ticker)

            if real_price is None or real_price <= 0:
                # Gerçek fiyat bu turda alınamadı (ağ/yfinance geçici sorunu
                # olabilir) — bağlantıyı koparmıyoruz, sadece bu turu
                # sessizce atlayıp bir sonrakini deniyoruz. Frontend zaten
                # kendi simülasyonuna kesintisiz devam ediyor (REST OHLCV
                # fetch'teki yedek-yola-düşme mantığıyla aynı defense-in-
                # depth prensibi).
                return False

            await websocket.send_json({
                "type": "tick",
                "ticker": ticker,
                "price": round(real_price, 2),
                "source": "live"
            })
            return True

        # (22 Temmuz 2026, on ikinci oturum, dördüncü tur — "canlı veri
        # göstergesi hemen yeşile dönmüyor" sorunu) Önceden ilk gerçek 'tick'
        # ancak LIVE_POLL_INTERVAL_SEC (12sn) sonra gönderiliyordu — bu yüzden
        # sayfa yeni açıldığında/sembol değiştiğinde frontend'deki yeşil nokta
        # 12 saniye boyunca gri kalıyor, biri tam o an bakarsa "canlı değil"
        # sanısına kapılabiliyordu (hoca sunumu öncesi bu yanlış izlenimi hiç
        # istemiyoruz). Artık geçmiş veriden hemen sonra bir "tick" daha
        # deneniyor — bağlantı kurulduktan ~1 saniye içinde gerçek fiyat
        # varsa nokta hemen yeşile dönüyor, yoksa döngü periyodik denemeye
        # devam ediyor.
        await fetch_and_send_tick()

        while True:
            await asyncio.sleep(LIVE_POLL_INTERVAL_SEC)
            await fetch_and_send_tick()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WebSocket] Error for {ticker}: {e}")
    finally:
        # (9 Ağustos 2026) Bağlantı sayacı — bağlantı nasıl biterse bitsin
        # (normal kapanma, hata, veya istemcinin aniden kopması) mutlaka
        # azaltılmalı, yoksa sayaç zamanla "sızar" ve gerçek kapasite
        # dolmadan yeni bağlantılar reddedilmeye başlar.
        _active_live_connections -= 1

# (23 Temmuz 2026, on üçüncü oturum — "motoru güçlendirme" temizliği)
# Burada önceden /api/v1/backtest/export uç noktası vardı — PDF raporu
# ÜRETİMİNİN BÜYÜK KISMI baştan sona SABİT/UYDURMA değerlerden oluşuyordu:
# Sharpe oranı ikili bir varsayımdan (`1.85 if total_profit > 0 else 0.45`),
# "BIST Sektör Ortalaması" tablosu 5 sembol için elle girilmiş sabit
# referanslardan, ve "Teknik Performans" bölümündeki gecikme/CPU/RAM
# rakamları da tamamen SABİT metinlerden (`"45ms"`, `"2.1%"` vb., hiçbir
# ölçümle ilgisi yok) geliyordu. Bu uç noktaya frontend'den (dataController.js/
# app.js) yapılan TEK çağrı da bu oturumda ölü kod olduğu için kaldırıldı,
# yani zaten hiçbir kullanıcı bu sahte rakamları görmüyordu — ama projenin
# "sahte veri yok" ilkesiyle açıkça çelişen bir risk olduğu için tamamen
# kaldırıldı, gelecekte yeniden bağlanıp yanlışlıkla canlıya alınmasın diye.

# (18 Temmuz 2026, onuncu oturum, beşinci tur — bulut dağıtımı hazırlığı)
# README_DEPLOY.md bu bloğun burada olduğunu iddia ediyordu ama gerçekte hiç
# yoktu (bulut host'un enjekte ettiği PORT ortam değişkenini okuyup uvicorn'u
# ona göre başlatan bir çalıştırıcı). Render/Railway gibi platformlar "Start
# Command" alanına açıkça `uvicorn main:app --host 0.0.0.0 --port $PORT`
# yazıldığında zaten bu bloğa ihtiyaç duymuyor (komut PORT'u kendisi enjekte
# ediyor) — ama bazı platformlar/otomatik-algılama modları sadece `python
# main.py` çalıştırabiliyor; bu blok o durumda da doğru portu dinlemeyi
# garanti ediyor. Yerelde (bu dosya doğrudan `python main.py` ile
# çalıştırıldığında) PORT ortam değişkeni yoksa varsayılan olarak 8000'i
# kullanmaya devam ediyor, yani mevcut yerel iş akışı hiç değişmiyor.
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
# EOF