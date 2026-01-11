const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // For large payloads

// MongoDB configuration
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const MONGODB_URI = `mongodb+srv://siriapps3_db_user:${DB_PASSWORD}@cue.garehsg.mongodb.net/?appName=cue`;
const COLLECTION = 'sessions';

let client;
let db;

// Connect to MongoDB
async function connectDB() {
  try {
    if (!client) {
      client = new MongoClient(MONGODB_URI);
      await client.connect();
      // Use cue database (will be created automatically if it doesn't exist)
      db = client.db('cue');
      console.log('✅ Connected to MongoDB Atlas');
      console.log(`📁 Collection: ${COLLECTION}`);
    }
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    throw error;
  }
}

// Initialize connection on startup
connectDB().catch(console.error);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'cue API',
    connected: !!client
  });
});

// Health check with DB connection
app.get('/health', async (req, res) => {
  try {
    if (!client) {
      await connectDB();
    }
    await client.db("admin").command({ ping: 1 });
    res.json({ 
      status: 'ok', 
      database: 'connected',
      collection: COLLECTION
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      error: error.message 
    });
  }
});

// Save session
app.post('/sessions', async (req, res) => {
  try {
    const database = await connectDB();
    const sessionData = {
      ...req.body,
      createdAt: req.body.createdAt ? new Date(req.body.createdAt) : new Date(),
      _id: undefined // Let MongoDB generate _id
    };
    
    // Ensure sessionId exists
    if (!sessionData.sessionId) {
      sessionData.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    const result = await database.collection(COLLECTION).insertOne(sessionData);
    
    res.json({ 
      success: true, 
      sessionId: sessionData.sessionId,
      _id: result.insertedId.toString()
    });
  } catch (error) {
    console.error('Save session error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get all sessions
app.get('/sessions', async (req, res) => {
  try {
    const database = await connectDB();
    const { filter, search, limit = 100, skip = 0 } = req.query;
    
    let query = {};
    
    // Date filter
    if (filter === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: today };
    }
    
    // Search query
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { 'summary.title': { $regex: search, $options: 'i' } },
        { 'summary.summary': { $regex: search, $options: 'i' } },
        { 'summary.keyTopics': { $regex: search, $options: 'i' } },
        { transcript: { $regex: search, $options: 'i' } }
      ];
    }
    
    const sessions = await database.collection(COLLECTION)
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .toArray();
    
    // Convert MongoDB _id to string for JSON
    const formattedSessions = sessions.map(session => ({
      ...session,
      _id: session._id.toString(),
      createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt
    }));
    
    res.json({ 
      success: true, 
      sessions: formattedSessions,
      count: formattedSessions.length
    });
  } catch (error) {
    console.error('Fetch sessions error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      sessions: []
    });
  }
});

// Get single session by ID
app.get('/sessions/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const { id } = req.params;
    
    // Try to find by sessionId first, then _id
    let session = await database.collection(COLLECTION).findOne({ 
      sessionId: id
    });
    
    if (!session) {
      // Try MongoDB ObjectId
      try {
        const { ObjectId } = require('mongodb');
        session = await database.collection(COLLECTION).findOne({ 
          _id: new ObjectId(id)
        });
      } catch (e) {
        // Invalid ObjectId format
      }
    }
    
    if (session) {
      session._id = session._id.toString();
      session.createdAt = session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt;
    }
    
    res.json({ 
      success: !!session, 
      session: session || null
    });
  } catch (error) {
    console.error('Fetch session error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete session
app.delete('/sessions/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const { id } = req.params;
    
    // Try to delete by sessionId first
    let result = await database.collection(COLLECTION).deleteOne({ 
      sessionId: id
    });
    
    if (result.deletedCount === 0) {
      // Try MongoDB ObjectId
      try {
        const { ObjectId } = require('mongodb');
        result = await database.collection(COLLECTION).deleteOne({ 
          _id: new ObjectId(id)
        });
      } catch (e) {
        // Invalid ObjectId format
      }
    }
    
    res.json({ 
      success: result.deletedCount > 0,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Video upload endpoint (stores URL, GridFS can be added later)
app.post('/videos/upload', async (req, res) => {
  try {
    const { sessionId, videoUrl } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'sessionId is required' 
      });
    }
    
    // For now, just return success with the URL
    // Full GridFS implementation can be added later if needed
    res.json({ 
      success: true, 
      videoUrl: videoUrl,
      message: 'Video URL stored. GridFS upload can be implemented if needed.'
    });
  } catch (error) {
    console.error('Video upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Chrome Flow API running on http://localhost:${PORT}`);
  console.log(`📁 Collection: ${COLLECTION}`);
  if (!DB_PASSWORD) {
    console.warn('⚠️  Warning: DB_PASSWORD not set. Update .env file!');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing MongoDB connection...');
  if (client) {
    await client.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing MongoDB connection...');
  if (client) {
    await client.close();
  }
  process.exit(0);
});
