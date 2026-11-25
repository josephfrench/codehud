import express from 'express';
import { helper } from '@/lib/helper';
const t = require('../trap.js');
const app = express();
app.get('/ping', (_req, res) => res.send(helper() + t.trapped));
