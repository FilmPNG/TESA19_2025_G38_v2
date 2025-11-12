import React, { useEffect, useState, useRef } from 'react';
import { AlertTriangle, Radio, Shield, X, Camera, Maximize2 } from 'lucide-react';
import { useNavigate } from "react-router-dom"; // <-- ต้อง import

const DroneDetectionDashboard = () => {
  const [enemyDrones, setEnemyDrones] = useState([]);
  const [friendlyDrones, setFriendlyDrones] = useState([]);
  const [selectedDrone, setSelectedDrone] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState({ enemy: 'disconnected', friendly: 'disconnected' });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [lastUpdate, setLastUpdate] = useState({ enemy: null, friendly: null });
  // 🚩 1. ลบ state นี้ออก
  // const [pendingDrones, setPendingDrones] = useState({ enemy: [], friendly: [] });
  const navigate = useNavigate();
  const [trackedEnemyIds, setTrackedEnemyIds] = useState([]);

  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef({ enemy: new Map(), friendly: new Map() });
  const enemySocketRef = useRef(null);
  const friendlySocketRef = useRef(null);

  const handleLogout = async () => {
    try {
      // เรียก backend logout
      const response = await fetch('http://localhost:3000/api/logout', {
        method: 'POST', // หรือ GET ขึ้นอยู่กับ backend
        credentials: 'include', // จำเป็นถ้าใช้ cookie
      });

      // ไม่ว่า response จะ ok หรือไม่ ก็เคลียร์ localStorage
      localStorage.removeItem('employee');
      localStorage.removeItem('token');

      // redirect ไปหน้า login
      window.location.href = '/login';

      if (!response.ok) {
        console.error('Logout failed on server');
      }
    } catch (error) {
      console.error('Logout error:', error);
      // เคลียร์ localStorage แม้เกิด error
      localStorage.removeItem('employee');
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
  };

  useEffect(() => {
    // Load Mapbox CSS
    const link = document.createElement('link');
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css';
    link.rel = 'stylesheet';
    document.head.appendChild(link);

    // Load Mapbox GL JS
    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js';
    script.async = true;
    script.onload = () => initializeMap();
    document.head.appendChild(script);

    // Load Socket.IO
    const socketScript = document.createElement('script');
    socketScript.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
    socketScript.async = true;
    socketScript.onload = () => initializeSocketConnections();
    document.head.appendChild(socketScript);

    return () => {
      if (enemySocketRef.current) {
        enemySocketRef.current.disconnect();
      }
      if (friendlySocketRef.current) {
        friendlySocketRef.current.disconnect();
      }
      if (map.current) {
        map.current.remove();
      }
    };
  }, []);

  // โหลดข้อมูลเริ่มต้นจาก API
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/recent/theirs');
        const result = await response.json();
        if (result.success && result.data.length > 0) {
          console.log('📦 Loaded initial enemy drones:', result.data.length);
          
          const uniqueIds = [...new Set(result.data.map(d => d.drone_id))];
          setTrackedEnemyIds(uniqueIds);
          
          if (enemySocketRef.current && connectionStatus.enemy === 'connected') {
            uniqueIds.forEach(drone_id => {
              console.log(`🔔 Subscribing to drone: ${drone_id}`);
              enemySocketRef.current.emit('subscribe_camera', { cam_id: drone_id });
            });
          }
          
          // 🚩 สร้าง Array ของโดรนทั้งหมดก่อน
          const initialDrones = result.data.map(data => {
            const imageUrl = data.image_path ? `http://localhost:3000${data.image_path}` : null;
            return {
              id: `${data.drone_id}-${data.id}`,
              obj_id: data.id,
              type: 'enemy',
              lat: parseFloat(data.latitude),
              lng: parseFloat(data.longitude),
              altitude: parseFloat(data.altitude),
              confidence: parseFloat(data.confidence),
              objective: 'unknown',
              size: data.width > 1.2 ? 'large' : data.width > 0.9 ? 'medium' : 'small',
              droneType: 'drone',
              timestamp: data.detected_at,
              camera: {
                name: `กล้อง ${data.drone_id}`,
                location: 'Bangkok Area',
                Institute: 'Local Detection System'
              },
              imageUrl: imageUrl,
              weather: data.weather,
              dimensions: {
                width: parseFloat(data.width),
                height: parseFloat(data.height)
              }
            };
          });
          // 🚩 อัปเดต State เพียงครั้งเดียว
          setEnemyDrones(initialDrones);
          
          // 🚩 ลบการเรียก `handleLocalDetectionData` ใน loop ทิ้ง
          // result.data.forEach(data => handleLocalDetectionData(data, 'enemy', false));
        }
      } catch (error) {
        console.error('Error loading initial data:', error);
      }
    };

    if (mapLoaded) {
      loadInitialData();
    }
  }, [mapLoaded, connectionStatus.enemy]);

  // Subscribe เมื่อ Socket เชื่อมต่อหรือ trackedEnemyIds เปลี่ยน
  useEffect(() => {
    if (enemySocketRef.current && connectionStatus.enemy === 'connected' && trackedEnemyIds.length > 0) {
      console.log('🔄 Subscribing to', trackedEnemyIds.length, 'drone IDs...');
      trackedEnemyIds.forEach(cam_id => {
        enemySocketRef.current.emit('subscribe_camera', { cam_id });
      });
    }
  }, [connectionStatus.enemy, trackedEnemyIds]);

  // 🚩 2. ลบ useEffect ที่เกี่ยวกับ pendingDrones ทิ้ง
  /*
  useEffect(() => {
    if (mapLoaded && map.current) {
      // ... (โค้ด pendingDrones ทั้งหมด) ...
    }
  }, [mapLoaded, pendingDrones]);
  */
  
  // 🚩 5. เพิ่ม Effect ใหม่: คอย Sync state 'enemyDrones' ไปยัง Map
  useEffect(() => {
    if (mapLoaded && map.current) {
      console.log('🗺️ Map sync: Updating enemy markers from state', enemyDrones.length);
      updateMarkers(enemyDrones, 'enemy');
    }
  }, [enemyDrones, mapLoaded]); // ทำงานทุกครั้งที่ enemyDrones หรือ mapLoaded เปลี่ยน

  // 🚩 5. เพิ่ม Effect ใหม่: คอย Sync state 'friendlyDrones' ไปยัง Map
  useEffect(() => {
    if (mapLoaded && map.current) {
      console.log('🗺️ Map sync: Updating friendly markers from state', friendlyDrones.length);
      updateMarkers(friendlyDrones, 'friendly');
    }
  }, [friendlyDrones, mapLoaded]); // ทำงานทุกครั้งที่ friendlyDrones หรือ mapLoaded เปลี่ยน

  const initializeMap = () => {
    if (!window.mapboxgl || map.current) return;

    window.mapboxgl.accessToken = 'pk.eyJ1IjoiZmlsbXBuZyIsImEiOiJjbWh1cTM4dWkwMmZqMnJwdndtc3NyaGxhIn0.oHO3kOudwG_iRm7XoeOffA';

    map.current = new window.mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [100.5018, 13.7563],
      zoom: 13
    });

    map.current.addControl(new window.mapboxgl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      setMapLoaded(true);
      console.log('✅ Map loaded successfully');
    });
  };

  const initializeSocketConnections = () => {
    if (!window.io) return;

    // Connect to enemy camera (ใช้ backend ของตัวเอง)
    enemySocketRef.current = window.io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    enemySocketRef.current.on('connect', () => {
        console.log('✅ Connected to enemy camera (local backend)');
        setConnectionStatus(prev => ({ ...prev, enemy: 'connected' }));
    });

    enemySocketRef.current.on('drone-theirs-detected', (data) => {
      console.log('📡 Enemy detection received (local backend):', data);
      handleLocalDetectionData(data, 'enemy', true);
    });

    enemySocketRef.current.on('disconnect', () => {
      console.log('❌ Disconnected from enemy camera');
      setConnectionStatus(prev => ({ ...prev, enemy: 'disconnected' }));
    });
    enemySocketRef.current.on('drone-theirs-updated', (data) => {
      console.log('🔄 Enemy update received (local backend):', data);
      handleLocalDetectionData(data, 'enemy', true);
    });

    enemySocketRef.current.on('connect_error', (error) => {
      console.error('Enemy connection error:', error);
      setConnectionStatus(prev => ({ ...prev, enemy: 'error' }));
    });

    // Connect to friendly camera
    friendlySocketRef.current = window.io('https://tesa-api.crma.dev', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    friendlySocketRef.current.on('connect', () => {
      console.log('✅ Connected to friendly camera');
      setConnectionStatus(prev => ({ ...prev, friendly: 'connected' }));
      friendlySocketRef.current.emit('subscribe_camera', {
        cam_id: 'f1bbc93d-5998-4f19-9c4a-7fbceef7044e'
      });
    });

    friendlySocketRef.current.on('object_detection', (data) => {
      console.log('📡 Friendly detection received:', data);
      handleDetectionData(data, 'friendly');
    });

    friendlySocketRef.current.on('disconnect', () => {
      console.log('❌ Disconnected from friendly camera');
      setConnectionStatus(prev => ({ ...prev, friendly: 'disconnected' }));
    });

    friendlySocketRef.current.on('connect_error', (error) => {
      console.error('Friendly connection error:', error);
      setConnectionStatus(prev => ({ ...prev, friendly: 'error' }));
    });
  };

  // 🚩 3. แก้ไข Handle data from local backend (enemy drones)
  const handleLocalDetectionData = (data, type, updateTimestamp = true) => {
    if (!data) return;

    if (updateTimestamp) {
      setLastUpdate(prev => ({ ...prev, [type]: new Date().toISOString() }));
    }

    const imageUrl = data.image_path ? `http://localhost:3000${data.image_path}` : null;

    const drone = {
      id: `${data.drone_id}-${data.id}`,
      obj_id: data.id, // <-- ใช้ data.id ถูกต้องแล้ว
      type: type,
      lat: parseFloat(data.latitude),
      lng: parseFloat(data.longitude),
      altitude: parseFloat(data.altitude),
      confidence: parseFloat(data.confidence),
      objective: 'unknown',
      size: data.width > 1.2 ? 'large' : data.width > 0.9 ? 'medium' : 'small',
      droneType: 'drone',
      timestamp: data.detected_at,
      camera: {
        name: `กล้อง ${data.drone_id}`,
        location: 'Bangkok Area',
        Institute: 'Local Detection System'
      },
      imageUrl: imageUrl,
      weather: data.weather,
      dimensions: {
        width: parseFloat(data.width),
        height: parseFloat(data.height)
      }
    };

    // 🚩 อัปเดต State โดยใช้ functional update form
    // 🚩 (ลบ if(mapLoaded) และ if(!mapLoaded) ทิ้ง)
    setEnemyDrones(prevDrones => {
      // อัพเดทหรือเพิ่มโดรน
      const filtered = prevDrones.filter(d => d.obj_id !== drone.obj_id);
      return [...filtered, drone];
    });
  };

  // 🚩 4. แก้ไข Handle data from TESA API (friendly drones)
  const handleDetectionData = (data, type) => {
    if (!data || !data.objects || data.objects.length === 0) return;

    setLastUpdate(prev => ({ ...prev, [type]: new Date().toISOString() }));

    const imageUrl = data.image ? `https://tesa-api.crma.dev${data.image.path}` : null;

    const drones = data.objects.map(obj => ({
      id: `${data.cam_id}-${obj.obj_id}`,
      obj_id: obj.obj_id,
      type: type,
      lat: obj.lat,
      lng: obj.lng,
      objective: obj.objective || 'unknown',
      size: obj.size || 'unknown',
      droneType: obj.type || 'drone',
      timestamp: data.timestamp,
      camera: data.camera,
      imageUrl: imageUrl,
      cam_id: data.cam_id
    }));

    // 🚩 อัปเดต State เท่านั้น
    setFriendlyDrones(drones);

    // 🚩 (ลบ if(mapLoaded) และ else (setPendingDrones) ทิ้ง)
  };

  const updateMarkers = (drones, type) => {
    if (!window.mapboxgl || !map.current) {
        console.log('⚠️ Mapbox not ready');
        return;
    }

    console.log(`🚁 Updating ${type} markers:`, drones.length);

    const markers = markersRef.current[type];
    const newDroneIds = new Set(drones.map(d => d.id));
    
    // 1. ตรวจสอบ Marker ที่ควรถูกลบออก (Marker ที่ไม่อยู่ในรายการ drones แล้ว)
    const markersToRemove = [];
    markers.forEach((marker, droneId) => {
        if (!newDroneIds.has(droneId)) {
            marker.remove();
            markersToRemove.push(droneId);
        }
    });
    markersToRemove.forEach(droneId => markers.delete(droneId));


    // 2. อัปเดตตำแหน่งของ Marker เดิม หรือสร้าง Marker ใหม่
    drones.forEach(drone => {
        
        // 🔑 ถ้า Marker นี้มีอยู่แล้ว: ให้อัปเดตตำแหน่ง
        if (markers.has(drone.id)) {
            const marker = markers.get(drone.id);
            marker.setLngLat([drone.lng, drone.lat]);
            
        } else {
            // 🔑 ถ้า Marker นี้เป็น Marker ใหม่: ให้สร้างขึ้นมา
            console.log(`📍 Adding NEW marker for ${drone.obj_id} at [${drone.lng}, ${drone.lat}]`);
            const el = document.createElement('div');
            el.className = `drone-marker ${type}`;
            
            const color = type === 'enemy' ? '#ef4444' : '#22c55e';
            const bgColor = type === 'enemy' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(34, 197, 94, 0.9)';
            const icon = type === 'enemy' ? '🚨' : '✅';

            el.style.cssText = `
                width: 50px;
                height: 50px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            el.innerHTML = `
                 <div class="marker-content" style="
                     background: ${bgColor};
                     width: 45px;
                     height: 45px;
                     border-radius: 50%;
                     display: flex;
                     align-items: center;
                     justify-content: center;
                     font-size: 24px;
                     border: 3px solid white;
                     box-shadow: 0 0 20px ${color}, 0 4px 10px rgba(0,0,0,0.5);
                     position: relative;
                     transition: transform 0.2s ease;
                 ">
                   <span style="
                     display: block;
                     line-height: 1;
                     user-select: none;
                   ">🚁</span>
                   <div style="
                     position: absolute;
                     top: -5px;
                     right: -5px;
                     background: ${color};
                     width: 18px;
                     height: 18px;
                     border-radius: 50%;
                     display: flex;
                     align-items: center;
                     justify-content: center;
                     font-size: 10px;
                     border: 2px solid white;
                     box-shadow: 0 2px 5px rgba(0,0,0,0.3);
          _20u...
                     <span style="display: block; line-height: 1;">${icon}</span>
                   </div>
                   <div style="
                     position: absolute;
                     bottom: -5px;
                     left: -5px;
                     background: white;
                     color: ${color};
                     width: 18px;
                     height: 18px;
                     border-radius: 50%;
                     display: flex;
                     align-items: center;
                     justify-content: center;
                     font-size: 11px;
                     font-weight: bold;
                     border: 2px solid ${color};
                     box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                   ">
                     ${drone.size === 'small' ? 'S' : drone.size === 'medium' ? 'M' : 'L'}
                   </div>
                 </div>
            `;

            const marker = new window.mapboxgl.Marker({
                element: el,
                anchor: 'bottom'
            })
                .setLngLat([drone.lng, drone.lat])
                .addTo(map.current);

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                setSelectedDrone({ ...drone });
                map.current.flyTo({
                    center: [drone.lng, drone.lat],
                    zoom: 15,
                    duration: 1000
                });
            });

            const markerContent = el.querySelector('.marker-content');
            el.addEventListener('mouseenter', () => {
                if (markerContent) markerContent.style.transform = 'scale(1.2)';
            });

            el.addEventListener('mouseleave', () => {
                if (markerContent) markerContent.style.transform = 'scale(1)';
            });
            
            markers.set(drone.id, marker);
        }
    });

    // 🚩 ลบส่วนนี้ออก เพราะเราไม่ต้องการให้ Map ขยับทุกครั้งที่มีการอัปเดตข้อมูล
    // (การขยับ Map จะเกิดขึ้นเมื่อคลิกที่ Card เท่านั้น)
    /*
    if (drones.length > 0 && drones.length === 1) {
      // ...
    } else if (drones.length > 1) {
      // ...
    }
    */
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'connected': return '#00ff00';
      case 'error': return '#ffaa00';
      default: return '#ff0000';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'connected': return 'เชื่อมต่อแล้ว';
      case 'error': return 'เกิดข้อผิดพลาด';
      default: return 'ไม่ได้เชื่อมต่อ';
    }
  };

  const getSizeLabel = (size) => {
    switch (size) {
      case 'small': return 'ขนาดเล็ก 🛸';
      case 'medium': return 'ขนาดกลาง 🚁';
      case 'large': return 'ขนาดใหญ่ ✈️';
      default: return 'ไม่ระบุขนาด';
    }
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0e27',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
        padding: '1rem 2rem',
        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img
            src="src/assets/logo_mahidol.png"
            alt="Logo"
            style={{ width: 64, height: 64, objectFit: 'contain' }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>
              ระบบตรวจจับโดรน
            </h1>
            <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.25rem' }}>
              Drone Detection System - Real-time Monitoring
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: getStatusColor(connectionStatus.enemy),
              boxShadow: connectionStatus.enemy === 'connected' ? `0 0 10px ${getStatusColor(connectionStatus.enemy)}` : 'none',
              animation: connectionStatus.enemy === 'connected' ? 'pulse 2s infinite' : 'none'
            }} />
            <span style={{ fontSize: '0.85rem' }}>
              ระบบเฝ้าระวัง: {getStatusText(connectionStatus.enemy)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: '12px',
            	height: '12px',
            	borderRadius: '50%',
            	background: getStatusColor(connectionStatus.friendly),
            	boxShadow: connectionStatus.friendly === 'connected' ? `0 0 10px ${getStatusColor(connectionStatus.friendly)}` : 'none',
            	animation: connectionStatus.friendly === 'connected' ? 'pulse 2s infinite' : 'none'
            }} />
            <span style={{ fontSize: '0.85rem' }}>
            	ระบบป้องกัน: {getStatusText(connectionStatus.friendly)}
            </span>
          </div>
          <button
            onClick={handleLogout}
            style={{
            	background: '#ef4444',
            	color: '#fff',
            	border: 'none',
            	padding: '0.5rem 1rem',
            	borderRadius: '6px',
            	cursor: 'pointer',
            	fontWeight: 'bold',
            	transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#dc2626'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#ef4444'}
        >
            Logout
        </button>
        </div>
      </div>
      
      {/* Main Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{
          width: '380px',
          background: '#151b3d',
          padding: '1rem',
          overflowY: 'auto',
          boxShadow: '4px 0 6px rgba(0,0,0,0.3)'
        }}>
          {/* Enemy Drones */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{
            	display: 'flex',
            	alignItems: 'center',
            	justifyContent: 'space-between',
            	marginBottom: '1rem',
            	padding: '0.75rem',
            	background: 'rgba(239, 68, 68, 0.2)',
            	borderRadius: '8px',
            	border: '1px solid rgba(239, 68, 68, 0.5)'
            }}>
            	<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            	  <AlertTriangle size={20} color="#ef4444" />
            	  <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
            		โดรนไม่ทราบที่มา
            	  </h2>
            	</div>
            	<span style={{
            	  background: 'rgba(239, 68, 68, 0.3)',
            	  padding: '0.25rem 0.75rem',
            	  borderRadius: '12px',
            	  fontSize: '0.9rem',
            	  fontWeight: 'bold'
            	}}>
            	  {enemyDrones.length}
            	</span>
            </div>
            {lastUpdate.enemy && (
            	<div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.75rem', textAlign: 'center' }}>
            	  อัพเดทล่าสุด: {new Date(lastUpdate.enemy).toLocaleTimeString('th-TH')}
            	</div>
            )}
            {enemyDrones.length === 0 ? (
            	<div style={{ textAlign: 'center', padding: '2rem', opacity: 0.6, fontSize: '0.9rem' }}>
            	  ไม่พบโดรน
            	  <div style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
            		{connectionStatus.enemy === 'connected' ? 'รอข้อมูลจากกล้อง...' : 'กำลังเชื่อมต่อ...'}
            	  </div>
            	</div>
            ) : (
            	enemyDrones.map(drone => (
            	  <DroneCard
            		key={drone.id}
            		drone={drone}
            		type="enemy"
            		onClick={() => {
            		  setSelectedDrone(drone);
            		  if (map.current && mapLoaded) {
            			map.current.flyTo({
            			  center: [drone.lng, drone.lat],
            			  zoom: 16,
            			  duration: 1000
            			});
            		  }
            		}}
            		onImageClick={() => drone.imageUrl && setSelectedImage(drone.imageUrl)}
            		getSizeLabel={getSizeLabel}
            	  />
            	))
            )}
          </div>

          {/* Friendly Drones */}
          <div>
            <div style={{
            	display: 'flex',
            	alignItems: 'center',
            	justifyContent: 'space-between',
            	marginBottom: '1rem',
            	padding: '0.75rem',
            	background: 'rgba(34, 197, 94, 0.2)',
            	borderRadius: '8px',
            	border: '1px solid rgba(34, 197, 94, 0.5)'
            }}>
            	<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            	  <Shield size={20} color="#22c55e" />
            	  <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
            		โดรนฝ่ายเรา
            	  </h2>
            	</div>
            	<span style={{
            	  background: 'rgba(34, 197, 94, 0.3)',
            	  padding: '0.25rem 0.75rem',
            	  borderRadius: '12px',
            	  fontSize: '0.9rem',
            	  fontWeight: 'bold'
            	}}>
            	  {friendlyDrones.length}
            	</span>
            </div>
            {lastUpdate.friendly && (
            	<div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.75rem', textAlign: 'center' }}>
            	  อัพเดทล่าสุด: {new Date(lastUpdate.friendly).toLocaleTimeString('th-TH')}
            	</div>
            )}
            {friendlyDrones.length === 0 ? (
            	<div style={{ textAlign: 'center', padding: '2rem', opacity: 0.6, fontSize: '0.9rem' }}>
            	  ไม่พบโดรนฝ่ายเรา
            	  <div style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
            		{connectionStatus.friendly === 'connected' ? 'รอข้อมูลจากกล้อง...' : 'กำลังเชื่อมต่อ...'}
            	  </div>
            	</div>
            ) : (
            	friendlyDrones.map(drone => (
            	  <DroneCard
            		key={drone.id}
            		drone={drone}
            		type="friendly"
            		onClick={() => {
            		  setSelectedDrone(drone);
            		  if (map.current && mapLoaded) {
            			map.current.flyTo({
            			  center: [drone.lng, drone.lat],
            			  zoom: 16,
            			  duration: 1000
            			});
            		  }
            		}}
            		onImageClick={() => drone.imageUrl && setSelectedImage(drone.imageUrl)}
            		getSizeLabel={getSizeLabel}
            	  />
            	))
            )}
          </div>
        </div>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative', background: '#1a1a2e' }}>
          <div
            ref={mapContainer}
            style={{
            	width: '100%',
            	height: '100%',
            	background: '#1a1a2e'
            }}
          />

          {!mapLoaded && (
          	<div style={{
          	  position: 'absolute',
          	  top: '50%',
          	  left: '50%',
          	  transform: 'translate(-50%, -50%)',
          	  textAlign: 'center'
          	}}>
          	  <div style={{
          		width: '50px',
          		height: '50px',
          		border: '4px solid rgba(255,255,255,0.3)',
          		borderTop: '4px solid #fff',
          		borderRadius: '50%',
          		animation: 'spin 1s linear infinite',
          		margin: '0 auto 1rem'
          	  }} />
          	  <div>กำลังโหลดแผนที่...</div>
          	</div>
          )}

          {/* Drone Details Modal */}
          {selectedDrone && (
          	<div style={{
          	  position: 'absolute',
          	  top: '20px',
          	  right: '20px',
          	  background: 'rgba(21, 27, 61, 0.98)',
          	  padding: '1.5rem',
          	  borderRadius: '12px',
          	  minWidth: '350px',
          	  maxWidth: '450px',
          	  maxHeight: 'calc(100vh - 120px)',
          	  overflowY: 'auto',
          	  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          	  border: `2px solid ${selectedDrone.type === 'enemy' ? '#ef4444' : '#22c55e'}`,
          	  backdropFilter: 'blur(10px)'
          	}}>
          	  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
          		<h3 style={{
          		  margin: 0,
          		  color: selectedDrone.type === 'enemy' ? '#ef4444' : '#22c55e',
          		  fontSize: '1.2rem',
          		  fontWeight: 'bold'
          		}}>
          		  {selectedDrone.type === 'enemy' ? '⚠️ โดรนไม่ทราบที่มา' : '✅ โดรนฝ่ายเรา'}
          		</h3>
          		<button
          		  onClick={() => setSelectedDrone(null)}
          		  style={{
          			background: 'transparent',
          			border: 'none',
          			color: '#fff',
          			cursor: 'pointer',
          			padding: '0.25rem',
          			display: 'flex',
          			alignItems: 'center',
          			justifyContent: 'center',
          			borderRadius: '4px',
          			transition: 'background 0.2s'
          		  }}
          		  onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
          		  onMouseLeave={(e) => e.target.style.background = 'transparent'}
          		>
          		  <X size={20} />
          		</button>
          	  </div>

          	  {/* Image Preview */}
          	  {selectedDrone.imageUrl && (
          		<div
          		  onClick={() => setSelectedImage(selectedDrone.imageUrl)}
          		  style={{
          			marginBottom: '1rem',
          			borderRadius: '8px',
          			overflow: 'hidden',
          			cursor: 'pointer',
          			position: 'relative',
          			border: '1px solid rgba(255,255,255,0.2)'
          		  }}
          		>
          		  <img
          			src={selectedDrone.imageUrl}
          			alt="Drone detection"
          			style={{ width: '100%', display: 'block' }}
          			onError={(e) => {
          			  e.target.style.display = 'none';
          			  e.target.parentElement.innerHTML = '<div style="padding: 2rem; text-align: center; opacity: 0.5;">ไม่สามารถโหลดรูปภาพได้</div>';
          			}}
          		  />
          		  <div style={{
          			position: 'absolute',
          			bottom: '8px',
          			right: '8px',
          			background: 'rgba(0,0,0,0.7)',
          			padding: '0.5rem',
          			borderRadius: '4px',
          			display: 'flex',
          			alignItems: 'center',
          			gap: '0.25rem'
          		  }}>
          			<Maximize2 size={14} />
          			<span style={{ fontSize: '0.75rem' }}>คลิกเพื่อขยาย</span>
          		  </div>
          		</div>
          	  )}

          	  <div style={{ fontSize: '0.9rem', lineHeight: '2' }}>
          		<div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '0.5rem' }}>
          		  <div style={{ opacity: 0.7 }}>Object ID:</div>
          		  <div style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
          			{selectedDrone.obj_id}
          		  </div>

          		  {selectedDrone.confidence && (
          			<>
          			  <div style={{ opacity: 0.7 }}>Confidence:</div>
          			  <div style={{ fontWeight: 'bold', color: selectedDrone.confidence > 0.8 ? '#22c55e' : '#ffaa00' }}>
          				{(selectedDrone.confidence * 100).toFixed(1)}%
          			  </div>
          			</>
          		  )}

          		  {selectedDrone.altitude && (
          			<>
          			  <div style={{ opacity: 0.7 }}>ความสูง:</div>
          			  <div>{selectedDrone.altitude.toFixed(1)} ม.</div>
          			</>
          		  )}

          		  {selectedDrone.weather && (
          			<>
          			  <div style={{ opacity: 0.7 }}>สภาพอากาศ:</div>
          			  <div style={{ textTransform: 'capitalize' }}>{selectedDrone.weather}</div>
          			</>
          		  )}

          		  {selectedDrone.dimensions && (
          			<>
          			  <div style={{ opacity: 0.7 }}>ขนาดตรวจจับ:</div>
          			  <div>{selectedDrone.dimensions.width.toFixed(2)} × {selectedDrone.dimensions.height.toFixed(2)} m</div>
          			</>
          		  )}

          		  <div style={{ opacity: 0.7 }}>ขนาดโดรน:</div>
          		  <div style={{ fontWeight: 'bold' }}>{getSizeLabel(selectedDrone.size)}</div>

          		  <div style={{ opacity: 0.7 }}>วัตถุประสงค์:</div>
          		  <div style={{
          			color: selectedDrone.objective === 'unknown' ? '#ffaa00' : '#22c55e',
          			fontWeight: 'bold'
          		  }}>
          			{selectedDrone.objective === 'unknown' ? '⚠️ ไม่ทราบ' : selectedDrone.objective}
          		  </div>

          		  <div style={{ opacity: 0.7 }}>ละติจูด:</div>
          		  <div>{selectedDrone.lat.toFixed(6)}°</div>

          		  <div style={{ opacity: 0.7 }}>ลองจิจูด:</div>
          		  <div>{selectedDrone.lng.toFixed(6)}°</div>

          		  <div style={{ opacity: 0.7 }}>กล้อง:</div>
          		  <div>{selectedDrone.camera?.name || 'N/A'}</div>

          		  <div style={{ opacity: 0.7 }}>สถานที่:</div>
          		  <div>{selectedDrone.camera?.location || 'N/A'}</div>

          		  <div style={{ opacity: 0.7 }}>หน่วยงาน:</div>
          		  <div>{selectedDrone.camera?.Institute || 'N/A'}</div>

          		  <div style={{ opacity: 0.7 }}>เวลาตรวจจับ:</div>
          		  <div>{new Date(selectedDrone.timestamp).toLocaleString('th-TH')}</div>
          		</div>
          	  </div>
          	</div>
          )}

          {/* Image Fullscreen Modal */}
          {selectedImage && (
          	<div
          	  onClick={() => setSelectedImage(null)}
          	  style={{
          		position: 'fixed',
          		top: 0,
          		left: 0,
          		right: 0,
          		bottom: 0,
          		background: 'rgba(0,0,0,0.95)',
          		display: 'flex',
          		alignItems: 'center',
          		justifyContent: 'center',
          		zIndex: 9999,
          		cursor: 'pointer',
          		padding: '2rem'
          	  }}
          	>
          	  <img
          		src={selectedImage}
          		alt="Full size"
          		style={{
          		  maxWidth: '100%',
          		  maxHeight: '100%',
          		  objectFit: 'contain',
          		  borderRadius: '8px',
          		  boxShadow: '0 0 50px rgba(0,0,0,0.8)'
          		}}
          	  />
          	  <button
          		onClick={() => setSelectedImage(null)}
          		style={{
          		  position: 'absolute',
          		  top: '20px',
          		  right: '20px',
          		  background: 'rgba(255,255,255,0.2)',
          		  border: 'none',
          		  color: '#fff',
          		  cursor: 'pointer',
          		  padding: '0.75rem',
          		  borderRadius: '50%',
          		  display: 'flex',
          		  alignItems: 'center',
          		  justifyContent: 'center',
          		  transition: 'background 0.2s'
          		}}
          		onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
          		onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          	  >
          		<X size={24} />
          	  </button>
          	</div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .drone-marker {
          pointer-events: auto;
        }
        .drone-marker .marker-content {
          pointer-events: none;
        }
      `}</style>
    </div>
  );
};

const DroneCard = ({ drone, type, onClick, onImageClick, getSizeLabel }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: type === 'enemy' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
        border: `1px solid ${type === 'enemy' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
        borderRadius: '8px',
        padding: '1rem',
        marginBottom: '0.75rem',
        cursor: 'pointer',
        transition: 'all 0.2s',
        transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
        boxShadow: isHovered ? `0 4px 12px ${type === 'enemy' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}` : 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            fontWeight: 'bold',
            color: type === 'enemy' ? '#ef4444' : '#22c55e',
            fontSize: '0.95rem'
          }}>
            {drone.obj_id}
          </span>
          {drone.imageUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onImageClick();
              }}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '4px',
                padding: '0.25rem 0.5rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
            	  gap: '0.25rem',
            	  color: '#fff',
            	  fontSize: '0.75rem'
            	}}
            >
            	<Camera size={12} />
            	รูป
            </button>
          )}
      	</div>
      	<span style={{
      	  fontSize: '0.75rem',
      	  padding: '0.25rem 0.5rem',
      	  background: type === 'enemy' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
      	  borderRadius: '4px',
      	  fontWeight: 'bold'
      	}}>
      	  {drone.droneType}
      	</span>
      </div>

      <div style={{ fontSize: '0.85rem', opacity: 0.9, lineHeight: '1.8' }}>
    	{drone.confidence && (
    	  <div style={{ marginBottom: '0.25rem' }}>
    		<strong>📊 Confidence:</strong>
    		<span style={{
    		  color: drone.confidence > 0.8 ? '#22c55e' : '#ffaa00',
    		  marginLeft: '0.25rem',
    		  fontWeight: 'bold'
    		}}>
    		  {(drone.confidence * 100).toFixed(1)}%
    		</span>
    	  </div>
    	)}
    	<div style={{ marginBottom: '0.25rem' }}>
    	  <strong>ขนาด:</strong> {getSizeLabel(drone.size)}
    	</div>
    	<div style={{ marginBottom: '0.25rem' }}>
    	  <strong>📍 ตำแหน่ง:</strong> {drone.lat.toFixed(4)}, {drone.lng.toFixed(4)}
    	</div>
    	{drone.altitude && (
    	  <div style={{ marginBottom: '0.25rem' }}>
    		<strong>✈️ ความสูง:</strong> {drone.altitude.toFixed(1)} ม.
    	  </div>
    	)}
    	{drone.weather && (
    	  <div style={{ marginBottom: '0.25rem' }}>
    		<strong>🌤️ สภาพอากาศ:</strong> <span style={{ textTransform: 'capitalize' }}>{drone.weather}</span>
    	  </div>
    	)}
    	<div style={{ marginBottom: '0.25rem' }}>
    	  <strong>🎯 วัตถุประสงค์:</strong>
    	  <span style={{
    		color: drone.objective === 'unknown' ? '#ffaa00' : '#22c55e',
    		marginLeft: '0.25rem'
    	  }}>
    		{drone.objective === 'unknown' ? 'ไม่ทราบ' : drone.objective}
    	  </span>
    	</div>
    	<div style={{ marginBottom: '0.25rem' }}>
    	  <strong>📹 กล้อง:</strong> {drone.camera?.name || 'N/A'}
    	</div>
    	<div style={{ opacity: 0.7, fontSize: '0.75rem' }}>
    	  🕐 {new Date(drone.timestamp).toLocaleString('th-TH')}
    	</div>
      </div>
    </div>
  );
};

export default DroneDetectionDashboard;