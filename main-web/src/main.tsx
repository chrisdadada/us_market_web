import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./calendar.css";
import "./stocks.css";
import "./marketFunds.css";
import "./tracking.css";
import "./article.css";
import "./opinions.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
