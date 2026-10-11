import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '@/app/App';
import { AuthProvider } from '@/auth';
import { ToastProvider } from '@/components/Toast';
import { applyTheme } from '@/lib/theme';
import '@/styles/styles.css';
import '@/styles/responsive.css';

applyTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
