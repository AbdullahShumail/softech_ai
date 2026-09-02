import { DISPOSITIONS } from './dispositions.js';
import { PROMPTS, rebuttalPrompt, answerPrompt, closePrompt } from './audio-map.js';

// Three-turn state machine. Pure function: given a disposition + the call's
// running state + campaign config, return what to do next. The session applies
// `updates` to its state and performs `action`.
//
//   turn 1  greeting played  → get past the brush-off, deliver the pitch
//   turn 2  pitch played     → read interest, qualify the decision maker
//   turn 3  objection handling → rebut (capped) then transfer or close
//
// action: 'continue' (play prompts, then keep listening on `updates.turn`)
//       | 'transfer'  (play transfer line, then bridge to a closer)
//       | 'hangup'    (play prompts, then end the call)

const DEFAULT_MAX_REBUTTALS = 3;
const MAX_REPEATS = 3;
const MAX_QUESTIONS = 4;

export function freshState() {
  return {
    turn: 1,
    pitchDelivered: false,
    interested: false,
    decisionMaker: null, // true | false | null
    rebuttalCount: 0,
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

/**
 * @param {string} disposition       classifier code
 * @param {boolean|null} decisionMaker  freshly extracted this turn (null = unknown)
 * @param {object} state              current session state (see freshState)
 * @param {object} campaign           loaded campaign config
 * @returns {{action:string, prompts:string[], updates:object, finalDisposition?:string, reason?:string}}
 */
export function decide(disposition, decisionMaker, state, campaign) {
  const s = { ...state };
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
  if (g === 'question') {
    const questionCount = s.questionCount + 1;
    const prompts = [answerPrompt(disposition)].filter(Boolean);
    if (questionCount > MAX_QUESTIONS) {
      // stop the Q&A loop; move things along
      if (!s.pitchDelivered) {
        return {
          action: 'continue',
          prompts: [...prompts, PROMPTS.pitch],
          updates: { questionCount, turn: 2, pitchDelivered: true },
        };
      }
      return terminate(disposition, [...prompts, closePrompt('R')]);
    }
    // answer, then re-ask where we were
    const followup = s.pitchDelivered ? PROMPTS.pitchFollowup : PROMPTS.pitch;
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

  // ---- transfer opportunity ----
  if (g === 'transfer' || (g === 'advance' && disposition === 'INT')) {
    s.interested = true;
    if (canTransfer(s)) {
      return { action: 'transfer', prompts: [PROMPTS.transfer], updates: { interested: true }, finalDisposition: 'QUAL' };
    }
    // interested but not yet qualified/pitched
    if (!s.pitchDelivered) {
      return {
        action: 'continue',
        prompts: [PROMPTS.pitch],
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
  if (s.turn === 1) return turn1(disposition, g, s);
  if (s.turn === 2) return turn2(disposition, g, s);
  return turn3(disposition, g, s, maxRebuttals);
}

function turn1(disposition, g, s) {
  // NEU / DM → straight to the pitch
  if (g === 'advance') {
    return {
      action: 'continue',
      prompts: [PROMPTS.pitch],
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
        prompts: [PROMPTS.pitch],
        updates: { turn: 2, pitchDelivered: true, bulldozedT1: true },
      };
    }
    return terminate(disposition, [closePrompt(disposition)]);
  }
  return { action: 'continue', prompts: [PROMPTS.reprompt], updates: { repeatCount: s.repeatCount + 1 } };
}

function turn2(disposition, g, s) {
  if (g === 'callback') return terminate(disposition, [closePrompt(disposition)]);

  if (g === 'advance') {
    // NEU after the pitch → nudge once, move to objection turn
    return { action: 'continue', prompts: [PROMPTS.pitchFollowup], updates: { turn: 3 } };
  }
  if (g === 'objection') {
    const prompt = rebuttalPrompt(disposition);
    return {
      action: 'continue',
      prompts: prompt ? [prompt] : [PROMPTS.pitchFollowup],
      updates: { turn: 3, rebuttalCount: 1 },
    };
  }
  return { action: 'continue', prompts: [PROMPTS.reprompt], updates: { repeatCount: s.repeatCount + 1 } };
}

function turn3(disposition, g, s, maxRebuttals) {
  if (g === 'callback') return terminate(disposition, [closePrompt(disposition)]);

  if (g === 'objection') {
    if (s.rebuttalCount >= maxRebuttals) {
      return terminate(disposition, [closePrompt(disposition)]);
    }
    const prompt = rebuttalPrompt(disposition);
    return {
      action: 'continue',
      prompts: prompt ? [prompt] : [closePrompt(disposition)],
      updates: { rebuttalCount: s.rebuttalCount + 1 },
    };
  }
  if (g === 'advance') {
    // NEU at turn 3 after rebuttals — one last nudge, else close
    if (s.rebuttalCount >= maxRebuttals) return terminate('NI', [closePrompt('NI')]);
    return { action: 'continue', prompts: [PROMPTS.pitchFollowup], updates: { rebuttalCount: s.rebuttalCount + 1 } };
  }
  return { action: 'continue', prompts: [PROMPTS.reprompt], updates: { repeatCount: s.repeatCount + 1 } };
}
