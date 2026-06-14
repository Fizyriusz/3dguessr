import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Dynamically load Google Maps 3D (alpha) script with maps3d library
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
if (API_KEY) {
  const scriptId = "google-maps-3d-script";
  if (!document.getElementById(scriptId)) {
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&v=alpha&libraries=maps3d`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
