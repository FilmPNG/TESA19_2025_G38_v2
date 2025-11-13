import React, { useEffect, useState, useRef } from 'react';
import { AlertTriangle, History, Shield, X, Camera, Maximize2, Layers, Wifi, List, ChevronUp, ChevronDown, MapPin, Siren } from 'lucide-react';
import { useNavigate } from "react-router-dom";

const DroneDetectionDashboard = () => {
  const [enemyDrones, setEnemyDrones] = useState([]);
  const [friendlyDrones, setFriendlyDrones] = useState([]);
  const [selectedDrone, setSelectedDrone] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState({ enemy: 'disconnected', friendly: 'disconnected' });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [lastUpdate, setLastUpdate] = useState({ enemy: null, friendly: null });
  const [history, setHistory] = useState([]); // 🚩 State ใหม่สำหรับเก็บประวัติ
  const [is3D, setIs3D] = useState(false); // State สำหรับมุมมอง 3D
  const navigate = useNavigate();
  const [liveFilter, setLiveFilter] = useState('all'); // 'all', 'enemy', 'friendly'
  const [redZones, setRedZones] = useState([]);
  const [intrusionAlerts, setIntrusionAlerts] = useState([]);
  const [historyFilter, setHistoryFilter] = useState('all'); // 'all', 'enemy', 'friendly'
  const [sectionsCollapsed, setSectionsCollapsed] = useState({ enemy: false, friendly: false, history: false });
  const [trackedEnemyIds, setTrackedEnemyIds] = useState([]);
  const [locationName, setLocationName] = useState('N/A'); // 🚩 State ใหม่สำหรับเก็บชื่อสถานที่

  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef({ enemy: new Map(), friendly: new Map() });
  const socketRef = useRef(null); // 🚩 รวม Socket เป็นตัวเดียว

  const handleLogout = async () => {
    try {
      // เรียก backend logout
      const response = await fetch('http://localhost:3000/api/logout', {
        method: 'POST', // หรือ GET ขึ้นอยู่กับ backend
        credentials: 'include', // จำเป็นถ้าใช้ cookie
      });

      // ไม่ว่า response จะ ok หรือไม่ ก็เคลียร์ localStorage
      localStorage.removeItem('isLoggedIn');
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
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (map.current) {
        map.current.remove();
      }
    };
  }, []);

  // โหลดข้อมูลเริ่มต้นจาก API
  useEffect(() => {
    // 🚩 ย้ายการโหลดข้อมูล friendly มาตรงนี้ด้วย
    const loadInitialFriendlyData = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/recent/ours');
        const result = await response.json();
        if (result.success && result.data.length > 0) {
          console.log('📦 Loaded initial friendly drones:', result.data.length);
          result.data.forEach(data => handleFriendlyDroneData(data, false));
        }
      } catch (error) {
        console.error('Error loading initial friendly data:', error);
      }
    };

    const loadInitialData = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/recent/theirs');
        const result = await response.json();
        if (result.success && result.data.length > 0) {
          console.log('📦 Loaded initial enemy drones:', result.data.length);
          
          const uniqueIds = [...new Set(result.data.map(d => d.drone_id))];
          setTrackedEnemyIds(uniqueIds);
          
          if (socketRef.current && connectionStatus.enemy === 'connected') {
            uniqueIds.forEach(drone_id => {
              console.log(`🔔 Subscribing to drone: ${drone_id}`);
              socketRef.current.emit('subscribe_camera', { cam_id: drone_id });
            });
          }
          
          // 🚩 สร้าง Array ของโดรนทั้งหมดก่อน
          const initialDrones = result.data.map(data => {
            const imageUrl = data.image_path ? `http://localhost:3000${data.image_path}` : null;
            return {
              id: data.drone_id, // ใช้ drone_id เป็น id หลัก
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
                name: `กล้อง ทีมสวนและบ้าน`,
                location: 'นครนายก',
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
          // ใช้ Map เพื่อให้แน่ใจว่ามี drone_id ที่ไม่ซ้ำกัน และเก็บข้อมูลล่าสุดเสมอ
          const latestDronesMap = new Map();
          initialDrones.forEach(drone => {
            // จัดเรียงตาม timestamp แล้วเก็บตัวล่าสุด
            if (!latestDronesMap.has(drone.id) || new Date(drone.timestamp) > new Date(latestDronesMap.get(drone.id).timestamp)) {
              latestDronesMap.set(drone.id, drone);
            }
          });
          setEnemyDrones(Array.from(latestDronesMap.values()));
          // 🚩 ลบการเรียก `handleLocalDetectionData` ใน loop ทิ้ง
          // result.data.forEach(data => handleLocalDetectionData(data, 'enemy', false));
        }
      } catch (error) {
        console.error('Error loading initial data:', error);
      }
    };

    if (mapLoaded) {
      loadInitialData();
      loadInitialFriendlyData(); // 🚩 โหลดข้อมูลโดรนฝ่ายเราเริ่มต้น
      fetchRedZones();
    }
  }, [mapLoaded, connectionStatus.enemy]);

  // Fetch Red Zones
  const fetchRedZones = async () => {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const res = await fetch('http://localhost:3000/api/red-zone', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) {
            console.log(`🗺️ Dashboard: Fetched ${data.data.length} red zones.`);
            setRedZones(data.data);
        }
    } catch (err) {
        console.error("Failed to fetch red zones:", err);
    }
  };

  // Haversine distance formula
  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const \u03c61 = lat1 * Math.PI/180; // \u03c6, \u03bb in radians
    const \u03c62 = lat2 * Math.PI/180;
    const \u0394\u03c6 = (lat2-lat1) * Math.PI/180;
    const \u0394\u03bb = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(\u0394\u03c6/2) * Math.sin(\u0394\u03c6/2) +
              Math.cos(\u03c61) * Math.cos(\u03c62) *
              Math.sin(\u0394\u03bb/2) * Math.sin(\u0394\u03bb/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in metres
  }

  const [dronesInZone, setDronesInZone] = useState(new Set());

  // Effect for continuous intrusion alerts every 5 seconds
  useEffect(() => {
    const alertInterval = setInterval(() => {
      const allDrones = [...enemyDrones, ...friendlyDrones];
      let newAlerts = [];

      allDrones.forEach(drone => {
        redZones.forEach(zone => {
          const distance = getDistance(drone.lat, drone.lng, zone.center_lat, zone.center_lng);
          if (distance <= zone.radius_meters) {
            const droneTypeText = drone.type === 'enemy' ? 'ไม่ทราบที่มา' : 'ฝ่ายเรา';
            const alertId = `${drone.obj_id}-${zone.id}-${Date.now()}`;
            const newAlert = {
              id: alertId,
              message: `โดรน${droneTypeText} ID: ${drone.obj_id} บุกรุกพื้นที่สีแดง "${zone.name}"!`,
              droneType: drone.type
            };
            newAlerts.push(newAlert);
            console.warn(`🚨 RE-ALERT: Drone ${drone.obj_id} is still in Red Zone "${zone.name}"`);
          }
        });
      });

      if (newAlerts.length > 0) {
        setIntrusionAlerts(prev => [...newAlerts, ...prev.slice(0, 5 - newAlerts.length)]);
        newAlerts.forEach(alert => {
            setTimeout(() => setIntrusionAlerts(prev => prev.filter(a => a.id !== alert.id)), 10000);
        });
      }

    }, 5000); // Repeat every 5 seconds

    return () => clearInterval(alertInterval);
  }, [enemyDrones, friendlyDrones, redZones]);

  const checkIntrusion = (drone) => {
    if (!redZones.length) return;
  
    redZones.forEach(zone => {
        const distance = getDistance(drone.lat, drone.lng, zone.center_lat, zone.center_lng);
        const droneZoneId = `${drone.obj_id}-${zone.id}`;
  
        if (distance <= zone.radius_meters) {
            // This function is now just for initial detection logging and state management
            // The continuous alert is handled by the useEffect interval
            console.log(`✅ Drone ${drone.obj_id} is inside Red Zone "${zone.name}"`);
        } else {
            if (dronesInZone.has(droneZoneId)) {
                console.log(`✅ Drone ${drone.obj_id} has left Red Zone "${zone.name}"`);
            }
        }
    });
  };

  // Subscribe เมื่อ Socket เชื่อมต่อหรือ trackedEnemyIds เปลี่ยน
  useEffect(() => {
    if (socketRef.current && connectionStatus.enemy === 'connected' && trackedEnemyIds.length > 0) {
      console.log('🔄 Subscribing to', trackedEnemyIds.length, 'drone IDs...');
      trackedEnemyIds.forEach(cam_id => {
        socketRef.current.emit('subscribe_camera', { cam_id });
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
      // ถ้ามีโดรนถูกเลือกจาก history ให้แสดงแค่ตัวนั้น
      if (selectedDrone) {
        const markersToShow = selectedDrone.type === 'enemy' ? [selectedDrone] : [];
        updateMarkers(markersToShow, 'enemy');
      } else {
        // ถ้าไม่มี ให้แสดงตาม live filter
        const showEnemy = liveFilter === 'all' || liveFilter === 'enemy';
        updateMarkers(showEnemy ? enemyDrones : [], 'enemy');
      }
    }
  }, [enemyDrones, mapLoaded, liveFilter, selectedDrone]);

  // 🚩 5. เพิ่ม Effect ใหม่: คอย Sync state 'friendlyDrones' ไปยัง Map
  useEffect(() => {
    if (mapLoaded && map.current) {
      // ถ้ามีโดรนถูกเลือกจาก history ให้แสดงแค่ตัวนั้น
      if (selectedDrone) {
        const markersToShow = selectedDrone.type === 'friendly' ? [selectedDrone] : [];
        updateMarkers(markersToShow, 'friendly');
      } else {
        const showFriendly = liveFilter === 'all' || liveFilter === 'friendly';
        updateMarkers(showFriendly ? friendlyDrones : [], 'friendly');
      }
    }
  }, [friendlyDrones, mapLoaded, liveFilter, selectedDrone]);

  // Effect for rendering Red Zones
  useEffect(() => {
    if (mapLoaded && map.current && redZones.length > 0) {
        const sourceId = 'dashboard-red-zones-source';
        const layerId = 'dashboard-red-zones-layer';

        const source = map.current.getSource(sourceId);
        const geoJSON = {
            type: 'FeatureCollection',
            features: redZones.map(zone => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [zone.center_lng, zone.center_lat]
                },
                properties: { radius: zone.radius_meters }
            }))
        };

        if (source) {
            source.setData(geoJSON);
        } else {
            map.current.addSource(sourceId, { type: 'geojson', data: geoJSON });
            map.current.addLayer({
                id: layerId,
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-radius': ['get', 'radius'],
                    'circle-color': '#ef4444',
                    'circle-opacity': 0.3,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ef4444',
                    'circle-stroke-opacity': 0.8
                }
            });
        }
    }
  }, [redZones, mapLoaded]);

  // Effect สำหรับจัดการมุมมอง 3D
  useEffect(() => {
    if (mapLoaded && map.current) {
      if (is3D) {
        // เพิ่ม source สำหรับข้อมูลความสูง (DEM) ถ้ายังไม่มี
        if (!map.current.getSource('mapbox-dem')) {
          map.current.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
            'tileSize': 512,
            'maxzoom': 14
          });
        }
        // ตั้งค่าภูมิประเทศ (terrain)
        map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
        // ปรับมุมมองให้เอียง
        map.current.easeTo({ pitch: 60, duration: 1000 });
      } else {
        // ปรับมุมมองกลับเป็น 2D
        map.current.easeTo({ pitch: 0, duration: 1000 });
        // นำ terrain ออก (รอให้ animation จบก่อน)
        const transitionEndHandler = () => {
          if (map.current.getPitch() === 0) {
            map.current.setTerrain(null);
          }
          map.current.off('moveend', transitionEndHandler);
        };
        map.current.on('moveend', transitionEndHandler);
      }
    }
  }, [is3D, mapLoaded]);

  // [แก้ไข] Effect สำหรับอัปเดตข้อมูลใน Card เมื่อโดรนที่เลือกมีการอัปเดต
  useEffect(() => {
    if (selectedDrone) {
      const allDrones = [...enemyDrones, ...friendlyDrones];
      const updatedDrone = allDrones.find(d => d.id === selectedDrone.id);

      if (updatedDrone) {
        // ตรวจสอบว่าข้อมูลมีการเปลี่ยนแปลงจริงก่อน set state เพื่อป้องกัน re-render ที่ไม่จำเป็น
        if (JSON.stringify(updatedDrone) !== JSON.stringify(selectedDrone)) {
          console.log(`🔄 Updating selected drone card for ID: ${selectedDrone.id}`);
          setSelectedDrone(updatedDrone);
        }
      }
    }
    // Dependency array: ทำงานเมื่อรายการโดรนหรือโดรนที่เลือกเปลี่ยนไป
  }, [enemyDrones, friendlyDrones, selectedDrone?.id]);

  // 🚩 Effect ใหม่: แปลงพิกัดเป็นชื่อสถานที่เมื่อเลือกโดรน
  useEffect(() => {
    if (selectedDrone?.lat && selectedDrone?.lng) {
      setLocationName('กำลังค้นหา...'); // แสดงสถานะกำลังโหลด

      const fetchLocationName = async () => {
        try {
          const { lng, lat } = selectedDrone;
          const accessToken = 'pk.eyJ1IjoiY2hhdGNoYWxlcm0iLCJhIjoiY21nZnpiYzU3MGRzdTJrczlkd3RxamN4YyJ9.k288gnCNLdLgczawiB79gQ';
          // ใช้ endpoint ของ Mapbox Geocoding API
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=region,province&access_token=${accessToken}`;
          
          const response = await fetch(url);
          const data = await response.json();

          if (data.features && data.features.length > 0) {
            // Mapbox จะส่งข้อมูลสถานที่มาใน context, เราจะหาอันที่เป็น region (จังหวัด)
            const provinceFeature = data.features.find(f => f.id.startsWith('region'));
            if (provinceFeature) {
              setLocationName(provinceFeature.text);
            } else {
              // ถ้าไม่เจอจังหวัด ให้ใช้ชื่อสถานที่ที่ใหญ่ที่สุดที่หาได้
              setLocationName(data.features[0].place_name.split(',').pop().trim());
            }
          } else {
            setLocationName('นครนายก');
          }
        } catch (error) {
          console.error('Failed to fetch location name:', error);
          setLocationName('ข้อผิดพลาด');
        }
      };
      fetchLocationName();
    }
  }, [selectedDrone?.lat, selectedDrone?.lng]); // ทำงานเมื่อพิกัดของโดรนที่เลือกเปลี่ยนไป

  const initializeMap = () => {
    if (!window.mapboxgl || map.current) return;

    window.mapboxgl.accessToken = 'pk.eyJ1IjoiY2hhdGNoYWxlcm0iLCJhIjoiY21nZnpiYzU3MGRzdTJrczlkd3RxamN4YyJ9.k288gnCNLdLgczawiB79gQ';

    map.current = new window.mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12', // เปลี่ยนเป็นภาพถ่ายดาวเทียม
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

    // 🚩 Connect to our backend
    socketRef.current = window.io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
        console.log('✅ Connected to backend socket server');
        // 🚩 ตั้งสถานะการเชื่อมต่อทั้งสองระบบเป็น 'connected'
        setConnectionStatus({ enemy: 'connected', friendly: 'connected' });
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected from backend socket server');
      // 🚩 ตั้งสถานะการเชื่อมต่อทั้งสองระบบเป็น 'disconnected'
      setConnectionStatus({ enemy: 'disconnected', friendly: 'disconnected' });
    });

    socket.on('connect_error', (error) => {
      console.error('Backend connection error:', error);
      // 🚩 ตั้งสถานะการเชื่อมต่อทั้งสองระบบเป็น 'error'
      setConnectionStatus({ enemy: 'error', friendly: 'error' });
    });

    // --- Enemy Drone Listeners ---
    socket.on('drone-theirs-detected', (data) => {
      console.log('📡 Enemy detection received (local backend):', data);
      handleLocalDetectionData(data, 'enemy', true);
    });

    socket.on('drone-theirs-updated', (data) => {
      console.log('🔄 Enemy update received (local backend):', data);
      handleLocalDetectionData(data, 'enemy', true);
    });

    // --- Friendly Drone Listener (from MQTT via backend) ---
    socket.on('drone-ours-update', (data) => {
      console.log('📡 Friendly drone update received (from MQTT):', data);
      handleFriendlyDroneData(data, true);
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
      id: data.drone_id, // 🚩 ใช้ drone_id เป็น ID หลักสำหรับ state
      obj_id: data.id, 
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
        name: `กล้อง ทีมสวนและบ้าน`,
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

    // 🚩 เพิ่มข้อมูลเข้า History (เก็บสูงสุด 50 รายการล่าสุด)
    setHistory(prevHistory => [drone, ...prevHistory].slice(0, 50));

    // Check for intrusion
    checkIntrusion(drone);

    // 🚩 อัปเดต State โดยใช้ functional update form
    // 🚩 (ลบ if(mapLoaded) และ if(!mapLoaded) ทิ้ง)
    setEnemyDrones(prevDrones => {
      const existingDroneIndex = prevDrones.findIndex(d => d.id === drone.id);
      if (existingDroneIndex !== -1) {
        // ถ้าเจอโดรนเดิม (id เดียวกัน) ให้อัปเดตข้อมูล
        const updatedDrones = [...prevDrones];
        updatedDrones[existingDroneIndex] = drone;
        return updatedDrones;
      }
      // ถ้าเป็นโดรนใหม่ ให้เพิ่มเข้าไป
      return [...prevDrones, drone];
    });

    // 🚩 [แก้ไข] ตรวจสอบและเพิ่ม drone_id ใหม่เข้าไปใน state ที่ใช้ subscribe
    setTrackedEnemyIds(prevIds => {
      if (!prevIds.includes(data.drone_id)) {
        console.log(`✨ New drone_id found, adding to subscription list: ${data.drone_id}`);
        return [...prevIds, data.drone_id];
      }
      return prevIds;
    });
  };

  // 🚩 4. สร้างฟังก์ชันใหม่สำหรับข้อมูลโดรนฝ่ายเรา
  const handleFriendlyDroneData = (data, updateTimestamp = true) => {
    if (!data) return;

    if (updateTimestamp) {
      setLastUpdate(prev => ({ ...prev, friendly: new Date().toISOString() }));
    }

    const drone = {
      id: data.drone_id,
      obj_id: data.drone_id, // ใช้ drone_id เป็น obj_id ไปก่อน
      type: 'friendly',
      lat: parseFloat(data.lat || data.latitude),
      lng: parseFloat(data.lng || data.longitude),
      altitude: parseFloat(data.altitude),
      objective: 'patrol',
      size: 'medium',
      droneType: 'fixed-wing',
      timestamp: data.detected_at,
      camera: { name: 'Onboard GPS', location: 'นครนายก', Institute: 'มหาวิทยาลัยมหิดล' }
    };

    // 🚩 เพิ่มข้อมูลเข้า History (เก็บสูงสุด 50 รายการล่าสุด)
    setHistory(prevHistory => [drone, ...prevHistory].slice(0, 50));
    
    // Check for intrusion for each friendly drone
    checkIntrusion(drone);

    // 🚩 อัปเดต State เท่านั้น
    setFriendlyDrones(prevDrones => {
      const existingIndex = prevDrones.findIndex(d => d.id === drone.id);
      if (existingIndex !== -1) {
        const updatedDrones = [...prevDrones];
        updatedDrones[existingIndex] = drone;
        return updatedDrones;
      }
      return [...prevDrones, drone];
    });
  };

  const updateMarkers = (drones, type, append = false) => {
    if (!window.mapboxgl || !map.current) {
        console.log('⚠️ Mapbox not ready');
        return;
    }

    console.log(`🚁 Updating ${type} markers:`, drones.length);

    const markers = markersRef.current[type];
    const newDroneIds = new Set(drones.map(d => d.id));
    
    // 1. ตรวจสอบ Marker ที่ควรถูกลบออก
    if (!append) {
      const markersToRemove = [];
      markers.forEach((marker, droneId) => {
          if (!newDroneIds.has(droneId)) {
              marker.remove();
              markersToRemove.push(droneId);
          }
      });
      markersToRemove.forEach(droneId => markers.delete(droneId));
    }


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
            const badgeIcon = type === 'enemy' ? '🚨' : '✅';
            const mainIcon = type === 'enemy' ? '🛸' : '✈️';

            el.style.cssText = `
                width: 50px;
                height: 50px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            // 🚩 [แก้ไข] โค้ด HTML ทั้งหมดนี้คือฉบับที่ถูกต้อง
            el.innerHTML = `
                 <div class="marker-wrapper" style="
                     position: relative;
                     width: 60px;
                     height: 60px;
                     display: flex;
                     align-items: center;
                     justify-content: center;
                 ">
                   <!-- Animated scanning circles -->
                   <div class="scan-circle scan-circle-1" style="
                     position: absolute;
                     width: 60px;
                     height: 60px;
                     border: 2px solid ${color};
                     border-radius: 50%;
                     opacity: 0;
                     animation: scan 2s ease-out infinite;
                   "></div>
                   <div class="scan-circle scan-circle-2" style="
                     position: absolute;
                     width: 60px;
                     height: 60px;
                     border: 2px solid ${color};
                     border-radius: 50%;
                     opacity: 0;
                     animation: scan 2s ease-out infinite 0.7s;
                   "></div>
                   <div class="scan-circle scan-circle-3" style="
                     position: absolute;
                     width: 60px;
                     height: 60px;
                     border: 2px solid ${color};
                     border-radius: 50%;
                     opacity: 0;
                     animation: scan 2s ease-out infinite 1.4s;
                   "></div>
                   
                   <!-- Rotating border -->
                   <div class="rotating-border" style="
                     position: absolute;
                     width: 54px;
                     height: 54px;
                     border-radius: 50%;
                     border: 3px solid transparent;
                     border-top-color: ${color};
                     border-right-color: ${color};
                     animation: rotate 3s linear infinite;
                   "></div>
                   
                   <!-- Main marker content -->
                   <div class="marker-content" style="
                     background: linear-gradient(135deg, ${bgColor} 0%, ${type === 'enemy' ? 'rgba(220, 38, 38, 0.95)' : 'rgba(22, 163, 74, 0.95)'} 100%);
                     width: 48px;
                     height: 48px;
                     border-radius: 50%;
                     display: flex;
                     align-items: center;
                     justify-content: center;
                     border: 3px solid white;
                     box-shadow: 0 0 20px ${color}, 0 4px 15px rgba(0,0,0,0.6), inset 0 2px 10px rgba(255,255,255,0.2);
                     position: relative;
                     transition: all 0.3s ease;
                     z-index: 2;
                   ">
                     <!-- Drone SVG Icon -->
                     <svg width="32" height="32" viewBox="0 0 64 64" fill="white" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
                       ${type === 'enemy' 
                         ? `
                         <!-- Enemy Drone (Quadcopter with X shape) -->
                         <g>
                           <!-- Center body -->
                           <circle cx="32" cy="32" r="6" fill="white"/>
                           <circle cx="32" cy="32" r="4" fill="${color}"/>
                           
                           <!-- Arms (X pattern) -->
                           <line x1="32" y1="32" x2="18" y2="18" stroke="white" stroke-width="3" stroke-linecap="round"/>
                           <line x1="32" y1="32" x2="46" y2="18" stroke="white" stroke-width="3" stroke-linecap="round"/>
                           <line x1="32" y1="32" x2="18" y2="46" stroke="white" stroke-width="3" stroke-linecap="round"/>
                           <line x1="32" y1="32" x2="46" y2="46" stroke="white" stroke-width="3" stroke-linecap="round"/>
                           
                           <!-- Propellers -->
                           <circle cx="18" cy="18" r="5" fill="white" opacity="0.8"/>
                           <circle cx="46" cy="18" r="5" fill="white" opacity="0.8"/>
                           <circle cx="18" cy="46" r="5" fill="white" opacity="0.8"/>
                           <circle cx="46" cy="46" r="5" fill="white" opacity="0.8"/>
                           
                           <!-- Propeller blades -->
                           <ellipse cx="18" cy="18" rx="8" ry="2" fill="white" opacity="0.6" transform="rotate(45 18 18)"/>
                           <ellipse cx="46" cy="18" rx="8" ry="2" fill="white" opacity="0.6" transform="rotate(-45 46 18)"/>
                           <ellipse cx="18" cy="46" rx="8" ry="2" fill="white" opacity="0.6" transform="rotate(-45 18 46)"/>
                           <ellipse cx="46" cy="46" rx="8" ry="2" fill="white" opacity="0.6" transform="rotate(45 46 46)"/>
                         </g>
                         `
                         : `
                         <!-- Friendly Drone (Fixed-wing) -->
                         <g>
                           <!-- Fuselage -->
                           <ellipse cx="32" cy="32" rx="4" ry="12" fill="white"/>
                           
                           <!-- Wings -->
                           <ellipse cx="32" cy="32" rx="24" ry="6" fill="white" opacity="0.9"/>
                           
                           <!-- Tail -->
                           <path d="M 32 44 L 28 54 L 32 52 L 36 54 Z" fill="white" opacity="0.9"/>
                           
                           <!-- Cockpit -->
                           <circle cx="32" cy="26" r="3" fill="${color}" opacity="0.8"/>
                           
                           <!-- Wing details -->
                           <line x1="20" y1="32" x2="44" y2="32" stroke="${color}" stroke-width="1" opacity="0.5"/>
                         </g>
                         `}
                     </svg>
                     
                     <!-- Alert Badge -->
                     <div style="
                       position: absolute;
                       top: -10px;
                       right: -10px;
                       background: ${type === 'enemy' ? '#dc2626' : '#16a34a'};
                       width: 24px;
                       height: 24px;
                       border-radius: 50%;
                       display: flex;
                       align-items: center;
                       justify-content: center;
                       border: 3px solid white;
                       box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                       font-weight: bold;
                       font-size: 12px;
                       color: white;
                       animation: pulse-badge 2s ease-in-out infinite;
                     ">
                       ${type === 'enemy' ? '!' : '✓'}
                     </div>
                     
                     
                     
                     <!-- Glow effect -->
                     <div style="
                       position: absolute;
                       width: 300%;
                       height: 300%;
                       border-radius: 50%;
                       background: radial-gradient(circle, ${color}40 0%, transparent 70%);
                       animation: glow-pulse 2s ease-in-out infinite;
                     "></div>
                   </div>
                 </div>
            `;

            const marker = new window.mapboxgl.Marker({
                element: el,
                anchor: 'bottom'
            })
                .setLngLat([drone.lng, drone.lat])
                .addTo(map.current);

            // ... (Event Listeners เหมือนเดิม)
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
  };

  const filteredHistory = history.filter(drone => {
    if (historyFilter === 'all') return true;
    return drone.type === historyFilter;
  });


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

        {/* Intrusion Alerts */}
        <div style={{ position: 'absolute', top: '100px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {intrusionAlerts.map(alert => (
                <div key={alert.id} style={{
                    background: 'linear-gradient(135deg, #b91c1c, #ef4444)',
                    color: 'white',
                    padding: '1rem 1.5rem',
                    borderRadius: '8px',
                    boxShadow: '0 4px 15px rgba(239, 68, 68, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    animation: 'fade-in-down 0.5s ease-out forwards'
                }}>
                    <Siren size={24} />
                    <span style={{ fontWeight: 'bold' }}>
                        {alert.message}
                    </span>
                </div>
            ))}
        </div>

        {/* Live Filter Toggles */}
        <div style={{
        	display: 'flex',
        	background: 'rgba(0,0,0,0.2)',
        	padding: '0.3rem',
        	borderRadius: '8px',
        	gap: '0.3rem',
        	minWidth: '400px'
        }}>
        	{[
        		{ key: 'all', label: 'ทั้งหมด', icon: <List size={16} /> },
        		{ key: 'enemy', label: 'ไม่ทราบที่มา', icon: <AlertTriangle size={16} /> },
        		{ key: 'friendly', label: 'ฝ่ายเรา', icon: <Shield size={16} /> }
        	].map(item => (
        		<button
        			key={item.key}
        			onClick={() => {
        			  setLiveFilter(item.key);
        			  setSelectedDrone(null); // เคลียร์โดรนที่เลือกจาก history เมื่อเปลี่ยน filter
        			}}
        			style={{
        				flex: 1,
        				background: liveFilter === item.key
        					? (item.key === 'enemy' ? '#ef4444' : item.key === 'friendly' ? '#22c55e' : '#3b82f6')
        					: 'transparent',
        				color: '#fff',
        				border: 'none',
        				padding: '0.5rem 1rem',
        				borderRadius: '6px',
        				cursor: 'pointer',
        				fontWeight: 'bold',
        				display: 'flex',
        				alignItems: 'center', 
        				whiteSpace: 'nowrap', // เพิ่มเพื่อให้ข้อความไม่ขึ้นบรรทัดใหม่
        				justifyContent: 'center',
        				gap: '0.5rem',
        				transition: 'background 0.2s'
        			}}
        		>
        			{item.icon} {item.label}
        		</button>
        	))}
        </div>

        {/* Red Zone Button */}
        <button
        	onClick={() => navigate('/redzone')}
        	style={{
        		background: 'rgba(239, 68, 68, 0.8)',
        		color: '#fff',
        		border: '1px solid #ef4444',
        		padding: '0.5rem 1rem',
        		borderRadius: '6px',
        		cursor: 'pointer',
        		fontWeight: 'bold',
        		display: 'flex', alignItems: 'center', gap: '0.5rem',
        		transition: 'background 0.2s'
        	}}
        	onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(220, 38, 38, 1)'}
        	onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.8)'}
        >
        	<MapPin size={16} /> จัดการพื้นที่สีแดง
        </button>

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
        	<>
        		{/* Enemy Drones */}
        		{(liveFilter === 'all' || liveFilter === 'enemy') && (
        		<div style={{ marginBottom: '1.5rem' }}>
        		  <div 
					onClick={() => setSectionsCollapsed(prev => ({ ...prev, enemy: !prev.enemy }))}
					style={{
            	display: 'flex',
            	alignItems: 'center',
            	justifyContent: 'space-between',
            	marginBottom: sectionsCollapsed.enemy ? '0' : '1rem',
            	padding: '0.75rem',
            	background: 'rgba(239, 68, 68, 0.2)',
            	borderRadius: '8px',
            	border: '1px solid rgba(239, 68, 68, 0.5)',
					cursor: 'pointer',
					transition: 'margin-bottom 0.3s ease'
        		  }}>
        			<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            	  <AlertTriangle size={20} color="#ef4444" />
        			  <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
            		โดรนไม่ทราบที่มา
            	  </h2>
            	</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
						<span style={{
						background: 'rgba(239, 68, 68, 0.3)',
						padding: '0.25rem 0.75rem',
						borderRadius: '12px',
						fontSize: '0.9rem',
						fontWeight: 'bold'
						}}>
						{enemyDrones.length}
						</span>
						{sectionsCollapsed.enemy ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
					</div>
        		  </div>
				  {!sectionsCollapsed.enemy && (
					<>
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
					</>
				  )}
        		</div>
        		)}

        		{/* Friendly Drones */}
        		{(liveFilter === 'all' || liveFilter === 'friendly') && (
        		<div>
        		  <div 
					onClick={() => setSectionsCollapsed(prev => ({ ...prev, friendly: !prev.friendly }))}
					style={{
            	display: 'flex',
            	alignItems: 'center',
            	justifyContent: 'space-between',
            	marginBottom: sectionsCollapsed.friendly ? '0' : '1rem',
            	padding: '0.75rem',
            	background: 'rgba(34, 197, 94, 0.2)',
            	borderRadius: '8px',
            	border: '1px solid rgba(34, 197, 94, 0.5)',
					cursor: 'pointer',
					transition: 'margin-bottom 0.3s ease'
        		  }}>
        			<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            	  <Shield size={20} color="#22c55e" />
        			  <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
            		โดรนฝ่ายเรา
            	  </h2>
            	</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
						<span style={{
						background: 'rgba(34, 197, 94, 0.3)',
						padding: '0.25rem 0.75rem',
						borderRadius: '12px',
						fontSize: '0.9rem',
						fontWeight: 'bold'
						}}>
						{friendlyDrones.length}
						</span>
						{sectionsCollapsed.friendly ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
					</div>
        		  </div>
				  {!sectionsCollapsed.friendly && (
					<>
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
					</>
				  )}
        		</div>
        		)}

        	{/* Detection History */}
        	<div style={{ marginTop: '1.5rem' }}>
        	  <div
        		onClick={() => setSectionsCollapsed(prev => ({ ...prev, history: !prev.history }))}
        		style={{
        		  display: 'flex',
        		  alignItems: 'center',
        		  justifyContent: 'space-between',
        		  marginBottom: sectionsCollapsed.history ? '0' : '1rem',
        		  padding: '0.75rem',
        		  background: 'rgba(99, 102, 241, 0.2)',
        		  borderRadius: '8px',
        		  border: '1px solid rgba(99, 102, 241, 0.5)',
        		  cursor: 'pointer',
        		  transition: 'margin-bottom 0.3s ease'
        		}}
        	  >
        		<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        		  <History size={20} color="#818cf8" />
        		  <h2 style={{ margin: 0, fontSize: '1.1rem' }}>ประวัติการตรวจจับ</h2>
        		</div>
        		<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        		  <span style={{
        			background: 'rgba(99, 102, 241, 0.3)',
        			padding: '0.25rem 0.75rem',
        			borderRadius: '12px',
        			fontSize: '0.9rem',
        			fontWeight: 'bold'
        		  }}>
        			{filteredHistory.length}
        		  </span>
        		  {sectionsCollapsed.history ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        		</div>
        	  </div>
        	  {!sectionsCollapsed.history && (
        		<div style={{ marginTop: '0rem' }}>
        		  <div style={{
        			display: 'block',
        			alignItems: 'center',
        			justifyContent: 'space-between',
        			marginBottom: '1rem',
        			padding: '0.75rem',
        			background: 'rgba(99, 102, 241, 0.1)',
        			borderRadius: '8px',
        			border: '1px solid rgba(99, 102, 241, 0.3)'
        		  }}>
        			{/* Filter Buttons */}
        			<div style={{ display: 'flex', gap: '0.5rem' }}>
        			  {['all', 'enemy', 'friendly'].map(filter => (
        				<button
        				  key={filter}
        				  onClick={(e) => {
        					e.stopPropagation();
        					setHistoryFilter(filter);
        				  }}
        				  style={{
        					flex: 1,
        					background: historyFilter === filter ? '#3b82f6' : 'rgba(255,255,255,0.1)',
        					color: '#fff',
        					border: '1px solid',
        					borderColor: historyFilter === filter ? '#3b82f6' : 'rgba(255,255,255,0.2)',
        					padding: '0.4rem 0.5rem',
        					borderRadius: '6px',
        					cursor: 'pointer',
        					fontWeight: 'bold',
        					fontSize: '0.8rem',
        					transition: 'all 0.2s'
        				  }}
        				>
        				  {filter === 'all' ? 'ทั้งหมด' : filter === 'enemy' ? 'ไม่ทราบที่มา' : 'ฝ่ายเรา'}
        				</button>
        			  ))}
        			</div>
        		  </div>
        		  {filteredHistory.length === 0 ? (
        			<div style={{ textAlign: 'center', padding: '2rem', opacity: 0.6, fontSize: '0.9rem' }}>
        			  {history.length === 0 ? 'ยังไม่มีประวัติการตรวจจับ' : 'ไม่พบข้อมูลตามตัวกรอง'}
        			</div>
        		  ) : (
        			<div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '0.5rem' }}>
        			  {filteredHistory.map((drone, index) => (
        				<DroneHistoryCard
        				  key={`${drone.id}-${index}`}
        				  drone={drone}
        				  isSelected={selectedDrone?.id === drone.id && selectedDrone?.timestamp === drone.timestamp}
        				  onClick={(e) => {
        					e.stopPropagation();
        					setSelectedDrone(drone);
        					if (map.current && mapLoaded) {
        					  map.current.flyTo({
        						center: [drone.lng, drone.lat],
        						zoom: 16,
        						duration: 1000
        					  });
        					}
        				  }}
        				/>
        			  ))}
        			</div>
        		  )}
        		</div>
        	  )}
        	</div>
        </>
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

          {/* 3D Toggle Button */}
          {mapLoaded && (
          	<div style={{
          	  position: 'absolute',
          	  top: '90px',
          	  right: '10px',
          	  zIndex: 1,
          	}}>
          	  <button
          		onClick={() => setIs3D(!is3D)}
          		style={{
          		  background: `rgba(21, 27, 61, ${is3D ? '0.9' : '0.7'})`,
          		  color: '#fff',
          		  border: `1px solid ${is3D ? '#3b82f6' : 'rgba(255,255,255,0.3)'}`,
          		  padding: '0.5rem',
          		  borderRadius: '8px',
          		  cursor: 'pointer',
          		  display: 'flex',
          		  alignItems: 'center',
          		  gap: '0.5rem',
          		  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          		  backdropFilter: 'blur(5px)',
          		  transition: 'all 0.2s ease'
          		}}
          	  >
          		<Layers size={18} color={is3D ? '#3b82f6' : '#fff'} />
          		<span style={{ fontWeight: 'bold' }}>{is3D ? '3D' : '2D'}</span>
          	  </button>
          	</div>
          )}

          {/* Drone Details Modal */}
          {selectedDrone && (
          	<div style={{
          	  position: 'absolute',
          	  top: '20px',
          	  right: '20px',
          	  background: 'rgba(21, 27, 61, 0.95)', // ลดความทึบเล็กน้อย
          	  padding: '1.25rem', // ลด Padding
          	  borderRadius: '12px',
          	  minWidth: '320px',  // ลดความกว้างขั้นต่ำ
          	  maxWidth: '380px',  // ลดความกว้างสูงสุด
          	  maxHeight: 'calc(100vh - 140px)', // ปรับความสูงเผื่อ
          	  overflowY: 'auto',
          	  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          	  border: `2px solid ${selectedDrone.type === 'enemy' ? '#ef4444' : '#22c55e'}`,
          	  backdropFilter: 'blur(10px)'
          	}}>
          	  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
          		<h3 style={{
          		  margin: 0,
          		  color: selectedDrone.type === 'enemy' ? '#ef4444' : '#22c55e',
          		  fontSize: '1.1rem', // ลดขนาดฟอนต์หัวข้อ
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

          	  <div style={{ fontSize: '0.85rem', lineHeight: '1.9' }}> 
          		<div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0.4rem' }}>
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

          		  {selectedDrone.altitude !== undefined && (
          			<>
          			  <div style={{ opacity: 0.7 }}>ความสูง:</div>
          			  <div>{selectedDrone.altitude.toFixed(1)} ม.</div>
          			</>
          		  )}

          		  {selectedDrone.weather !== undefined && (
          			<>
          			  <div style={{ opacity: 0.7 }}>สภาพอากาศ:</div>
          			  <div style={{ textTransform: 'capitalize' }}>{selectedDrone.weather}</div>
          			</>
          		  )}

          		  {selectedDrone.dimensions !== undefined && (
          			<>
          			  <div style={{ opacity: 0.7 }}>ขนาดตรวจจับ:</div>
          			  <div>{selectedDrone.dimensions.width.toFixed(2)} × {selectedDrone.dimensions.height.toFixed(2)} m</div>
          			</>
          		  )}

          		  {selectedDrone.objective !== undefined && (
          			<>
          			  <div style={{ opacity: 0.7 }}>วัตถุประสงค์:</div>
          			  <div style={{
          				color: selectedDrone.objective === 'unknown' ? '#ffaa00' : '#22c55e',
          				fontWeight: 'bold'
          			  }}>
          				{selectedDrone.objective === 'unknown' ? '⚠️ ไม่ทราบ' : selectedDrone.objective}
          			  </div>
          			</>
          		  )}

          		  {selectedDrone.lat !== undefined && (
          			<>
          			  <div style={{ opacity: 0.7 }}>ละติจูด:</div>
          			  <div>{selectedDrone.lat.toFixed(6)}°</div>
          			</>
          		  )}

          		  {selectedDrone.lng !== undefined && (
          			<>
          			  <div style={{ opacity: 0.7 }}>ลองจิจูด:</div>
          			  <div>{selectedDrone.lng.toFixed(6)}°</div>
          			</>
          		  )}

          		  <div style={{ opacity: 0.7 }}>กล้อง:</div>
          		  <div>{selectedDrone.camera?.name || 'N/A'}</div>


          		  <div style={{ opacity: 0.7 }}>จังหวัด:</div>
          		  <div>{locationName}</div>

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
        @keyframes fade-in-down {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
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
    	  <strong>📹 กล้อง:</strong> {'ทีมสวนและบ้าน'}
    	</div>
    	<div style={{ opacity: 0.7, fontSize: '0.75rem' }}>
    	  🕐 {new Date(drone.timestamp).toLocaleString('th-TH')}
    	</div>
      </div>
    </div>
  );
};

const DroneHistoryCard = ({ drone, onClick, isSelected }) => {
  const type = drone.type;
  const color = type === 'enemy' ? '#ef4444' : '#22c55e';
  const icon = type === 'enemy' ? '🛸' : '✈️';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem', 
        background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)',
        padding: '0.75rem',
        borderRadius: '6px',
        marginBottom: '0.5rem',
        cursor: 'pointer',
        borderLeft: `4px solid ${color}`,
        transition: 'background 0.2s ease'
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = isSelected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.07)'}
      onMouseLeave={(e) => e.currentTarget.style.background = isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)'}
    >
      <div style={{ fontSize: '1.5rem' }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', color: '#fff', fontFamily: 'monospace' }}>
            ID: {drone.obj_id}
          </span>
          <span style={{ fontSize: '0.75rem', color: color, fontWeight: 'bold' }}>
            {type === 'enemy' ? 'THREAT' : 'FRIENDLY'}
          </span>
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.25rem' }}>
        	{new Date(drone.timestamp).toLocaleDateString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      </div>
    </div>
  );
};


export default DroneDetectionDashboard;