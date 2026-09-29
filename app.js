import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import gameRoutes from './routes/gameRoutes.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));

app.set('view engine', 'ejs');
app.set('views', path.join(root, 'views'));
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(root, 'public')));
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(gameRoutes);
app.use((_req, res) => res.status(404).json({ error: { message: '찾을 수 없는 경로입니다.' } }));
app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: { message: status >= 500 ? '서버 오류가 발생했습니다.' : '요청 형식을 확인해 주세요.' }
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`JevChess: http://localhost:${port}`));
