class StrategyEngine:
    @staticmethod
    def calculate_metrics(data: list) -> dict:
        """
        Calculates moving average crossover strategy metrics on historical BIST OHLCV data.
        
        Expected fields in data dictionary:
        - Date: string/date
        - Open, High, Low, Close: float
        - Volume: float
        """
        if len(data) < 20:
            return {
                "total_profit": 0.0,
                "win_rate": 0.0,
                "trade_count": 0,
                "equity_curve": [100000.0] * max(1, len(data)),
                "drawdown_curve": [0.0] * max(1, len(data)),
                "dates": [d.get("Date", "") for d in data],
                "trades": []
            }
        
        closes = [d.get("Close", 0.0) for d in data]
        dates = [str(d.get("Date", ""))[:10] for d in data]
        
        # Calculate SMA 5 (fast) and SMA 20 (slow)
        sma5 = []
        sma20 = []
        for i in range(len(closes)):
            if i >= 4:
                sma5.append(sum(closes[i-4:i+1]) / 5)
            else:
                sma5.append(None)
                
            if i >= 19:
                sma20.append(sum(closes[i-19:i+1]) / 20)
            else:
                sma20.append(None)
        
        # Simulate trades
        position = False
        entry_price = 0.0
        entry_date = ""
        entry_idx = 0
        trades = []
        initial_capital = 100000.0
        cash = initial_capital
        equity_curve = []
        
        # Initialize initial periods with cash
        for i in range(len(data)):
            if i == 0:
                equity_curve.append(cash)
                continue
                
            buy_signal = False
            sell_signal = False
            
            if (sma5[i] is not None and sma20[i] is not None and 
                sma5[i-1] is not None and sma20[i-1] is not None):
                buy_signal = sma5[i] > sma20[i] and sma5[i-1] <= sma20[i-1]
                sell_signal = sma5[i] < sma20[i] and sma5[i-1] >= sma20[i-1]
            
            current_price = closes[i]
            
            if buy_signal and not position:
                position = True
                entry_price = current_price
                entry_date = dates[i]
                entry_idx = i
            elif sell_signal and position:
                position = False
                profit_pct = (current_price - entry_price) / entry_price * 100
                pnl = (cash * (profit_pct / 100))
                cash *= (1 + profit_pct / 100)
                trades.append({
                    "entryDate": entry_date,
                    "exitDate": dates[i],
                    "type": "BUY",
                    "shares": int(cash / entry_price) if entry_price > 0 else 0,
                    "entryPrice": round(entry_price, 2),
                    "exitPrice": round(current_price, 2),
                    "pnl": round(pnl, 2),
                    "holdingDays": i - entry_idx
                })
            
            # Record equity
            if position:
                current_value = cash * (current_price / entry_price)
                equity_curve.append(current_value)
            else:
                equity_curve.append(cash)
        
        # Force close open position at the last candle
        if position:
            current_price = closes[-1]
            profit_pct = (current_price - entry_price) / entry_price * 100
            pnl = (cash * (profit_pct / 100))
            cash *= (1 + profit_pct / 100)
            equity_curve[-1] = cash
            trades.append({
                "entryDate": entry_date,
                "exitDate": dates[-1],
                "type": "BUY",
                "shares": int(cash / entry_price) if entry_price > 0 else 0,
                "entryPrice": round(entry_price, 2),
                "exitPrice": round(current_price, 2),
                "pnl": round(pnl, 2),
                "holdingDays": len(data) - 1 - entry_idx,
                "forceExit": True
            })
            position = False
            
        # Calculate summary metrics
        trade_count = len(trades)
        wins = [t["pnl"] for t in trades if t["pnl"] > 0]
        win_rate = (len(wins) / trade_count * 100) if trade_count > 0 else 0.0
        total_profit = ((cash - initial_capital) / initial_capital * 100)
        
        # Calculate drawdown curve
        peak = 0.0
        drawdown_curve = []
        for eq in equity_curve:
            if eq > peak:
                peak = eq
            dd = ((peak - eq) / peak * 100) if peak > 0 else 0.0
            drawdown_curve.append(dd)
            
        return {
            "total_profit": round(total_profit, 2),
            "win_rate": round(win_rate, 2),
            "trade_count": trade_count,
            "equity_curve": [round(eq, 2) for eq in equity_curve],
            "drawdown_curve": [round(dd, 2) for dd in drawdown_curve],
            "dates": dates,
            "trades": trades
        }
