'use strict';
const GameEngine = require('../../src/modules/game/game.engine');

describe('GameEngine — State Machine', () => {

  // ── transition ────────────────────────────────────────────────────────────

  describe('transition()', () => {
    test('valid: setup → lobby', () => {
      const r = GameEngine.transition({ state:'setup', version:0 }, 'lobby');
      expect(r.success).toBe(true);
      expect(r.state).toBe('lobby');
      expect(r.version).toBe(1);
    });

    test('valid: scoring → playing', () => {
      const r = GameEngine.transition({ state:'scoring', version:5 }, 'playing');
      expect(r.success).toBe(true);
    });

    test('invalid: setup → playing', () => {
      const r = GameEngine.transition({ state:'setup', version:0 }, 'playing');
      expect(r.success).toBe(false);
      expect(r.error).toContain('Invalid transition');
    });

    test('invalid: finished → anything', () => {
      const r = GameEngine.transition({ state:'finished', version:10 }, 'playing');
      expect(r.success).toBe(false);
    });

    test('handles missing state gracefully', () => {
      const r = GameEngine.transition({}, 'lobby');
      expect(r.success).toBe(false);
    });
  });

  // ── selectQuestion ────────────────────────────────────────────────────────

  describe('selectQuestion()', () => {
    const board = [
      { category:'Science', values:[
        { value:200, questionId:'q1', used:false },
        { value:400, questionId:'q2', used:true  },
      ]},
      { category:'History', values:[
        { value:200, questionId:'q3', used:false },
      ]},
    ];

    test('selects available cell', () => {
      const r = GameEngine.selectQuestion(board, 'Science', 200);
      expect(r.success).toBe(true);
      expect(r.cell.questionId).toBe('q1');
      expect(r.board[0].values[0].used).toBe(true);
    });

    test('fails on already-used cell', () => {
      const r = GameEngine.selectQuestion(board, 'Science', 400);
      expect(r.success).toBe(false);
    });

    test('fails on non-existent category', () => {
      const r = GameEngine.selectQuestion(board, 'Sports', 200);
      expect(r.success).toBe(false);
    });

    test('fails on invalid value', () => {
      const r = GameEngine.selectQuestion(board, 'Science', 999);
      expect(r.success).toBe(false);
    });
  });

  // ── applyScore ────────────────────────────────────────────────────────────

  describe('applyScore()', () => {
    const teams = [
      { id:'t1', name:'Alpha', score:1000 },
      { id:'t2', name:'Beta',  score:600  },
    ];

    test('adds score for correct answer', () => {
      const r = GameEngine.applyScore(teams, 't1', 400);
      expect(r.success).toBe(true);
      expect(r.teams.find(t=>t.id==='t1').score).toBe(1400);
    });

    test('deducts score for wrong answer (no negative floor by default)', () => {
      const r = GameEngine.applyScore(teams, 't2', -200);
      expect(r.success).toBe(true);
      expect(r.teams.find(t=>t.id==='t2').score).toBe(400);
    });

    test('floor at 0 by default', () => {
      const poor = [{ id:'t1', name:'Poor', score:100 }];
      const r = GameEngine.applyScore(poor, 't1', -400);
      expect(r.success).toBe(true);
      expect(r.teams[0].score).toBe(0);
    });

    test('allows negative score if allowNegative=true', () => {
      const poor = [{ id:'t1', name:'Poor', score:100 }];
      const r = GameEngine.applyScore(poor, 't1', -400, true);
      expect(r.teams[0].score).toBe(-300);
    });

    test('fails for unknown team', () => {
      const r = GameEngine.applyScore(teams, 'unknown', 200);
      expect(r.success).toBe(false);
    });
  });

  // ── isBoardComplete ───────────────────────────────────────────────────────

  describe('isBoardComplete()', () => {
    test('empty board → false', () => {
      expect(GameEngine.isBoardComplete([])).toBe(false);
    });

    test('all used → true', () => {
      const board = [{ category:'A', values:[{ value:200, used:true }] }];
      expect(GameEngine.isBoardComplete(board)).toBe(true);
    });

    test('one unused → false', () => {
      const board = [{ category:'A', values:[{ value:200, used:true }, { value:400, used:false }] }];
      expect(GameEngine.isBoardComplete(board)).toBe(false);
    });
  });

  // ── buildBoard ────────────────────────────────────────────────────────────

  describe('buildBoard()', () => {
    test('creates board from categories and questions', () => {
      const cats = ['Science','History'];
      const qMap = {
        Science: [{ _id:'q1', value:200 }, { _id:'q2', value:400 }],
        History: [{ _id:'q3', value:200 }],
      };
      const board = GameEngine.buildBoard(cats, qMap);
      expect(board).toHaveLength(2);
      expect(board[0].category).toBe('Science');
      expect(board[0].values[0].used).toBe(false);
    });
  });

  // ── replay ────────────────────────────────────────────────────────────────

  describe('replay()', () => {
    test('rebuilds state from logs without mutating base', () => {
      const base  = { state:'lobby', version:0, teams:[], board:[] };
      const logs  = [
        { action:'STATE_TRANSITION', payload:{ targetState:'playing' }, sequence:1 },
        { action:'TEAM_ADD', payload:{ team:{ id:'t1', name:'Alpha', score:0, players:[], color:'#6366f1' } }, sequence:2 },
      ];
      const result = GameEngine.replay(base, logs);
      expect(result.state).toBe('playing');
      expect(result.teams).toHaveLength(1);
      expect(base.state).toBe('lobby'); // base not mutated
    });

    test('skips corrupt log entries', () => {
      const base = { state:'lobby', version:0, teams:[] };
      const logs = [{ action:'UNKNOWN_ACTION', payload:{}, sequence:1 }];
      const result = GameEngine.replay(base, logs);
      expect(result.state).toBe('lobby'); // unchanged
    });
  });

  // ── leaderboard ───────────────────────────────────────────────────────────

  describe('leaderboard()', () => {
    test('sorts by score descending', () => {
      const teams = [{ id:'t1', score:200 }, { id:'t2', score:800 }, { id:'t3', score:400 }];
      const lb = GameEngine.leaderboard(teams);
      expect(lb[0].score).toBe(800);
      expect(lb[2].score).toBe(200);
    });

    test('does not mutate original array', () => {
      const teams = [{ id:'t1', score:200 }, { id:'t2', score:800 }];
      GameEngine.leaderboard(teams);
      expect(teams[0].score).toBe(200); // original order preserved
    });
  });
});
