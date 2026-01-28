import React from "react";
import { motion } from "framer-motion";

export default function PrismTaskCard({ summary }) {
  const tasks = summary?.result?.tasks || [];
  const sentiment = summary?.result?.sentiment || "Neutral";
  const urgencyClass = sentiment === "Urgent" ? "urgent" : "";

  return (
    <motion.div className={`card prism-card ${urgencyClass}`} layout>
      <div className="card-header">Prism Summary</div>
      <div className="card-subtitle">{summary?.payload?.title}</div>
      <div className="card-text">{summary?.result?.summary_tldr}</div>
      <ul className="task-list">
        {tasks.map((task, idx) => (
          <li key={`${task.action}-${idx}`} className={`task ${task.priority}`}>
            <span className="task-priority">{task.priority}</span>
            {task.action}
          </li>
        ))}
      </ul>
      <button className="draft-reply">Draft Reply</button>
    </motion.div>
  );
}
