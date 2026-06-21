import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import workspaceRoutes from './routes/workspaces';
import pipelineRoutes from './routes/pipelines';
import stageRoutes from './routes/stages';
import leadRoutes from './routes/leads';
import contactRoutes from './routes/contacts';
import messageRoutes from './routes/messages';
import taskRoutes from './routes/tasks';
import noteRoutes from './routes/notes';
import tagRoutes from './routes/tags';
import automationRoutes from './routes/automations';
import chatbotRoutes from './routes/chatbots';
import templateRoutes from './routes/templates';
import integrationRoutes from './routes/integrations';
import webhookRoutes from './routes/webhooks';
import analyticsRoutes from './routes/analytics';
import notificationRoutes from './routes/notifications';
import customFieldRoutes from './routes/customFields';
import fileRoutes from './routes/files';
import whatsappRoutes from './routes/whatsapp';
import broadcastRoutes from './routes/broadcasts';
import aiRoutes from './routes/ai';
import goalsRoutes from './routes/goals';
import csatRoutes, { publicRouter as csatPublicRoutes } from './routes/csat';
import teamsRoutes from './routes/teams';
import systemEmailTemplatesRoutes from './routes/systemEmailTemplates';
import productRoutes from './routes/products';
import quoteRoutes from './routes/quotes';
import sectorTemplateRoutes from './routes/sectorTemplates';
import salesAgentRoutes from './routes/salesAgent';
import billingRoutes from './routes/billing';


// Middleware
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';

// Lib
import { processExpiredDelays } from './lib/chatbotEngine';
import { checkOverdueTasks, processScheduledAutomations, checkNoResponseConversations, checkStagnantLeads } from './lib/automationEngine';
import { checkEvolutionInstances } from './lib/evolutionMonitor';
import { runDailyDigests } from './lib/dailyTaskDigest';
import { runDailyLearningConsolidation } from './lib/salesLearningConsolidator';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
});

// Global middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    // Forçar Content-Type para alguns formatos comuns
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimes: Record<string, string> = {
      webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav',
      m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      pdf: 'application/pdf',
    };
    if (ext && mimes[ext]) res.setHeader('Content-Type', mimes[ext]);
  },
}));
app.use(rateLimiter);

// Socket.io - real-time events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join:workspace', (workspaceId: string) => {
    socket.join(`workspace:${workspaceId}`);
  });

  socket.on('join:lead', (leadId: string) => {
    socket.join(`lead:${leadId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Make io available in routes
app.set('io', io);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/csat-public', csatPublicRoutes);

// Protected routes
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/workspaces', authMiddleware, workspaceRoutes);
app.use('/api/pipelines', authMiddleware, pipelineRoutes);
app.use('/api/stages', authMiddleware, stageRoutes);
app.use('/api/leads', authMiddleware, leadRoutes);
app.use('/api/contacts', authMiddleware, contactRoutes);
app.use('/api/messages', authMiddleware, messageRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/notes', authMiddleware, noteRoutes);
app.use('/api/tags', authMiddleware, tagRoutes);
app.use('/api/automations', authMiddleware, automationRoutes);
app.use('/api/chatbots', authMiddleware, chatbotRoutes);
app.use('/api/templates', authMiddleware, templateRoutes);
app.use('/api/integrations', authMiddleware, integrationRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/custom-fields', authMiddleware, customFieldRoutes);
app.use('/api/files', authMiddleware, fileRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/broadcasts', authMiddleware, broadcastRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/goals', authMiddleware, goalsRoutes);
app.use('/api/csat', authMiddleware, csatRoutes);
app.use('/api/teams', authMiddleware, teamsRoutes);
app.use('/api/system-email-templates', authMiddleware, systemEmailTemplatesRoutes);
app.use('/api/products', authMiddleware, productRoutes);
app.use('/api/quotes', authMiddleware, quoteRoutes);
app.use('/api/sector-templates', authMiddleware, sectorTemplateRoutes);
app.use('/api/sales-agent', authMiddleware, salesAgentRoutes);
app.use('/api/billing', authMiddleware, billingRoutes);


// Error handler (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  // Migrar credenciais de integrações legadas (plaintext) para o formato encriptado.
  // Idempotente: corre todos os arranques mas só toca nas que ainda não estão encriptadas.
  try {
    const { migrateAllCredentialsToEncrypted } = await import('./lib/integrationCrypto');
    const prismaSingleton = (await import('./lib/prisma')).default;
    await migrateAllCredentialsToEncrypted(prismaSingleton);
  } catch (e: any) {
    console.error('Falha a migrar credenciais para encriptado:', e.message);
  }
});

// Processa delays de chatbots expirados a cada 30 segundos
// (cobre casos em que o setTimeout in-memory se perdeu por reinício)
setInterval(() => {
  processExpiredDelays().catch((e) => console.error('processExpiredDelays error:', e));
}, 30_000);

// Verifica tarefas atrasadas a cada minuto e dispara automações de task_overdue
setInterval(() => {
  checkOverdueTasks().catch((e) => console.error('checkOverdueTasks error:', e));
}, 60_000);

// Dispara automações com trigger schedule (every_X_minutes, daily_at, weekly_at, monthly_at)
setInterval(() => {
  processScheduledAutomations().catch((e) => console.error('processScheduledAutomations error:', e));
}, 60_000);

// Verifica conversas sem resposta (trigger no_response) — corre a cada 5 minutos
setInterval(() => {
  checkNoResponseConversations().catch((e) => console.error('checkNoResponseConversations error:', e));
}, 5 * 60_000);

// Verifica leads parados (trigger lead_stagnant) — corre a cada hora
setInterval(() => {
  checkStagnantLeads().catch((e) => console.error('checkStagnantLeads error:', e));
}, 60 * 60_000);

// Monitoriza instâncias Evolution (auto-reconnect + notificação de desconexão) — corre a cada 5 minutos
setInterval(() => {
  checkEvolutionInstances().catch((e) => console.error('checkEvolutionInstances error:', e));
}, 5 * 60_000);
// E primeira verificação 30s após o startup
setTimeout(() => {
  checkEvolutionInstances().catch(() => {});
}, 30_000);

// Digest diário de tarefas — corre a cada minuto. A função verifica se algum
// workspace tem o digest agendado para esta HH:MM e dispara só nesses casos.
setInterval(() => {
  runDailyDigests().catch((e) => console.error('runDailyDigests error:', e));
}, 60_000);

// IA Vendedora: consolidação nocturna da memória aprendida (Fase 4).
// Roda 1x por hora; a própria função só executa quando a hora local é 02.
setInterval(() => {
  runDailyLearningConsolidation().catch((e) => console.error('runDailyLearningConsolidation error:', e));
}, 60 * 60_000);

(global as any).io = io;
export { io };
export default app;
