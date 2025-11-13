// src/pages/Login.jsx
import React, { useState } from "react";
import "./Login.css";
import { useNavigate } from "react-router-dom";

const Login = ({ onLogin }) => { // <-- รับ props onLogin
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("http://localhost:3000/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("userId", data.userId); // 🚩 เก็บ userId ลง localStorage
        localStorage.setItem("token", data.token);
        onLogin(true); // <-- แจ้ง App.jsx ว่าล็อกอินสำเร็จ
        navigate("/dashboard"); // ไปหน้า dashboard
      } else {
        setError(data.message || "Login ล้มเหลว");
      }
    } catch (err) {
      console.error(err);
      setError("เกิดข้อผิดพลาดเครือข่าย");
    }

    setLoading(false);
  };

  return (
    <div className="login-container">
      <div className="login-left">
        <img
          src="/src/assets/logo_mahidol.png"
          alt="ระบบตรวจจับโดรน"
          className="login-logo"
        />
        <h1>ระบบตรวจจับโดรนทางทหาร</h1>
        <p>เข้าสู่ระบบเพื่อจัดการโดรนและตรวจจับภัยคุกคาม</p>
        <p>หน่วยงานสวนและบ้าน 2025</p>
      </div>
      <div className="login-right">
        <form className="login-form" onSubmit={handleLogin}>
          <h2>เข้าสู่ระบบ</h2>
          {error && <p className="error">{error}</p>}
          <label>Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            placeholder="กรอกชื่อผู้ใช้"
          />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="กรอกรหัสผ่าน"
          />
          <button type="submit" disabled={loading}>
            {loading ? "กำลังเข้าสู่ระบบ..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
