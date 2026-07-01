window.MARKET_INDICATORS_CONFIG = {
  // DATA_MODE:
  // - "auto": local localhost uses API; hosted pages use static data files.
  // - "static": always read data/latest.json and data/history.json.
  // - "api": always call /api/quotes and /api/history.
  DATA_MODE: "auto",

  // For static hosting, keep empty to read same-origin data/*.json files.
  // Set this only if snapshots are served from another origin.
  DATA_BASE_URL: "",

  // Keep empty for local same-origin API usage. If using a separate backend,
  // set this to the backend origin, for example:
  // API_BASE_URL: "https://market-indicators.example.com"
  API_BASE_URL: "",

  // Leave empty for normal use. If the backend has DASHBOARD_ACCESS_TOKEN set,
  // the app will ask for the token once and save it on the current device.
  ACCESS_TOKEN: "",
};
