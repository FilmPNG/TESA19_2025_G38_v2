require('dotenv').config();
const express = require('express');
const http = require('http');
const mqtt = require('mqtt');
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
        origin: '*',
        credentials: true,
    } 
});

// ---- Middleware ----
app.use(cookieParser());
app.use(cors({
    origin: '*',
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

// ---- MQTT Connection ----
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://192.168.10.10:1883';
const MQTT_TOPIC_OURS = 'x/y';

const mqttClient = mqtt.connect(MQTT_BROKER_URL);

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  mqttClient.subscribe(MQTT_TOPIC_OURS, (err) => {
    if (!err) {
      console.log(`📡 Subscribed to MQTT topic: ${MQTT_TOPIC_OURS}`);
    } else {
      console.error('MQTT subscription error:', err);
    }
  });
});

mqttClient.on('message', async (topic, message) => {
  if (topic === MQTT_TOPIC_OURS) {
    try {
      const data = JSON.parse(message.toString());
      // 🚩 รับ drone_id (จาก key 'id'), lat, lon, alt
      const { id: drone_id, lat, lon, alt } = data;

      if (drone_id === undefined || lat === undefined || lon === undefined || alt === undefined) {
        console.warn('Received incomplete MQTT message:', data);
        return;
      }

      // 🚩 ตรวจสอบว่ามี drone_id นี้ใน DB หรือยัง
      const [existing] = await pool.execute('SELECT id FROM drone_ours WHERE drone_id = ?', [drone_id]);

      if (existing.length > 0) {
        // 🚩 ถ้ามี -> อัปเดต
        const [updateResult] = await pool.execute(
          'UPDATE drone_ours SET latitude = ?, longitude = ?, altitude = ? WHERE drone_id = ?',
          [lat, lon, alt, drone_id]
        );
        if (updateResult.affectedRows > 0) {
          console.log(`🚁 Updated friendly drone data for drone_id: ${drone_id}`);
          // 🚩 ส่งข้อมูลอัปเดตผ่าน Socket.IO
          const updatedDrone = { drone_id, lat, lng: lon, altitude: alt, detected_at: new Date() };
          io.emit('drone-ours-update', updatedDrone);
        }
      } else {
        // 🚩 ถ้าไม่มี -> เพิ่มใหม่
        const [insertResult] = await pool.execute(
          'INSERT INTO drone_ours (drone_id, latitude, longitude, altitude) VALUES (?, ?, ?, ?)',
          [drone_id, lat, lon, alt]
        );
        console.log(`🚁 Saved new friendly drone data from MQTT for drone_id: ${drone_id}`);
        // 🚩 ส่งข้อมูลใหม่ผ่าน Socket.IO
        const newDrone = { drone_id, lat, lng: lon, altitude: alt, detected_at: new Date() };
        io.emit('drone-ours-update', newDrone);

        // 🚩 เพิ่ม/อัปเดตใน lastPositions ด้วย
        lastPositions.ours[drone_id] = {
            drone_id,
            ...newDrone, // ใช้ข้อมูลเดียวกับที่ส่งไป socket
            id: insertResult.insertId // เพิ่ม id จาก DB
        };
      }
    } catch (err) {
      console.error('Error processing MQTT message or saving to DB:', err);
    }
  }
});

// ---- Keep latest positions ----
const lastPositions = {
  ours: {},
  theirs: {}
};

// ----------------- Authentication Middleware -----------------
const requireAuth = (req, res, next) => {
    let token = req.cookies.auth_token;

    // 🚩 ตรวจสอบ Authorization header ด้วย
    if (!token && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
    }
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

        res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', role: user.role, userId: user.id, token: token }); // 🚩 เพิ่ม token ใน response

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
    console.log('req.user in check-auth:', req.user); // 🚩 เพิ่ม log
});

// ----------------- APIs -----------------

// Insert enemy drone (JSON)
app.post('/api/drone-theirs', requireAuth, async (req, res) => {
    const { drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path } = req.body;
    try {
        // 1. ตรวจสอบว่ามี drone_id นี้ใน DB หรือยัง
        const [existing] = await pool.execute(`SELECT id FROM drone_theirs WHERE drone_id = ?`, [drone_id]);

        if (existing.length > 0) {
            // 2. ถ้ามี -> อัปเดตข้อมูล
            const existingId = existing[0].id;
            await pool.execute(
                `UPDATE drone_theirs SET confidence=?, latitude=?, longitude=?, altitude=?, weather=?, width=?, height=?, image_path=?, detected_at=CURRENT_TIMESTAMP WHERE id=?`,
                [confidence, latitude, longitude, altitude, weather, width, height, image_path, existingId]
            );

            const updatedRow = { id: existingId, drone_id, ...req.body, detected_at: new Date() };
            lastPositions.theirs[drone_id] = updatedRow;

            console.log(`📤 Emitting drone-theirs-updated to room: ${drone_id}`);
            io.to(drone_id).emit('drone-theirs-updated', updatedRow);

            res.json({ success: true, message: 'Drone updated', data: updatedRow });

        } else {
            // 3. ถ้าไม่มี -> เพิ่มข้อมูลใหม่
            const [r] = await pool.execute(
                `INSERT INTO drone_theirs (drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path]
            );

            const newRow = { id: r.insertId, drone_id, ...req.body, detected_at: new Date() };
            lastPositions.theirs[drone_id] = newRow;

            console.log(`📤 Emitting drone-theirs-detected to room: ${drone_id}`);
            io.to(drone_id).emit('drone-theirs-detected', newRow);

            res.status(201).json({ success: true, message: 'Drone created', id: r.insertId });
        }

    } catch (err) {
        console.error('Error in POST /api/drone-theirs:', err);
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




// ---- CREATE Red Zone ----
app.post('/api/red-zone', requireAuth, async (req, res) => {
  const { name, center_lat, center_lng, radius_meters } = req.body;
  console.log('req.user in CREATE Red Zone handler:', req.user); // 🚩 เพิ่ม log
  try {
    const [result] = await pool.execute(
      `INSERT INTO red_zones (name, center_lat, center_lng, radius_meters, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [name, center_lat, center_lng, radius_meters, req.user.id]
    );

    const newZone = {
      id: result.insertId,
      name,
      center_lat,
      center_lng,
      radius_meters,
      created_by: req.user.id,
      created_at: new Date(),
      updated_at: new Date()
    };

    // ส่งไปทุก client ผ่าน Socket.IO
    io.emit('red-zone-created', newZone);

    res.json({ success: true, data: newZone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- UPDATE Red Zone ----
app.put('/api/red-zone/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, center_lat, center_lng, radius_meters } = req.body;
  try {
    await pool.execute(
      `UPDATE red_zones SET name=?, center_lat=?, center_lng=?, radius_meters=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [name, center_lat, center_lng, radius_meters, id]
    );

    const updatedZone = {
      id: parseInt(id),
      name,
      center_lat,
      center_lng,
      radius_meters,
      updated_at: new Date()
    };

    io.emit('red-zone-updated', updatedZone);

    res.json({ success: true, data: updatedZone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- DELETE Red Zone ----
app.delete('/api/red-zone/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.execute(`DELETE FROM red_zones WHERE id=?`, [id]);
    io.emit('red-zone-deleted', { id: parseInt(id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- GET ALL Red Zones ----
app.get('/api/red-zone', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT rz.*, u.username as created_by_username 
             FROM red_zones rz
             LEFT JOIN users u ON rz.created_by = u.id
             ORDER BY rz.created_at DESC`
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});




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