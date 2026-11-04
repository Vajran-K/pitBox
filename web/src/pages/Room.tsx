import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useData, type Meta, type Timing, type Track } from "../data";
import { raceOutcome } from "../lib/predictions";
import { buildReplay, type Replay as ReplayModel } from "../lib/replay";
import { ROOMS_BASE, isQualiType, type RoomInfo } from "../lib/roomProtocol";
import { saveName, savedName, useRoom, useRoomClock } from "../lib/useRoom";
import { PicksPanel, Reactions, RoomBar, RoomChat } from "../components/RoomParts";
import LiveRoom from "./LiveRoom";
import { ReplayView } from "./Replay";
import { SERVER_DOWN } from "./Rooms";

export default function Room() {
  const code = (useParams().code ?? "").toUpperCase();
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(savedName() || null);

  useEffect(() => {
    let live = true;
    setInfo(null); setError(null);
    fetch(`${ROOMS_BASE}/api/rooms/${code}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!live) return;
        if (r.ok) setInfo(body); else setError(body.error ?? SERVER_DOWN);
      })
      .catch(() => live && setError(SERVER_DOWN));
    return () => { live = false; };
  }, [code]);

  if (error) return <div className="empty error"><p>{error}</p><Link className="button" to="/rooms">Start or join another room</Link></div>;
  if (!info) return <p className="empty">Finding room {code}…</p>;
  if (!name) return <JoinCard info={info} onJoin={(n) => { saveName(n); setName(n); }} />;
  if (info.kind === "live") return <LiveRoom info={info} name={name} />;
  return <RoomData info={info} name={name} />;
}

function JoinCard({ info, onJoin }: { info: RoomInfo; onJoin: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => name.trim() && onJoin(name.trim());
  return (
    <section className="panel form-panel join-card">
      <p className="kicker">Room {info.code}</p>
      <h1>{info.title}</h1>
      <label className="field">
        <span>Your name</span>
        <input autoFocus value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Shown next to your messages" />
      </label>
      <button className="button" onClick={submit} disabled={!name.trim()}>Join the room</button>
    </section>
  );
}

function RoomData({ info, name }: { info: RoomInfo; name: string }) {
  const meta = useData<Meta>(`sessions/${info.session}/meta.json`);
  const timing = useData<Timing>(`sessions/${info.session}/timing.json`);
  const track = useData<Track>(`sessions/${info.session}/track.json`);
  if (meta.error || timing.error) return <p className="empty">{meta.error ?? timing.error}</p>;
  if (!meta.data || !timing.data || track.loading) return <p className="empty">Loading the race…</p>;
  return <RoomLive info={info} name={name} meta={meta.data} timing={timing.data} track={track.data ?? null} />;
}

function RoomLive({ info, name, meta, timing, track }: { info: RoomInfo; name: string; meta: Meta; timing: Timing; track: Track | null }) {
  const room = useRoom(info.code, name);
  const rp = useMemo(() => buildReplay(meta, timing, track), [meta, timing, track]);
  const clock = useRoomClock(room, info.raceStart, info.raceEnd);
  const quali = isQualiType(info.sessionType ?? meta.name);
  const outcome = useMemo(() => raceOutcome(meta, timing), [meta, timing]);
  const s = room.state;
  // grid order for the pickers
  const drivers = [...meta.drivers].sort((a, b) => (meta.grid.find((g) => g.driver_number === a.number)?.position ?? 99) - (meta.grid.find((g) => g.driver_number === b.number)?.position ?? 99));
  const locked = s.locked || clock.t >= rp.start;
  const finished = clock.t >= rp.end - 15_000;

  return (
    <ReplayView meta={meta} timing={timing} track={track} clock={clock}
      kicker={<RoomBar state={s} code={info.code} />}
      overlay={<Reactions state={s} />}
      main={<>
        {s.status === "failed" && <p className="empty error" role="alert">{s.error}</p>}
        <RoomChat room={room} label={(m) => lapLabel(rp, m.raceT, quali)} hint="No messages yet. Say hello, or make your picks on the right." />
      </>}
      side={<PicksPanel room={room} drivers={drivers} quali={quali} locked={locked} finished={finished} outcome={outcome}
        lockNote="Picks close when the replay reaches the start." />} />
  );
}

function lapLabel(rp: ReplayModel, t: number, quali: boolean): string {
  if (t < rp.start) return "Before the start";
  if (t >= rp.end - 15_000) return quali ? "After the session" : "After the flag";
  if (quali) {
    const m = Math.floor((t - rp.start) / 60_000);
    return `${m} min in`;
  }
  let lap = 1;
  while (lap < rp.totalLaps && rp.leaderLineTimes[lap] <= t) lap++;
  return `Lap ${lap}`;
}
