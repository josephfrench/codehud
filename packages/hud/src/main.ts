import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import DemoApp from './routes/DemoApp.svelte';
import Assets from './routes/Assets.svelte';

try { document.documentElement.dataset.theme = localStorage.getItem('codehud-theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }

// Temporary routes while the game-style direction is explored:
//   /demo   guided scene only      /assets   sprite gallery
const path = location.pathname.replace(/\/+$/, '');
const Root = path === '/demo' ? DemoApp : path === '/assets' ? Assets : App;

export default mount(Root, { target: document.getElementById('app')! });
