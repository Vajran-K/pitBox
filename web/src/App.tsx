import { NavLink, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Race from "./pages/Race";
import Replay from "./pages/Replay";
import Season from "./pages/Season";
import Drivers from "./pages/Drivers";
import Rooms from "./pages/Rooms";
import Room from "./pages/Room";
import Live from "./pages/Live";
import Races from "./pages/Races";
import GlobalSearch from "./components/GlobalSearch";
import ThemeToggle from "./components/ThemeToggle";
import { ChatProvider, useChat } from "./components/GlobalChat";

export default function App() {
  return (
    <ChatProvider>
      <Shell />
    </ChatProvider>
  );
}

function Shell() {
  const chat = useChat();
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="wordmark" aria-label="PitBox home">
          Pit<span>Box</span>
        </NavLink>
        <GlobalSearch />
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/live">Live</NavLink>
          <NavLink to="/races">Races</NavLink>
          <NavLink to="/season">Seasons</NavLink>
          <NavLink to="/drivers">Compare drivers</NavLink>
          <NavLink to="/rooms">Watch rooms</NavLink>
          <button className="nav-ask" onClick={() => chat.openChat()}>Ask AI</button>
          <ThemeToggle />
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/race/:key" element={<Race />} />
          <Route path="/race/:key/replay" element={<Replay />} />
          <Route path="/season" element={<Season />} />
          <Route path="/season/:year" element={<Season />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/rooms" element={<Rooms />} />
          <Route path="/room/:code" element={<Room />} />
          <Route path="/live" element={<Live />} />
          <Route path="/races" element={<Races />} />
          <Route path="*" element={<p className="empty">That page doesn't exist. Pick a race or season from the menu.</p>} />
        </Routes>
      </main>
      <footer className="footer">
        Race data from <a href="https://openf1.org">OpenF1</a> (2023 onward) and history from{" "}
        <a href="https://github.com/jolpica/jolpica-f1">Jolpica-F1</a> (1950 onward). PitBox is a personal project and
        isn't affiliated with Formula 1.
      </footer>
    </div>
  );
}
