import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/App";
import { insideTauri } from "@/tauri";
import "@/styles.css";
import "@/conversation.css";
import "@/skills.css";
import "@/projects.css";
import "@/answers.css";
import "@/island-layout.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element missing from index.html");
}

// The window is glass over whatever is behind it. In a browser there is nothing behind it, so a
// stand-in is put there to judge the dim against.
if (!insideTauri()) document.body.classList.add("preview");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
