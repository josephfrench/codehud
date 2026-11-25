import { money } from '@acme/shared';
import { Header } from './components/Header';
export function App() { fetch('/api/orders'); return <Header title={money(1)} />; }
