import { DISPOSITIONS } from './dispositions.js';
import { PROMPTS, rebuttalPrompt, answerPrompt, closePrompt } from './audio-map.js';

// Three-turn state machine. Pure function: given a disposition + the call's
// running state + campaign config, return what to do next. The session applies
// `updates` to its state and performs `action`.
//
//   turn 1  greeting played  → get past the brush-off, deliver the pitch
//   turn 2  pitch played     → read interest, qualify the decision maker
//   turn 3  objection handling → climb the rebuttal ladder, then transfer or close
//
// action: 'continue' (play prompts, then keep listening on `updates.turn`)
//       | 'transfer'  (play transfer line, then bridge to a closer)
//       | 'hangup'    (play prompts, then end the call)
//
// Rebuttals are per-code LADDERS (see audio-map). Each objection code tracks its
// own rung in state.usedRebuttals, so hearing NI then BUDGET starts BUDGET at
// its own rung 0 rather than skipping ahead. A ladder that runs out returns
// null, which means "out of road" — close rather than repeat a line.

const DEFAULT_MAX_REBUTTALS = 3;
const MAX_REPEATS = 3;
const MAX_QUESTIONS = 4;

// A site this old is a qualifying signal, so the pitch opens by naming it.
const DATED_SITE_YEARS = 3;

export function freshState() {
  return {
    turn: 1,
    pitchDelivered: false,
    interested: false,
    decisionMaker: null, // true | false | null
    rebuttalCount: 0,
    usedRebuttals: {}, // code -> next rung
    repeatCount: 0,
    questionCount: 0,
    bulldozedT1: false,
    awaitingDecisionMaker: false,
  };
}

const group = (code) => DISPOSITIONS[code]?.group ?? 'reprompt';

function terminate(code, prompts) {
  return { action: 'hangup', prompts, updates: {}, finalDisposition: code };
}

function canTransfer(s) {
  return s.pitchDelivered && s.interested && s.decisionMaker === true;
}

/** Opening pitch, tailored when we know the site is old or absent. */
function pitchFor(hints) {
  if (hints.noSite) return PROMPTS.pitchNoSite;
  const yrs = hints.siteAgeYears;
  if (typeof yrs === 'number' && yrs >= DATED_SITE_YEARS) return PROMPTS.pitchDated;
  return PROMPTS.pitch;
}

/** Take the next rung of a code's ladder, or null if it's spent. */
function nextRebuttal(s, code, maxRebuttals) {
  if (s.rebuttalCount >= maxRebuttals) return null;
  const rung = s.usedRebuttals[code] ?? 0;
  const prompt = rebuttalPrompt(code, rung);
  if (!prompt) return null;
  return {
    prompt,
    updates: {
      rebuttalCount: s.rebuttalCount + 1,
      usedRebuttals: { ...s.usedRebuttals, [code]: rung + 1 },
    },
  };
}

/**
 * @param {string} disposition       classifier code
 * @param {boolean|null} decisionMaker  freshly extracted this turn (null = unknown)
 * @param {object} state              current session state (see freshState)
 * @param {object} campaign           loaded campaign config
 * @param {object} [hints]            { siteAgeYears?: number, noSite?: boolean }
 * @returns {{action:string, prompts:string[], updates:object, finalDisposition?:string, reason?:string}}
 */
export function decide(disposition, decisionMaker, state, campaign, hints = {}) {
  const r = route(disposition, decisionMaker, state, campaign, hints);
  // Prompt entries may be arrays (a split pitch) — flatten to a flat play list.
  return { ...r, prompts: (r.prompts ?? []).flat().filter(Boolean) };
}

