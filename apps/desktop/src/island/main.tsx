import React from "react";
import ReactDOM from "react-dom/client";
import { IslandBoundary } from "@/island/boundaries";
import { Island } from "@/island/Island";
import "@/island/island.css";
import "@/island/lists.css";
import "@/island/shortcuts.css";
import "@/island/shelf.css";
import "@/island/voice.css";
import "@/island/glance.css";
import "@/island/week.css";
import "@/island/todos.css";
import "@/island/coding-detail.css";
import "@/island/asked.css";
import "@/island/wings.css";

const root = document.getElementById("island");
if (!root) {
  throw new Error("island root element missing from island.html");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <IslandBoundary>
      <Island />
    </IslandBoundary>
  </React.StrictMode>,
);
