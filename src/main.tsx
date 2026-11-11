/**
 * PONTO DE ENTRADA do front-end (Vite + React 19).
 * Monta o componente <App /> dentro da div #root de index.html. O StrictMode executa
 * efeitos duas vezes em desenvolvimento para revelar efeitos sem limpeza (cleanup).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './design-system.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
