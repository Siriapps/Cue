import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { clearAuth } from '../auth/googleAuth';

function DashboardLayout({ user, children, searchQuery, setSearchQuery, dashboardConnected }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  const handleRecordNew = () => {
    alert('Use the cue extension on any webpage to record a session.\n\nClick "Start Session" in the floating halo strip.');
  };

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/library':
        return 'Meeting Session History';
      case '/activity':
        return 'AI Task Automation';
      case '/mosaic':
        return 'Mosaic Field';
      case '/settings':
        return 'Settings';
      case '/reels':
        return 'Reels Feed';
      default:
        return 'Dashboard';
    }
  };

  const getPageSubtitle = () => {
    switch (location.pathname) {
      case '/library':
        return 'Manage and review your AI-enhanced workspaces.';
      case '/activity':
        return 'Observing agentic workflows in real-time.';
      default:
        return '';
    }
  };

  const isMosaicPage = location.pathname === '/mosaic';

  return (
    <div className={`library-app${sidebarExpanded ? ' sidebar-expanded' : ''}${isMosaicPage ? ' mosaic-fullscreen' : ''}`}>
      {/* Sidebar */}
      <div className="library-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" fill="url(#logoGradSidebar)" />
              <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="14" r="2" fill="white"/>
              <defs>
                <linearGradient id="logoGradSidebar" x1="2" y1="2" x2="22" y2="22">
                  <stop stopColor="#6366f1"/>
                  <stop offset="1" stopColor="#8b5cf6"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="sidebar-brand-text">cue</span>
        </div>

        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={() => setSidebarExpanded((e) => !e)}
          title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {sidebarExpanded ? (
              <polyline points="15 18 9 12 15 6" />
            ) : (
              <polyline points="9 18 15 12 9 6" />
            )}
          </svg>
        </button>

        <div className="sidebar-nav">
          <NavLink
            to="/library"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="Library"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span>Library</span>
          </NavLink>
          <NavLink
            to="/reels"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="Reels"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="18" rx="2"/>
              <path d="M8 21V3M16 21V3M2 12h20"/>
            </svg>
            <span>Reels</span>
          </NavLink>
          <NavLink
            to="/activity"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="AI Task Automation"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span>AI Task Automation</span>
          </NavLink>
          <NavLink
            to="/mosaic"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="Mosaic"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
            </svg>
            <span>Mosaic</span>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span>Settings</span>
          </NavLink>
        </div>

        {/* User section: avatar + menu (stitch reference) */}
        {user && (
          <div className="sidebar-user">
            <div
              className="user-profile-btn"
              onClick={() => setShowUserMenu(!showUserMenu)}
              title={user.name || user.email}
            >
              {user.picture ? (
                <img
                  src={user.picture}
                  alt=""
                  className="sidebar-user-avatar"
                />
              ) : (
                <div className="sidebar-user-avatar placeholder">
                  {(user.name || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="user-info">
                <span className="user-name">{user.name || 'User'}</span>
                <span className="user-email">{user.email || ''}</span>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="chevron">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>

            {showUserMenu && (
              <div className="user-menu">
                <button onClick={handleLogout} className="user-menu-item logout">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content - stitch liquid bg */}
      <div className={`library-main liquid-bg${isMosaicPage ? ' mosaic-main' : ''}`}>
        {/* Top bar: Cue AI logo, search, Halo Strip, Start Session, Go Live (hidden on Mosaic) */}
        {!isMosaicPage && (
          <div className="dashboard-topbar">
            <div className="topbar-brand">
              <div className="topbar-logo">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" fill="url(#logoGradTopbar)" />
                  <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="12" cy="14" r="2" fill="white"/>
                  <defs>
                    <linearGradient id="logoGradTopbar" x1="2" y1="2" x2="22" y2="22">
                      <stop stopColor="#6366f1"/>
                      <stop offset="1" stopColor="#8b5cf6"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <span className="topbar-brand-text">Cue AI</span>
            </div>
            <div className="topbar-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder={location.pathname === '/activity' ? 'Search tasks, meetings, or files…' : 'Search sessions…'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="topbar-actions">
              <button type="button" className="topbar-btn halo-strip" title="Halo Strip (use extension on page)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 7l-7 5 7 5V7z"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <span>Halo Strip</span>
              </button>
              <button type="button" className="topbar-btn start-session" onClick={handleRecordNew}>
                <span>Start Session</span>
              </button>
              <button type="button" className="topbar-btn go-live" title="Go Live">
                <span className="live-dot"></span>
                <span>Go Live</span>
              </button>
              {dashboardConnected && (
                <div className="connection-indicator connected" title="Connected to server">
                  <span className="connection-dot"></span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Page title row (hidden on Mosaic) */}
        {!isMosaicPage && (
          <header className="library-header">
            <h1 className="library-title">{getPageTitle()}</h1>
          </header>
        )}

        {/* Page Content */}
        {children}
      </div>
    </div>
  );
}

export default DashboardLayout;
