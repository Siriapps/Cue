import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { clearAuth } from '../auth/googleAuth';
import DashboardHalo from '../components/DashboardHalo';

function DashboardLayout({ user, children, searchQuery, setSearchQuery, dashboardConnected }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showUserMenu, setShowUserMenu] = useState(false);

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
        return 'Session Library';
      case '/activity':
        return 'Google Activity';
      case '/mosaic':
        return 'Mosaic Field';
      case '/orbit':
        return 'Daily Orbit';
      case '/settings':
        return 'Settings';
      case '/avatar':
        return 'Avatar Preview';
      case '/reels':
        return 'Reels Feed';
      default:
        return 'Dashboard';
    }
  };

  return (
    <div className="library-app">
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
            to="/avatar"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="Avatar Preview"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="7" r="4"/>
              <path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>
            </svg>
            <span>Avatar</span>
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
            title="AI Actions"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <span>AI Actions</span>
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
            to="/orbit"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="Orbit"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              <circle cx="12" cy="12" r="4"/>
            </svg>
            <span>Orbit</span>
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

        <button className="nav-item record-btn" onClick={handleRecordNew} title="Record New Session">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="6" fill="white"/>
          </svg>
          <span>New Session</span>
        </button>

        {/* User Profile Section */}
        {user && (
          <div className="sidebar-user">
            <div
              className="user-profile-btn"
              onClick={() => setShowUserMenu(!showUserMenu)}
            >
              <img
                src={user.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=8b5cf6&color=fff`}
                alt={user.name}
                className="user-avatar"
              />
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

      {/* Main Content */}
      <div className="library-main">
        <DashboardHalo user={user} />
        {/* Header */}
        <header className="library-header">
          <h1 className="library-title">{getPageTitle()}</h1>
          <div className="header-actions">
            <div className="search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {dashboardConnected && (
              <div className="connection-indicator connected" title="Connected to server">
                <span className="connection-dot"></span>
              </div>
            )}
          </div>
        </header>

        {/* Page Content */}
        {children}
      </div>
    </div>
  );
}

export default DashboardLayout;
