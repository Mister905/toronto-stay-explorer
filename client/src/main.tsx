import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Browser entry. Development StrictMode re-runs effects, so fetches abort on cleanup.
// DEMO [1.13]: Development reruns setup, cleanup, then setup
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
