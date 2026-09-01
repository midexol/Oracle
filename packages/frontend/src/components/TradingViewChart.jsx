import React, { useEffect, useRef } from "react";

const ASSET_SYMBOLS = {
  BTC: "BINANCE:BTCUSDT",
  ETH: "BINANCE:ETHUSDT",
  SOL: "BINANCE:SOLUSDT",
  AVAX: "BINANCE:AVAXUSDT",
};

export function assetToSymbol(asset) {
  return ASSET_SYMBOLS[asset?.toUpperCase()] || "BINANCE:BTCUSDT";
}

export function marketToSymbol(market) {
  const asset = market?.split(" ")[0]?.toUpperCase();
  return assetToSymbol(asset);
}

export function marketToInterval(market) {
  if (market?.includes("15M")) return "15";
  if (market?.includes("1H")) return "60";
  if (market?.includes("4H")) return "240";
  return "D";
}

export default function TradingViewChart({ symbol = "BINANCE:BTCUSDT", interval = "15", height = 380 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      backgroundColor: "#0D1016",
      gridColor: "rgba(255,255,255,0.06)",
      allow_symbol_change: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });

    const wrapper = document.createElement("div");
    wrapper.className = "tradingview-widget-container";
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";
    wrapper.appendChild(widgetDiv);
    wrapper.appendChild(script);

    el.appendChild(wrapper);

    return () => {
      el.innerHTML = "";
    };
  }, [symbol, interval]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.07)",
        background: "#0D1016",
      }}
    />
  );
}
