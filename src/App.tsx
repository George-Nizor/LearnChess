import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './routes/Layout';
import { Play } from './routes/Play';
import { Tactics } from './routes/Tactics';
import { Openings } from './routes/Openings';
import { Endgames } from './routes/Endgames';
import { Dashboard } from './routes/Dashboard';
import { Analysis } from './routes/Analysis';
import { Settings } from './routes/Settings';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Play /> },
      { path: 'tactics', element: <Tactics /> },
      { path: 'openings', element: <Openings /> },
      { path: 'endgames', element: <Endgames /> },
      { path: 'analysis', element: <Analysis /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
