from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
import io
from fastapi.responses import StreamingResponse
from fpdf import FPDF
from backend.engine import StrategyEngine
import asyncio
import random

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class BacktestRequest(BaseModel):
    engine_id: str
    ticker: str

class PDFRequest(BaseModel):
    ticker: str
    engine_id: str
    total_profit: float
    win_rate: float
    trade_count: int

class PDFReport(FPDF):
    def header(self):
        # Premium dark theme header
        self.set_fill_color(30, 30, 30) # #1E1E1E
        self.rect(0, 0, 210, 40, "F")
        self.set_text_color(212, 175, 55) # Gold accent #D4AF37
        self.set_font("helvetica", "B", 18)
        self.cell(0, 20, "OPTIPULSELAB QUANTITATIVE REPORT", ln=True, align="C")
        self.set_font("helvetica", "I", 10)
        self.set_text_color(200, 200, 200)
        self.cell(0, -5, "Simulated Backtesting Compliance & Performance Audit", ln=True, align="C")
        self.ln(15)

    def footer(self):
        # Footer
        self.set_y(-15)
        self.set_font("helvetica", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Page {self.page_no()} | CONFIDENTIAL - SANDBOX MODE NON-LIVE", align="C")

@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/v1/ohlcv/{ticker}")
async def get_data(ticker: str):
    stock = yf.Ticker(ticker + ".IS") 
    hist = stock.history(period="3mo", interval="1d")
    data = hist.reset_index().to_dict(orient="records")
    
    # Convert Timestamp values to string for serialization
    for record in data:
        if "Date" in record:
            record["Date"] = str(record["Date"])
            
    return {"ticker": ticker, "data": data}

# Global task cache to simulate asynchronous queues
task_store = {}

@app.post("/api/v1/backtest/run")
async def run_backtest(request: BacktestRequest):
    ticker = request.ticker
    stock = yf.Ticker(ticker + ".IS")
    hist = stock.history(period="3mo", interval="1d")
    data = hist.reset_index().to_dict(orient="records")
    
    # Convert Date values to string for serialization
    for record in data:
        if "Date" in record:
            record["Date"] = str(record["Date"])
            
    metrics = StrategyEngine.calculate_metrics(data)
    
    # Format candles for frontend candlestick chart mapping
    formatted_candles = []
    for record in data:
        formatted_candles.append({
            "date": str(record.get("Date", ""))[:10],
            "open": float(record.get("Open", 0.0)),
            "high": float(record.get("High", 0.0)),
            "low": float(record.get("Low", 0.0)),
            "close": float(record.get("Close", 0.0)),
            "volume": float(record.get("Volume", 0.0))
        })
    metrics["candles"] = formatted_candles
    
    task_id = f"task_{ticker}_{request.engine_id}"
    task_store[task_id] = {
        "status": "completed",
        "metrics": metrics
    }
    
    return {
        "task_id": task_id,
        "status": "processing"
    }

@app.get("/api/v1/backtest/status/{task_id}")
async def get_status(task_id: str):
    if task_id in task_store:
        return task_store[task_id]
        
    return {
        "status": "completed", 
        "metrics": {
            "total_profit": 15.5, 
            "win_rate": 65.0, 
            "trade_count": 12,
            "candles": [],
            "equity_curve": [],
            "drawdown_curve": [],
            "trades": []
        }
    }

@app.websocket("/ws/live/{ticker}")
async def websocket_endpoint(websocket: WebSocket, ticker: str):
    await websocket.accept()
    try:
        # Fetch initial historical candles to populate the chart
        stock = yf.Ticker(ticker + ".IS")
        hist = stock.history(period="3mo", interval="1d")
        data = hist.reset_index().to_dict(orient="records")
        
        for record in data:
            if "Date" in record:
                record["Date"] = str(record["Date"])
                
        formatted_candles = []
        for record in data:
            formatted_candles.append({
                "date": str(record.get("Date", ""))[:10],
                "open": float(record.get("Open", 0.0)),
                "high": float(record.get("High", 0.0)),
                "low": float(record.get("Low", 0.0)),
                "close": float(record.get("Close", 0.0)),
                "volume": float(record.get("Volume", 0.0))
            })
            
        # Push historical data as first payload
        await websocket.send_json({
            "type": "history",
            "candles": formatted_candles
        })
        
        # Stream simulated real-time tick updates every 1 second
        last_price = formatted_candles[-1]["close"] if formatted_candles else 100.0
        while True:
            await asyncio.sleep(1.0)
            change_pct = random.uniform(-0.005, 0.005)
            tick_price = last_price * (1 + change_pct)
            last_price = tick_price
            
            await websocket.send_json({
                "type": "tick",
                "ticker": ticker,
                "price": round(tick_price, 2)
            })
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WebSocket] Error for {ticker}: {e}")

@app.post("/api/v1/backtest/export")
async def export_report(request: PDFRequest):
    pdf = PDFReport()
    pdf.add_page()
    
    # Document Title
    pdf.ln(10)
    pdf.set_font("helvetica", "B", 14)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 10, f"Strategy Performance Summary: {request.ticker}", ln=True)
    pdf.ln(5)
    
    # Data Table
    pdf.set_font("helvetica", "B", 11)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(90, 8, "Metric Parameter", border=1, fill=True)
    pdf.cell(90, 8, "Value", border=1, fill=True, ln=True)
    
    pdf.set_font("helvetica", "", 10)
    metrics_data = [
        ("Asset Selected", f"{request.ticker} (BIST)"),
        ("Execution Engine", request.engine_id),
        ("Net Profit / Return", f"{request.total_profit:.2f}%"),
        ("Win Rate", f"{request.win_rate:.2f}%"),
        ("Total Trades Executed", str(request.trade_count)),
        ("Compliance Validation", "SANDBOX MODE (NON-LIVE)")
    ]
    
    for label, val in metrics_data:
        pdf.cell(90, 8, label, border=1)
        pdf.cell(90, 8, val, border=1, ln=True)
        
    pdf.ln(10)
    pdf.set_font("helvetica", "B", 11)
    pdf.cell(0, 10, "Compliance Auditor Safety Disclosures", ln=True)
    pdf.set_font("helvetica", "", 9)
    pdf.set_text_color(100, 100, 100)
    disclosure_text = (
        "OptiPulseLab simulations operate in a sandbox environment using historical BIST asset pricing data. "
        "Calculated metrics (Net Profit, Win Rate, and Drawdown parameters) are purely hypothetical, "
        "do not represent actual trading, and do not account for full market slippage, exchange liquidity, or broker execution latency. "
        "Past performance is not indicative of future results."
    )
    pdf.multi_cell(0, 5, disclosure_text)
    
    pdf_bytes = pdf.output()
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=OptiPulseLab_Report_{request.ticker}.pdf"}
    )