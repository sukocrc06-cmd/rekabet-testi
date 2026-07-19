# OptiPulseLab Backend Cloud Deployment Guide

This guide describes how to deploy the OptiPulseLab backend engine (`main.py`) to a 24/7 cloud environment using platforms like **Render.com** or **Railway.app**, so the live frontend (Vercel) gets real data and a real live feed for *every* visitor — not only when your own computer happens to be running the backend locally.

> **18 Temmuz 2026 update (onuncu oturum, beşinci tur):** this guide previously referenced a `backend/` subfolder (`backend.main:app`, `backend/main.py`) that does not actually exist in this repository — `main.py` and `engine.py` live at the repo root. Those paths have been corrected below. A proper `PORT`-aware runner block was also added to the bottom of `main.py` (it didn't exist before, despite this guide previously claiming it did). Finally, connecting the frontend to your deployed backend is now a **single edit in one file** (`config.js`) instead of hunting down every hardcoded `127.0.0.1:8000` across `app.js`/`dataController.js`/`tradingChart.js`/`tradingEngine.js`/`multiChartGrid.js`.

---

## 1. Cloud-Native Preparation Check

The backend is configured to be stateless and dynamic:
1. **Dynamic Port Binding**: `main.py` now ends with `if __name__ == "__main__": uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))` — it reads the `PORT` environment variable your cloud host injects, defaulting to `8000` for local runs. (This block did not exist before this session; it's real now.)
2. **Stateless Logic**: The calculations in `engine.py` are purely mathematical and require no local databases or filesystem paths.
3. **Dependency Mapping**: `requirements.txt` at the repo root lists everything needed (`fastapi`, `uvicorn`, `pandas`, `yfinance`, `requests`, `fpdf2`, `websockets`).
4. **File layout**: `main.py`, `engine.py`, and `requirements.txt` are all at the **repository root** — there is no `backend/` subfolder. Any deploy command must reference `main:app`, not `backend.main:app`.

---

## 2. Cloud Service Commands

When creating a new Web Service on **Render.com** or **Railway.app**, use these (repo-root-relative) commands:

| Command Class | Value / Command | Notes |
| :--- | :--- | :--- |
| **Build Command** | `pip install -r requirements.txt` | Automatically resolves and builds Linux packages. |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` | Note: `main:app`, not `backend.main:app` — there's no `backend/` subfolder. |

*Note: On Railway, the environment variable `$PORT` is handled automatically. On Render, they automatically expose `$PORT` to the starting command. Either way, the `if __name__ == "__main__"` block added to `main.py` this session also means a platform that just runs `python main.py` (no custom Start Command) will still bind to the right port.*

---

## 3. Step-by-Step Deployment Instructions

### Option A: Hosting on Render.com (Recommended)
1. **Prepare Repository**: Commit your changes (including `requirements.txt` and `main.py`) and push them to your GitHub repository.
2. **Create Render Account**: Sign up at [Render.com](https://render.com) using your GitHub account.
3. **Create Web Service**:
   - In the Render dashboard, click **New** → **Web Service**.
   - Connect your GitHub account and select your repository.
4. **Configure Settings**:
   - **Name**: `optipulselab-backend`
   - **Runtime**: `Python 3` (3.10+)
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **Deploy**: Click **Create Web Service**. Render will build the container and deploy the service. Your live URL will look like `https://optipulselab-backend.onrender.com`.
   - Render's free tier spins the service down after inactivity and takes ~30-60s to wake back up on the next request — the first request after idle time may time out or feel slow. This is a free-tier characteristic, not a bug in this app.

### Option B: Hosting on Railway.app
1. **Sign Up**: Register at [Railway.app](https://railway.app) using your GitHub credentials.
2. **New Project**: Click **New Project** → **Deploy from GitHub repo**.
3. **Select Repo**: Link your repository.
4. **Deploy Settings**: Railway detects the Python code and `requirements.txt` automatically.
5. **Configure Start Command**: If needed, go to **Settings** → **Start Command** and override it with:
   `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. **Generate Domain**: Go to **Settings** → **Domains** → click **Generate Domain** to get your public API URL.

---

## 4. Connecting Your Frontend Client (now a single-file edit)

Once your backend is running 24/7 in the cloud, open **`config.js`** (new this session — every other file now reads the backend address from here, instead of each having its own hardcoded copy) and change these two lines:

```js
window.OPTIPULSE_CONFIG = {
    BACKEND_HTTP: 'https://optipulselab-backend.onrender.com',   // your Render/Railway URL, no trailing slash
    BACKEND_WS: 'wss://optipulselab-backend.onrender.com'        // same host, wss:// not ws:// (see note below)
};
```

That's it — `app.js`, `dataController.js`, `tradingChart.js`, `tradingEngine.js`, and `multiChartGrid.js` all read `window.OPTIPULSE_CONFIG` at call time, so there is nothing else to edit.

**Important — `wss://` not `ws://`:** your cloud host serves HTTPS, and browsers require encrypted WebSockets (`wss://`) from an HTTPS page — plain `ws://` will be blocked. `BACKEND_WS` must use `wss://`.

**Important — the loopback fetch option is now automatic:** every fetch call in this app used to hardcode a Chrome-specific `targetAddressSpace: 'loopback'` option, needed only because the backend used to always be `127.0.0.1`. `config.js` now detects whether `BACKEND_HTTP` is actually a loopback address (`127.0.0.1`/`localhost`) and only adds that option when it is. Once you point `BACKEND_HTTP` at your cloud URL, this is handled automatically — you do not need to remove anything manually, and you will not hit the same "local vs loopback" address-space-mismatch error class that this project ran into back in the first session.

Once `config.js` points at your cloud backend, the live Vercel site will show real market data and a real live feed for **any** visitor, not just when your own computer happens to have `main.py` running.
