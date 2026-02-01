import React, { useState, useEffect, useCallback } from 'react';
import { config } from '../config';

const ADK_API_URL = config.API_BASE_URL;

function GoogleActivity({ lastActivityUpdate = 0 }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`${ADK_API_URL}/google_activity?limit=100`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setActivities(data.activities || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${ADK_API_URL}/google_activity?limit=100`);
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        if (!cancelled) setActivities(data.activities || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (lastActivityUpdate > 0) fetchActivities();
  }, [lastActivityUpdate, fetchActivities]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchActivities();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchActivities]);

  // Do not show draft generation in activity (only sent/created actions)
  const filteredActivities = activities.filter(
    (a) => !(a.service === 'gmail' && a.action === 'create_draft')
  );

  const counts = filteredActivities.reduce((acc, a) => {
    const s = a.service || 'other';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const formatTime = (id) => {
    if (!id) return '';
    try {
      const date = new Date(parseInt(id.substring(0, 8), 16) * 1000);
      if (isNaN(date.getTime())) return '';
      const now = new Date();
      const diffMs = now - date;
      const mins = Math.floor(diffMs / 60000);
      const hours = Math.floor(diffMs / 3600000);
      const days = Math.floor(diffMs / 86400000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  };

  const describeActivity = (a) => {
    const service = a.service || '';
    const action = a.action || '';
    const details = a.details || {};
    if (service === 'gmail') {
      if (action === 'list_emails') return `AI listed ${details.count || 0} emails`;
      if (action === 'read_email') return 'AI read an email';
      if (action === 'send_email') return `AI sent email: ${details.subject || 'email'}`;
      if (action === 'draft_reply') return 'AI drafted a reply';
      if (action === 'get_recent_threads') return `AI fetched ${details.count || 0} threads`;
    }
    if (service === 'calendar') {
      if (action === 'list_events') return `AI listed ${details.count || 0} events`;
      if (action === 'create_event') return `AI created event: ${details.summary || 'event'}`;
      if (action === 'get_next_event') return 'AI fetched next event';
    }
    if (service === 'drive') {
      if (action === 'list_files') return `AI listed ${details.count || 0} files`;
      if (action === 'create_file') return `AI created file: ${details.name || 'file'}`;
      if (action === 'share_file') return `AI shared file with ${details.email || ''}`;
    }
    if (service === 'docs') {
      if (action === 'create_document') return `AI created doc: ${details.title || 'doc'}`;
      if (action === 'append_to_doc') return 'AI appended to doc';
    }
    if (service === 'sheets') {
      if (action === 'create_sheet') return `AI created sheet: ${details.title || 'sheet'}`;
    }
    if (service === 'tasks') {
      if (action === 'create_task') return `AI created task: ${details.title || 'task'}`;
    }
    return `AI ${action} (${service})`;
  };

  if (loading) {
    return (
      <div className="sessions-container">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading activity...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sessions-container">
        <p className="empty-memory">Could not load activity: {error}</p>
      </div>
    );
  }

  return (
    <div className="sessions-container google-activity-container">
      <h2 className="sections-title">AI Activity in Your Google Workspace</h2>
      <div className="google-activity-cards">
        <div className="google-activity-card">
          <span className="google-activity-card-label">Gmail</span>
          <span className="google-activity-card-count">{counts.gmail || 0}</span>
        </div>
        <div className="google-activity-card">
          <span className="google-activity-card-label">Calendar</span>
          <span className="google-activity-card-count">{counts.calendar || 0}</span>
        </div>
        <div className="google-activity-card">
          <span className="google-activity-card-label">Drive</span>
          <span className="google-activity-card-count">{counts.drive || 0}</span>
        </div>
        <div className="google-activity-card">
          <span className="google-activity-card-label">Docs</span>
          <span className="google-activity-card-count">{counts.docs || 0}</span>
        </div>
        <div className="google-activity-card">
          <span className="google-activity-card-label">Sheets</span>
          <span className="google-activity-card-count">{counts.sheets || 0}</span>
        </div>
        <div className="google-activity-card">
          <span className="google-activity-card-label">Tasks</span>
          <span className="google-activity-card-count">{counts.tasks || 0}</span>
        </div>
      </div>
      <div className="google-activity-timeline">
        <h3>Activity timeline</h3>
        {filteredActivities.length === 0 ? (
          <p className="empty-memory">No AI activity yet. Use MCP tools to see actions here.</p>
        ) : (
          <ul className="google-activity-list">
            {filteredActivities.map((a, idx) => (
              <li key={a._id || idx} className="google-activity-item">
                <span className="google-activity-desc">{describeActivity(a)}</span>
                <span className="google-activity-time">{formatTime(a._id)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default GoogleActivity;
