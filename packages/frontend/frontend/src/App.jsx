import React, { useState, useEffect } from "react";
import OracleLanding from "./components/OracleLanding";
import OracleDashboard from "./components/OracleDashboard";

export default function App() {
  const [route, setRoute] = useState("landing"); // "landing" | "app"

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return route === "landing" ? (
    <OracleLanding onLaunch={() => setRoute("app")} />
  ) : (
    <OracleDashboard onExit={() => setRoute("landing")} />
  );
}
