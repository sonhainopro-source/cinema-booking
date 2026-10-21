const express = require('express');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;
const SECRET_KEY = "supersecretkey_lab_only"; // Trong thực tế phải giữ bí mật

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// --- Khởi tạo Database SQLite ---
const db = new sqlite3.Database(':memory:'); // Dùng RAM cho lab
db.serialize(() => {
    db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, role TEXT)");
    // Tạo tài khoản admin và user thường
    db.run("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')");
    db.run("INSERT INTO users (username, password, role) VALUES ('user1', 'user123', 'user')");
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
