import { Router } from 'express';
import { createGame, getGame, playHumanMove, retryJev, GameError } from '../services/chessService.js';

const router = Router();
router.get('/', (_req, res) => res.render('index'));
router.post('/api/games', (_req, res) => res.status(201).json(createGame()));
router.get('/api/games/:gameId', (req, res, next) => {
  try { res.json(getGame(req.params.gameId)); } catch (error) { next(error); }
});

function turnHandler(action) {
  return async (req, res, next) => {
    try {
      const state = await action(req.params.gameId, req.body);
      res.status(state.phase === 'jev_error' ? 502 : 200).json(state);
    } catch (error) { next(error); }
  };
}

router.post('/api/games/:gameId/moves', turnHandler(playHumanMove));
router.post('/api/games/:gameId/jev-retry', turnHandler(retryJev));
router.use((error, _req, res, next) => {
  if (!(error instanceof GameError)) return next(error);
  res.status(error.status).json({ error: { code: error.code, message: error.message } });
});
export default router;
