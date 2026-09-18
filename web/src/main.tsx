import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ReportPreview from './components/ReportPreview.tsx'

// 无路由库（v1）：/report 是报告预览壳页（新窗），其余一律主应用
const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    {window.location.pathname === '/report' ? <ReportPreview /> : <App />}
  </StrictMode>,
)
