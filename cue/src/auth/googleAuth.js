// Google OAuth helper for Cue Dashboard
// Uses Google Identity Services (GIS) for client-side OAuth

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';

// Storage keys
const STORAGE_KEYS = {
  TOKEN: 'cue_google_token',
  USER: 'cue_google_user',
  EXPIRY: 'cue_token_expiry',
};

// Get stored user
// Returns user even if token expired — keeps user logged in visually.
// Token validity should be checked separately when making API calls.
export function getStoredUser() {
  try {
    const userStr = localStorage.getItem(STORAGE_KEYS.USER);
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (e) {
    console.error('[cue] Error getting stored user:', e);
    return null;
  }
}

// Check if the stored token is still valid
export function isTokenExpired() {
  try {
    const expiry = localStorage.getItem(STORAGE_KEYS.EXPIRY);
    if (!expiry) return true;
    return Date.now() > parseInt(expiry, 10);
  } catch {
    return true;
  }
}

// Get stored token (returns null if expired, but does NOT clear user data)
export function getStoredToken() {
  try {
    const expiry = localStorage.getItem(STORAGE_KEYS.EXPIRY);
    if (expiry && Date.now() > parseInt(expiry, 10)) {
      return null;
    }
    return localStorage.getItem(STORAGE_KEYS.TOKEN);
  } catch (e) {
    return null;
  }
}

// Store auth data
export function storeAuth(token, user, expiresIn = 3600) {
  try {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    localStorage.setItem(STORAGE_KEYS.EXPIRY, String(Date.now() + expiresIn * 1000));
  } catch (e) {
    console.error('[cue] Error storing auth:', e);
  }
}

// Clear auth data
export function clearAuth() {
  try {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.EXPIRY);
  } catch (e) {
    console.error('[cue] Error clearing auth:', e);
  }
}

// Initialize Google OAuth popup
export function initGoogleAuth(onSuccess, onError) {
  if (!GOOGLE_CLIENT_ID) {
    onError(new Error('Google Client ID not configured. Add REACT_APP_GOOGLE_CLIENT_ID to .env'));
    return;
  }

  // Load Google Identity Services script
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;

  script.onload = () => {
    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (response.credential) {
            // Decode JWT to get user info
            const payload = decodeJwt(response.credential);
            const user = {
              id: payload.sub,
              email: payload.email,
              name: payload.name,
              picture: payload.picture,
            };

            storeAuth(response.credential, user, 3600);
            onSuccess(user);
          } else {
            onError(new Error('No credential received'));
          }
        },
      });

      // Trigger the sign-in popup
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // Fallback to OAuth popup
          startOAuthPopup(onSuccess, onError);
        }
      });
    } catch (e) {
      onError(e);
    }
  };

  script.onerror = () => {
    onError(new Error('Failed to load Google Identity Services'));
  };

  document.body.appendChild(script);
}

// OAuth popup fallback using implicit flow
function startOAuthPopup(onSuccess, onError) {
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
        onError(new Error('Popup closed'));
        return;
      }

      if (popup.location.href.includes(redirectUri)) {
        clearInterval(pollTimer);

        // Extract token from hash
        const hash = popup.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const expiresIn = parseInt(params.get('expires_in') || '3600', 10);

        popup.close();

        if (accessToken) {
          // Fetch user info
          fetchUserInfo(accessToken)
            .then((user) => {
              storeAuth(accessToken, user, expiresIn);
              onSuccess(user);
            })
            .catch(onError);
        } else {
          onError(new Error('No access token in response'));
        }
      }
    } catch (e) {
      // Cross-origin errors are expected until redirect
    }
  }, 500);
}

// Fetch user info from Google API
async function fetchUserInfo(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }

  const data = await response.json();
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    picture: data.picture,
  };
}

// Decode JWT payload (for Google ID token)
function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('[cue] Error decoding JWT:', e);
    return {};
  }
}

// Check if URL has OAuth redirect params (for handling redirect flow)
export function handleOAuthRedirect() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return null;

  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in') || '3600', 10);

  if (accessToken) {
    // Clear hash from URL
    window.history.replaceState(null, '', window.location.pathname);
    return { accessToken, expiresIn };
  }

  return null;
}
