const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Khởi tạo Database SQLite
const db = new sqlite3.Database(':memory:'); // Dùng RAM để test, thực tế dùng file .db

db.serialize(() => {
  // Tạo bảng Phim
  db.run(`CREATE TABLE movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    poster TEXT,
    duration INTEGER,
    description TEXT
  )`);

  // Tạo bảng Lịch chiếu
  db.run(`CREATE TABLE showtimes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id INTEGER,
    time TEXT,
    room TEXT,
    price INTEGER
  )`);

  // Tạo bảng Vé
  db.run(`CREATE TABLE tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    showtime_id INTEGER,
    seat_number TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    booking_date DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Thêm dữ liệu mẫu (Phim)
  db.run(`INSERT INTO movies (title, poster, duration, description) VALUES 
    ('Lật Mặt 7', 'https://upload.wikimedia.org/wikipedia/vi/thumb/8/8f/Lat_mat_7.jpg/220px-Lat_mat_7.jpg', 120, 'Phim gia đình Việt Nam'),
    ('Dune 2', 'https://upload.wikimedia.org/wikipedia/en/thumb/5/52/Dune_Part_Two_poster.jpg/220px-Dune_Part_Two_poster.jpg', 166, 'Phim khoa học viễn tưởng')
  `);

  // Thêm dữ liệu mẫu (Lịch chiếu cho phim 1)
  db.run(`INSERT INTO showtimes (movie_id, time, room, price) VALUES 
    (1, '2024-05-20 19:00', 'Phòng 1', 90000),
    (1, '2024-05-20 21:30', 'Phòng 2', 90000),
    (2, '2024-05-21 18:00', 'Phòng IMAX', 150000)
  `);
});

// --- API Lấy danh sách phim ---
app.get('/api/movies', (req, res) => {
  db.all("SELECT * FROM movies", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- API Lấy lịch chiếu của một phim ---
app.get('/api/movies/:id/showtimes', (req, res) => {
  db.all("SELECT * FROM showtimes WHERE movie_id = ?", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- API Lấy danh sách ghế đã đặt của một suất chiếu ---
app.get('/api/showtimes/:id/tickets', (req, res) => {
  db.all("SELECT seat_number FROM tickets WHERE showtime_id = ?", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => r.seat_number));
  });
});

// --- API Đặt vé ---
app.post('/api/book', (req, res) => {
  const { showtime_id, seats, customer_name, customer_phone } = req.body;
  
  if (!seats || seats.length === 0) {
    return res.status(400).json({ error: "Vui lòng chọn ghế" });
  }

  // Kiểm tra xem ghế đã có ai đặt chưa
  const placeholders = seats.map(() => '?').join(',');
  db.all(`SELECT seat_number FROM tickets WHERE showtime_id = ? AND seat_number IN (${placeholders})`, 
    [showtime_id, ...seats], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (rows.length > 0) {
        return res.status(400).json({ error: "Một số ghế đã có người đặt. Vui lòng chọn ghế khác." });
      }

      // Nếu ghế trống, tiến hành lưu vé
      const stmt = db.prepare("INSERT INTO tickets (showtime_id, seat_number, customer_name, customer_phone) VALUES (?, ?, ?, ?)");
      seats.forEach(seat => {
        stmt.run(showtime_id, seat, customer_name, customer_phone);
      });
      stmt.finalize();

      res.json({ success: true, message: "Đặt vé thành công!" });
  });
});

// Phục vụ file giao diện
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => {
  console.log('🚀 Server đặt vé đang chạy tại http://localhost:3000');
});
// --- API Đăng nhập (CỐ Ý CHỨA LỖ HỔNG SQL INJECTION) ---
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    // CẢNH BÁO: Lỗi SQL Injection nằm ở đây (dùng nối chuỗi thay vì parameterized query)
    const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
    
    db.get(query, (err, row) => {
        if (err) {
            return res.status(500).json({ error: "Lỗi database" });
        }
        if (!row) {
            return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
        }

        // Tạo JWT Token (giả lập role)
        const token = jwt.sign({ id: row.id, username: row.username, role: row.role }, SECRET_KEY, { expiresIn: '1h' });
        
        // Lưu token vào Cookie
        res.cookie('token', token, { httpOnly: true });
        
        // Trả về thông tin cho Frontend
        res.json({ 
            message: "Đăng nhập thành công", 
            user: { id: row.id, username: row.username, role: row.role } 
        });
    });
});

// --- Middleware kiểm tra xác thực ---
const authenticate = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: "Token không hợp lệ" });
    }
};

// --- API Lấy thông tin Admin Dashboard (Yêu cầu quyền Admin) ---
app.get('/api/admin/users', authenticate, (req, res) => {
    // Kiểm tra quyền
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: "Không có quyền truy cập" });
    }

    // Lấy danh sách user
    db.all("SELECT id, username, role FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "Lỗi database" });
        res.json({ users: rows });
    });
});

// --- Phục vụ file HTML Frontend ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Lab Server đang chạy tại: http://localhost:${PORT}`);
});
