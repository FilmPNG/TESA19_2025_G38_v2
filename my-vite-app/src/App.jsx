// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
// นำเข้า Components ที่สร้างใหม่
import Login from './page/Login'; 
import Dashboard from './page/Dashboard';
import RedZone from './page/RedZone'; // 🚩 นำเข้าหน้า RedZone
import './App.css'; // ใช้ CSS เดิม

// Component สำหรับป้องกันเส้นทาง (Protected Route)
const ProtectedRoute = ({ children, isLoggedIn }) => {
  if (!isLoggedIn) {
    // ถ้ายังไม่ล็อกอิน ให้เปลี่ยนเส้นทางไปยังหน้า Login
    return <Navigate to="/login" replace />; 
  }
  return children;
};

function App() {
  // ใช้ useState เพื่อเก็บสถานะการล็อกอิน
  const [isLoggedIn, setIsLoggedIn] = useState(
    // ตรวจสอบจาก Local Storage หรือ Session Storage เมื่อโหลดครั้งแรก
    localStorage.getItem('isLoggedIn') === 'true' 
  ); 

  // ใช้ useEffect เพื่ออัพเดท Local Storage เมื่อสถานะเปลี่ยน
  useEffect(() => {
    localStorage.setItem('isLoggedIn', isLoggedIn);
  }, [isLoggedIn]);

  // ฟังก์ชันสำหรับจัดการการล็อกอิน
  const handleLogin = (status) => {
    setIsLoggedIn(status);
  };
  
  // ฟังก์ชันสำหรับจัดการการออกจากระบบ
  const handleLogout = () => {
    setIsLoggedIn(false);
  };

  return (
    <Router>
      <Routes>
        {/* 1. เส้นทางหน้า Login (สาธารณะ) */}
        <Route path="/login" element={<Login onLogin={handleLogin} />} />

        {/* 2. เส้นทางหน้า Dashboard (ต้องล็อกอิน) */}
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute isLoggedIn={isLoggedIn}>
              {/* ส่งฟังก์ชัน Logout ไปให้ Dashboard ด้วย */}
              <Dashboard onLogout={handleLogout} /> 
            </ProtectedRoute>
          } 
        />
        
        {/* 🚩 เพิ่มเส้นทางสำหรับหน้า RedZone */}
        <Route 
          path="/redzone"
          element={
            <ProtectedRoute isLoggedIn={isLoggedIn}>
              <RedZone />
            </ProtectedRoute>
          }
        />

        {/* 3. เส้นทางเริ่มต้น (Redirect ไป Login ถ้ายังไม่เข้าสู่ระบบ) */}
        <Route 
          path="/" 
          element={<Navigate to={isLoggedIn ? "/dashboard" : "/login"} replace />} 
        />
        
        {/* 4. จัดการเส้นทางที่ไม่พบ (404) */}
        <Route path="*" element={<h1>404 Not Found</h1>} />
      </Routes>
    </Router>
  );
}

export default App;