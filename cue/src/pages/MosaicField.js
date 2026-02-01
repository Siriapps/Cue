import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { config } from '../config';

const ADK_API_URL = config.API_BASE_URL;

function MosaicField() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${ADK_API_URL}/sessions?limit=50`)
      .then((res) => res.ok ? res.json() : { sessions: [] })
      .then((data) => {
        if (!cancelled) setSessions(data.sessions || []);
      })
      .catch(() => { if (!cancelled) setSessions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const recent = sessions.slice(0, 6);
  const priority = sessions.filter((s) => (s.summary?.sentiment || '').toLowerCase() === 'urgent' || (s.summary?.action_items?.length || 0) > 2).slice(0, 4);
  const waiting = sessions.filter((s) => (s.summary?.action_items || []).some((a) => (a.task || a.action || '').toLowerCase().includes('wait'))).slice(0, 4);

  if (loading) {
    return (
      <div className="sessions-container">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mosaic-field">
      <h2 className="sections-title">Mosaic Field</h2>
      <div className="mosaic-grid">
        <motion.div className="mosaic-card mosaic-deep" layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <h3>Deep Work</h3>
          <p>Current focus and live progress</p>
          <p className="mosaic-muted">Start a session from the extension to see live progress here.</p>
        </motion.div>
        <motion.div className="mosaic-card mosaic-priority" layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
          <h3>Priority</h3>
          <p>{priority.length} session(s) with urgent or many action items</p>
          {priority.slice(0, 2).map((s, i) => (
            <div key={s.sessionId || i} className="mosaic-item">{s.title || 'Session'}</div>
          ))}
        </motion.div>
        <motion.div className="mosaic-card mosaic-recent" layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
          <h3>Recent</h3>
          <p>Quick access to latest sessions</p>
          {recent.slice(0, 3).map((s, i) => (
            <div key={s.sessionId || i} className="mosaic-item">{s.title || 'Session'}</div>
          ))}
        </motion.div>
        <motion.div className="mosaic-card mosaic-waiting" layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
          <h3>Waiting</h3>
          <p>Tasks pending others</p>
          {waiting.length === 0 ? <p className="mosaic-muted">None</p> : waiting.slice(0, 2).map((s, i) => (
            <div key={s.sessionId || i} className="mosaic-item">{s.title || 'Session'}</div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

export default MosaicField;