function route(disposition, decisionMaker, state, campaign, hints) {
  const s = { ...state, usedRebuttals: { ...state.usedRebuttals } };
  if (decisionMaker === true || decisionMaker === false) s.decisionMaker = decisionMaker;

  const maxRebuttals = campaign?.turnLogic?.['3']?.maxRebuttals ?? DEFAULT_MAX_REBUTTALS;
  const g = group(disposition);

  // ---- global handlers (any turn) ----
  if (disposition === 'AM') {
    return { action: 'hangup', prompts: [PROMPTS.voicemail], updates: {}, finalDisposition: 'AM' };
  }
  if (g === 'terminate') {
    return terminate(disposition, [closePrompt(disposition)]);
  }
  if (disposition === 'WAIT') {
    return { action: 'continue', prompts: [PROMPTS.waitAck], updates: {}, reason: 'hold' };
  }
  if (disposition === 'R') {
    const repeatCount = s.repeatCount + 1;
    if (repeatCount >= MAX_REPEATS) return terminate('R', [closePrompt('R')]);
    return { action: 'continue', prompts: [PROMPTS.reprompt], updates: { repeatCount } };
  }

  // "I'm busy" before we have said anything is worth one save — a rep answers it
  // by shrinking the ask, not by hanging up. After that, respect it.
  if (disposition === 'TIME') {
    const reb = !s.pitchDelivered ? nextRebuttal(s, 'TIME', maxRebuttals) : null;
    if (reb) {
      return {
        action: 'continue',
        prompts: [reb.prompt, PROMPTS.pitchShort],
        updates: { ...reb.updates, turn: 2, pitchDelivered: true },
      };
    }
    return terminate('TIME', [closePrompt('TIME')]);
  }

  if (g === 'question') {
    const questionCount = s.questionCount + 1;
    const prompts = [answerPrompt(disposition)].filter(Boolean);
    if (questionCount > MAX_QUESTIONS) {
      // stop the Q&A loop; move things along
      if (!s.pitchDelivered) {
        return {
          action: 'continue',
          prompts: [...prompts, pitchFor(hints)],
          updates: { questionCount, turn: 2, pitchDelivered: true },
        };
      }
      return terminate(disposition, [...prompts, closePrompt('R')]);
    }
    // answer, then re-ask where we were
    const followup = s.pitchDelivered ? PROMPTS.pitchFollowup : pitchFor(hints);
    const updates = { questionCount };
    if (!s.pitchDelivered) {
      updates.turn = 2;
      updates.pitchDelivered = true;
    }
    return { action: 'continue', prompts: [...prompts, followup], updates };
  }

  if (disposition === 'NDM') {
    if (s.awaitingDecisionMaker) {
      return terminate('NDM', [closePrompt('NDM')]);
    }
    return {
      action: 'continue',
      prompts: [PROMPTS.askDecisionMaker],
      updates: { awaitingDecisionMaker: true, decisionMaker: false },
    };
  }

  // No website at all is the strongest lead on the list — pitch it directly and
  // qualify in the same breath rather than walking the generic three turns.
  if (disposition === 'NOSITE' && !s.pitchDelivered) {
    return {
      action: 'continue',
      prompts: [PROMPTS.pitchNoSite, PROMPTS.askDecisionMaker],
      updates: {
        interested: true,
        pitchDelivered: true,
        awaitingDecisionMaker: true,
        turn: 3,
      },
    };
  }

  // ---- transfer opportunity ----
  // askedAndOwns covers the reply to askDecisionMaker: we already had interest,
  // we asked who decides, and they said it is them.
  const askedAndOwns = s.awaitingDecisionMaker && s.decisionMaker === true && s.interested;
  if (g === 'transfer' || disposition === 'INT' || askedAndOwns) {
    s.interested = true;
    if (canTransfer(s)) {
      return { action: 'transfer', prompts: [PROMPTS.transfer], updates: { interested: true }, finalDisposition: 'QUAL' };
    }
    if (!s.pitchDelivered) {
      return {
        action: 'continue',
        prompts: [pitchFor(hints)],
        updates: { interested: true, turn: 2, pitchDelivered: true },
      };
    }
    // pitched + interested, decision maker unknown → qualify
    return {
      action: 'continue',
      prompts: [PROMPTS.askDecisionMaker],
      updates: { interested: true, awaitingDecisionMaker: true, turn: Math.max(s.turn, 3) },
    };
  }

  // ---- per-turn ----
  if (s.turn === 1) return turn1(disposition, g, s, maxRebuttals, hints);
  if (s.turn === 2) return turn2(disposition, g, s, maxRebuttals, hints);
  return turn3(disposition, g, s, maxRebuttals);
}

function turn1(disposition, g, s, maxRebuttals, hints) {
  // NEU / DM → acknowledge what they just told us, then pitch. (NOSITE never
  // reaches here; it has its own opener that already reacts to the answer.)
  if (g === 'advance') {
    return {
      action: 'continue',
      prompts: [PROMPTS.great, pitchFor(hints)],
      updates: { turn: 2, pitchDelivered: true },
    };
  }
  if (g === 'callback') {
    return terminate(disposition, [closePrompt(disposition)]);
  }
  if (g === 'objection') {
    // reflexive brush-off before hearing anything — bulldoze once with the pitch
    if (!s.bulldozedT1) {
      return {
        action: 'continue',
        prompts: [pitchFor(hints)],
        updates: { turn: 2, pitchDelivered: true, bulldozedT1: true },
      };
    }
    const reb = nextRebuttal(s, disposition, maxRebuttals);
    if (reb) {
      return { action: 'continue', prompts: [reb.prompt], updates: { ...reb.updates, turn: 3 } };
    }
    return terminate(disposition, [closePrompt(disposition)]);
  }
  return { action: 'continue', prompts: [PROMPTS.reprompt], updates: { repeatCount: s.repeatCount + 1 } };
}

function turn2(disposition, g, s, maxRebuttals, hints) {
  if (g === 'callback') return terminate(disposition, [closePrompt(disposition)]);

  if (g === 'advance') {
    // NEU after the pitch → nudge once, move to objection turn
    return { action: 'continue', prompts: [PROMPTS.pitchFollowup], updates: { turn: 3 } };
  }
  if (g === 'objection') {
    const reb = nextRebuttal(s, disposition, maxRebuttals);
    if (reb) {
      return { action: 'continue', prompts: [reb.prompt], updates: { ...reb.updates, turn: 3 } };
    }
    return terminate(disposition, [closePrompt(disposition)]);
  }
  return { action: 'continue', prompts: [PROMPTS.reprompt], updates: { repeatCount: s.repeatCount + 1 } };
}

function turn3(disposition, g, s, maxRebuttals) {
  if (g === 'callback') return terminate(disposition, [closePrompt(disposition)]);

  if (g === 'objection') {
    const reb = nextRebuttal(s, disposition, maxRebuttals);
    if (reb) {
      return { action: 'continue', prompts: [reb.prompt], updates: reb.updates };
    }
    return terminate(disposition, [closePrompt(disposition)]);
  }
  if (g === 'advance') {
    // NEU at turn 3 after rebuttals — one last nudge, else close
    if (s.rebuttalCount >= maxRebuttals) return terminate('NI', [closePrompt('NI')]);
    return { action: 'continue', prompts: [PROMPTS.pitchFollowup], updates: { rebuttalCount: s.rebuttalCount + 1 } };
  }
  return { action: 'continue', prompts: [PROMPTS.reprompt], updates: { repeatCount: s.repeatCount + 1 } };
}
