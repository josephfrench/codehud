import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import Assets from './routes/Assets.svelte';

try { document.documentElement.dataset.theme = localStorage.getItem('codehud-theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }

// /assets is a temporary gallery of the resource sprites; everything else is the app.
const path = location.pathname.replace(/\/+$/, '');
const Root = path === '/assets' ? Assets : App;

export default mount(Root, { target: document.getElementById('app')! });
