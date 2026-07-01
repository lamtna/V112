'use strict';
/**
 * GameEngine — Pure state machine. No DB, no I/O, fully unit-testable.
 *
 * States: setup → lobby → playing → question → answer → scoring → finished
 *
 * FIXED:
 *  - selectQuestion now validates value is a number
 *  - applyScore prevents score going below 0 (configurable)
 *  - replay is immutable (deep clone)
 *  - isBoardComplete returns false on empty board (safe default)
 */

const VALID_TRANSITIONS = {
  setup:    ['lobby'],
  lobby:    ['playing'],
  playing:  ['question', 'finished'],
  question: ['answer'],
  answer:   ['scoring'],
  scoring:  ['playing', 'finished'],
  finished: [],
};

class GameEngine {
  /**
   * Validate and apply a state transition.
   */
  static transition(session, targetState) {
    if (!session?.state) return { success: false, error: 'Session has no state' };
    const allowed = VALID_TRANSITIONS[session.state] || [];
    if (!allowed.includes(targetState)) {
      return {
        success: false,
        error: `Invalid transition: ${session.state} → ${targetState}. Allowed: [${allowed.join(', ')}]`,
      };
    }
    return { success: true, state: targetState, version: (session.version || 0) + 1 };
  }

  /**
   * Build the game board from categories and question data.
   */
  static buildBoard(categories, questionsMap) {
    return categories.map((cat) => ({
      category: cat,
      values: (questionsMap[cat] || []).map((q) => ({
        value:      q.value,
        questionId: q._id,
        used:       false,
      })),
    }));
  }

  /**
   * Select a question cell from the board.
   * Returns { success, board, cell } | { success: false, error }
   */
  static selectQuestion(board, category, value) {
    const numValue = Number(value);
    if (!Number.isFinite(numValue)) return { success: false, error: 'Invalid value' };
    if (![200, 400, 600, 800].includes(numValue)) return { success: false, error: 'Value must be 200, 400, 600 or 800' };

    let found = null;
    const updatedBoard = board.map((col) => {
      if (col.category !== category) return col;
      return {
        ...col,
        values: col.values.map((cell) => {
          if (cell.value === numValue && !cell.used) {
            found = { ...cell };
            return { ...cell, used: true };
          }
          return cell;
        }),
      };
    });

    if (!found) return { success: false, error: `Question $${numValue} in ${category} is not available` };
    return { success: true, board: updatedBoard, cell: found };
  }

  /**
   * Apply a score delta to a team. Score will not drop below 0.
   */
  static applyScore(teams, teamId, delta, allowNegative = false) {
    let found = false;
    const updated = teams.map((t) => {
      if (t.id !== teamId) return t;
      found = true;
      const newScore = allowNegative ? t.score + delta : Math.max(0, t.score + delta);
      return { ...t, score: newScore };
    });
    if (!found) return { success: false, error: `Team ${teamId} not found` };
    return { success: true, teams: updated };
  }

  /**
   * Returns true only if board is non-empty AND all cells are used.
   */
  static isBoardComplete(board) {
    if (!Array.isArray(board) || board.length === 0) return false;
    return board.every((col) =>
      Array.isArray(col.values) && col.values.length > 0 && col.values.every((cell) => cell.used)
    );
  }

  /**
   * Sort teams by score descending.
   */
  static leaderboard(teams) {
    return [...teams].sort((a, b) => b.score - a.score);
  }

  /**
   * Replay event log onto a base snapshot state.
   * Pure — does not mutate baseState.
   */
  static replay(baseState, logs) {
    let state = JSON.parse(JSON.stringify(baseState));
    for (const log of (logs || [])) {
      try {
        state = GameEngine.applyLog(state, log);
      } catch (e) {
        // Skip corrupt log entries during replay
      }
    }
    return state;
  }

  static applyLog(state, log) {
    switch (log.action) {
      case 'STATE_TRANSITION':
        return { ...state, state: log.payload.targetState, version: log.sequence };

      case 'SCORE_UPDATE': {
        const result = GameEngine.applyScore(state.teams, log.payload.teamId, log.payload.delta);
        return result.success ? { ...state, teams: result.teams } : state;
      }

      case 'QUESTION_SELECT': {
        const result = GameEngine.selectQuestion(
          state.board, log.payload.category, log.payload.value
        );
        return result.success
          ? { ...state, board: result.board, currentQuestion: log.payload.currentQuestion }
          : state;
      }

      case 'TEAM_ADD':
        return { ...state, teams: [...state.teams, log.payload.team] };

      default:
        return state;
    }
  }
}

module.exports = GameEngine;
