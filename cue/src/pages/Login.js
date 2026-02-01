import React, { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { storeAuth } from '../auth/googleAuth';
import './Login.css';

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';

function Login({ onLogin }) {
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    const particles = [];
    const particleCount = 60;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      for (let i = 0; i < particleCount; i++) {
        particles[i] = {
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 2 + 0.5,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          opacity: Math.random() * 0.4 + 0.1,
        };
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(139, 92, 246, ' + (p.opacity * 0.6 * (0.6 + 0.4 * Math.sin(Date.now() * 0.002 + p.x))) + ')';
        ctx.fill();
      });
      animationId = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    draw();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  const handleMouseMove = (e) => {
    setMouse({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
  };

  const handleGoogleSignIn = () => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Google OAuth not configured. Please add REACT_APP_GOOGLE_CLIENT_ID to your .env file.');
      return;
    }

    setIsLoading(true);
    setError('');

    const SCOPES = [
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/tasks',
    ].join(' ');

    const redirectUri = window.location.origin + '/login';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&prompt=consent`;

    // Open popup
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      authUrl,
      'google-auth',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // Poll for redirect
    const pollTimer = setInterval(() => {
      try {
        if (!popup || popup.closed) {
          clearInterval(pollTimer);
          setIsLoading(false);
          return;
        }

        // Check if popup navigated to our redirect URI
        const popupUrl = popup.location.href;
        if (popupUrl.startsWith(redirectUri)) {
          clearInterval(pollTimer);

          // Extract token from hash
          const hash = popup.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          const expiresIn = parseInt(params.get('expires_in') || '3600', 10);

          popup.close();

          if (accessToken) {
            // Fetch user info
            fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            })
              .then((res) => res.json())
              .then((userData) => {
                const user = {
                  id: userData.id,
                  email: userData.email,
                  name: userData.name,
                  picture: userData.picture,
                };
                storeAuth(accessToken, user, expiresIn);
                setIsLoading(false);
                if (onLogin) {
                  onLogin(user);
                }
              })
              .catch((err) => {
                console.error('[cue] Failed to fetch user info:', err);
                setError('Failed to get user information');
                setIsLoading(false);
              });
          } else {
            setError('No access token received');
            setIsLoading(false);
          }
        }
      } catch (e) {
        // Cross-origin errors are expected until redirect completes
      }
    }, 500);

    // Timeout after 2 minutes
    setTimeout(() => {
      clearInterval(pollTimer);
      if (isLoading) {
        setIsLoading(false);
        setError('Sign in timed out. Please try again.');
      }
    }, 120000);
  };

  const handleBack = () => {
    navigate('/');
  };

  return (
    <div className="login-page" onMouseMove={handleMouseMove}>
      {/* Floating orbs */}
      <div className="login-orb login-orb-1" />
      <div className="login-orb login-orb-2" />
      <div className="login-orb login-orb-3" />

      <div
        className="login-bg-gradient"
        style={{
          background: 'radial-gradient(ellipse at ' + (mouse.x * 100) + '% ' + (mouse.y * 100) + '%, rgba(139, 92, 246, 0.12) 0%, rgba(99, 102, 241, 0.08) 40%, rgba(124, 58, 237, 0.05) 70%, transparent 100%)',
        }}
      />
      <canvas ref={canvasRef} className="login-particles" aria-hidden="true" />
      <div className="login-bg-animated" />

      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="login-card-inner">
          <div className="login-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" fill="url(#loginLogoGrad)" />
              <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="14" r="2" fill="white" />
              <defs>
                <linearGradient id="loginLogoGrad" x1="2" y1="2" x2="22" y2="22">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h2 className="login-title">Sign in to cue</h2>
          <p className="login-subtitle">Your AI-powered workspace assistant</p>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            type="button"
            className="login-google-btn"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className="login-spinner" />
                Signing in...
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </>
            )}
          </button>

          <button type="button" className="login-back" onClick={handleBack}>
            Back to home
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default Login;
