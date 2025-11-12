require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- เพิ่ม: สำหรับจัดการ Login, Hash รหัสผ่าน, และ Cookie ---
const bcrypt = require('bcryptjs'); 
const cookieParser = require('cookie-parser'); 
const jwt = require('jsonwebtoken'); 
// -----------------------------------------------------------

const app = express();
const server = http.createServer(app);

// กำหนด Secret Key สำหรับ JWT (ควรตั้งค่าใน .env)
const JWT_SECRET = process.env.JWT_SECRET || 'your_strong_secret_key_drone_control_center_2025'; 

const io = new Server(server, { 
    cors: { 
        origin: 'http://localhost:5173', // **สำคัญ:** เปลี่ยนเป็น URL ของ Frontend คุณ
        credentials: true, // อนุญาตให้ส่ง Cookie ข้ามโดเมน
    } 
});

// ---- Middleware ----
app.use(cookieParser()); // ใช้สำหรับอ่านและเขียน Cookie
app.use(cors({
    origin: 'http://localhost:5173', // **สำคัญ:** ต้องตรงกับ origin ของ Frontend
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
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

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

// ---- Keep latest positions for realtime update ----
const lastPositions = {
  ours: {},    // drone_id -> data
  theirs: {}  // drone_id -> data
};

// ----------------- Authentication Middleware -----------------

/**
 * Middleware สำหรับตรวจสอบ JWT Token จาก Cookie
 */
const requireAuth = (req, res, next) => {
    const token = req.cookies.auth_token;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized: ไม่มีการเข้าสู่ระบบ' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // เก็บข้อมูลผู้ใช้ใน request (เช่น id, username, role)
        next();
    } catch (err) {
        console.error('JWT Verification Failed:', err.message);
        // ลบ Cookie ที่หมดอายุหรือผิดปกติออก
        res.clearCookie('auth_token'); 
        return res.status(401).json({ success: false, message: 'Unauthorized: Session หมดอายุ' });
    }
};

// ----------------- AUTH APIs -----------------

/**
 * API สำหรับเข้าสู่ระบบ: ตรวจสอบผู้ใช้, สร้าง JWT, และตั้งค่า Cookie
 */
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    try {
        // 1. ค้นหาผู้ใช้
        const [rows] = await pool.execute(
            `SELECT id, username, password_hash, role FROM users WHERE username = ?`,
            [username]
        );

        const user = rows[0];
        if (!user) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }

        // 2. ตรวจสอบรหัสผ่านที่ Hash
        // **สำคัญ:** ถ้าคุณใช้รหัสผ่านแบบ Plain text ใน DB ให้ข้ามขั้นตอนนี้
        // และใช้ `if (password !== user.password_hash)` แทน
        const isMatch = await bcrypt.compare(password, user.password_hash); 

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }

        // 3. สร้าง JWT Token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' } // Token หมดอายุใน 8 ชั่วโมง
        );
        
        const eightHours = 8 * 60 * 60 * 1000;

        // 4. ตั้งค่า Cookie
        res.cookie('auth_token', token, {
            httpOnly: true, // ป้องกันการเข้าถึงจาก JavaScript (XSS)
            secure: process.env.NODE_ENV === 'production', // ใช้ secure: true เมื่อเป็น HTTPS
            maxAge: eightHours, // 8 ชั่วโมง
            sameSite: 'lax',
        });

        // 5. ส่ง Response กลับ
        res.json({ success: true, message: 'เข้าสู่ระบบสำเร็จ', role: user.role });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'ข้อผิดพลาดภายในเซิร์ฟเวอร์' });
    }
});

/**
 * API สำหรับออกจากระบบ: ลบ Cookie
 */
app.post('/api/logout', (req, res) => {
    // ลบ Cookie โดยตั้งค่าให้หมดอายุทันที
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'ออกจากระบบสำเร็จ' });
});

/**
 * API ตรวจสอบสถานะการล็อกอิน (เพื่อให้ Frontend ตรวจสอบ Session เมื่อโหลดหน้า)
 */
app.get('/api/check-auth', requireAuth, (req, res) => {
    res.json({ success: true, isLoggedIn: true, user: { username: req.user.username, role: req.user.role } });
});


// ----------------- APIs (Protected Access) -----------------

