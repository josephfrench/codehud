import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Home from '@/pages/Home';
import Orders from '@/pages/Orders';
import { Layout } from './components/Layout';
const router = createBrowserRouter([
  { path: '/', element: <Layout />, children: [
    { index: true, element: <Home /> },
    { path: 'orders', element: <Orders /> },
    { path: 'orders/:id', lazy: () => import('./pages/OrderDetail') },
  ] },
]);
export default function App() { return <RouterProvider router={router} />; }
