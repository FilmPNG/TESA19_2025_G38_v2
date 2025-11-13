import React, { useEffect, useState, useRef } from 'react';
import { MapPin, Plus, Trash2, Edit, X, Save, ArrowLeft } from 'lucide-react';
import { useNavigate } from "react-router-dom";
import io from 'socket.io-client';

const RedZone = () => {
    const navigate = useNavigate();
    const mapContainer = useRef(null);
    const map = useRef(null);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [redZones, setRedZones] = useState([]);
    const [isAdding, setIsAdding] = useState(false);
    const [newZone, setNewZone] = useState({ name: '', center_lat: null, center_lng: null, radius_meters: 100 });
    const newZoneMarker = useRef(null);
    const zoneMarkers = useRef(new Map());
    const socketRef = useRef(null);

    // ---- Data Fetching and Socket Listeners ----
    useEffect(() => {
        const link = document.createElement('link');
        link.href = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css';
        link.rel = 'stylesheet';
        document.head.appendChild(link);

        const script = document.createElement('script');
        script.src = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js';
        script.async = true;
        script.onload = initializeMap;
        document.head.appendChild(script);

        // Fetch initial data
        fetchRedZones();

        // Setup socket connection
        socketRef.current = io('http://localhost:3000', { withCredentials: true });
        const socket = socketRef.current;

        socket.on('red-zone-created', (zone) => {
            setRedZones(prev => [zone, ...prev]);
        });
        socket.on('red-zone-updated', (zone) => {
            setRedZones(prev => prev.map(z => z.id === zone.id ? { ...z, ...zone } : z));
        });
        socket.on('red-zone-deleted', ({ id }) => {
            setRedZones(prev => prev.filter(z => z.id !== id));
        });

        return () => {
            if (map.current) map.current.remove();
            socket.disconnect();
            document.head.removeChild(link);
            document.head.removeChild(script);
        };
    }, []);

    // ---- Map Initialization and Updates ----
    const initializeMap = () => {
        if (!window.mapboxgl || map.current) return;
        window.mapboxgl.accessToken = 'pk.eyJ1IjoiY2hhdGNoYWxlcm0iLCJhIjoiY21nZnpiYzU3MGRzdTJrczlkd3RxamN4YyJ9.k288gnCNLdLgczawiB79gQ';
        map.current = new window.mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            center: [100.5018, 13.7563],
            zoom: 13
        });
        map.current.on('load', () => setMapLoaded(true));
    };

    useEffect(() => {
        if (mapLoaded) {
            updateRedZoneSourcesAndLayers();
        }
    }, [redZones, mapLoaded, newZone, isAdding]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;

        const mapInstance = map.current;
        const mapCanvas = mapInstance.getCanvas();

        // จัดการ Event Listener และ Cursor ตามสถานะ isAdding
        if (isAdding) {
            mapInstance.on('click', handleMapClick);
            mapCanvas.style.cursor = 'crosshair';
        } else {
            mapInstance.off('click', handleMapClick);
            mapCanvas.style.cursor = '';
        }

        // Cleanup function
        return () => {
            if (isAdding) {
                mapInstance.off('click', handleMapClick);
            }
        };
    }, [isAdding, mapLoaded]);

    // Effect to sync marker with manual coordinate input
    useEffect(() => {
        if (isAdding && mapLoaded && map.current && newZone.center_lat && newZone.center_lng) {
            const coords = [newZone.center_lng, newZone.center_lat];
            if (newZoneMarker.current) {
                newZoneMarker.current.setLngLat(coords);
            } else {
                const el = document.createElement('div');
                el.className = 'new-zone-marker';
                newZoneMarker.current = new window.mapboxgl.Marker({ element: el, draggable: true })
                    .setLngLat(coords)
                    .addTo(map.current)
                    .on('dragend', handleMarkerDragEnd);
            }
        }
    }, [newZone.center_lat, newZone.center_lng, isAdding, mapLoaded]);

    const updateRedZoneSourcesAndLayers = () => {
        if (!map.current) return;

        const sourceId = 'red-zones-source';
        const layerId = 'red-zones-layer';
        const newZoneSourceId = 'new-zone-source';
        const newZoneLayerId = 'new-zone-layer';

        const source = map.current.getSource(sourceId);
        const newZoneSource = map.current.getSource(newZoneSourceId);

        // Existing Red Zones
        const existingZonesGeoJSON = {
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
            source.setData(existingZonesGeoJSON);
        } else {
            map.current.addSource(sourceId, { type: 'geojson', data: existingZonesGeoJSON });
            map.current.addLayer({
                id: layerId,
                type: 'circle',
                source: sourceId,
                paint: {
                    'circle-radius': ['get', 'radius'],
                    'circle-color': '#ef4444', // Red for existing zones
                    'circle-opacity': 0.3,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ef4444',
                    'circle-stroke-opacity': 0.8
                }
            });
        }

        // New Zone being added
        const newZoneGeoJSON = {
            type: 'FeatureCollection',
            features: (isAdding && newZone.center_lat) ? [{
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [newZone.center_lng, newZone.center_lat]
                },
                properties: { radius: newZone.radius_meters }
            }] : []
        };

        if (newZoneSource) {
            newZoneSource.setData(newZoneGeoJSON);
        } else {
            map.current.addSource(newZoneSourceId, { type: 'geojson', data: newZoneGeoJSON });
            map.current.addLayer({
                id: newZoneLayerId,
                type: 'circle',
                source: newZoneSourceId,
                paint: {
                    'circle-radius': ['get', 'radius'],
                    'circle-color': '#facc15', // Yellow for new zone
                    'circle-opacity': 0.4,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fde047',
                    'circle-stroke-opacity': 0.9
                }
            });
        }
    };

    // ---- API Calls ----
    const fetchRedZones = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('http://localhost:3000/api/red-zone', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setRedZones(data.data);
            }
        } catch (err) {
            console.error("Failed to fetch red zones:", err);
        }
    };

    const handleAddZone = async () => {
        if (!newZone.name || !newZone.center_lat) {
            alert('กรุณากรอกชื่อและเลือกตำแหน่งบนแผนที่');
            return;
        }
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('http://localhost:3000/api/red-zone', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(newZone)
            });
            if (res.ok) {
                cancelAddMode();
                fetchRedZones(); // 🚩 ดึงข้อมูลใหม่หลังจากเพิ่มสำเร็จ
            } else {
                const errData = await res.json();
                alert(`เกิดข้อผิดพลาด: ${errData.message}`);
            }
        } catch (err) {
            console.error("Failed to add red zone:", err);
            alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
        }
    };

    const handleDeleteZone = async (id) => {
        if (!window.confirm('คุณแน่ใจหรือไม่ว่าต้องการลบโซนนี้?')) return;
        try {
            const token = localStorage.getItem('token');
            await fetch(`http://localhost:3000/api/red-zone/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            fetchRedZones(); // 🚩 ดึงข้อมูลใหม่หลังจากเพิ่มสำเร็จ
        } catch (err) {
            console.error("Failed to delete red zone:", err);
        }
    };

    const handleMarkerDragEnd = () => {
        if (newZoneMarker.current) {
            const { lng, lat } = newZoneMarker.current.getLngLat();
            setNewZone(prev => ({ ...prev, center_lat: lat, center_lng: lng }));
        }
    };

    // ---- UI Event Handlers ----
    const handleMapClick = (e) => {
        const { lng, lat } = e.lngLat;
        setNewZone(prev => ({ ...prev, center_lat: lat, center_lng: lng }));
    
        if (newZoneMarker.current) {
            newZoneMarker.current.setLngLat([lng, lat]);
        } else {
            // This part is now mostly handled by the useEffect, but we keep it for the initial click
            const el = document.createElement('div');
            el.className = 'new-zone-marker';
            newZoneMarker.current = new window.mapboxgl.Marker({ element: el, draggable: true })
                .setLngLat([lng, lat])
                .addTo(map.current);

            newZoneMarker.current.on('dragend', () => {
                handleMarkerDragEnd();
            });
        }
    };

    const handleCoordChange = (field) => (e) => {
        const value = e.target.value;
        // Allow empty value to clear it, otherwise parse as float
        setNewZone(prev => ({ ...prev, [field]: value === '' ? '' : parseFloat(value) }));
    };

    const cancelAddMode = () => {
        setIsAdding(false);
        if (newZoneMarker.current) {
            newZoneMarker.current.remove();
            newZoneMarker.current = null;
        }
        setNewZone({ name: '', center_lat: null, center_lng: null, radius_meters: 100 });
    };

    return (
        <div style={{ 
            display: 'flex', 
            height: '100vh', 
            background: '#0a0e27', 
            color: '#fff',
            fontFamily: '"Noto Sans Thai", sans-serif'
        }}>
            <style>{`
                .new-zone-marker {
                    width: 20px;
                    height: 20px;
                    background: #fde047;
                    border-radius: 50%;
                    border: 2px solid #fff;
                    box-shadow: 0 0 10px #fde047;
                }
                .sidebar-redzone {
                    scrollbar-width: thin;
                    scrollbar-color: #4f46e5 #1e293b;
                }
            `}</style>
            {/* Sidebar */}
            <div className="sidebar-redzone" style={{ width: '380px', background: '#151b3d', padding: '1rem', overflowY: 'auto', boxShadow: '4px 0 6px rgba(0,0,0,0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <button onClick={() => navigate('/dashboard')} style={{ background: 'transparent', border: 'none', color: '#a5b4fc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <ArrowLeft size={20} />
                        กลับหน้าหลัก
                    </button>
                    <h1 style={{ margin: 0, fontSize: '1.5rem' }}>จัดการพื้นที่สีแดง</h1>
                </div>

                {/* Add Zone Section */}
                {isAdding ? (
                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                        <h2 style={{ marginTop: 0 }}>เพิ่มโซนใหม่</h2>
                        <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>คลิกบนแผนที่ หรือกรอกพิกัดเพื่อกำหนดจุดศูนย์กลาง</p>
                        <input
                            type="text"
                            placeholder="ชื่อโซน"
                            value={newZone.name}
                            onChange={e => setNewZone(prev => ({ ...prev, name: e.target.value }))}
                            style={{ width: '100%', padding: '0.5rem', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#fff', marginBottom: '0.5rem' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                            <input
                                type="number"
                                placeholder="ละติจูด"
                                value={newZone.center_lat ?? ''}
                                onChange={handleCoordChange('center_lat')}
                                style={{ width: '50%', padding: '0.5rem', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#fff' }}
                            />
                            <input
                                type="number"
                                placeholder="ลองจิจูด"
                                value={newZone.center_lng ?? ''}
                                onChange={handleCoordChange('center_lng')}
                                style={{ width: '50%', padding: '0.5rem', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#fff' }}
                            />
                        </div>
                        <label style={{ display: 'block', fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.25rem' }}>รัศมี (เมตร): {newZone.radius_meters}</label>
                        <input
                            type="range"
                            min="50"
                            max="5000"
                            step="50"
                            value={newZone.radius_meters}
                            onChange={e => setNewZone(prev => ({ ...prev, radius_meters: parseInt(e.target.value) }))}
                            style={{ width: '100%', marginBottom: '1rem' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                            <button onClick={handleAddZone} style={{ flex: 1, background: '#22c55e', border: 'none', color: '#fff', padding: '0.75rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                <Save size={16} /> บันทึก
                            </button>
                            <button onClick={cancelAddMode} style={{ flex: 1, background: '#64748b', border: 'none', color: '#fff', padding: '0.75rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                <X size={16} /> ยกเลิก
                            </button>
                        </div>
                    </div>
                ) : (
                    <button onClick={() => setIsAdding(true)} style={{ width: '100%', background: '#4f46e5', border: 'none', color: '#fff', padding: '0.75rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                        <Plus size={16} /> เพิ่มโซนใหม่
                    </button>
                )}

                {/* Zone List */}
                <div>
                    {redZones.map(zone => (
                        <div key={zone.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '6px', marginBottom: '0.75rem', borderLeft: '4px solid #ef4444' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{zone.name}</h3>
                                <div>
                                    <button onClick={() => handleDeleteZone(zone.id)} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.25rem' }}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                            <div style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '0.5rem' }}>
                                <div><strong>รัศมี:</strong> {zone.radius_meters} เมตร</div>
                                <div style={{ fontFamily: 'monospace' }}>Lat: {parseFloat(zone.center_lat).toFixed(5)}, Lng: {parseFloat(zone.center_lng).toFixed(5)}</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.5rem' }}>
                                    สร้างโดย: {zone.created_by_username || zone.created_by} | {new Date(zone.created_at).toLocaleDateString('th-TH')}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Map */}
            <div style={{ flex: 1, position: 'relative' }}>
                <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
                {!mapLoaded && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                        <div style={{ width: '50px', height: '50px', border: '4px solid rgba(255,255,255,0.3)', borderTop: '4px solid #fff', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
                        <div>กำลังโหลดแผนที่...</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RedZone;
