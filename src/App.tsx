import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { DataProvider } from './lib/store'
import { SpecialEventsProvider } from './lib/special-events-store'
import Notices from './components/Notices'
import Shell from './components/Shell'
import Tonight from './pages/Tonight'
import Standings from './pages/Standings'
import Players from './pages/Players'
import Pots from './pages/Pots'
import SpecialEvents from './pages/SpecialEvents'
import SeasonPage from './pages/Season'
import SettingsPage from './pages/Settings'
import Login from './pages/Login'
import RequireAdmin from './components/RequireAdmin'

export default function App() {
  return (
    <DataProvider>
      <SpecialEventsProvider>
        <Notices />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/tv" element={<Tonight projectorMode />} />
            <Route path="/" element={<Shell />}>
              <Route index element={<Tonight />} />
              <Route path="standings" element={<Standings />} />
              <Route path="players" element={<Players />} />
              <Route path="pots" element={<Pots />} />
              <Route path="special-events" element={<SpecialEvents />} />
              <Route path="season" element={<RequireAdmin><SeasonPage /></RequireAdmin>} />
              <Route path="settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SpecialEventsProvider>
    </DataProvider>
  )
}
