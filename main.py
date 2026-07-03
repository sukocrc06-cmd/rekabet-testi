from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
import yfinance as yf
import requests
import os

# Set up requests Session with standard User-Agent header
session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
})

app = FastAPI(title="Investment Test Platform API")

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", response_class=HTMLResponse)
def serve_index():
    index_path = os.path.join(os.path.dirname(__file__), "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail="index.html not found")
    with open(index_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read(), status_code=200)

@app.get("/fetch-data/{ticker}")
def fetch_data(ticker: str):
    try:
        symbol = ticker.upper()
        # Add .IS suffix for Turkish stocks if not already provided
        turkish_tickers = ["ASELSAN", "ASELS", "THYAO", "BIMAS", "TUPRS", "AKBNK"]
        if symbol in turkish_tickers:
            if symbol == "ASELSAN":
                symbol = "ASELS"
            if not symbol.endswith(".IS"):
                symbol = symbol + ".IS"
                
        stock = yf.Ticker(symbol, session=session)
        df = stock.history(period="1d", interval="1m", timeout=5)
        
        if df.empty:
            # Fallback to daily check if minute bars are not available
            df = stock.history(period="5d", interval="1d", timeout=5)
            
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No pricing data found for ticker: {symbol}")
            
        # Extract last closing price
        current_price = float(df['Close'].iloc[-1])
        open_price = float(df['Open'].iloc[0])
        high_price = float(df['High'].max())
        low_price = float(df['Low'].min())
        volume = int(df['Volume'].iloc[-1]) if 'Volume' in df.columns else 0
        
        price_change = current_price - open_price
        price_change_pct = (price_change / open_price) * 100 if open_price > 0 else 0
        
        return {
            "ticker": symbol,
            "current_price": round(current_price, 2),
            "open": round(open_price, 2),
            "high": round(high_price, 2),
            "low": round(low_price, 2),
            "volume": volume,
            "change": round(price_change, 2),
            "change_percent": round(price_change_pct, 2)
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to fetch data: {str(e)}"}
        )