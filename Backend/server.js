require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const bcrypt = require('bcryptjs'); 
const cookieParser = require('cookie-parser'); 
const jwt = require('jsonwebtoken'); 

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'your_strong_secret_key_drone_control_center_2025'; 

const io = new Server(server, { 
    cors: { 
        origin: 'http://localhost:5173',
        credentials: true,
    } 
});

// ---- Middleware ----
app.use(cookieParser());
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true,
}));
app.use(express.json());

// ---- Upload config ----
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads/theirs';
fs.mkdirSync(path.join(__dirname, UPLOAD_DIR), { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, UPLOAD_DIR)),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---- MySQL pool ----
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || '',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || '',
  waitForConnections: true,
  connectionLimit: 10,
});

// ---- Keep latest positions ----
const lastPositions = {
  ours: {},
  theirs: {}
};

// ----------------- Authentication Middleware -----------------
const requireAuth = (req, res, next) => {
    const token = req.cookies.auth_token;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized: ไม่มีการเข้าสู่ระบบ' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error('JWT Verification Failed:', err.message);
        res.clearCookie('auth_token'); 
        return res.status(401).json({ success: false, message: 'Unauthorized: Session หมดอายุ' });
    }
};

// ----------------- AUTH APIs -----------------
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    try {
        const [rows] = await pool.execute(
            `SELECT id, username, password_hash, role FROM users WHERE username = ?`,
            [username]
        );

        const user = rows[0];
        if (!user) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash); 

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        
        const eightHours = 8 * 60 * 60 * 1000;

        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: eightHours,
            sameSite: 'lax',
        });

        res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', role: user.role });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'ข้อผิดพลาดภายในเซิร์ฟเวอร์' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'ออกจากระบบสำเร็จ' });
});

app.get('/api/check-auth', requireAuth, (req, res) => {
    res.json({ success: true, isLoggedIn: true, user: { username: req.user.username, role: req.user.role } });
});

// ----------------- APIs -----------------

// Insert our drone
app.post('/api/drone-ours', requireAuth, async (req, res) => {
  const { drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path } = req.body;
  try {
    const [r] = await pool.execute(
      `INSERT INTO drone_ours (drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path]
    );

    const row = { 
      id: r.insertId, 
      drone_id, 
      confidence, 
      latitude, 
      longitude, 
      altitude, 
      weather, 
      width, 
      height, 
      image_path, 
      detected_at: new Date() 
    };
    lastPositions.ours[drone_id] = row;

    // ส่งไปทุก client ที่ subscribe drone_id นี้
    io.to(drone_id).emit('drone-ours-detected', row);
    
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Insert enemy drone (JSON)
app.post('/api/drone-theirs', requireAuth, async (req, res) => {
  const { drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path } = req.body;
  try {
    const [r] = await pool.execute(
      `INSERT INTO drone_theirs (drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path]
    );

    const row = { 
      id: r.insertId, 
      drone_id, 
      confidence, 
      latitude, 
      longitude, 
      altitude, 
      weather, 
      width, 
      height, 
      image_path, 
      detected_at: new Date() 
    };
    lastPositions.theirs[drone_id] = row;

    console.log(`📤 Emitting drone-theirs-detected to room: ${drone_id}`);
    io.to(drone_id).emit('drone-theirs-detected', row);

    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload enemy drone with image
app.post('/api/drone-theirs/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { drone_id, confidence, latitude, longitude, altitude, weather, width, height } = req.body;
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const imagePath = path.posix.join('/', UPLOAD_DIR, req.file.filename);

    const [r] = await pool.execute(
      `INSERT INTO drone_theirs (drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [drone_id, parseFloat(confidence), parseFloat(latitude), parseFloat(longitude), parseFloat(altitude), weather, parseFloat(width), parseFloat(height), imagePath]
    );

    const row = { 
      id: r.insertId, 
      drone_id, 
      confidence: parseFloat(confidence), 
      latitude: parseFloat(latitude), 
      longitude: parseFloat(longitude), 
      altitude: parseFloat(altitude), 
      weather, 
      width: parseFloat(width), 
      height: parseFloat(height), 
      image_path: imagePath, 
      detected_at: new Date() 
    };
    lastPositions.theirs[drone_id] = row;

    console.log(`📤 Emitting drone-theirs-detected to room: ${drone_id}`);
    io.to(drone_id).emit('drone-theirs-detected', row);

    res.json({ success: true, insertedId: r.insertId, image_path: imagePath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update enemy drone
app.put('/api/drone-theirs/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { confidence, latitude, longitude, altitude, weather, width, height, image_path } = req.body;

    try {
        // ดึง drone_id ก่อนอัปเดต
        const [existing] = await pool.execute(`SELECT drone_id FROM drone_theirs WHERE id=?`, [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Drone not found' });
        }
        const drone_id = existing[0].drone_id;

        // อัปเดต DB
        await pool.execute(
            `UPDATE drone_theirs SET confidence=?, latitude=?, longitude=?, altitude=?, weather=?, width=?, height=?, image_path=? WHERE id=?`,
            [confidence, latitude, longitude, altitude, weather, width, height, image_path, id]
        );

        const updatedRow = { 
            id: parseInt(id), 
            drone_id,
            confidence, 
            latitude, 
            longitude, 
            altitude, 
            weather, 
            width, 
            height, 
            image_path, 
            detected_at: new Date() 
        };

        // อัปเดต cache
        lastPositions.theirs[drone_id] = updatedRow;

        // ส่ง event ไปยัง client ที่ subscribe
        console.log(`📤 Emitting drone-theirs-updated to room: ${drone_id}`);
        io.to(drone_id).emit('drone-theirs-updated', updatedRow);

        res.json({ success: true, data: updatedRow });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete enemy drone
app.delete('/api/drone-theirs/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // ดึง drone_id ก่อนลบ
    const [existing] = await pool.execute(`SELECT drone_id FROM drone_theirs WHERE id=?`, [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Drone not found' });
    }
    const drone_id = existing[0].drone_id;

    await pool.execute(`DELETE FROM drone_theirs WHERE id=?`, [id]);
    delete lastPositions.theirs[drone_id];

    console.log(`📤 Emitting drone-theirs-removed to room: ${drone_id}`);
    io.to(drone_id).emit('drone-theirs-removed', { id, drone_id });

    res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get recent events
app.get('/api/recent/ours', async (req, res) => {
  try {
    const [rows] = await pool.execute(`SELECT * FROM drone_ours ORDER BY detected_at DESC LIMIT 100`);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/recent/theirs', async (req, res) => {
  try {
    const [rows] = await pool.execute(`SELECT * FROM drone_theirs ORDER BY detected_at DESC LIMIT 100`);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get last positions
app.get('/api/last/ours', (req, res) => res.json({ success: true, data: Object.values(lastPositions.ours) }));
app.get('/api/last/theirs', (req, res) => res.json({ success: true, data: Object.values(lastPositions.theirs) }));

// ---- Socket.IO ----
io.on('connection', socket => {
  console.log('✅ Client connected:', socket.id);

  // Subscribe to specific camera/drone
  socket.on('subscribe_camera', ({ cam_id }) => {
    console.log(`🔔 Client ${socket.id} subscribed to camera: ${cam_id}`);
    socket.join(cam_id);

    // ส่งตำแหน่งล่าสุดทันที (ถ้ามี)
    const latest = lastPositions.theirs[cam_id];
    if (latest) {
      console.log(`📤 Sending latest position for ${cam_id} to ${socket.id}`);
      socket.emit('drone-theirs-detected', latest);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ---- Start server ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));