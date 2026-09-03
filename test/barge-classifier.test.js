import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBarge } from '../src/brain/barge-classifier.js';

test('backchannels keep the bot talking', () => {
  for (const t of ['yeah', 'uh huh', 'okay', 'right', 'mm-hmm', 'go on', 'sure']) {
    assert.equal(classifyBarge(t), 'BACKCHANNEL', t);
  }
});

test('side talk keeps the bot talking', () => {
  for (const t of ['hold on a second', 'hang on', 'let me grab a pen', 'one moment']) {
    assert.equal(classifyBarge(t), 'SIDE_TALK', t);
  }
});

test('real intent stops the bot', () => {
  for (const t of [
    'not interested thanks',
    'take me off your list',
    'who is this exactly',
    'how did you get my number',
    'are you a robot',
    'actually we just rebuilt our whole site last year',
  ]) {
    assert.equal(classifyBarge(t), 'STOP', t);
  }
});

test('empty / noise defaults to backchannel', () => {
  assert.equal(classifyBarge(''), 'BACKCHANNEL');
  assert.equal(classifyBarge('...'), 'BACKCHANNEL');
});

test('answers to the website-age question interrupt (they are the point of the call)', () => {
  for (const t of [
    '5 years', 'about six years old', 'ten years', 'since 2019', '2019',
    'no website', 'we do not have one', 'brand new', 'last year',
  ]) {
    assert.equal(classifyBarge(t), 'STOP', t);
  }
});

test('short but decisive replies interrupt', () => {
  for (const t of ['no thanks', 'not now', 'I do not need it', 'call me back', 'wrong number']) {
    assert.equal(classifyBarge(t), 'STOP', t);
  }
});

test('genuine filler still does not interrupt', () => {
  for (const t of ['yeah', 'okay', 'uh huh', 'sure', 'right', 'mm-hmm']) {
    assert.equal(classifyBarge(t), 'BACKCHANNEL', t);
  }
});