// 1) Insert our drone (JSON) - **ถูกป้องกันแล้ว**
app.post('/api/drone-ours', requireAuth, async (req, res) => {
  const { drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path } = req.body;
  try {
    const [r] = await pool.execute(
      `INSERT INTO drone_ours (drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path]
    );

    const row = { id: r.insertId, drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path, detected_at: new Date() };
    lastPositions.ours[drone_id] = row;

    io.emit('drone-ours-detected', row);
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2) Insert enemy drone (JSON without image) - **ถูกป้องกันแล้ว**
app.post('/api/drone-theirs', requireAuth, async (req, res) => {
  const { drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path } = req.body;
  try {
    const [r] = await pool.execute(
      `INSERT INTO drone_theirs (drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path]
    );

    const row = { id: r.insertId, drone_id, confidence, latitude, longitude, altitude, weather, width, height, image_path, detected_at: new Date() };
    lastPositions.theirs[drone_id] = row;

    io.to(drone_id).emit('drone-theirs-detected', row);

    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3) Upload enemy drone image - **ถูกป้องกันแล้ว**
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

    const row = { id: r.insertId, drone_id, confidence: parseFloat(confidence), latitude: parseFloat(latitude), longitude: parseFloat(longitude), altitude: parseFloat(altitude), weather, width: parseFloat(width), height: parseFloat(height), image_path: imagePath, detected_at: new Date() };
    lastPositions.theirs[drone_id] = row;

    io.to(drone_id).emit('drone-theirs-detected', row);

    res.json({ success: true, insertedId: r.insertId, image_path: imagePath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});


app.put('/api/drone-theirs/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { confidence, latitude, longitude, altitude, weather, width, height, image_path, drone_id } = req.body; // 🚩 เพิ่ม drone_id ใน req.body (ต้องส่งมาจาก Frontend)

    try {
        // 1. อัพเดท DB
        await pool.execute(
            `UPDATE drone_theirs SET confidence=?, latitude=?, longitude=?, altitude=?, weather=?, width=?, height=?, image_path=? WHERE id=?`,
            [confidence, latitude, longitude, altitude, weather, width, height, image_path, id]
        );

        // 2. ดึง drone_id ออกมา (ถ้าไม่มีใน body หรือไม่แน่ใจ)
        let actualDroneId = drone_id;
        if (!actualDroneId) {
            const [rows] = await pool.execute(`SELECT drone_id FROM drone_theirs WHERE id=?`, [id]);
            if (rows.length > 0) {
                actualDroneId = rows[0].drone_id;
            }
        }
        
        // ถ้าหา drone_id ไม่เจอ ให้หยุด
        if (!actualDroneId) {
            return res.status(404).json({ success: false, message: 'Drone ID not found after update' });
        }


        // 3. สร้าง Row ที่อัพเดทแล้ว
        // 🚨 สำคัญ: ในกรณี Update ให้ดึงข้อมูลที่สมบูรณ์จาก DB อีกครั้งเพื่อความชัวร์ หรือใช้ค่าที่ส่งมา + actualDroneId
        const updatedRow = { 
            id: parseInt(id), 
            drone_id: actualDroneId, // ใช้ actualDroneId
            confidence, latitude, longitude, altitude, 
            weather, width, height, image_path, 
            detected_at: new Date() 
        };

        // 4. อัพเดท Cache (lastPositions)
        // 🚨 Key ใน lastPositions.theirs ควรเป็น drone_id ไม่ใช่ id (Primary Key)
        lastPositions.theirs[actualDroneId] = updatedRow; // 🚩 ใช้ actualDroneId เป็น key

        // 5. ส่ง event ไป client โดยใช้ drone_id
        // io.to(actualDroneId) จะส่งไปยังทุก client ที่ subscribe 'actualDroneId'
        io.to(actualDroneId).emit('drone-theirs-updated', updatedRow); // <-- ส่ง Event ใหม่

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
    await pool.execute(`DELETE FROM drone_theirs WHERE id=?`, [id]);
    delete lastPositions.theirs[id];

    // แจ้ง frontend ว่าโดรนนี้หายไป
    io.to(id).emit('drone-theirs-removed', { id });

    res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});



// 4) Get recent events (อ่านข้อมูลมักไม่ถูกป้องกัน แต่ถ้าเป็นข้อมูล sensitive ควรใช้ requireAuth)
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

// 5) Get last positions (อ่านข้อมูลมักไม่ถูกป้องกัน)
app.get('/api/last/ours', (req, res) => res.json({ success: true, data: Object.values(lastPositions.ours) }));
app.get('/api/last/theirs', (req, res) => res.json({ success: true, data: Object.values(lastPositions.theirs) }));

// ---- Socket.IO ----
io.on('connection', socket => {
  console.log('Client connected:', socket.id);

  // Subscribe to specific enemy camera
  socket.on('subscribe_camera', ({ cam_id }) => {
    console.log(`Client ${socket.id} subscribed to camera: ${cam_id}`);
    socket.join(cam_id);

    // Send latest position immediately if exists
    const latest = lastPositions.theirs[cam_id];
    if (latest) socket.emit('drone-theirs-detected', latest);
  });

  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ---- Start server ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));