import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { DataProvider } from './lib/store'
import Shell from './components/Shell'
import Tonight from './pages/Tonight'
import Standings from './pages/Standings'
import Players from './pages/Players'
import Pots from './pages/Pots'
import SeasonPage from './pages/Season'
import SettingsPage from './pages/Settings'
import Login from './pages/Login'

export default function App() {
  return (
    <DataProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Shell />}>
            <Route index element={<Tonight />} />
            <Route path="standings" element={<Standings />} />
            <Route path="players" element={<Players />} />
            <Route path="pots" element={<Pots />} />
            <Route path="season" element={<SeasonPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </DataProvider>
  )
}
