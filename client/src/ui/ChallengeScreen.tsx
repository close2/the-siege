import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../App';
import { BATTLE, ECON, SIM_VERSION, TICK_RATE } from '../content/stats';
import { getTheme } from '../content/themes';
import { formatDate, formatNumber } from '../i18n/format';
import { DRY_RUN_ID } from '../net/types';
import { GameCanvas } from '../render/GameCanvas';
import type { GameView, ReplayPlayer } from '../render/GameView';
import { sound } from '../render/Sound';
import { padById, sectorById } from '../sim/map';
import { upgradeCost } from '../sim/orders';
import type { Checkin, Order, PadId, PlayerId } from '../sim/types';
import { useSeason, type SeasonView } from '../state/useSeason';
import { Gold, Icon, PLAYER_COLORS, RichText, Sheet, Toast, cssColor, fmtDuration, portraitUrl, useNow } from './common';
import { BuildSheet, CheckInSheet, DawnReport, IntentSheet, PlanSheet, towerRange } from './sheets';
import { TutorialContent } from './Tutorial';

type SheetState = { kind: 'checkin' } | { kind: 'build'; pad: PadId } | { kind: 'plan' } | { kind: 'intent' } | { kind: 'report'; day: number } | { kind: 'menu' } | { kind: 'tutorial' } | null;

