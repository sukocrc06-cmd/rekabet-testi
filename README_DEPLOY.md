# OptiPulseLab Backend Cloud Deployment Guide

This guide describes how to deploy the OptiPulseLab backend engine to a 24/7 cloud environment using platforms like **Render.com** or **Railway.app**.

---

## 1. Cloud-Native Preparation Check

The backend has been configured to be fully stateless and dynamic:
1. **Dynamic Port Binding**: Added a runner block at the bottom of [main.py](file:///c:/Users/sukru/OneDrive/Desktop/rekabet%20testi/backend/main.py) which automatically checks the environment variable `PORT` injected by your cloud host (defaulting to `8000` for local runs).
2. **Stateless Logic**: The calculations in [engine.py](file:///c:/Users/sukru/OneDrive/Desktop/rekabet%20testi/backend/engine.py) are purely mathematical and require no local databases or filesystem paths.
3. **Dependency Mapping**: Created a root-level [requirements.txt](file:///c:/Users/sukru/OneDrive/Desktop/rekabet%20testi/requirements.txt) to automatically provision the necessary packages on Linux cloud instances.

---

## 2. Cloud Service Commands

When creating a new Web Service on **Render.com** or **Railway.app**, use the following configuration commands:

| Command Class | Value / Command | Notes |
| :--- | :--- | :--- |
| **Build Command** | `pip install -r requirements.txt` | Automatically resolves and builds Linux packages. |
| **Start Command** | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` | Binds FastAPI globally on the host. |

*Note: On Railway, the environment variable `$PORT` is handled automatically. On Render, they automatically expose `$PORT` to the starting command.*

---

## 3. Step-by-Step Deployment Instructions

### Option A: Hosting on Render.com (Recommended)
1. **Prepare Repository**: Commit your changes (including `requirements.txt` and `backend/main.py`) and push them to your GitHub repository.
2. **Create Render Account**: Sign up at [Render.com](https://render.com) using your GitHub account.
3. **Create Web Service**:
   - In the Render dashboard, click **New** -> **Web Service**.
   - Connect your GitHub account and select your repository.
4. **Configure Settings**:
   - **Name**: `optipulselab-backend`
   - **Runtime**: `Python 3` (or Python version 3.10+)
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
5. **Deploy**: Click **Create Web Service**. Render will build the container and deploy the service. Your live URL will look like `https://optipulselab-backend.onrender.com`.

### Option B: Hosting on Railway.app
1. **Sign Up**: Register at [Railway.app](https://railway.app) using your GitHub credentials.
2. **New Project**: Click **New Project** -> **Deploy from GitHub repo**.
3. **Select Repo**: Link your repository.
4. **Deploy Settings**: Railway detects the Python code and `requirements.txt` automatically.
5. **Configure Start Command**: If needed, go to **Settings** -> **Start Command** and override it with:
   `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
6. **Generate Domain**: Go to **Settings** -> **Domains** -> click **Generate Domain** to get your public API URL.

---

## 4. Connecting Your Frontend Client

Once your backend is running 24/7 in the cloud:
1. Copy your public API URL (e.g., `https://optipulselab-backend.onrender.com`).
2. Open your frontend [app.js](file:///c:/Users/sukru/OneDrive/Desktop/rekabet%20testi/app.js) and [dataController.js](file:///c:/Users/sukru/OneDrive/Desktop/rekabet%20testi/dataController.js).
3. Replace all local calls to `http://127.0.0.1:8000` with your new cloud URL.
   *Example:*
   ```diff
   - fetch('http://127.0.0.1:8000/api/v1/backtest/run', ...
   + fetch('https://optipulselab-backend.onrender.com/api/v1/backtest/run', ...
   ```
4. Now, your frontend dashboard will work from any browser on any computer, independent of your local laptop's running state!
