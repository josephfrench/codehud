import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import Assets from './routes/Assets.svelte';
import { startDemo } from './lib/demo.ts';

try { document.documentElement.dataset.theme = localStorage.getItem('codehud-theme') || 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }

// / waits for a system to be loaded; /demo runs the app on a sample system with a scripted agent, entirely
// in the browser; /assets is a gallery of the resource sprites.
const path = location.pathname.replace(/\/+$/, '');
const Root = path === '/assets' ? Assets : App;
if (path === '/demo') startDemo();

export default mount(Root, { target: document.getElementById('app')! });
