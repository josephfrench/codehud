import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

try { document.documentElement.dataset.theme = localStorage.getItem('codehud-theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }

export default mount(App, { target: document.getElementById('app')! });