export function ChallengeScreen({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const { backend, user, navigate } = useApp();
  const { view, error, putCheckin, putOrders, markSeen, refresh, reload } = useSeason(backend, id, user.id);
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

  // show valley (preview incl. planned orders) & keep canvas handlers fresh (re-draws when language changes)
  useEffect(() => {
    const v = gv.current;
    if (!v || !ready || !view) return;
    v.onPadTap = (pad) => {
      const owner = view.state.pads[pad]?.owner;
      if (replay) return;
      if (owner === user.id && view.planDay) setTimeout(() => setSheet({ kind: 'build', pad }), 0);
      else if (owner) setToast(t('hud.ownersPlot', { name: owners[owner]?.name ?? '?' }));
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
    const myGold = st.players[user.id]?.gold ?? 0;
    const upgradable = new Set<PadId>();
    if (view.planDay)
      for (const [pid, ps] of Object.entries(st.pads)) {
        if (ps.owner !== user.id || !ps.building) continue;
        const c = upgradeCost(ps.building.type, ps.building.level);
        if (c !== null && c <= myGold) upgradable.add(pid);
      }
    v.showValley(view.setup.map, st.pads, st.keep, {
      upgradable,
      owners,
      me: user.id,
      intent: view.clock.finished ? null : view.state.intent,
      theme: view.setup.config.theme,
      rally: view.preview?.rally ?? false,
      animate: true,
    });
  }, [ready, view, replay, owners, user.id, i18n.language, t]);

  // range ring for the plot whose build sheet is open (empty plot: L1 archer reach)
  useEffect(() => {
    const v = gv.current;
    if (!v || !ready || !view) return;
    if (sheet?.kind !== 'build' || replay) {
      v.showRange(0, 0, null);
      return;
    }
    const def = padById(view.setup.map, sheet.pad)?.pad;
    const b = (view.preview?.state ?? view.state).pads[sheet.pad]?.building;
    const r = towerRange(view, sheet.pad, b?.type ?? 'archer', b?.level ?? 1);
    if (def) v.showRange(def.x, def.y, r);
  }, [ready, view, sheet, replay]);

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
        markSeen(day);
      };
      setReplay({ day, player: p });
      if (view.battles[day - 1].rally) setTimeout(() => sound.play('horn'), 300);
    },
    [view, owners, user.id, speed, myFocus, markSeen],
  );

  const endReplay = () => {
    if (gv.current) gv.current.autoCamera = false;
    setReplay(null);
  };

  // unseen Dawn → offer replay (synced across devices via challenge.seenDay + localStorage)
  const resolved = view?.clock.resolved ?? 0;
  const seen = Math.max(Number(localStorage.getItem(seenKey) ?? 0), view?.challenge.seenDay ?? 0);
  const unseenDawn = resolved > 0 && seen < resolved ? resolved : null;

  const doCheckin = async (day: number, c: Checkin) => {
    const res = await putCheckin(day, c);
    sound.play('coin');
    setToast(res === 'queued' ? t('hud.reportedOfflineToast') : t('hud.reportedToast'));
  };

  const doOrders = (orders: Order[]) => {
    if (!view?.planDay) return;
    // drop plans the preview already rejects for good (e.g. "pad occupied"); keep "not enough gold" (today's report may still pay for it)
    const dead = new Set((view.preview?.players[user.id]?.skipped ?? []).filter((s) => s.reason !== 'not enough gold').map((s) => s.order));
    putOrders(
      view.planDay,
      orders.filter((o) => !dead.has(o)),
    ).catch((e) => setToast((e as Error).message));
  };

  const now = useNow(1000, () => backend.now(id));

  if (error && !view) return <div className="screen error">{error}</div>;
  if (!view)
    return (
      <div className="screen bg-art center" style={{ paddingTop: '40vh' }}>
        {t('app.loadingValley')}
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
    if (f) v.focus((f.x + view.setup.map.keep.x) / 2, (f.y + view.setup.map.keep.y) / 2);
  };

  // the dry run restarts under the same id: drop every cached event of the previous run
  const afterDryRunRestart = async () => {
    endReplay();
    setScoutedDay(0);
    setSheet(null);
    setCoachCollapsed(false);
    centered.current = false;
    await reload();
  };

  const restartDryRun = async () => {
    await backend.startDryRun(myHeroClass);
    await afterDryRunRestart();
  };

  const centerMyPlotsAndFollow = () => {
    centerMyPlots();
    if (replay && gv.current) gv.current.autoCamera = true;
  };

  const focusPad = (pad: PadId) => {
    const def = padById(view.setup.map, pad)?.pad;
    if (def && gv.current) gv.current.focus(def.x, def.y + 80);
  };

  // ---------- lobby ----------
  if (!clock.started) {
    const link = `${location.origin}/join/${view.challenge.inviteCode}`;
    return (
      <div className="screen bg-art col">
        <div className="row">
          <button className="btn small" onClick={() => navigate('/')}>
            {t('common.home')}
          </button>
          <h2 className="grow selectable" style={{ margin: 0 }}>
            {setup.config.title}
          </h2>
        </div>
        <div className="panel col">
          <h3>{t('lobby.gathering')}</h3>
          <div className="selectable">
            <RichText
              i18nKey="lobby.beginsIn"
              values={{
                duration: fmtDuration(clock.windows[0].open - now),
                startDate: formatDate(setup.config.startDate),
                days: setup.config.days,
              }}
            />
          </div>
          {backend.mode === 'http' && !view.challenge.local && (
            <>
              <div>{t('lobby.inviteFriends')}</div>
              <div className="title center selectable" style={{ fontSize: 28, letterSpacing: '0.15em' }}>
                {view.challenge.inviteCode}
              </div>
              <button
                className="btn gold block"
                onClick={async () => {
                  if (navigator.share)
                    await navigator
                      .share({ title: t('app.title'), text: t('lobby.shareText', { title: setup.config.title }), url: link })
                      .catch(() => undefined);
                  else {
                    await navigator.clipboard.writeText(link);
                    setToast(t('lobby.linkCopied'));
                  }
                }}
              >
                {t('lobby.shareInviteLink')}
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
              {t('lobby.startNowDemo')}
            </button>
          )}
          <h3>{t('lobby.defenders')}</h3>
          {view.challenge.members.map((m, i) => (
            <div key={m.userId} className="row selectable">
              <img src={portraitUrl(m.heroClass)} width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: `3px solid ${cssColor(PLAYER_COLORS[i % 8])}` }} alt="" />
              <b>{owners[m.userId]?.name ?? m.name}</b>
              {m.bot && <span className="muted">{t('common.bot')}</span>}
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
              {clock.finished
                ? t('hud.seasonComplete')
                : t('hud.dayStatus', {
                    day: view.planDay,
                    total: setup.config.days,
                    duration: fmtDuration((nextDawn ?? now) - now),
                  })}
            </div>
          </div>
          <span className="chip">
            <Icon id="gold" size={18} />
            {formatNumber(gold)}
          </span>
          <span className="chip">
            <Icon id="heart" size={18} />
            {formatNumber(Math.round(keep.hp))}
          </span>
          <span className="chip">
            <Icon id="star" size={18} />
            {formatNumber(totalStars)}
          </span>
        </div>
        <div className="team">
          {view.challenge.members
            .slice()
            .sort((a, b) => a.joinOrder - b.joinOrder)
            .map((m, i) => {
              const targetDay = view.planDay ?? clock.open[0] ?? null;
              const done = targetDay ? view.checkedIn(targetDay, m.userId) : true;
              const label = owners[m.userId]?.name ?? m.name;
              return (
                <div key={m.userId} className={'avatar' + (done ? '' : ' dim')} style={{ '--c': cssColor(PLAYER_COLORS[i % 8]) } as React.CSSProperties} title={label}>
                  <img src={portraitUrl(m.heroClass)} alt="" />
                  {done && targetDay !== null && <Icon id="check" size={18} style={{ position: 'absolute', right: -2, top: 26 }} />}
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.userId === me ? t('common.you') : label}</div>
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
            {t('hud.simMismatch', { challengeVer: view.challenge.simVersion, appVer: SIM_VERSION })}
          </div>
        )}
        {view.pendingCount > 0 && (
          <button
            type="button"
            className="chip"
            style={{ cursor: 'pointer', alignSelf: 'center', borderColor: 'var(--gold)', color: 'var(--gold)', fontSize: 12 }}
            onClick={() => void refresh()}
          >
            {t('hud.pendingSync', { count: view.pendingCount })}
          </button>
        )}
        {view.desyncDay && <div className="error" style={{ fontSize: 12 }}>{t('hud.desyncWarning', { day: view.desyncDay })}</div>}
        {error && <div className="error" style={{ fontSize: 12 }}>{error}</div>}
      </div>

      {replay ? (
        <>
          <div className="dawn-banner center">
            {t('replay.dawnBanner', { day: replay.day })}
            <ReplayClock player={replay.player} />
          </div>
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
              {t('replay.skip')}
            </button>
            <button className="btn small" onClick={endReplay}>
              ✕
            </button>
          </div>
        </>
      ) : (
        <div className="hud-bottom">
          {unseenDawn ? (
            <button className="btn gold" style={{ maxWidth: 340, animation: 'pulse 1.4s infinite' }} onClick={() => startReplay(unseenDawn)}>
              {t('hud.watchDawn', { day: unseenDawn })}
            </button>
          ) : (
            <>
              <button className={'btn' + (missingCheckin ? ' gold' : '')} disabled={!clock.open.length} onClick={() => setSheet({ kind: 'checkin' })} style={{ position: 'relative' }}>
                {t('hud.report')}
                {missingCheckin && <span className="badge-dot">!</span>}
              </button>
              <button className="btn" disabled={!view.planDay} onClick={() => setSheet({ kind: 'plan' })} style={{ position: 'relative' }}>
                {t('hud.plan')}
                {view.myOrders.length > 0 && <span className="badge-dot" style={{ background: '#3a8a3a' }}>{view.myOrders.length}</span>}
              </button>
              <button className="btn" disabled={!view.state.intent} onClick={openScout}>
                {t('hud.scout')}
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
      {sheet?.kind === 'plan' && pv && (
        <PlanSheet
          view={view}
          onOrders={doOrders}
          onOpenPad={(pad) => {
            focusPad(pad);
            setSheet({ kind: 'build', pad });
          }}
          onClose={() => setSheet(null)}
        />
      )}
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
            <h3>{t('menu.title')}</h3>
            <button className="btn block" onClick={() => setSheet({ kind: 'tutorial' })}>
              {t('menu.howToPlay')}
            </button>
            {resolved > 0 && (
              <button className="btn block" onClick={() => startReplay(resolved)}>
                {t('menu.replayDawn', { day: resolved })}
              </button>
            )}
            {resolved > 0 && (
              <button className="btn block" onClick={() => setSheet({ kind: 'report', day: resolved })}>
                {t('menu.lastReport')}
              </button>
            )}
            {backend.mode === 'http' && !view.challenge.local && (
              <button
                className="btn block"
                onClick={async () => {
                  const link = `${location.origin}/join/${view.challenge.inviteCode}`;
                  await navigator.clipboard?.writeText(link).catch(() => undefined);
                  setToast(t('hud.inviteCopiedToast', { code: view.challenge.inviteCode }));
                  setSheet(null);
                }}
              >
                {t('menu.inviteCode', { code: view.challenge.inviteCode })}
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
                {t('menu.skipToNextDawn')}
              </button>
            )}
            {isDryRun && (
              <button className="btn block" onClick={restartDryRun}>
                {t('menu.restartDryRun')}
              </button>
            )}
            <button className="btn block" onClick={() => navigate('/settings')}>
              {t('menu.settings')}
            </button>
            <div className="muted" style={{ fontSize: 12 }}>
              {t('menu.goldAfterPlans')} <Gold n={gold} size={14} />
            </div>
          </div>
        </div>
      )}
      {sheet?.kind === 'tutorial' && (
        <Sheet wide onClose={() => setSheet(null)}>
          <h2>{t('tutorial.title')}</h2>
          <TutorialContent
            inDryRun={isDryRun}
            onStartDryRun={async (hc) => {
              await backend.startDryRun(hc);
              setSheet(null);
              if (isDryRun) await afterDryRunRestart();
              else navigate(`/c/${DRY_RUN_ID}`);
            }}
          />
        </Sheet>
      )}
      {!sheet && (
        <button className="btn small recenter" onClick={centerMyPlotsAndFollow} title={t('hud.backToPlots')} aria-label={t('hud.backToPlots')}>
          📍
        </button>
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

/** battle clock during a replay: enemies still alive when it runs out retreat at sunrise */
function ReplayClock({ player }: { player: ReplayPlayer }) {
  const { t } = useTranslation();
  useNow(250, () => player.battle.tick);
  const left = Math.max(0, BATTLE.maxSeconds - player.battle.tick / TICK_RATE);
  const over = player.battle.done;
  const cleared = player.battle.enemies.length === 0;
  const m = Math.floor(left / 60);
  const s = Math.floor(left % 60);
  return (
    <div style={{ fontSize: 14, fontFamily: 'inherit', lineHeight: 1.2 }}>
      {over ? (cleared ? t('replay.hordeDefeated') : t('replay.sunrise')) : `⏱ ${m}:${String(s).padStart(2, '0')}`}
      <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'system-ui, sans-serif' }}>
        {over ? (cleared ? t('replay.subCleared') : t('replay.subRetreat')) : t('replay.subUntilSunrise')}
      </div>
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
  const { t } = useTranslation();
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
    const status = unseenDawn
      ? t('coach.statusDawnReady', { day: unseenDawn })
      : view.planDay
        ? t('coach.statusDayOf', { day: view.planDay, total: view.setup.config.days })
        : t('coach.statusComplete');
    return (
      <div style={boxStyle} className="row">
        <b className="grow" style={{ color: 'var(--gold)' }}>
          {t('coach.collapsedTitle', { status })}
        </b>
        <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onToggleCollapse}>
          {t('coach.show')}
        </button>
      </div>
    );
  }

  if (unseenDawn) {
    return (
      <div style={boxStyle} className="col">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b style={{ color: 'var(--gold)' }}>{t('coach.dawnArrivedTitle', { day: unseenDawn })}</b>
          <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onToggleCollapse}>
            {t('coach.hide')}
          </button>
        </div>
        <div>
          <RichText i18nKey="coach.dawnArrivedBody" values={{ day: unseenDawn }} />
        </div>
      </div>
    );
  }

  if (view.clock.finished) {
    return (
      <div style={boxStyle} className="col">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b style={{ color: 'var(--gold)' }}>{t('coach.completeTitle')}</b>
          <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onToggleCollapse}>
            {t('coach.hide')}
          </button>
        </div>
        <div>{t('coach.completeBody', { dawnTime: view.setup.config.dawnTime })}</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className="btn small" onClick={onRestart}>
            {t('coach.restartDryRun')}
          </button>
          <button className="btn small gold" onClick={onNewChallenge}>
            {t('coach.startRealChallenge')}
          </button>
        </div>
      </div>
    );
  }

  const day = view.planDay ?? 1;
  const reported = Boolean(view.myCheckin(day));
  const hasOrders = view.myOrders.length > 0;
  const theme = getTheme(view.setup.config.theme);

  let hint: React.ReactNode;
  if (!scouted) {
    hint =
      day === 1 ? (
        <RichText i18nKey="coach.hintScoutDay1" />
      ) : day === 2 ? (
        <RichText i18nKey="coach.hintScoutDay2" />
      ) : (
        <RichText i18nKey="coach.hintScoutDay3" values={{ bossName: theme.bossName }} />
      );
  } else if (!reported) {
    hint = day === 1 ? <RichText i18nKey="coach.hintReportDay1" /> : <RichText i18nKey="coach.hintReportOther" values={{ day }} />;
  } else if (!hasOrders) {
    hint =
      day === 1 ? (
        <RichText i18nKey="coach.hintOrdersDay1" values={{ gold }} />
      ) : day === 2 ? (
        <RichText i18nKey="coach.hintOrdersDay2" values={{ gold }} />
      ) : (
        <RichText i18nKey="coach.hintOrdersDay3" values={{ gold }} />
      );
  } else {
    hint = <RichText i18nKey="coach.hintReady" values={{ day, dawnTime: view.setup.config.dawnTime }} />;
  }

  return (
    <div style={{ ...boxStyle, gap: 6 }} className="col">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b style={{ color: 'var(--gold)' }}>{t('coach.headerDay', { day, total: view.setup.config.days })}</b>
        <div className="row" style={{ gap: 10 }}>
          <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onTutorial}>
            {t('coach.guide')}
          </button>
          <button className="linkbtn" style={{ padding: 0, fontSize: 12 }} onClick={onToggleCollapse}>
            {t('coach.hide')}
          </button>
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        <button type="button" className="chip" style={{ cursor: 'pointer', borderColor: scouted ? 'var(--green)' : undefined }} onClick={onScout}>
          {t('coach.chipScout', { prefix: scouted ? '✓' : '1.' })}
        </button>
        <button type="button" className="chip" style={{ cursor: 'pointer', borderColor: reported ? 'var(--green)' : undefined }} onClick={onReport}>
          {t('coach.chipReport', { prefix: reported ? '✓' : '2.' })}
        </button>
        <button type="button" className="chip" style={{ cursor: 'pointer', borderColor: hasOrders ? 'var(--green)' : undefined }} onClick={hasOrders ? onPlan : onFocusPlots}>
          {t('coach.chipBuildPlan', { prefix: hasOrders ? '✓' : '3.' })}
        </button>
        <button type="button" className="chip" style={{ cursor: 'pointer', borderColor: 'var(--gold)', color: 'var(--gold)' }} onClick={onSkipDawn}>
          {t('coach.chipSkipDawn', { day })}
        </button>
      </div>
      <div>{hint}</div>
    </div>
  );
}
