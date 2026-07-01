# Tencent CloudBase Frontend Hosting

CloudBase can host the static dashboard pages while Alibaba Cloud SAE runs the backend API.

## Files To Upload

Upload these frontend files to CloudBase static hosting:

```text
index.html
us.html
china.html
hong-kong.html
crypto.html
china-hk.html
styles.css
app.js
model.js
config.js
```

Do not upload:

```text
server.py
market-history.json
tests/
deploy/
docs/
```

## Configure API Backend URL

Edit `config.js` before uploading to CloudBase:

```js
window.MARKET_INDICATORS_CONFIG = {
  API_BASE_URL: "https://<your-sae-backend-domain>",
  ACCESS_TOKEN: "",
};
```

Leave `ACCESS_TOKEN` empty. When the backend returns 401, the page asks for the token and stores it on the current device.

## Backend CORS Setting

In Alibaba Cloud SAE, set:

```text
CORS_ALLOWED_ORIGIN=https://<your-cloudbase-domain>
```

The backend will allow CloudBase-hosted pages to call:

```text
/api/quotes
/api/history
```

## Local Mode Still Works

For local development, keep `API_BASE_URL` empty in `config.js` and run:

```bash
python3 server.py
```

Then open:

```text
http://127.0.0.1:8787/index.html
```
