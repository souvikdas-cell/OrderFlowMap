# Handover: OrderFlowMap + OpenAlgo + Fyers (2026-09-08)

Owner: Souvik Das (GitHub souvikdas-cell). Goal: Bookmap-style order flow heatmap on Nifty futures using live Fyers data.

## What exists and where

| Piece | Location | State |
|---|---|---|
| OrderFlowMap (single index.html, MIT, forked from Azhagesan-dev) | `D:\Claude\Projects\OrderFlowMap` | Pushed to https://github.com/souvikdas-cell/OrderFlowMap. Remote `origin` = Souvik, `upstream` = original author. |
| Hosted copy | Cloudflare Workers, static assets via Connect-to-Git | Every push to `main` redeploys. `wrangler.toml` + `.assetsignore` in repo. If URL missing: Settings > Domains & Routes > enable workers.dev. |
| OpenAlgo (broker bridge) | `D:\Claude\Projects\openalgo`, venv at `venv\` | Installed, Fyers keys in `.env` (lines 10-11), Souvik has created his OpenAlgo admin login and completed Fyers login. Contract master downloaded (77k NFO rows). |
| Render deploy (optional, unpushed, untested) | `D:\Claude\Projects\openalgo-render` | render.yaml, build.sh, start.sh, make_env.py, router.py. Souvik said "No docker", so this uses Render's native Python runtime. Needs an empty GitHub repo `openalgo-render` and Starter plan (persistent disk). |

## How to run locally

```
cd D:\Claude\Projects\openalgo
.\venv\Scripts\python.exe app.py
```
Starts dashboard on http://127.0.0.1:5000 and the market-data WebSocket on ws://127.0.0.1:8765 (app.py launches the proxy itself, no second process needed). Logs go to `D:\Claude\Projects\openalgo-app.log` when started the way above, plus `openalgo\log\errors.jsonl`.

Fyers token expires nightly around 03:00 IST. Each trading day: open dashboard, click Login, approve on Fyers.

OpenAlgo API key: dashboard > http://127.0.0.1:5000/apikey. Souvik pastes it into OrderFlowMap himself.

## Connecting OrderFlowMap

Live panel: URL `ws://127.0.0.1:8765`, API key, symbol `NIFTY29SEP26FUT` (current month; Oct = `NIFTY27OCT26FUT`), exchange NFO (auto-selected now for FUT/CE/PE symbols), tick `0.10` (Nifty futures tick is 0.10, README's 0.05 is stale). Reliance on NSE works as a sanity check.

The hosted https page can talk to ws://127.0.0.1 because Chrome exempts loopback from mixed-content blocking. Firefox will not. Only works on the laptop running OpenAlgo.

## Fixes made today (all in index.html, all pushed)

1. Timestamp unit. Fyers adapter sends `timestamp` in seconds, no `ltt`. Code assumed ms and divided by 1000, plotting everything in 1970. Now normalises: if value < 1e11 treat as seconds.
2. Volume missing from Fyers depth messages, so volume-delta trade detection never fired (no bubbles, CVD, VWAP, volume profile). Now subscribes to mode 3 (Depth) AND mode 2 (Quote) and merges into `liveMerged`. Depth-only ticks never seed the volume baseline (prevents a fake day-size first trade). Verified with synthetic ticks in browser.
3. Exchange auto-switch NSE->NFO / BSE->BFO when symbol ends in FUT or digits+CE/PE. Both failed Nifty attempts were due to NSE being left selected.

Office WiFi blocks PyPI wheel downloads (403 block page). Installs need phone hotspot. Running works on office WiFi.

## Open items / next asks from Souvik

1. Verify on the live market (fixes were pushed at ~13:50 IST, Souvik had not yet confirmed Nifty with bubbles/CVD working).
2. "Past data": heatmap (depth) cannot be backfilled from any broker. Plan agreed in principle: (a) session recording to IndexedDB with replay and a Sessions panel; (b) backfill price/volume/VWAP from OpenAlgo `/api/v1/history` 1-min candles on connect. Not started.
3. Render hosting: decide later, files ready.
4. Possible Route B: Python bridge emitting OpenAlgo WS protocol from Choice/FinX feed (Choice is not an OpenAlgo broker). Not started, feasibility unverified.

## OpenAlgo WS protocol (what OrderFlowMap speaks)

Send `{"action":"authenticate","api_key":"..."}` -> expect `{"message":"Authentication successful"}`.
Send `{"action":"subscribe","symbol":"NIFTY29SEP26FUT","exchange":"NFO","mode":3,"depth":5}` and same with `mode:2`.
Receive `{"type":"market_data","symbol","exchange","mode","data":{ltp, volume (mode 2 only on Fyers), timestamp (sec), depth:{buy:[{price,quantity,orders}],sell:[...]}}}`.

## Secrets

Never in this file or the repo. Fyers App ID / Secret live only in `openalgo\.env`. Souvik pasted the secret into a chat earlier; recommended he regenerate it at myapi.fyers.in.
