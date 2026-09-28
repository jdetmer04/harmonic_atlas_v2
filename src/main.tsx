import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { autosaveViewPrefs, loadViewPrefs } from './state/persist';
import { initialState, store } from './state/store';
import './app/layout.css';

store.setState(initialState(loadViewPrefs()), true);
autosaveViewPrefs();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
