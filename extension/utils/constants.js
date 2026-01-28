// API Configuration (use Vite env vars; do not hardcode keys)
export const CONFIG = {
  // Gemini API
  GEMINI_API_KEY: import.meta.env.VITE_GEMINI_API_KEY || '',
  GEMINI_API_URL:
    import.meta.env.VITE_GEMINI_API_URL ||
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash',
  
  // Veo 3 API
  VEO_API_KEY: import.meta.env.VITE_VEO_API_KEY || '',
  VEO_API_URL:
    import.meta.env.VITE_VEO_API_URL ||
    'https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001',
  
  // Processing states
  STATES: {
    IDLE: 'idle',
    RECORDING: 'recording',
    TRANSCRIBING: 'transcribing',
    SUMMARIZING: 'summarizing',
    GENERATING_VIDEO: 'generating_video',
    COMPLETE: 'complete',
    ERROR: 'error'
  },
  
  // Video styles for Gemini to choose from
  VIDEO_STYLES: {
    ANIMATED_DIAGRAM: 'animated_diagram',
    WHITEBOARD: 'whiteboard',
    PRESENTER: 'presenter',
    STORY: 'story'
  },
  
  // Default video duration in seconds
  DEFAULT_VIDEO_DURATION: 45,
  MAX_VIDEO_DURATION: 60,
  MIN_VIDEO_DURATION: 30,
  
  // MongoDB Backend API
  // For local development: 'http://localhost:3000'
  // For production: 'https://your-deployed-api.vercel.app' (or Railway/Render URL)
  MONGODB_API_URL: 'http://localhost:3000',
  MONGODB_API_KEY: '', // Not needed for backend API approach
  
  // Library URL - React app "cue" running on localhost
  LIBRARY_URL: 'http://localhost:3001' // Change port if your React app uses a different one
};

export default CONFIG;
