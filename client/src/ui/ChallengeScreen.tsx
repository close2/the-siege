import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { ECON, SIM_VERSION } from '../content/stats';
import { DRY_RUN_ID } from '../net/types';
import { GameCanvas } from '../render/GameCanvas';
import type { GameView, ReplayPlayer } from '../render/GameView';
import { sound } from '../render/Sound';
import { sectorById } from '../sim/map';
import type { Checkin, Order, PadId, PlayerId } from '../sim/types';
import { useSeason, type SeasonView } from '../state/useSeason';
import { Gold, Icon, PLAYER_COLORS, Sheet, Toast, cssColor, fmtDuration, portraitUrl, useNow } from './common';
import { BuildSheet, CheckInSheet, DawnReport, IntentSheet, PlanSheet } from './sheets';
import { TutorialContent } from './Tutorial';

type SheetState = { kind: 'checkin' } | { kind: 'build'; pad: PadId } | { kind: 'plan' } | { kind: 'intent' } | { kind: 'report'; day: number } | { kind: 'menu' } | { kind: 'tutorial' } | null;

export function ChallengeScreen({ id }: { id: string }) {
  const { backend, user, navigate } = useApp();
  const { view, error, putCheckin, putOrders, refresh } = useSeason(backend, id, user.id);
  const gv = useRef<GameView | null>(null);
  const [ready, setReady] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ day: number; player: ReplayPlayer } | null>(null);
  const [speed, setSpeed] = useState(1);
  const [scoutedDay, setScoutedDay] = useState(0);
  const [coachCollapsed, setCoachCollapsed] = useState(false);
  const seenKey = `siege.seen.${id}`;
  const isDryRun = id === DRY_RUN_ID;

  const owners = useMemo(() => {
    if (!view) return {};
    const o: Record<PlayerId, { color: number; name: string; dormant?: boolean }> = {};
    view.setup.players.forEach((p, i) => {
      const missStreak = view.state.players[p.id]?.missStreak ?? 0;
      o[p.id] = { color: PLAYER_COLORS[i % PLAYER_COLORS.length], name: p.name, dormant: missStreak >= ECON.dormantAfter };
    });
    return o;
  }, [view]);

  useEffect(() => {
    const notice = backend.popNotice?.();
    if (notice) setToast(notice);
  }, [backend, view]);

  // show valley (preview incl. planned orders) & keep canvas handlers fresh
  useEffect(() => {
    const v = gv.current;
    if (!v || !ready || !view) return;
    v.onPadTap = (pad) => {
      const owner = view.state.pads[pad]?.owner;
      if (replay) return;
      if (owner === user.id && view.planDay) setTimeout(() => setSheet({ kind: 'build', pad }), 0);
      else if (owner) setToast(`${owners[owner]?.name ?? '?'}'s plot`);
    };
    v.onIntentTap = () => {
      setTimeout(() => {
        if (view.planDay) setScoutedDay(view.planDay);
        setSheet({ kind: 'intent' });
      }, 0);
    };
    (window as unknown as { __siegeDebug: unknown }).__siegeDebug = {
      myPadScreen: () => {
        const pads = view.setup.map.sectors.flatMap((sc) => sc.pads).filter((p) => view.state.pads[p.id]?.owner === user.id && !view.state.pads[p.id]?.building);
        const pad = pads[pads.length - 1] ?? pads[0];
        if (!pad) return null;
        const pt = v.viewport.toScreen(pad.x, pad.y);
        const r = v.app.canvas.getBoundingClientRect();
        return { x: r.left + pt.x, y: r.top + pt.y };
      },
    };
    if (replay) return;
    const st = view.preview?.state ?? view.state;
    v.showValley(view.setup.map, st.pads, st.keep, {
      owners,
      me: user.id,
      intent: view.clock.finished ? null : view.state.intent,
      theme: view.setup.config.theme,
      rally: view.preview?.rally ?? false,
      animate: true,
    });
  }, [ready, view, replay, owners, user.id]);

  const myFocus = useCallback(
    (vw: SeasonView) =>
      vw.state.players[user.id]?.sectors
        .map((s) => sectorById(vw.setup.map, s))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => s.rally) ?? [],
    [user.id],
  );

  // initial camera on my sector
  const centered = useRef(false);
  useEffect(() => {
    const v = gv.current;
    if (!v || !ready || !view || centered.current) return;
    centered.current = true;
    const f = myFocus(view)[0];
    if (f) v.viewport.moveCenter((f.x + view.setup.map.keep.x) / 2, (f.y + view.setup.map.keep.y) / 2);
  }, [ready, view, myFocus]);

  const startReplay = useCallback(
    (day: number) => {
      const v = gv.current;
      if (!v || !view) return;
      setSheet(null);
      const p = v.playBattle(view.battles[day - 1], view.states[day - 1].pads, { owners, me: user.id });
      p.speed = speed;
      v.autoCamera = true;
      v.cameraFocus = myFocus(view);
      p.onEnd = () => {
        v.autoCamera = false;
        const rep = view.reports[day - 1];
        sound.play(rep.keepFell ? 'defeat' : rep.stars >= 2 ? 'victory' : 'horn');
        setSheet({ kind: 'report', day });
        localStorage.setItem(seenKey, String(Math.max(day, Number(localStorage.getItem(seenKey) ?? 0))));
      };
      setReplay({ day, player: p });
      if (view.battles[day - 1].rally) setTimeout(() => sound.play('horn'), 300);
    },
    [view, owners, user.id, speed, myFocus, seenKey],
  );

  const endReplay = () => {
    if (gv.current) gv.current.autoCamera = false;
    setReplay(null);
  };

  // unseen Dawn → offer replay
  const resolved = view?.clock.resolved ?? 0;
  const seen = Number(localStorage.getItem(seenKey) ?? 0);
  const unseenDawn = resolved > 0 && seen < resolved ? resolved : null;

  const doCheckin = async (day: number, c: Checkin) => {
    await putCheckin(day, c);
    sound.play('coin');
    setToast('Reported — thank you, defender!');
  };

  const doOrders = (orders: Order[]) => {
    if (!view?.planDay) return;
    putOrders(view.planDay, orders).catch((e) => setToast((e as Error).message));
  };

  const now = useNow(1000, () => backend.now(id));

  if (error && !view) return <div className="screen error">{error}</div>;
  if (!view)
    return (
      <div className="screen bg-art center" style={{ paddingTop: '40vh' }}>
        Loading the valley…
      </div>
    );

  const { clock, setup } = view;
  const me = user.id;
  const pv = view.preview;
  const gold = (pv?.state ?? view.state).players[me]?.gold ?? 0;
  const keep = (pv?.state ?? view.state).keep;
  const totalStars = view.state.stars.reduce((a, b) => a + b, 0) + view.state.bonusStars;
  const missingCheckin = clock.open.some((d) => !view.myCheckin(d));
  const nextDawn = view.planDay ? clock.windows[view.planDay - 1].dawn : null;
  const canSkipDawn = Boolean(backend.skipToNextDawn && (backend.mode === 'local' || view.challenge.local));
  const myHeroClass = view.challenge.members.find((m) => m.userId === me)?.heroClass ?? 'knight';

  const openScout = () => {
    if (view.planDay) setScoutedDay(view.planDay);
    setSheet({ kind: 'intent' });
  };

  const centerMyPlots = () => {
    const v = gv.current;
    if (!v) return;
    const f = myFocus(view)[0];
    if (f) v.viewport.moveCenter((f.x + view.setup.map.keep.x) / 2, (f.y + view.setup.map.keep.y) / 2);
  };

  const restartDryRun = async () => {
    await backend.startDryRun(myHeroClass);
    setScoutedDay(0);
    setSheet(null);
    await refresh();
  };

  // ---------- lobby ----------
  if (!clock.started) {
    const link = `${location.origin}/join/${view.challenge.inviteCode}`;
    return (
      <div className="screen bg-art col">
        <div className="row">
          <button className="btn small" onClick={() => navigate('/')}>
            ‹ Home
          </button>
          <h2 className="grow" style={{ margin: 0 }}>
            {setup.config.title}
          </h2>
        </div>
        <div className="panel col">
          <h3>Gathering the defenders</h3>
          <div>
            The siege begins in <b>{fmtDuration(clock.windows[0].open - now)}</b> ({setup.config.startDate}) and lasts {setup.config.days} days.
          </div>
          {backend.mode === 'http' && !view.challenge.local && (
            <>
              <div>Invite friends — they can join until the start:</div>
              <div className="title center" style={{ fontSize: 28, letterSpacing: '0.15em' }}>
                {view.challenge.inviteCode}
              </div>
              <button
                className="btn gold block"
                onClick={async () => {
                  if (navigator.share) await navigator.share({ title: 'The Siege', text: `Join my challenge "${setup.config.title}"`, url: link }).catch(() => undefined);
                  else {
                    await navigator.clipboard.writeText(link);
                    setToast('Link copied');
                  }
                }}
              >
                Share invite link
              </button>
            </>
          )}
          {canSkipDawn && (
            <button
              className="btn block"
              onClick={async () => {
                await backend.skipToNextDawn!(id);
                await refresh();
              }}
            >
              ⏩ Start now (demo)
            </button>
          )}
          <h3>Defenders</h3>
          {view.challenge.members.map((m, i) => (
            <div key={m.userId} className="row">
              <img src={portraitUrl(m.heroClass)} width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: `3px solid ${cssColor(PLAYER_COLORS[i % 8])}` }} alt="" />
              <b>{m.name}</b>
              {m.bot && <span className="muted">(bot)</span>}
            </div>
          ))}
        </div>
        {toast && <Toast text={toast} onDone={() => setToast(null)} />}
      </div>
    );
  }

  // ---------- game ----------
  return (
    <div className="game" onPointerDown={() => sound.unlock()}>
      <GameCanvas
        onReady={(v) => {
          gv.current = v;
          setReady(true);
        }}
      />

      <div className="hud-top">
        <div className="row">
          <button className="btn small" onClick={() => navigate('/')} style={{ minWidth: 44 }}>
            ‹
          </button>
          <div className="grow" style={{ textShadow: '0 1px 3px #000', lineHeight: 1.15 }}>
            <div className="title" style={{ fontSize: 16, margin: 0 }}>
              {setup.config.title}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {clock.finished ? 'Season complete' : `Day ${view.planDay} of ${setup.config.days} · Dawn in ${fmtDuration((nextDawn ?? now) - now)}`}
            </div>
          </div>
          <span className="chip">
            <Icon id="gold" size={18} />
            {gold}
          </span>
          <span className="chip">
            <Icon id="heart" size={18} />
            {Math.round(keep.hp)}
          </span>
          <span className="chip">
            <Icon id="star" size={18} />
            {totalStars}
          </span>
        </div>
        <div className="team">
          {view.challenge.members
            .slice()
            .sort((a, b) => a.joinOrder - b.joinOrder)
            .map((m, i) => {
              const done = view.planDay ? clock.open.every((d) => view.checkedIn(d, m.userId)) : true;
              return (
                <div key={m.userId} className={'avatar' + (done ? '' : ' dim')} style={{ '--c': cssColor(PLAYER_COLORS[i % 8]) } as React.CSSProperties} title={m.name}>
                  <img src={portraitUrl(m.heroClass)} alt="" />
                  {done && clock.open.length > 0 && <Icon id="check" size={18} style={{ position: 'absolute', right: -2, top: 26 }} />}
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.userId === me ? 'You' : m.name}</div>
                </div>
              );
            })}
        </div>
        {isDryRun && !replay && (
          <DryRunCoach
            view={view}
            gold={gold}
            unseenDawn={unseenDawn}
            scouted={scoutedDay === view.planDay}
            collapsed={coachCollapsed}
            onToggleCollapse={() => setCoachCollapsed((c) => !c)}
            onScout={openScout}
            onReport={() => setSheet({ kind: 'checkin' })}
            onFocusPlots={centerMyPlots}
            onPlan={() => setSheet({ kind: 'plan' })}
            onSkipDawn={async () => {
              await backend.skipToNextDawn!(id);
              await refresh();
            }}
            onRestart={restartDryRun}
            onNewChallenge={() => navigate('/new')}
            onTutorial={() => setSheet({ kind: 'tutorial' })}
          />
        )}
        {view.simVersionMismatch && (
          <div className="error" style={{ fontSize: 12 }}>
            ⚠ This challenge uses game rules v{view.challenge.simVersion}, this app runs v{SIM_VERSION}. Battles may differ from your teammates' — please update the app.
          </div>
        )}
        {view.desyncDay && <div className="error" style={{ fontSize: 12 }}>⚠ Out of sync with teammates since day {view.desyncDay}. Please update the app.</div>}
        {error && <div className="error" style={{ fontSize: 12 }}>{error}</div>}
      </div>

      {replay ? (
        <>
          <div className="dawn-banner">Dawn {replay.day}</div>
          <div className="replay-bar">
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                className={'btn small' + (speed === s ? ' gold' : '')}
                onClick={() => {
                  setSpeed(s);
                  replay.player.speed = s;
                }}
              >
                {s}×
              </button>
            ))}
            <button className="btn small" onClick={() => replay.player.skip()}>
              Skip ⏭
            </button>
            <button className="btn small" onClick={endReplay}>
              ✕
            </button>
          </div>
        </>
      ) : (
        <div className="hud-bottom">
          {unseenDawn ? (
            <button className="btn gold" style={{ maxWidth: 280, animation: 'pulse 1.4s infinite' }} onClick={() => startReplay(unseenDawn)}>
              ☀ Watch Dawn {unseenDawn}
            </button>
          ) : (
            <>
              <button className={'btn' + (missingCheckin ? ' gold' : '')} disabled={!clock.open.length} onClick={() => setSheet({ kind: 'checkin' })} style={{ position: 'relative' }}>
                ✔ Report
                {missingCheckin && <span className="badge-dot">!</span>}
              </button>
              <button className="btn" disabled={!view.planDay} onClick={() => setSheet({ kind: 'plan' })} style={{ position: 'relative' }}>
                ⚒ Plan
                {view.myOrders.length > 0 && <span className="badge-dot" style={{ background: '#3a8a3a' }}>{view.myOrders.length}</span>}
              </button>
              <button className="btn" disabled={!view.state.intent} onClick={openScout}>
                👁 Scout
              </button>
              <button className="btn" onClick={() => setSheet({ kind: 'menu' })} style={{ maxWidth: 56 }}>
                ☰
              </button>
            </>
          )}
        </div>
      )}

      {sheet?.kind === 'checkin' && <CheckInSheet view={view} onSave={doCheckin} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'build' && pv && <BuildSheet view={view} padId={sheet.pad} onOrders={doOrders} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'plan' && pv && <PlanSheet view={view} onOrders={doOrders} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'intent' && <IntentSheet view={view} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'report' && view.reports[sheet.day - 1] && (
        <DawnReport
          view={view}
          report={view.reports[sheet.day - 1]}
          onClose={() => {
            setSheet(null);
            endReplay();
          }}
          onReplay={() => startReplay(sheet.day)}
        />
      )}
      {sheet?.kind === 'menu' && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet panel col" onClick={(e) => e.stopPropagation()}>
            <h3>Menu</h3>
            <button className="btn block" onClick={() => setSheet({ kind: 'tutorial' })}>
              📖 How to play
            </button>
            {resolved > 0 && (
              <button className="btn block" onClick={() => startReplay(resolved)}>
                ↻ Replay Dawn {resolved}
              </button>
            )}
            {resolved > 0 && (
              <button className="btn block" onClick={() => setSheet({ kind: 'report', day: resolved })}>
                📜 Last report
              </button>
            )}
            {backend.mode === 'http' && !view.challenge.local && (
              <button
                className="btn block"
                onClick={async () => {
                  const link = `${location.origin}/join/${view.challenge.inviteCode}`;
                  await navigator.clipboard?.writeText(link).catch(() => undefined);
                  setToast(`Invite code ${view.challenge.inviteCode} copied`);
                  setSheet(null);
                }}
              >
                ✉ Invite code: {view.challenge.inviteCode}
              </button>
            )}
            {canSkipDawn && !clock.finished && (
              <button
                className="btn block"
                onClick={async () => {
                  await backend.skipToNextDawn!(id);
                  setSheet(null);
                  await refresh();
                }}
              >
                ⏩ Skip to next Dawn (demo)
              </button>
            )}
            {isDryRun && (
              <button className="btn block" onClick={restartDryRun}>
                ↻ Restart dry run
              </button>
            )}
            <button className="btn block" onClick={() => navigate('/settings')}>
              ⚙ Settings
            </button>
            <div className="muted" style={{ fontSize: 12 }}>
              Your gold after plans: <Gold n={gold} size={14} />
            </div>
          </div>
        </div>
      )}
      {sheet?.kind === 'tutorial' && (
        <Sheet wide onClose={() => setSheet(null)}>
          <h2>How to Play</h2>
          <TutorialContent
            inDryRun={isDryRun}
            onStartDryRun={async (hc) => {
              await backend.startDryRun(hc);
              setSheet(null);
              navigate(`/c/${DRY_RUN_ID}`);
            }}
          />
        </Sheet>
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function DryRunCoach({
  view,
  gold,
  unseenDawn,
  scouted,
  collapsed,
  onToggleCollapse,
  onScout,
  onReport,
  onFocusPlots,
  onPlan,
  onSkipDawn,
  onRestart,
  onNewChallenge,
  onTutorial,
}: {
  view: SeasonView;
  gold: number;
  unseenDawn: number | null;
  scouted: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onScout: () => void;
  onReport: () => void;
  onFocusPlots: () => void;
  onPlan: () => void;
  onSkipDawn: () => void;
  onRestart: () => void;
  onNewChallenge: () => void;
  onTutorial: () => void;
}) {
  const boxStyle: React.CSSProperties = {
    background: 'rgba(16, 22, 34, 0.92)',
    border: '1px solid rgba(244, 198, 78, 0.65)',
    borderRadius: 10,
    padding: collapsed ? '4px 10px' : '8px 10px',
    marginTop: 4,
    fontSize: 12.5,
    lineHeight: 1.35,
    maxWidth: 540,
    marginLeft: 'auto',
    marginRight: 'auto',
  };

  if (collapsed) {
    return (
      <div style={boxStyle} className="row">
        <b className="grow" style={{ color: 'var(--gold)' }}>
          🎯 Dry Run Guide {unseenDawn ? `· Dawn ${unseenDawn} ready` : view.planDay ? `· Day ${view.planDay} of ${view.setup.config.days}` : '· Complete'}
        </b>
        <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onToggleCollapse}>
          Show ▾
        </button>
      </div>
    );
  }

  if (unseenDawn) {
    return (
      <div style={boxStyle} className="col">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b style={{ color: 'var(--gold)' }}>☀ Step 4 · Dawn {unseenDawn} has arrived!</b>
          <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onToggleCollapse}>
            Hide ▴
          </button>
        </div>
        <div>
          All reports and plans have locked in, gold was paid, towers were built, and the battle was fought. Tap <b>☀ Watch Dawn {unseenDawn}</b> at the bottom to watch the replay!
        </div>
      </div>
    );
  }

  if (view.clock.finished) {
    return (
      <div style={boxStyle} className="col">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b style={{ color: 'var(--gold)' }}>🎉 Dry Run Complete!</b>
          <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onToggleCollapse}>
            Hide ▴
          </button>
        </div>
        <div>
          You completed all 3 days and faced the Boss! In a real challenge, each day stays open until the next morning's Dawn ({view.setup.config.dawnTime}).
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className="btn small" onClick={onRestart}>
            ↻ Restart dry run
          </button>
          <button className="btn small gold" onClick={onNewChallenge}>
            ⚔ Start real challenge
          </button>
        </div>
      </div>
    );
  }

  const day = view.planDay ?? 1;
  const reported = Boolean(view.myCheckin(day));
  const hasOrders = view.myOrders.length > 0;

  let hint: React.ReactNode;
  if (!scouted) {
    hint =
      day === 1 ? (
        <>
          <b>Step 1 · Scout:</b> Tap <b>👁 Scout</b> (or a red road arrow) to see which roads the horde will attack tonight and what enemy types are marching.
        </>
      ) : day === 2 ? (
        <>
          <b>Day 2 · Tougher foes:</b> New enemy types unlock as the season progresses. Tap <b>👁 Scout</b> to inspect tonight's roads!
        </>
      ) : (
        <>
          <b>Day 3 · Boss Night!</b> On the final night (and every 7th day), <b>The Sugar Wraith</b> marches. Tap <b>👁 Scout</b> to find the Boss road!
        </>
      );
  } else if (!reported) {
    hint =
      day === 1 ? (
        <>
          <b>Step 2 · Report your habit:</b> Tap <b>✔ Report</b> to log today's checklist. Hitting your target earns full gold (+72g) and +2 Hero XP; even an honest partial/missed report still earns gold and triggers the <b>Team Rally</b> (+15% tower speed)!
        </>
      ) : (
        <>
          <b>Step 2 · Report for Day {day}:</b> Tap <b>✔ Report</b>. (Tip: try checking only 1 or 2 boxes to see how partial reports still pay gold, or check all 3 for full gold!)
        </>
      );
  } else if (!hasOrders) {
    hint =
      day === 1 ? (
        <>
          <b>Step 3 · Build towers ({gold}g available):</b> Tap your <b>glowing plots</b> on the valley map to build towers (try an <b>Archer Tower</b> and a <b>Barracks</b>), or open <b>⚒ Plan</b> to set your Hero's stance.
        </>
      ) : day === 2 ? (
        <>
          <b>Step 3 · Upgrade & share ({gold}g available):</b> Tap an existing tower to <b>Upgrade</b> it to Level 2, build a <b>Mage Tower</b> against armoured enemies, or donate gold to the <b>Keep</b> in <b>⚒ Plan</b>.
        </>
      ) : (
        <>
          <b>Step 3 · Boss Night prep ({gold}g available):</b> Build/upgrade towers and open <b>⚒ Plan</b> to send your <b>Hero</b> to reinforce the road the Boss is attacking!
        </>
      );
  } else {
    hint = (
      <>
        <b>Step 4 · Ready for Dawn {day}!</b> In a real challenge, you'd now wait until tomorrow morning ({view.setup.config.dawnTime}). In this dry run, tap <b>⏩ Skip to Dawn {day}</b> below!
      </>
    );
  }

  return (
    <div style={{ ...boxStyle, gap: 6 }} className="col">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b style={{ color: 'var(--gold)' }}>
          🎯 Dry Run · Day {day} of {view.setup.config.days}
        </b>
        <div className="row" style={{ gap: 10 }}>
          <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onTutorial}>
            📖 Guide
          </button>
          <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onToggleCollapse}>
            Hide ▴
          </button>
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        <button type="button" className="chip" style={{ cursor: 'pointer', borderColor: scouted ? 'var(--green)' : undefined }} onClick={onScout}>
          {scouted ? '✓' : '1.'} Scout
        </button>
        <button type="button" className="chip" style={{ cursor: 'pointer', borderColor: reported ? 'var(--green)' : undefined }} onClick={onReport}>
          {reported ? '✓' : '2.'} Report
        </button>
        <button type="button" className="chip" style={{ cursor: 'pointer', borderColor: hasOrders ? 'var(--green)' : undefined }} onClick={hasOrders ? onPlan : onFocusPlots}>
          {hasOrders ? '✓' : '3.'} Build & Plan
        </button>
        <button type="button" className="chip" style={{ cursor: 'pointer', borderColor: 'var(--gold)', color: 'var(--gold)' }} onClick={onSkipDawn}>
          ⏩ Skip to Dawn {day}
        </button>
      </div>
      <div>{hint}</div>
    </div>
  );
}
