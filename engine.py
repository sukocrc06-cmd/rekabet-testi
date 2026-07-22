class StrategyEngine:
    # (22 Temmuz 2026, on ikinci oturum — "gerçek çoklu-strateji motoru")
    # Önceden `engine_id` parametresi backend'e hiç ulaşmıyordu ("OptiPulse
    # Core" ve "Backtrader Standard" arayüzde iki ayrı motor gibi
    # sunuluyordu ama ikisi de birebir aynı SMA5/SMA20 kesişim stratejisini
    # çalıştırıyordu — bkz. PDF raporundaki latency/CPU farkı yalnızca
    # KOZMETİKTİ, gerçek strateji sonucu hep özdeşti). Artık `engine_id`
    # gerçekten farklı bir sinyal üretici seçiyor: "optipulse" (eskisiyle
    # birebir aynı SMA5/SMA20 trend-takip stratejisi) vs "backtrader" (yeni:
    # RSI+MACD momentum/dönüş stratejisi). Trade simülasyonu/equity-drawdown
    # muhasebesi TEK bir ortak döngüde kalıyor (iki strateji arasında kopya
    # kod yok) — yalnızca "hangi günler al/sat sinyali üretir" kısmı farklı.

    @staticmethod
    def _sma_crossover_signals(closes: list) -> tuple:
        """
        Orijinal (tek) strateji: SMA5 (hızlı) ile SMA20 (yavaş) kesişimi —
        trend-takip. SMA5, SMA20'yi yukarı keserse AL, aşağı keserse SAT.
        """
        n = len(closes)
        sma5 = [None] * n
        sma20 = [None] * n
        for i in range(n):
            if i >= 4:
                sma5[i] = sum(closes[i - 4:i + 1]) / 5
            if i >= 19:
                sma20[i] = sum(closes[i - 19:i + 1]) / 20

        buy_signals = [False] * n
        sell_signals = [False] * n
        for i in range(1, n):
            if (sma5[i] is not None and sma20[i] is not None and
                    sma5[i - 1] is not None and sma20[i - 1] is not None):
                buy_signals[i] = sma5[i] > sma20[i] and sma5[i - 1] <= sma20[i - 1]
                sell_signals[i] = sma5[i] < sma20[i] and sma5[i - 1] >= sma20[i - 1]
        return buy_signals, sell_signals

    @staticmethod
    def _compute_ema(values: list, period: int) -> list:
        """Standart EMA — ilk `period` değerin SMA'sıyla tohumlanır, öncesi None."""
        n = len(values)
        ema = [None] * n
        if n < period:
            return ema
        k = 2.0 / (period + 1)
        seed = sum(values[:period]) / period
        ema[period - 1] = seed
        for i in range(period, n):
            ema[i] = values[i] * k + ema[i - 1] * (1 - k)
        return ema

    @staticmethod
    def _compute_rsi(closes: list, period: int = 14) -> list:
        """Wilder'ın klasik ortalama kazanç/kayıp yöntemiyle RSI (0-100)."""
        n = len(closes)
        rsi = [None] * n
        if n <= period:
            return rsi
        gains = [0.0] * n
        losses = [0.0] * n
        for i in range(1, n):
            change = closes[i] - closes[i - 1]
            gains[i] = max(change, 0.0)
            losses[i] = max(-change, 0.0)
        avg_gain = sum(gains[1:period + 1]) / period
        avg_loss = sum(losses[1:period + 1]) / period
        rsi[period] = 100.0 if avg_loss == 0 else 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))
        for i in range(period + 1, n):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
            rsi[i] = 100.0 if avg_loss == 0 else 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))
        return rsi

    @staticmethod
    def _compute_macd(closes: list, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple:
        """MACD çizgisi (EMA12-EMA26) ve onun sinyal çizgisi (MACD'nin EMA9'u).
        Sinyal EMA'sı yalnızca MACD'nin GERÇEKTEN tanımlı olduğu (None
        olmayan) değerler üzerinden hesaplanır, ardından orijinal indekslere
        geri eşlenir — aksi halde None'lar EMA hesabını bozardı."""
        ema_fast = StrategyEngine._compute_ema(closes, fast)
        ema_slow = StrategyEngine._compute_ema(closes, slow)
        n = len(closes)
        macd_line = [None] * n
        for i in range(n):
            if ema_fast[i] is not None and ema_slow[i] is not None:
                macd_line[i] = ema_fast[i] - ema_slow[i]

        valid_idx = [i for i, v in enumerate(macd_line) if v is not None]
        signal_line = [None] * n
        if valid_idx:
            valid_macd = [macd_line[i] for i in valid_idx]
            ema_signal = StrategyEngine._compute_ema(valid_macd, signal)
            for pos, real_idx in enumerate(valid_idx):
                signal_line[real_idx] = ema_signal[pos]
        return macd_line, signal_line

    @staticmethod
    def _rsi_macd_signals(closes: list) -> tuple:
        """
        "Backtrader Standard" motoru: momentum/dönüş odaklı bir strateji —
        SMA5/20 trend-takibinden KASITLI OLARAK farklı bir mantık kullanır.
        AL: MACD, sinyal çizgisini YUKARI keser VE RSI henüz aşırı-alım
        bölgesinde değil (<60) — momentum yeni dönüyor, geç kalınmamış.
        SAT: MACD sinyal çizgisini AŞAĞI keser YA DA RSI aşırı-alım
        bölgesine (>75) ulaşır (momentum tükenmeden kâr realizasyonu).
        """
        n = len(closes)
        rsi = StrategyEngine._compute_rsi(closes, 14)
        macd_line, signal_line = StrategyEngine._compute_macd(closes, 12, 26, 9)

        buy_signals = [False] * n
        sell_signals = [False] * n
        for i in range(1, n):
            if (macd_line[i] is not None and signal_line[i] is not None and
                    macd_line[i - 1] is not None and signal_line[i - 1] is not None):
                macd_cross_up = macd_line[i] > signal_line[i] and macd_line[i - 1] <= signal_line[i - 1]
                macd_cross_down = macd_line[i] < signal_line[i] and macd_line[i - 1] >= signal_line[i - 1]
                rsi_ok = rsi[i] is None or rsi[i] < 60.0
                buy_signals[i] = macd_cross_up and rsi_ok
                rsi_overbought = rsi[i] is not None and rsi[i] > 75.0
                sell_signals[i] = macd_cross_down or rsi_overbought
        return buy_signals, sell_signals

    @staticmethod
    def calculate_metrics(data: list, engine_id: str = "optipulse") -> dict:
        """
        Calculates strategy backtest metrics on historical BIST OHLCV data,
        using the signal-generation logic selected by `engine_id`:
          - "optipulse"  -> SMA5/SMA20 trend-following crossover (original)
          - "backtrader" -> RSI(14) + MACD(12,26,9) momentum/reversal combo
          - anything else -> falls back to "optipulse" (safe default)

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

        if engine_id == "backtrader":
            buy_signals, sell_signals = StrategyEngine._rsi_macd_signals(closes)
        else:
            buy_signals, sell_signals = StrategyEngine._sma_crossover_signals(closes)

        # Simulate trades — bu ortak muhasebe döngüsü her iki motor için de
        # AYNI (yalnızca buy_signals/sell_signals farklı üretiliyor), böylece
        # equity/drawdown/win-rate hesapları iki motor arasında asla
        # birbirinden sapmıyor; fark yalnızca AL/SAT kararlarının kendisinde.
        position = False
        entry_price = 0.0
        entry_date = ""
        entry_idx = 0
        trades = []
        initial_capital = 100000.0
        cash = initial_capital
        equity_curve = []

        for i in range(len(data)):
            if i == 0:
                equity_curve.append(cash)
                continue

            current_price = closes[i]

            if buy_signals[i] and not position:
                position = True
                entry_price = current_price
                entry_date = dates[i]
                entry_idx = i
            elif sell_signals[i] and position:
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
            "trades": trades,
            "engine_id": engine_id if engine_id == "backtrader" else "optipulse"
        }
