import { Router, Request, Response } from 'express';
import { login, register, getMe } from '../services/auth.service';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const result = await login(email, password);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

router.post('/register', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }
    if (role && !['admin', 'user'].includes(role)) {
      res.status(400).json({ error: 'Role must be "admin" or "user"' });
      return;
    }
    const user = await register(email, password, name, role);
    res.status(201).json(user);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await getMe(req.user!.id);
    res.json(user);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
