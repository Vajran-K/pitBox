import { setTranscriptsEnabled, useTranscripts } from "../lib/transcribe";

export type Clip = { url: string; when: string; code: string; colour?: string };

/** Team radio clips with Whisper transcripts underneath (when switched on). */
export default function RadioPanel({ title = "Team radio", clips, empty }: { title?: string; clips: Clip[]; empty: string }) {
  const t = useTranscripts(clips.map((c) => c.url));
  const loading = t.enabled && t.model.state === "loading";
  return (
    <section className="panel live-feed radio-panel">
      <div className="radio-head">
        <h2>{title}</h2>
        <label className="switch">
          <input type="checkbox" checked={t.enabled} onChange={(e) => setTranscriptsEnabled(e.target.checked)} />
          <span>Transcripts</span>
        </label>
      </div>
      {!t.enabled && clips.length > 0 && <p className="chart-note">Turn on transcripts to read the radio. Speech is turned into text on this device (the model is about 80 MB, downloaded once).</p>}
      {loading && <p className="chart-note">Downloading the speech model… {Math.round(t.model.progress * 100)}%</p>}
      {t.enabled && t.model.state === "error" && <p className="chart-note warn">Transcripts aren't working here: {t.model.error}</p>}
      {clips.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="radio-list">
          {clips.map((c) => {
            const tr = t.get(c.url);
            return (
              <li key={c.url}>
                <div className="radio-row">
                  <span className="when">{c.when}</span>
                  <span className="who"><span className="team-bar" style={{ background: c.colour }} /><strong>{c.code}</strong></span>
                  <audio controls preload="none" src={c.url}>Your browser can't play this clip.</audio>
                </div>
                {t.enabled && (
                  <p className={`transcript${tr?.status === "done" ? "" : " pending"}`}>
                    {tr?.status === "done" ? `“${tr.text}”` : tr?.status === "error" ? `Couldn't transcribe: ${tr.error}` : tr?.status === "working" ? "Transcribing…" : "Waiting to transcribe…"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {t.enabled && t.model.state === "ready" && <p className="chart-note">Transcribed on this device by Whisper ({t.model.device === "webgpu" ? "graphics card" : "processor"}). Radio is noisy, so words can be wrong.</p>}
    </section>
  );
}
