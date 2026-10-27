import '@fontsource-variable/inter';
import React from 'react';
import ReactDOM from 'react-dom/client';
import LabApp from './LabApp';
import './styles.css';
import './gen7.css';
import './lab.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LabApp />
  </React.StrictMode>,
);
