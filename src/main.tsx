import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Dynamically load Google Maps script to prevent URI malformed error if environment key is missing
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
if (mapsApiKey && mapsApiKey !== '%VITE_GOOGLE_MAPS_API_KEY%') {
  if (!document.querySelector('script[src*="maps.googleapis.com"]')) {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=maps3d&v=alpha`;
    script.defer = true;
    document.head.appendChild(script);
  }
} else {
  console.error("VITE_GOOGLE_MAPS_API_KEY is not defined or is placeholder. Please configure it in your Vercel/local environment variables.");
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
