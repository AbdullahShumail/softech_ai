# Prompt audio — `prompts/b2b-outreach/`

22 mono WAV files, any sample rate (converted to 8 kHz µ-law at boot). Filename =
key. Missing files are logged at startup and skipped at runtime.

Keep each line short (one or two sentences). The bot plays them back-to-back, so
they must sound natural in sequence. **Keep the AI identification** in `greeting`
and `ans-bot` — do not remove it.

| File | When it plays | Suggested content |
|---|---|---|
| `greeting.wav` | call answered | Identify: automated call from <company>, we build modern websites/software. One-line hook about outdated sites costing business. |
| `pitch.wav` | after greeting / brush-off | 15–20 s: what a modern site + app does for a small business (mobile, speed, bookings/leads), and that you build custom. |
| `pitch-followup.wav` | after a neutral reply to the pitch | "Does getting your website and booking flow modernised sound worth a quick chat with one of our consultants?" |
| `ask-decision-maker.wav` | interest shown, decision-maker unknown / NDM | "Are you the right person who'd decide on the website and software side?" |
| `transfer.wav` | qualified → bridging | "Great — let me connect you with a senior consultant now, one moment." |
| `reprompt.wav` | silence / unclear | "Sorry, I didn't catch that — are you still there?" |
| `wait-ack.wav` | caller says hold on | "Of course, take your time." |
| `voicemail-message.wav` | answering machine detected | Short: who called, what for, a callback number, then ends. |
| `reb-ni.wav` | "not interested" | One-line reframe: most owners say that until they see what a modern site brings in. |
| `reb-has.wav` | "we have a developer/agency" | Acknowledge; we often work alongside or take over stalled projects, quick audit is free. |
| `reb-hap.wav` | "happy with our site" | Acknowledge; ask when it was last rebuilt / is it mobile-first and fast. |
| `reb-budget.wav` | cost / budget objection | Range starts small, phased, ROI framing; the consult is free. |
| `ans-bot.wav` | "are you a robot?" | Yes — an automated assistant from <company>; a human consultant takes over if it's a fit. |
| `ans-who.wav` | "who is this?" | <agent> calling from <company>, we build websites and business software. |
| `ans-how.wav` | "how does this work / how'd you get my number" | Brief: public business listing; a short call, then a human if interested. |
| `ans-email.wav` | "email me info" | Offer to have a consultant send details, confirm best email — or a 2-min chat now. |
| `close-not-interested.wav` | objections exhausted | Polite close, no hard feelings, leave the door open. |
| `close-callback.wav` | bad time / call back | "No problem — we'll try another time. Have a good day." |
| `close-dnc.wav` | opt-out | "Understood, I'll remove you from our list. Sorry to bother you." |
| `close-language.wav` | language barrier | Short apology, end. |
| `ndm-close.wav` | not the decision maker, twice | "No worries — thanks for your time." |
| `close-generic.wav` | fallback close | Neutral goodbye. |
