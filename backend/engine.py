class StrategyEngine:
    @staticmethod
    def calculate_metrics(data: list, engine: str = 'optipulse') -> dict:
        """
        Calculates moving average crossover strategy metrics on historical BIST OHLCV data.
        Adjusts periods and commissions dynamically based on the execution engine.
        """
        # Determine strategy parameters by engine
        if engine == 'backtrader':
            fast_period = 7
            slow_period = 25
            comm_rate = 0.0007 # 0.07%
        elif engine == 'custom':
            fast_period = 10
            slow_period = 30
            comm_rate = 0.0010 # 0.10%
        else:
            fast_period = 5
            slow_period = 20
            comm_rate = 0.0005 # 0.05%

        if len(data) < slow_period:
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
        
        # Calculate fast and slow moving averages
        sma_fast = []
        sma_slow = []
        for i in range(len(closes)):
            if i >= fast_period - 1:
                sma_fast.append(sum(closes[i - (fast_period - 1):i + 1]) / fast_period)
            else:
                sma_fast.append(None)
                
            if i >= slow_period - 1:
                sma_slow.append(sum(closes[i - (slow_period - 1):i + 1]) / slow_period)
            else:
                sma_slow.append(None)
        
        # Simulate trades
        position = False
        entry_price = 0.0
        entry_date = ""
        entry_idx = 0
        shares = 0
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
            
            if (sma_fast[i] is not None and sma_slow[i] is not None and 
                sma_fast[i-1] is not None and sma_slow[i-1] is not None):
                buy_signal = sma_fast[i] > sma_slow[i] and sma_fast[i-1] <= sma_slow[i-1]
                sell_signal = sma_fast[i] < sma_slow[i] and sma_fast[i-1] >= sma_slow[i-1]
            
            current_price = closes[i]
            
            if buy_signal and not position:
                position = True
                entry_price = current_price
                entry_date = dates[i]
                entry_idx = i
                # Subtract commission on entry
                cost_per_share = entry_price * (1 + comm_rate)
                shares = int(cash / cost_per_share) if cost_per_share > 0 else 0
                cash -= shares * cost_per_share
                
            elif sell_signal and position:
                position = False
                # Subtract commission on exit
                revenue = shares * current_price * (1 - comm_rate)
                pnl = revenue - (shares * entry_price * (1 + comm_rate))
                cash += revenue
                
                trades.append({
                    "entryDate": entry_date,
                    "exitDate": dates[i],
                    "type": "BUY",
                    "shares": shares,
                    "entryPrice": round(entry_price, 2),
                    "exitPrice": round(current_price, 2),
                    "pnl": round(pnl, 2),
                    "holdingDays": i - entry_idx
                })
                shares = 0
            
            # Record equity
            if position:
                current_value = cash + (shares * current_price)
                equity_curve.append(current_value)
            else:
                equity_curve.append(cash)
        
        # Force close open position at the last candle
        if position:
            current_price = closes[-1]
            revenue = shares * current_price * (1 - comm_rate)
            pnl = revenue - (shares * entry_price * (1 + comm_rate))
            cash += revenue
            equity_curve[-1] = cash
            
            trades.append({
                "entryDate": entry_date,
                "exitDate": dates[-1],
                "type": "BUY",
                "shares": shares,
                "entryPrice": round(entry_price, 2),
                "exitPrice": round(current_price, 2),
                "pnl": round(pnl, 2),
                "holdingDays": len(data) - 1 - entry_idx,
                "forceExit": True
            })
            position = False
            shares = 0
            
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
