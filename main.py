from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import traceback

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def get_index():
    with open("index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.post("/run-analysis")
async def run_analysis():
    return {"status": "success", "message": "Motor çalışıyor, veriler hazır!"}

@app.post("/opti-chat")
async def opti_chat(request: Request):
    # BULLETPROOF: dynamically parse any JSON structure or raw text to prevent 422 errors
    question = ""
    try:
        data = await request.json()
        question = str(data.get("question", data.get("text", data.get("message", data.get("msg", "")))))
    except Exception:
        try:
            body = await request.body()
            question = body.decode("utf-8")
        except Exception:
            question = ""

    question_upper = question.upper()
    words = question_upper.replace("?", "").replace(".", "").replace(",", "").split()
    
    # Extract uppercase ticker
    target = next((w for w in words if w.isupper() and 1 <= len(w) <= 8 and w not in ["NE", "NASIL", "OPTI", "MERHABA", "SELAM", "HİSSE", "HISSE"]), None)

    if target:
        try:
            print(f"[Opti AI] Analyzing ticker: {target}")
            stock = yf.Ticker(target)
            hist = stock.history(period="3mo")
            
            if hist.empty:
                stock = yf.Ticker(target + ".IS")
                hist = stock.history(period="3mo")
                if hist.empty:
                    return {"response": f"Patron, {target} hissesi için Yahoo Finance üzerinde hiçbir canlı veri bulamadım."}

            if len(hist) < 20:
                return {"response": f"Patron, {target} hissesi gefunden fakat teknik analiz (SMA/RSI) yapmak için yeterli geçmiş veri günü yok."}

            # Technical Calculations
            current_price = hist['Close'].iloc[-1]
            sma_20 = hist['Close'].rolling(window=20).mean().iloc[-1]

            delta = hist['Close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            
            # Prevent division by zero
            if loss.iloc[-1] == 0:
                rsi = 100.0
            else:
                rs = gain.iloc[-1] / loss.iloc[-1]
                rsi = 100 - (100 / (1 + rs))

            signal = "AL 🟢" if current_price > sma_20 and rsi < 70 else "BEKLE/SAT 🔴"

            msg = f"Hemen {target} hissesini senin için analiz ettim. Güncel fiyat: ${current_price:.2f}. 20 Günlük Ortalaması: ${sma_20:.2f}. RSI seviyesi: {rsi:.1f}. Opti AI Kararı: {signal}"
            return {"response": msg}

        except Exception as e:
            print(traceback.format_exc())
            return {"response": f"Analiz motorunda bir hata oluştu patron: {str(e)}"}

    return {"response": "Ben Opti! Web sitemizin ve borsa verilerinin kontrolü bende. Lütfen bana analiz etmemi istediğin hissenin kodunu (Örn: AAPL, TSLA veya THYAO) yaz."}