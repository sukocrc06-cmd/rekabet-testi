from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
import pandas as pd

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    question: str

@app.get("/")
async def get_index():
    with open("index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.post("/run-analysis")
async def run_analysis():
    return {"status": "success", "message": "Motor çalışıyor, veriler hazır!"}

@app.post("/opti-chat")
async def opti_chat(req: ChatRequest):
    question = req.question.upper()
    words = question.replace("?", "").replace(".", "").split()
    
    target = next((w for w in words if w.isupper() and 1 <= len(w) <= 8 and w not in ["NE", "NASIL", "OPTI", "MERHABA", "SELAM"]), None)

    if target:
        try:
            stock = yf.Ticker(target)
            hist = stock.history(period="3mo")
            
            if hist.empty:
                stock = yf.Ticker(target + ".IS")
                hist = stock.history(period="3mo")
                if hist.empty:
                    return {"response": f"Patron, {target} hissesi için borsa verisi bulamadım."}

            current_price = hist['Close'].iloc[-1]
            sma_20 = hist['Close'].rolling(window=20).mean().iloc[-1]

            delta = hist['Close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs)).iloc[-1]

            signal = "AL 🟢" if current_price > sma_20 and rsi < 70 else "BEKLE/SAT 🔴"

            msg = f"Hemen {target} hissesini senin için analiz ettim. Güncel fiyat: ${current_price:.2f}. 20 Günlük Ortalaması: ${sma_20:.2f}. RSI seviyesi: {rsi:.1f}. Opti AI Kararı: {signal}"
            return {"response": msg}

        except Exception as e:
            return {"response": f"Analiz sırasında bir hata oluştu: {str(e)}"}

    return {"response": "Ben Opti! Lütfen bana analiz etmemi istediğin hissenin tam kodunu (Örneğin: AAPL, TSLA veya THYAO) yaz."}