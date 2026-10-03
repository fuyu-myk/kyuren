import React from "react";
import ReactDOM from "react-dom/client";
import { Island } from "@/island/Island";
import "@/island/island.css";
import "@/island/lists.css";
import "@/island/shortcuts.css";
import "@/island/shelf.css";
import "@/island/voice.css";
import "@/island/glance.css";
import "@/island/coding-detail.css";
import "@/island/wings.css";

const root = document.getElementById("island");
if (!root) {
  throw new Error("island root element missing from island.html");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Island />
  </React.StrictMode>,
);
