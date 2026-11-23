import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles.css';
import './screens.css';
import { PassengerApp, SignIn, Home, Board, Pay, Tickets, TicketDetail, LiveTrip, LiveTripIndex, Track } from './passenger';
import { registerServiceWorker, InstallPrompt } from './install';

registerServiceWorker();

// Asks phone visitors to install the app (passenger app, or the crew app under /crew).
function Install() {
  const { pathname } = useLocation();
  return <InstallPrompt key={pathname.startsWith('/crew') ? 'crew' : 'app'} path={pathname} app={pathname.startsWith('/crew') ? 'HopOn Crew' : 'VIP HopOn'} />;
}

// Crew and ops screens load separately so passengers on weak data never download them.
const CrewApp = lazy(() => import('./crew').then((m) => ({ default: m.CrewApp })));
const Ops = lazy(() => import('./ops').then((m) => ({ default: m.Ops })));

const P = (el: JSX.Element) => <PassengerApp>{el}</PassengerApp>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/signin" element={P(<SignIn />)} />
        <Route path="/" element={P(<Home />)} />
        <Route path="/board/:id" element={P(<Board />)} />
        <Route path="/pay/:id" element={P(<Pay />)} />
        <Route path="/tickets" element={P(<Tickets />)} />
        <Route path="/tickets/:id" element={P(<TicketDetail />)} />
        <Route path="/trip" element={P(<LiveTripIndex />)} />
        <Route path="/trip/:id" element={P(<LiveTrip />)} />
        <Route path="/t/:token" element={<Track />} />
        <Route path="/crew/*" element={<Suspense fallback={<div className="app" />}><CrewApp /></Suspense>} />
        <Route path="/ops" element={<Suspense fallback={<div className="ops" />}><Ops /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Install />
    </BrowserRouter>
  </StrictMode>,
);
